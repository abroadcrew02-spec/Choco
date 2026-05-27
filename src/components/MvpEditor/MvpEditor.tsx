import { useRef, useState, useCallback, useEffect } from "react";

interface PaintRegion {
  id: string;
  pixels: { x: number; y: number }[];
  color: string;
  transparent: boolean;
}

interface MvpEditorState {
  imageData: ImageData | null;
  naturalWidth: number;
  naturalHeight: number;
  regions: PaintRegion[];
}

const DEFAULT_COLOR = "#ff0000";
const DEFAULT_TOLERANCE = 32;

function hexToRgb(hex: string): [number, number, number] {
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
  return Math.sqrt(
    (r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2
  );
}

/**
 * Flood fill: returns the set of pixel coordinates reachable from (startX, startY)
 * within the given color tolerance.
 */
function floodFillSelect(
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
 * Applies all paint regions to the base imageData and returns the composited ImageData.
 */
function compositeRegions(
  baseImageData: ImageData,
  regions: PaintRegion[]
): ImageData {
  const { width, height } = baseImageData;
  const result = new ImageData(
    new Uint8ClampedArray(baseImageData.data),
    width,
    height
  );

  for (const region of regions) {
    if (region.transparent) {
      for (const { x, y } of region.pixels) {
        const idx = (y * width + x) * 4;
        result.data[idx + 3] = 0;
      }
    } else {
      const [r, g, b] = hexToRgb(region.color);
      for (const { x, y } of region.pixels) {
        const idx = (y * width + x) * 4;
        result.data[idx] = r;
        result.data[idx + 1] = g;
        result.data[idx + 2] = b;
        result.data[idx + 3] = 255;
      }
    }
  }

  return result;
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
 * Renders a single paint region as a PNG data URL.
 * The canvas is the same size as the source image (width x height).
 * Only the pixels listed in region.pixels are filled with region.color (alpha=255);
 * all other pixels remain fully transparent (alpha=0).
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
 * Builds an SVG with pixel-accurate color regions.
 * The base image is embedded as an <image> element (with transparent mask applied
 * when transparent regions exist). Each color-change region is rendered as a
 * separate full-canvas PNG layer so that only the exact flood-filled pixels are
 * painted — no bounding-box approximation.
 */
function buildSvg(
  imageData: ImageData,
  regions: PaintRegion[],
  width: number,
  height: number
): string {
  const baseDataUrl = imageDataToPngDataUrl(imageData);

  const transparentRegionPixels = regions
    .filter((r) => r.transparent)
    .flatMap((r) => r.pixels);

  const transparentMaskRects =
    transparentRegionPixels.length > 0
      ? transparentRegionPixels
          .map((p) => `    <rect x="${p.x}" y="${p.y}" width="1" height="1" fill="black" />`)
          .join("\n")
      : "";

  const maskSection =
    transparentMaskRects.length > 0
      ? `  <mask id="transparentMask">
    <rect width="${width}" height="${height}" fill="white" />
${transparentMaskRects}
  </mask>`
      : "";

  const imageElement =
    transparentMaskRects.length > 0
      ? `  <image href="${baseDataUrl}" width="${width}" height="${height}" mask="url(#transparentMask)" />`
      : `  <image href="${baseDataUrl}" width="${width}" height="${height}" />`;

  const colorRegionElements = regions
    .filter((r) => !r.transparent && r.pixels.length > 0)
    .map((region) => {
      const pngDataUrl = regionToPngDataUrl(region, width, height);
      return `  <image href="${pngDataUrl}" width="${width}" height="${height}" />`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
${maskSection}
${imageElement}
${colorRegionElements}
</svg>`;
}

export function MvpEditor() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [state, setState] = useState<MvpEditorState>({
    imageData: null,
    naturalWidth: 0,
    naturalHeight: 0,
    regions: [],
  });

  const [mode, setMode] = useState<"color" | "transparent">("color");
  const [selectedColor, setSelectedColor] = useState(DEFAULT_COLOR);
  const [tolerance, setTolerance] = useState(DEFAULT_TOLERANCE);
  const [status, setStatus] = useState("画像を読み込んでください");

  // Redraw canvas whenever state changes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !state.imageData) return;
    const ctx = canvas.getContext("2d")!;
    const composited = compositeRegions(state.imageData, state.regions);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.putImageData(composited, 0, 0);
  }, [state]);

  const loadImageFromFile = useCallback((file: File) => {
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

      setState({
        imageData,
        naturalWidth: w,
        naturalHeight: h,
        regions: [],
      });
      setStatus(`画像読み込み完了: ${w}x${h}`);
    };
    img.onerror = () => {
      setStatus("画像の読み込みに失敗しました");
      URL.revokeObjectURL(url);
    };
    img.src = url;
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file && file.type.startsWith("image/")) {
        loadImageFromFile(file);
      }
    },
    [loadImageFromFile]
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) loadImageFromFile(file);
    },
    [loadImageFromFile]
  );

  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas || !state.imageData) return;

      const rect = canvas.getBoundingClientRect();
      const scaleX = state.naturalWidth / rect.width;
      const scaleY = state.naturalHeight / rect.height;
      const x = Math.floor((e.clientX - rect.left) * scaleX);
      const y = Math.floor((e.clientY - rect.top) * scaleY);

      if (x < 0 || x >= state.naturalWidth || y < 0 || y >= state.naturalHeight) return;

      const pixels = floodFillSelect(state.imageData, x, y, tolerance);
      if (pixels.length === 0) return;

      const newRegion: PaintRegion = {
        id: `region-${Date.now()}`,
        pixels,
        color: selectedColor,
        transparent: mode === "transparent",
      };

      setState((prev) => ({
        ...prev,
        regions: [...prev.regions, newRegion],
      }));

      setStatus(
        mode === "transparent"
          ? `透過: ${pixels.length}px 選択`
          : `色変更: ${pixels.length}px → ${selectedColor}`
      );
    },
    [state, tolerance, selectedColor, mode]
  );

  const handleUndo = useCallback(() => {
    setState((prev) => ({
      ...prev,
      regions: prev.regions.slice(0, -1),
    }));
    setStatus("元に戻しました");
  }, []);

  const handleReset = useCallback(() => {
    setState((prev) => ({ ...prev, regions: [] }));
    setStatus("全リセット完了");
  }, []);

  const handleExportSvg = useCallback(() => {
    if (!state.imageData) return;

    const svgString = buildSvg(
      state.imageData,
      state.regions,
      state.naturalWidth,
      state.naturalHeight
    );

    const blob = new Blob([svgString], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "export.svg";
    a.click();
    URL.revokeObjectURL(url);
    setStatus("SVGをエクスポートしました");
  }, [state]);

  const handleExportPng = useCallback(() => {
    if (!state.imageData) return;

    const composited = compositeRegions(state.imageData, state.regions);
    const url = imageDataToPngDataUrl(composited);
    const a = document.createElement("a");
    a.href = url;
    a.download = "export.png";
    a.click();
    setStatus("PNGをエクスポートしました");
  }, [state]);

  const canvasStyle: React.CSSProperties = {
    maxWidth: "100%",
    maxHeight: "100%",
    cursor: state.imageData ? "crosshair" : "default",
    display: "block",
  };

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
          gap: 12,
          padding: "8px 16px",
          background: "#1a1a1a",
          borderBottom: "1px solid #444",
          flexWrap: "wrap",
        }}
      >
        {/* File open */}
        <button
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

        <div style={{ width: 1, height: 24, background: "#444" }} />

        {/* Mode */}
        <label style={{ fontSize: 12, color: "#aaa" }}>モード:</label>
        <button
          onClick={() => setMode("color")}
          style={{ ...btnStyle, background: mode === "color" ? "#0066cc" : "#444" }}
        >
          色変更
        </button>
        <button
          onClick={() => setMode("transparent")}
          style={{ ...btnStyle, background: mode === "transparent" ? "#0066cc" : "#444" }}
        >
          透過
        </button>

        {/* Color picker */}
        {mode === "color" && (
          <>
            <label style={{ fontSize: 12, color: "#aaa" }}>色:</label>
            <input
              type="color"
              value={selectedColor}
              onChange={(e) => setSelectedColor(e.target.value)}
              style={{ width: 36, height: 28, cursor: "pointer", border: "none", borderRadius: 4 }}
            />
          </>
        )}

        {/* Tolerance */}
        <label style={{ fontSize: 12, color: "#aaa" }}>許容値: {tolerance}</label>
        <input
          type="range"
          min={0}
          max={128}
          value={tolerance}
          onChange={(e) => setTolerance(Number(e.target.value))}
          style={{ width: 80 }}
        />

        <div style={{ width: 1, height: 24, background: "#444" }} />

        {/* Undo / Reset */}
        <button onClick={handleUndo} disabled={state.regions.length === 0} style={btnStyle}>
          元に戻す
        </button>
        <button onClick={handleReset} disabled={state.regions.length === 0} style={{ ...btnStyle, background: "#662222" }}>
          全リセット
        </button>

        <div style={{ width: 1, height: 24, background: "#444" }} />

        {/* Export */}
        <button
          onClick={handleExportSvg}
          disabled={!state.imageData}
          style={{ ...btnStyle, background: "#226622" }}
        >
          SVG出力
        </button>
        <button
          onClick={handleExportPng}
          disabled={!state.imageData}
          style={{ ...btnStyle, background: "#226622" }}
        >
          PNG出力
        </button>

        {/* Status */}
        <span style={{ marginLeft: "auto", fontSize: 11, color: "#888" }}>{status}</span>
      </div>

      {/* Canvas area */}
      <div
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "auto",
          position: "relative",
          backgroundImage:
            "linear-gradient(45deg, #3a3a3a 25%, transparent 25%), " +
            "linear-gradient(-45deg, #3a3a3a 25%, transparent 25%), " +
            "linear-gradient(45deg, transparent 75%, #3a3a3a 75%), " +
            "linear-gradient(-45deg, transparent 75%, #3a3a3a 75%)",
          backgroundSize: "16px 16px",
          backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0px",
        }}
      >
        {!state.imageData ? (
          <div
            style={{
              border: "2px dashed #666",
              borderRadius: 8,
              padding: "48px 64px",
              textAlign: "center",
              color: "#888",
            }}
          >
            <p style={{ margin: 0, fontSize: 18 }}>ここに画像をドロップ</p>
            <p style={{ margin: "8px 0 0", fontSize: 13 }}>または「画像を開く」ボタン</p>
          </div>
        ) : (
          <canvas
            ref={canvasRef}
            width={state.naturalWidth}
            height={state.naturalHeight}
            onClick={handleCanvasClick}
            style={canvasStyle}
          />
        )}
      </div>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  padding: "4px 12px",
  background: "#444",
  color: "#f0f0f0",
  border: "1px solid #666",
  borderRadius: 4,
  cursor: "pointer",
  fontSize: 13,
};
