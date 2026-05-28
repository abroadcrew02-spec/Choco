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

type EditorMode = "color" | "transparent" | "eyedropper" | "replace-all";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_COLOR = "#ff0000";
const DEFAULT_TOLERANCE = 32;
const SVG_TARGET_LONG_EDGE = 2048;
const ACCEPTED_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".bmp", ".svg", ".gif"];
const PALETTE_BUCKETS = 32; // quantization step per channel

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

export function rgbToHex(r: number, g: number, b: number): string {
  return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
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
 * Selects all pixels in the image whose color is within tolerance of the
 * pixel at (startX, startY), regardless of connectivity.
 */
export function replaceAllSelect(
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

  const result: { x: number; y: number }[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      if (colorDistance(r, g, b, startR, startG, startB) <= tolerance) {
        result.push({ x, y });
      }
    }
  }
  return result;
}

/**
 * Picks the RGB color of a single pixel from ImageData.
 * Returns [r, g, b] or null if out of bounds.
 */
export function pickPixelColor(
  imageData: ImageData,
  x: number,
  y: number
): [number, number, number] | null {
  const { width, height, data } = imageData;
  if (x < 0 || x >= width || y < 0 || y >= height) return null;
  const idx = (y * width + x) * 4;
  return [data[idx], data[idx + 1], data[idx + 2]];
}

/**
 * Extracts up to `count` dominant colors from ImageData using histogram
 * quantization (each channel bucketed to PALETTE_BUCKETS steps).
 */
