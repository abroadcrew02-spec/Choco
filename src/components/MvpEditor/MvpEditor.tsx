import { useRef, useState, useCallback, useEffect } from "react";
import { useUndoRedo } from "./hooks/useUndoRedo";
import { useZoomPan } from "./hooks/useZoomPan";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PaintRegion {
  id: string;
  pixels: { x: number; y: number }[];
  color: string;
  transparent: boolean;
}

interface BaseState {
  imageData: ImageData | null;
  naturalWidth: number;
  naturalHeight: number;
}

type EditorMode = "color" | "transparent";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_COLOR = "#ff0000";
const DEFAULT_TOLERANCE = 32;
const SVG_TARGET_LONG_EDGE = 2048;
const ACCEPTED_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".bmp", ".svg", ".gif"];

// ---------------------------------------------------------------------------
// Pure utility functions (exported for testing)
// ---------------------------------------------------------------------------

export function hexToRgb(hex: string): [number, number, number] {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return [0, 0, 0];
  return [
    parseInt(result[1], 16),
    parseInt(result[2], 16),
    parseInt(result[3], 16),
  ];
}

function colorDistance(
  r1: number, g1: number, b1: number,
  r2: number, g2: number, b2: number
): number {
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
}

/**
 * Flood fill selection. Returns the set of pixel coordinates reachable from
 * (startX, startY) within the given color tolerance.
 */
export function floodFillSelect(
  imageData: ImageData,
  startX: number,
  startY: number,
  tolerance: number
): { x: number; y: number }[] {
  const { width, height, data } = imageData;
  const startIdx = (startY * width + startX) * 4;
  const startR = data[startIdx];
  const startG = data[startIdx + 1];
  const startB = data[startIdx + 2];

  const visited = new Uint8Array(width * height);
  const result: { x: number; y: number }[] = [];
  const stack: number[] = [startY * width + startX];
  visited[startY * width + startX] = 1;

  while (stack.length > 0) {
    const idx = stack.pop()!;
    const x = idx % width;
    const y = Math.floor(idx / width);
    const pixelIdx = idx * 4;

    const r = data[pixelIdx];
    const g = data[pixelIdx + 1];
    const b = data[pixelIdx + 2];

    if (colorDistance(r, g, b, startR, startG, startB) > tolerance) continue;

    result.push({ x, y });

    const neighbors = [
      { nx: x - 1, ny: y },
      { nx: x + 1, ny: y },
      { nx: x, ny: y - 1 },
      { nx: x, ny: y + 1 },
    ];

    for (const { nx, ny } of neighbors) {
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      const nIdx = ny * width + nx;
      if (visited[nIdx]) continue;
      visited[nIdx] = 1;
      stack.push(nIdx);
    }
  }

  return result;
}

/**
 * Applies all paint regions to the base imageData and returns composited ImageData.
 * No layer opacity/visibility — regions are directly applied on top of base.
 */
export function compositeRegions(
  baseImageData: ImageData,
  regions: PaintRegion[]
): ImageData {
  const { width, height } = baseImageData;
  const resultData = new Uint8ClampedArray(baseImageData.data);

  for (const region of regions) {
    if (region.transparent) {
      for (const { x, y } of region.pixels) {
        const idx = (y * width + x) * 4;
        resultData[idx + 3] = 0;
      }
    } else {
      const [r, g, b] = hexToRgb(region.color);
      for (const { x, y } of region.pixels) {
        const idx = (y * width + x) * 4;
        resultData[idx] = r;
        resultData[idx + 1] = g;
        resultData[idx + 2] = b;
        resultData[idx + 3] = 255;
      }
    }
  }

  return new ImageData(resultData, width, height);
}

/**
 * Converts ImageData to a PNG data URL via an offscreen canvas.
 */
function imageDataToPngDataUrl(imageData: ImageData): string {
  const canvas = document.createElement("canvas");
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const ctx = canvas.getContext("2d")!;
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL("image/png");
}

/**
 * Renders a single non-transparent paint region as a PNG data URL.
 */