export function extractPaletteColors(
  imageData: ImageData,
  count: number
): string[] {
  const { width, height, data } = imageData;
  const bucketMap = new Map<number, number>();
  const step = PALETTE_BUCKETS;

  for (let i = 0; i < width * height; i++) {
    const r = Math.floor(data[i * 4] / step) * step;
    const g = Math.floor(data[i * 4 + 1] / step) * step;
    const b = Math.floor(data[i * 4 + 2] / step) * step;
    const a = data[i * 4 + 3];
    if (a < 128) continue; // skip mostly-transparent pixels
    const key = (r << 16) | (g << 8) | b;
    bucketMap.set(key, (bucketMap.get(key) ?? 0) + 1);
  }

  const sorted = [...bucketMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, count);

  return sorted.map(([key]) => {
    const r = (key >> 16) & 0xff;
    const g = (key >> 8) & 0xff;
    const b = key & 0xff;
    return rgbToHex(r, g, b);
  });
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
function imageDataToPngDataUrl(imageData: ImageData, scale = 1): string {
  const canvas = document.createElement("canvas");
  canvas.width = imageData.width * scale;
  canvas.height = imageData.height * scale;
  const ctx = canvas.getContext("2d")!;
  if (scale > 1) {
    ctx.imageSmoothingEnabled = false;
    const tmpCanvas = document.createElement("canvas");
    tmpCanvas.width = imageData.width;
    tmpCanvas.height = imageData.height;
    const tmpCtx = tmpCanvas.getContext("2d")!;
    tmpCtx.putImageData(imageData, 0, 0);
    ctx.drawImage(tmpCanvas, 0, 0, imageData.width * scale, imageData.height * scale);
  } else {
    ctx.putImageData(imageData, 0, 0);
  }
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
  const [hoverInfo, setHoverInfo] = useState<string | null>(null);
  const [palette, setPalette] = useState<string[]>([]);
  const [pngScale, setPngScale] = useState<1 | 2 | 4>(1);
  const [showMapping, setShowMapping] = useState(true);
  const [showPalette, setShowPalette] = useState(true);

  const zoom = useZoomPan(spacePressed);

  // ---------------------------------------------------------------------------
  // Keyboard shortcuts: Ctrl+Z, Ctrl+Y, Ctrl+0, Space, I, R
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
      if (e.ctrlKey && e.key === "0") {
        e.preventDefault();
        const container = containerRef.current;
        if (container && baseState.naturalWidth > 0) {
          zoom.fitToContainer(
            container.clientWidth,
            container.clientHeight,
            baseState.naturalWidth,
            baseState.naturalHeight
          );
        }
        return;
      }
      // I = eyedropper
      if (!e.ctrlKey && !e.altKey && e.key === "i") {
        setMode("eyedropper");
        return;
      }
      // R = replace-all
      if (!e.ctrlKey && !e.altKey && e.key === "r") {
        setMode("replace-all");
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
  }, [regionHistory, baseState.naturalWidth, baseState.naturalHeight, zoom]);

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
            setPalette(extractPaletteColors(imageData, 8));
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
        setPalette(extractPaletteColors(imageData, 8));
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
  // Canvas coordinate helper
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

  // ---------------------------------------------------------------------------
  // Canvas interactions
  // ---------------------------------------------------------------------------

  const handleCanvasMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!baseState.imageData) return;
      const coords = getCanvasCoords(e);
      if (!coords) {
        setHoverInfo(null);
        return;
      }
      const { x, y } = coords;
      const rgb = pickPixelColor(baseState.imageData, x, y);
      if (!rgb) {
        setHoverInfo(null);
        return;
      }
      const [r, g, b] = rgb;
      const hex = rgbToHex(r, g, b).toUpperCase();
      setHoverInfo(`X: ${x}, Y: ${y} | ${hex} (${r}, ${g}, ${b})`);
    },
    [baseState, getCanvasCoords]
  );

  const handleCanvasMouseLeave = useCallback(() => {
    setHoverInfo(null);
  }, []);

  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (spacePressed) return;
      if (!baseState.imageData) return;
      const coords = getCanvasCoords(e);
      if (!coords) return;
      const { x, y } = coords;

      // Eyedropper mode: pick color and switch back to color mode
      if (mode === "eyedropper") {
        const rgb = pickPixelColor(baseState.imageData, x, y);
        if (!rgb) return;
        const hex = rgbToHex(rgb[0], rgb[1], rgb[2]);
        setSelectedColor(hex);
        setMode("color");
        setStatus(`スポイト: ${hex.toUpperCase()} を選択`);
        return;
      }

      // Replace-all mode: select all pixels of same color globally
      if (mode === "replace-all") {
        const pixels = replaceAllSelect(baseState.imageData, x, y, tolerance);
        if (pixels.length === 0) return;
        const newRegion: PaintRegion = {
          id: `region-${Date.now()}`,
          pixels,
          color: selectedColor,
          transparent: false,
        };
        regionHistory.push([...regions, newRegion]);
        setStatus(`一括置換: ${pixels.length}px → ${selectedColor}`);
        return;
      }

      // Color / transparent mode: flood fill
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
  // Remove a specific region by id (mapping table undo)
  // ---------------------------------------------------------------------------

  const handleRemoveRegion = useCallback(
    (id: string) => {
      const next = regions.filter((r) => r.id !== id);
      regionHistory.push(next);
      setStatus("リージョンを削除しました");
    },
    [regions, regionHistory]
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
    const url = imageDataToPngDataUrl(composited, pngScale);
    const a = document.createElement("a");
    a.href = url;
    a.download = `export_${pngScale}x.png`;
    a.click();
    setStatus(`PNGをエクスポートしました (${pngScale}x)`);
  }, [baseState, regions, pngScale]);

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
    : mode === "eyedropper"
      ? "crosshair"
      : mode === "replace-all"
        ? "pointer"
        : baseState.imageData
          ? "crosshair"
          : "default";

  const zoomPercent = Math.round(zoom.scale * 100);

  // Mapping entries: color regions only, most recent first
  const mappingEntries = regions.filter((r) => !r.transparent).slice().reverse();

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
      {/* Toolbar row 1 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 12px",
          background: "#1a1a1a",
          borderBottom: "1px solid #333",
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
          title="塗りつぶし色変更"
        >
          色変更
        </button>
        <button
          type="button"
          onClick={() => setMode("transparent")}
          style={{ ...btnStyle, background: mode === "transparent" ? "#0066cc" : "#444" }}
          title="塗りつぶし透過"
        >
          透過
        </button>
        <button
          type="button"
          onClick={() => setMode("eyedropper")}
          style={{ ...btnStyle, background: mode === "eyedropper" ? "#cc6600" : "#444" }}
          title="スポイト (I)"
        >
          スポイト
        </button>
        <button
          type="button"
          onClick={() => setMode("replace-all")}
          style={{ ...btnStyle, background: mode === "replace-all" ? "#7700cc" : "#444" }}
          title="同色一括置換 (R)"
        >
          一括置換
        </button>

        {/* Color picker */}
        {(mode === "color" || mode === "replace-all") && (
          <input
            type="color"
            value={selectedColor}
            onChange={(e) => setSelectedColor(e.target.value)}
            style={{ width: 36, height: 28, cursor: "pointer", border: "1px solid #666", borderRadius: 4, background: "none" }}
            title="色を選択"
          />
        )}

        <div style={dividerStyle} />

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
      </div>

      {/* Toolbar row 2 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 12px",
          background: "#1e1e1e",
          borderBottom: "1px solid #444",
          flexWrap: "wrap",
        }}
      >
        {/* Undo / Redo / Reset */}
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

        {/* Zoom fit */}
        <button
          type="button"
          onClick={handleFit}
          disabled={!baseState.imageData}
          style={btnStyle}
          title="フィット表示 (Ctrl+0)"
        >
          Fit
        </button>

        <div style={dividerStyle} />

        {/* Export SVG */}
        <button
          type="button"
          onClick={handleExportSvg}
          disabled={!baseState.imageData}
          style={{ ...btnStyle, background: "#226622" }}
        >
          SVG出力
        </button>

        {/* Export PNG with scale selector */}
        <button
          type="button"
          onClick={handleExportPng}
          disabled={!baseState.imageData}
          style={{ ...btnStyle, background: "#226622" }}
        >
          PNG出力
        </button>
        <select
          value={pngScale}
          onChange={(e) => setPngScale(Number(e.target.value) as 1 | 2 | 4)}
          style={{
            background: "#333",
            color: "#f0f0f0",
            border: "1px solid #666",
            borderRadius: 4,
            fontSize: 12,
            padding: "3px 4px",
            cursor: "pointer",
          }}
          title="PNG出力倍率"
        >
          <option value={1}>1x</option>
          <option value={2}>2x</option>
          <option value={4}>4x</option>
        </select>

        <div style={dividerStyle} />

        {/* Panel toggles */}
        <button
          type="button"
          onClick={() => setShowPalette((v) => !v)}
          style={{ ...btnStyle, background: showPalette ? "#555" : "#333" }}
        >
          {showPalette ? "パレット ▲" : "パレット ▼"}
        </button>
        <button
          type="button"
          onClick={() => setShowMapping((v) => !v)}
          style={{ ...btnStyle, background: showMapping ? "#555" : "#333" }}
        >
          {showMapping ? "編集ログ ▲" : "編集ログ ▼"}
        </button>
      </div>

      {/* Palette panel */}
      {showPalette && palette.length > 0 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 12px",
            background: "#181818",
            borderBottom: "1px solid #333",
          }}
        >
          <span style={{ ...labelStyle, marginRight: 4 }}>主要色:</span>
          {palette.map((hex) => (
            <button
              key={hex}
              type="button"
              onClick={() => {
                setSelectedColor(hex);
                if (mode !== "color" && mode !== "replace-all") setMode("color");
              }}
              title={hex.toUpperCase()}
              style={{
                width: 24,
                height: 24,
                background: hex,
                border: selectedColor === hex ? "2px solid #fff" : "1px solid #555",
                borderRadius: 3,
                cursor: "pointer",
                padding: 0,
              }}
            />
          ))}
        </div>
      )}

      {/* Main area: canvas + right sidebar */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
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
                onMouseMove={handleCanvasMouseMove}
                onMouseLeave={handleCanvasMouseLeave}
                style={{ cursor: canvasCursor, display: "block" }}
              />
            </div>
          )}

          {/* Status bar (bottom-left) */}
          {baseState.imageData && (
            <div style={statusBarStyle}>
              {hoverInfo ?? status}
            </div>
          )}

          {/* Zoom indicator (bottom-right) */}
          {baseState.imageData && (
            <div style={zoomIndicatorStyle}>
              {zoomPercent}%
            </div>
          )}
        </div>

        {/* Mapping sidebar */}
        {showMapping && mappingEntries.length > 0 && (
          <div
            style={{
              width: 220,
              background: "#181818",
              borderLeft: "1px solid #333",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                padding: "6px 10px",
                borderBottom: "1px solid #333",
                fontSize: 11,
                color: "#aaa",
                fontWeight: "bold",
              }}
            >
              編集ログ ({mappingEntries.length})
            </div>
            <div style={{ flex: 1, overflowY: "auto" }}>
              {mappingEntries.map((region) => (
                <div
                  key={region.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "4px 8px",
                    borderBottom: "1px solid #222",
                    fontSize: 11,
                  }}
                >
                  <span
                    style={{
                      width: 14,
                      height: 14,
                      background: region.color,
                      border: "1px solid #555",
                      borderRadius: 2,
                      flexShrink: 0,
                      display: "inline-block",
                    }}
                  />
                  <span style={{ color: "#ccc", flex: 1, fontFamily: "monospace", fontSize: 10 }}>
                    {region.color.toUpperCase()}
                    <br />
                    <span style={{ color: "#666" }}>{region.pixels.length}px</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => handleRemoveRegion(region.id)}
                    style={{
                      background: "#400",
                      color: "#f88",
                      border: "none",
                      borderRadius: 2,
                      cursor: "pointer",
                      fontSize: 10,
                      padding: "1px 5px",
                      flexShrink: 0,
                    }}
                    title="このリージョンを削除"
                  >
                    x
                  </button>
                </div>
              ))}
            </div>
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
  padding: "4px 10px",
  background: "#444",
  color: "#f0f0f0",
  border: "1px solid #666",
  borderRadius: 4,
  cursor: "pointer",
  fontSize: 12,
};

const dividerStyle: React.CSSProperties = {
  width: 1,
  height: 22,
  background: "#444",
};

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  color: "#aaa",
};

const statusBarStyle: React.CSSProperties = {
  position: "absolute",
  bottom: 8,
  left: 12,
  fontSize: 11,
  color: "#ccc",
  background: "rgba(0,0,0,0.6)",
  padding: "2px 8px",
  borderRadius: 3,
  pointerEvents: "none",
  maxWidth: "60%",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
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