function regionToPngDataUrl(
  region: PaintRegion,
  width: number,
  height: number
): string {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  const imageData = ctx.createImageData(width, height);
  const [r, g, b] = hexToRgb(region.color);
  for (const { x, y } of region.pixels) {
    const idx = (y * width + x) * 4;
    imageData.data[idx] = r;
    imageData.data[idx + 1] = g;
    imageData.data[idx + 2] = b;
    imageData.data[idx + 3] = 255;
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL("image/png");
}

/**
 * Builds an SVG with pixel-accurate color regions, using independent PNG
 * <image> elements per region (pixel-complete, no opacity compositing).
 */
export function buildSvg(
  imageData: ImageData,
  regions: PaintRegion[],
  width: number,
  height: number
): string {
  const baseDataUrl = imageDataToPngDataUrl(imageData);

  const transparentPixels = regions
    .filter((r) => r.transparent)
    .flatMap((r) => r.pixels);

  const maskRects =
    transparentPixels.length > 0
      ? transparentPixels
          .map((p) => `    <rect x="${p.x}" y="${p.y}" width="1" height="1" fill="black" />`)
          .join("\n")
      : "";

  const maskSection =
    maskRects.length > 0
      ? `  <mask id="transparentMask">
    <rect width="${width}" height="${height}" fill="white" />
${maskRects}
  </mask>`
      : "";

  const imageElement =
    maskRects.length > 0
      ? `  <image href="${baseDataUrl}" width="${width}" height="${height}" mask="url(#transparentMask)" />`
      : `  <image href="${baseDataUrl}" width="${width}" height="${height}" />`;

  const colorElements = regions
    .filter((r) => !r.transparent && r.pixels.length > 0)
    .map((region) => {
      const pngUrl = regionToPngDataUrl(region, width, height);
      return `  <image href="${pngUrl}" width="${width}" height="${height}" />`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
${maskSection}
${imageElement}
${colorElements}
</svg>`;
}

/**
 * Rewrites an SVG string so its rendered size has a long edge of
 * SVG_TARGET_LONG_EDGE pixels, preserving aspect ratio.
 */
function rewriteSvgForHighResRasterize(svgText: string): {
  text: string;
  width: number;
  height: number;
} {
  const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
  const svg = doc.documentElement;

  let aspectW = 1;
  let aspectH = 1;

  const viewBox = svg.getAttribute("viewBox");
  if (viewBox) {
    const parts = viewBox.trim().split(/[\s,]+/);
    if (parts.length === 4) {
      const vbW = parseFloat(parts[2]);
      const vbH = parseFloat(parts[3]);
      if (vbW > 0 && vbH > 0) {
        aspectW = vbW;
        aspectH = vbH;
      }
    }
  } else {
    const attrW = parseFloat(svg.getAttribute("width") ?? "0");
    const attrH = parseFloat(svg.getAttribute("height") ?? "0");
    if (attrW > 0 && attrH > 0) {
      aspectW = attrW;
      aspectH = attrH;
    }
  }

  let targetW: number;
  let targetH: number;
  if (aspectW >= aspectH) {
    targetW = SVG_TARGET_LONG_EDGE;
    targetH = Math.round((aspectH / aspectW) * SVG_TARGET_LONG_EDGE);
  } else {
    targetH = SVG_TARGET_LONG_EDGE;
    targetW = Math.round((aspectW / aspectH) * SVG_TARGET_LONG_EDGE);
  }

  svg.setAttribute("width", String(targetW));
  svg.setAttribute("height", String(targetH));

  const serialized = new XMLSerializer().serializeToString(doc);
  return { text: serialized, width: targetW, height: targetH };
}

/**
 * Returns true if the file should be accepted as an image based on
 * MIME type or file extension (C-2 fix: extension fallback for WebView2).
 */
export function isAcceptedImageFile(file: { type: string; name: string }): boolean {
  if (file.type.startsWith("image/")) return true;
  const lower = file.name.toLowerCase();
  return ACCEPTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function MvpEditor() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [baseState, setBaseState] = useState<BaseState>({
    imageData: null,
    naturalWidth: 0,
    naturalHeight: 0,
  });

  const regionHistory = useUndoRedo<PaintRegion[]>([]);
  const regions = regionHistory.current;

  const [mode, setMode] = useState<EditorMode>("color");
  const [selectedColor, setSelectedColor] = useState(DEFAULT_COLOR);
  const [tolerance, setTolerance] = useState(DEFAULT_TOLERANCE);
  const [status, setStatus] = useState("画像を読み込んでください");
  const [spacePressed, setSpacePressed] = useState(false);

  const zoom = useZoomPan(spacePressed);

  // ---------------------------------------------------------------------------
  // Keyboard shortcuts: Ctrl+Z, Ctrl+Y, Space
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        e.preventDefault();
        setSpacePressed(true);
        return;
      }
      if (e.ctrlKey && e.key === "z") {
        e.preventDefault();
        regionHistory.undo();
        setStatus("元に戻しました");
        return;
      }
      if (e.ctrlKey && (e.key === "y" || (e.shiftKey && e.key === "Z"))) {
        e.preventDefault();
        regionHistory.redo();
        setStatus("やり直しました");
        return;
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        setSpacePressed(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [regionHistory]);

  // ---------------------------------------------------------------------------
  // Canvas redraw
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !baseState.imageData) return;
    const ctx = canvas.getContext("2d")!;
    const composited = compositeRegions(baseState.imageData, regions);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.putImageData(composited, 0, 0);
  }, [baseState, regions]);

  // ---------------------------------------------------------------------------
  // Image loading
  // ---------------------------------------------------------------------------

  const loadImageFromFile = useCallback(
    (file: File) => {
      const isSvg =
        file.type === "image/svg+xml" ||
        file.name.toLowerCase().endsWith(".svg");

      if (isSvg) {
        const reader = new FileReader();
        reader.onload = () => {
          const svgText = reader.result as string;
          let rewritten: ReturnType<typeof rewriteSvgForHighResRasterize>;
          try {
            rewritten = rewriteSvgForHighResRasterize(svgText);
          } catch {
            setStatus("SVGの解析に失敗しました");
            return;
          }
          const { text, width: w, height: h } = rewritten;
          const blob = new Blob([text], { type: "image/svg+xml" });
          const url = URL.createObjectURL(blob);
          const img = new Image();
          img.onload = () => {
            const offscreen = document.createElement("canvas");
            offscreen.width = w;
            offscreen.height = h;
            const ctx = offscreen.getContext("2d")!;
            ctx.drawImage(img, 0, 0, w, h);
            const imageData = ctx.getImageData(0, 0, w, h);
            URL.revokeObjectURL(url);
            setBaseState({ imageData, naturalWidth: w, naturalHeight: h });
            regionHistory.reset([]);
            setStatus(`画像読み込み完了: ${w}x${h}`);
          };
          img.onerror = () => {
            setStatus("SVG画像の読み込みに失敗しました");
            URL.revokeObjectURL(url);
          };
          img.src = url;
        };
        reader.onerror = () => setStatus("ファイルの読み込みに失敗しました");
        reader.readAsText(file);
        return;
      }

      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const w = img.naturalWidth;
        const h = img.naturalHeight;
        const offscreen = document.createElement("canvas");
        offscreen.width = w;
        offscreen.height = h;
        const ctx = offscreen.getContext("2d")!;
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, w, h);
        URL.revokeObjectURL(url);
        setBaseState({ imageData, naturalWidth: w, naturalHeight: h });
        regionHistory.reset([]);
        setStatus(`画像読み込み完了: ${w}x${h}`);
      };
      img.onerror = () => {
        setStatus("画像の読み込みに失敗しました");
        URL.revokeObjectURL(url);
      };
      img.src = url;
    },
    [regionHistory]
  );

  // C-2 fix: accept by MIME type OR file extension fallback
  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file && isAcceptedImageFile(file)) {
        loadImageFromFile(file);
      }
    },
    [loadImageFromFile]
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) loadImageFromFile(file);
      e.target.value = "";
    },
    [loadImageFromFile]
  );

  // ---------------------------------------------------------------------------
  // Canvas interaction
  // ---------------------------------------------------------------------------

  const getCanvasCoords = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>): { x: number; y: number } | null => {
      const canvas = canvasRef.current;
      if (!canvas || !baseState.imageData) return null;
      const rect = canvas.getBoundingClientRect();
      const scaleX = baseState.naturalWidth / rect.width;
      const scaleY = baseState.naturalHeight / rect.height;
      const x = Math.floor((e.clientX - rect.left) * scaleX);
      const y = Math.floor((e.clientY - rect.top) * scaleY);
      if (x < 0 || x >= baseState.naturalWidth || y < 0 || y >= baseState.naturalHeight)
        return null;
      return { x, y };
    },
    [baseState]
  );

  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (spacePressed) return;
      if (!baseState.imageData) return;
      const coords = getCanvasCoords(e);
      if (!coords) return;
      const { x, y } = coords;

      const pixels = floodFillSelect(baseState.imageData, x, y, tolerance);
      if (pixels.length === 0) return;

      const newRegion: PaintRegion = {
        id: `region-${Date.now()}`,
        pixels,
        color: selectedColor,
        transparent: mode === "transparent",
      };

      regionHistory.push([...regions, newRegion]);
      setStatus(
        mode === "transparent"
          ? `透過: ${pixels.length}px 選択`
          : `色変更: ${pixels.length}px → ${selectedColor}`
      );
    },
    [baseState, tolerance, selectedColor, mode, spacePressed, regions, regionHistory, getCanvasCoords]
  );

  // ---------------------------------------------------------------------------
  // Export handlers
  // ---------------------------------------------------------------------------

  const handleExportSvg = useCallback(() => {
    if (!baseState.imageData) return;
    const svgString = buildSvg(
      baseState.imageData,
      regions,
      baseState.naturalWidth,
      baseState.naturalHeight
    );
    const blob = new Blob([svgString], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "export.svg";
    a.click();
    URL.revokeObjectURL(url);
    setStatus("SVGをエクスポートしました");
  }, [baseState, regions]);

  const handleExportPng = useCallback(() => {
    if (!baseState.imageData) return;
    const composited = compositeRegions(baseState.imageData, regions);
    const url = imageDataToPngDataUrl(composited);
    const a = document.createElement("a");
    a.href = url;
    a.download = "export.png";
    a.click();
    setStatus("PNGをエクスポートしました");
  }, [baseState, regions]);

  // ---------------------------------------------------------------------------
  // Fit to container
  // ---------------------------------------------------------------------------

  const handleFit = useCallback(() => {
    const container = containerRef.current;
    if (!container || baseState.naturalWidth === 0) return;
    zoom.fitToContainer(
      container.clientWidth,
      container.clientHeight,
      baseState.naturalWidth,
      baseState.naturalHeight
    );
  }, [zoom, baseState.naturalWidth, baseState.naturalHeight]);

  // ---------------------------------------------------------------------------
  // Derived values
  // ---------------------------------------------------------------------------

  const canvasCursor = spacePressed
    ? zoom.isPanning
      ? "grabbing"
      : "grab"
    : baseState.imageData
      ? "crosshair"
      : "default";

  const zoomPercent = Math.round(zoom.scale * 100);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        width: "100%",
        background: "#2d2d2d",
        color: "#f0f0f0",
        fontFamily: "sans-serif",
      }}
    >
      {/* Toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "8px 16px",
          background: "#1a1a1a",
          borderBottom: "1px solid #444",
          flexWrap: "wrap",
        }}
      >
        {/* Open image */}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          style={btnStyle}
        >
          画像を開く
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={handleFileChange}
        />

        <div style={dividerStyle} />

        {/* Mode */}
        <span style={labelStyle}>モード:</span>
        <button
          type="button"
          onClick={() => setMode("color")}
          style={{ ...btnStyle, background: mode === "color" ? "#0066cc" : "#444" }}
        >
          色変更
        </button>
        <button
          type="button"
          onClick={() => setMode("transparent")}
          style={{ ...btnStyle, background: mode === "transparent" ? "#0066cc" : "#444" }}
        >
          透過
        </button>

        {/* Color picker (HTML native) */}
        {mode === "color" && (
          <input
            type="color"
            value={selectedColor}
            onChange={(e) => setSelectedColor(e.target.value)}
            style={{ width: 36, height: 28, cursor: "pointer", border: "1px solid #666", borderRadius: 4, background: "none" }}
            title="色を選択"
          />
        )}

        {/* Tolerance */}
        <span style={labelStyle}>許容値: {tolerance}</span>
        <input
          type="range"
          min={0}
          max={128}
          value={tolerance}
          onChange={(e) => setTolerance(Number(e.target.value))}
          style={{ width: 80 }}
        />

        <div style={dividerStyle} />

        {/* Undo / Redo */}
        <button
          type="button"
          onClick={() => { regionHistory.undo(); setStatus("元に戻しました"); }}
          disabled={!regionHistory.canUndo}
          style={btnStyle}
          title="元に戻す (Ctrl+Z)"
        >
          Undo
        </button>
        <button
          type="button"
          onClick={() => { regionHistory.redo(); setStatus("やり直しました"); }}
          disabled={!regionHistory.canRedo}
          style={btnStyle}
          title="やり直し (Ctrl+Y)"
        >
          Redo
        </button>
        <button
          type="button"
          onClick={() => { regionHistory.reset([]); setStatus("全リセット完了"); }}
          disabled={regions.length === 0}
          style={{ ...btnStyle, background: "#662222" }}
        >
          全リセット
        </button>

        <div style={dividerStyle} />

        {/* Zoom */}
        <button
          type="button"
          onClick={handleFit}
          disabled={!baseState.imageData}
          style={btnStyle}
        >
          Fit
        </button>

        <div style={dividerStyle} />

        {/* Export */}
        <button
          type="button"
          onClick={handleExportSvg}
          disabled={!baseState.imageData}
          style={{ ...btnStyle, background: "#226622" }}
        >
          SVG出力
        </button>
        <button
          type="button"
          onClick={handleExportPng}
          disabled={!baseState.imageData}
          style={{ ...btnStyle, background: "#226622" }}
        >
          PNG出力
        </button>

        <span style={{ marginLeft: "auto", fontSize: 11, color: "#888" }}>{status}</span>
      </div>

      {/* Canvas area */}
      <div
        ref={containerRef}
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        onWheel={zoom.onWheel}
        onMouseDown={zoom.onMouseDown}
        onMouseMove={zoom.onMouseMove}
        onMouseUp={zoom.onMouseUp}
        onMouseLeave={zoom.onMouseUp}
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          position: "relative",
          cursor: canvasCursor,
          backgroundImage:
            "linear-gradient(45deg, #3a3a3a 25%, transparent 25%), " +
            "linear-gradient(-45deg, #3a3a3a 25%, transparent 25%), " +
            "linear-gradient(45deg, transparent 75%, #3a3a3a 75%), " +
            "linear-gradient(-45deg, transparent 75%, #3a3a3a 75%)",
          backgroundSize: "16px 16px",
          backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0px",
        }}
      >
        {!baseState.imageData ? (
          <div
            style={{
              border: "2px dashed #666",
              borderRadius: 8,
              padding: "48px 64px",
              textAlign: "center",
              color: "#888",
              pointerEvents: "none",
            }}
          >
            <p style={{ margin: 0, fontSize: 18 }}>ここに画像をドロップ</p>
            <p style={{ margin: "8px 0 0", fontSize: 13 }}>または「画像を開く」ボタン</p>
            <p style={{ margin: "4px 0 0", fontSize: 11, color: "#666" }}>PNG / JPG / SVG / WebP / BMP 対応</p>
          </div>
        ) : (
          <div
            style={{
              transform: `translate(${zoom.offsetX}px, ${zoom.offsetY}px) scale(${zoom.scale})`,
              transformOrigin: "0 0",
              position: "absolute",
              top: 0,
              left: 0,
            }}
          >
            <canvas
              ref={canvasRef}
              width={baseState.naturalWidth}
              height={baseState.naturalHeight}
              onClick={handleCanvasClick}
              style={{ cursor: canvasCursor, display: "block" }}
            />
          </div>
        )}

        {/* Status bar (bottom-left) */}
        {baseState.imageData && (
          <div style={statusBarStyle}>
            モード: {mode === "color" ? "色変更" : "透過"} | {baseState.naturalWidth}x{baseState.naturalHeight}
          </div>
        )}

        {/* Zoom indicator (bottom-right) */}
        {baseState.imageData && (
          <div style={zoomIndicatorStyle}>
            {zoomPercent}%
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared styles
// ---------------------------------------------------------------------------

const btnStyle: React.CSSProperties = {
  padding: "4px 12px",
  background: "#444",
  color: "#f0f0f0",
  border: "1px solid #666",
  borderRadius: 4,
  cursor: "pointer",
  fontSize: 13,
};

const dividerStyle: React.CSSProperties = {
  width: 1,
  height: 24,
  background: "#444",
};

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#aaa",
};

const statusBarStyle: React.CSSProperties = {
  position: "absolute",
  bottom: 8,
  left: 12,
  fontSize: 11,
  color: "#aaa",
  background: "rgba(0,0,0,0.5)",
  padding: "2px 8px",
  borderRadius: 3,
  pointerEvents: "none",
};

const zoomIndicatorStyle: React.CSSProperties = {
  position: "absolute",
  bottom: 8,
  right: 12,
  fontSize: 11,
  color: "#aaa",
  background: "rgba(0,0,0,0.5)",
  padding: "2px 6px",
  borderRadius: 3,
  pointerEvents: "none",
};
