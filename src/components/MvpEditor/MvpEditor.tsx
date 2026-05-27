import { useRef, useState, useCallback, useEffect } from "react";
import { useUndoRedo } from "./hooks/useUndoRedo";
import { useZoomPan } from "./hooks/useZoomPan";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useLayers } from "./hooks/useLayers";
import { useUpdater } from "./hooks/useUpdater";
import { ColorPicker } from "./components/ColorPicker";
import { LayerPanel } from "./components/LayerPanel";
import { UpdateModal } from "./components/UpdateModal";
import {
  serializeProject,
  downloadProject,
  parseChocoJson,
  deserializeRegions,
  loadImageFromDataUrl,
  saveProjectToBlob,
} from "./lib/projectIO";
import type { LayerVisibility, LayerOpacity } from "./lib/projectIO";

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

type EditorMode = "color" | "transparent" | "brush";

const DEFAULT_COLOR = "#ff0000";
const DEFAULT_TOLERANCE = 32;
const DEFAULT_BRUSH_SIZE = 20;
const SVG_TARGET_LONG_EDGE = 2048;
const MAX_RECENT_COLORS = 8;

/**
 * Rewrites an SVG string so that its rendered width/height will produce a
 * rasterized bitmap with a long edge of SVG_TARGET_LONG_EDGE pixels.
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
 * Returns pixels within a circle of given radius centered at (cx, cy),
 * clamped to image bounds.
 */
function getBrushPixels(
  cx: number,
  cy: number,
  radius: number,
  width: number,
  height: number
): { x: number; y: number }[] {
  const result: { x: number; y: number }[] = [];
  const r = Math.ceil(radius);
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy <= radius * radius) {
        const px = cx + dx;
        const py = cy + dy;
        if (px >= 0 && px < width && py >= 0 && py < height) {
          result.push({ x: px, y: py });
        }
      }
    }
  }
  return result;
}

/**
 * Merges new pixels into an existing region's pixel array,
 * deduplicating via a Set<number> encoding (y * width + x).
 */
function mergePixels(
  existing: { x: number; y: number }[],
  toAdd: { x: number; y: number }[],
  imageWidth: number
): { x: number; y: number }[] {
  const seen = new Set<number>(existing.map((p) => p.y * imageWidth + p.x));
  const merged = [...existing];
  for (const p of toAdd) {
    const key = p.y * imageWidth + p.x;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(p);
    }
  }
  return merged;
}

/**
 * Removes pixels from an existing region's pixel array.
 */
function subtractPixels(
  existing: { x: number; y: number }[],
  toRemove: { x: number; y: number }[],
  imageWidth: number
): { x: number; y: number }[] {
  const removeSet = new Set<number>(toRemove.map((p) => p.y * imageWidth + p.x));
  return existing.filter((p) => !removeSet.has(p.y * imageWidth + p.x));
}

/**
 * Applies all paint regions to the base imageData and returns the composited ImageData.
 * Respects layer visibility and opacity settings.
 */
function compositeRegions(
  baseImageData: ImageData,
  regions: PaintRegion[],
  layerVisibility: LayerVisibility,
  layerOpacity: LayerOpacity
): ImageData {
  const { width, height } = baseImageData;

  // Start with a transparent canvas
  const result = new ImageData(
    new Uint8ClampedArray(width * height * 4),
    width,
    height
  );

  // Background layer
  if (layerVisibility.background) {
    const bgAlpha = layerOpacity.background / 100;
    for (let i = 0; i < baseImageData.data.length; i += 4) {
      result.data[i] = baseImageData.data[i];
      result.data[i + 1] = baseImageData.data[i + 1];
      result.data[i + 2] = baseImageData.data[i + 2];
      result.data[i + 3] = Math.round(baseImageData.data[i + 3] * bgAlpha);
    }
  }

  // Edit layer: apply regions on top
  if (layerVisibility.edit) {
    const editAlpha = layerOpacity.edit / 100;

    // Build edit layer ImageData from regions
    const editLayer = new Uint8ClampedArray(width * height * 4);
    // Copy background as base for edit layer
    editLayer.set(result.data);

    for (const region of regions) {
      if (region.transparent) {
        for (const { x, y } of region.pixels) {
          const idx = (y * width + x) * 4;
          editLayer[idx + 3] = 0;
        }
      } else {
        const [r, g, b] = hexToRgb(region.color);
        for (const { x, y } of region.pixels) {
          const idx = (y * width + x) * 4;
          editLayer[idx] = r;
          editLayer[idx + 1] = g;
          editLayer[idx + 2] = b;
          editLayer[idx + 3] = 255;
        }
      }
    }

    // Composite edit layer onto result using opacity
    if (editAlpha >= 1) {
      result.data.set(editLayer);
    } else {
      for (let i = 0; i < result.data.length; i += 4) {
        const srcA = editLayer[i + 3] / 255;
        const dstA = result.data[i + 3] / 255;
        const outA = srcA * editAlpha + dstA * (1 - srcA * editAlpha);
        if (outA > 0) {
          result.data[i] = Math.round(
            (editLayer[i] * srcA * editAlpha + result.data[i] * dstA * (1 - srcA * editAlpha)) / outA
          );
          result.data[i + 1] = Math.round(
            (editLayer[i + 1] * srcA * editAlpha + result.data[i + 1] * dstA * (1 - srcA * editAlpha)) / outA
          );
          result.data[i + 2] = Math.round(
            (editLayer[i + 2] * srcA * editAlpha + result.data[i + 2] * dstA * (1 - srcA * editAlpha)) / outA
          );
          result.data[i + 3] = Math.round(outA * 255);
        } else {
          result.data[i + 3] = 0;
        }
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

const SHORTCUT_HELP: { key: string; description: string }[] = [
  { key: "B", description: "ブラシモード" },
  { key: "G", description: "バケツ塗りモード" },
  { key: "E", description: "透過モード" },
  { key: "Ctrl+Z", description: "元に戻す (Undo)" },
  { key: "Ctrl+Y / Ctrl+Shift+Z", description: "やり直し (Redo)" },
  { key: "Ctrl+0", description: "フィット表示" },
  { key: "Ctrl+1", description: "100% 表示" },
  { key: "Space + ドラッグ", description: "パン（移動）" },
  { key: "ホイール", description: "ズームイン/アウト" },
  { key: "ブラシ中 Shift", description: "直近 region に追加" },
  { key: "ブラシ中 Alt", description: "直近 region から削除" },
];

const MODE_LABEL: Record<EditorMode, string> = {
  color: "バケツ塗り",
  transparent: "透過",
  brush: "ブラシ",
};

export function MvpEditor() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const projectFileInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [baseState, setBaseState] = useState<Omit<MvpEditorState, "regions">>({
    imageData: null,
    naturalWidth: 0,
    naturalHeight: 0,
  });

  const regionHistory = useUndoRedo<PaintRegion[]>([]);

  const [mode, setMode] = useState<EditorMode>("color");
  const [selectedColor, setSelectedColor] = useState(DEFAULT_COLOR);
  const [recentColors, setRecentColors] = useState<string[]>([]);
  const [tolerance, setTolerance] = useState(DEFAULT_TOLERANCE);
  const [brushSize, setBrushSize] = useState(DEFAULT_BRUSH_SIZE);
  const [status, setStatus] = useState("画像を読み込んでください");
  const [spacePressed, setSpacePressed] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);

  const layers = useLayers();
  const updater = useUpdater();

  // Brush stroke state
  const isBrushingRef = useRef(false);
  const strokePixelSetRef = useRef<Set<number>>(new Set());
  const maskTargetIndexRef = useRef<number>(-1);
  const maskSubtractRef = useRef<boolean>(false);

  // Brush cursor overlay state
  const [brushCursorPos, setBrushCursorPos] = useState<{ cx: number; cy: number } | null>(null);

  const zoom = useZoomPan(spacePressed);

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

  const handleScale100 = useCallback(() => {
    zoom.setScale100();
  }, [zoom]);

  const handleUndo = useCallback(() => {
    if (!regionHistory.canUndo) return;
    regionHistory.undo();
    setStatus("元に戻しました");
  }, [regionHistory]);

  const handleRedo = useCallback(() => {
    if (!regionHistory.canRedo) return;
    regionHistory.redo();
    setStatus("やり直しました");
  }, [regionHistory]);

  useKeyboardShortcuts({
    onUndo: handleUndo,
    onRedo: handleRedo,
    onFit: handleFit,
    onScale100: handleScale100,
    onModeChange: setMode,
    setSpacePressed,
  });

  const regions = regionHistory.current;

  const addRecentColor = useCallback((hex: string) => {
    setRecentColors((prev) => {
      const filtered = prev.filter((c) => c !== hex);
      return [hex, ...filtered].slice(0, MAX_RECENT_COLORS);
    });
  }, []);

  // Redraw canvas whenever regions, base image, or layer settings change
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !baseState.imageData) return;
    const ctx = canvas.getContext("2d")!;
    const composited = compositeRegions(
      baseState.imageData,
      regions,
      layers.layerVisibility,
      layers.layerOpacity
    );
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.putImageData(composited, 0, 0);
  }, [baseState, regions, layers.layerVisibility, layers.layerOpacity]);

  // Draw brush cursor on overlay canvas
  useEffect(() => {
    const overlay = overlayCanvasRef.current;
    if (!overlay) return;
    const ctx = overlay.getContext("2d")!;
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    if (mode === "brush" && brushCursorPos) {
      const { cx, cy } = brushCursorPos;
      ctx.beginPath();
      ctx.arc(cx, cy, brushSize, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(255,255,255,0.8)";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, brushSize, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(0,0,0,0.5)";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }, [mode, brushCursorPos, brushSize]);

  const getCanvasCoords = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>): { x: number; y: number } | null => {
      const canvas = canvasRef.current;
      if (!canvas || !baseState.imageData) return null;
      const rect = canvas.getBoundingClientRect();
      const scaleX = baseState.naturalWidth / rect.width;
      const scaleY = baseState.naturalHeight / rect.height;
      const x = Math.floor((e.clientX - rect.left) * scaleX);
      const y = Math.floor((e.clientY - rect.top) * scaleY);
      if (x < 0 || x >= baseState.naturalWidth || y < 0 || y >= baseState.naturalHeight) return null;
      return { x, y };
    },
    [baseState]
  );

  const loadImageFromFile = useCallback((file: File) => {
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
          layers.resetLayers();
          setStatus(`画像読み込み完了: ${w}x${h}`);
        };
        img.onerror = () => {
          setStatus("画像の読み込みに失敗しました");
          URL.revokeObjectURL(url);
        };
        img.src = url;
      };
      reader.onerror = () => {
        setStatus("ファイルの読み込みに失敗しました");
      };
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
      layers.resetLayers();
      setStatus(`画像読み込み完了: ${w}x${h}`);
    };
    img.onerror = () => {
      setStatus("画像の読み込みに失敗しました");
      URL.revokeObjectURL(url);
    };
    img.src = url;
  }, [regionHistory, layers]);

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

  // ---- Project save ----

  const handleSaveProject = useCallback(() => {
    if (!baseState.imageData) {
      setStatus("保存する画像がありません");
      return;
    }

    const project = serializeProject({
      imageData: baseState.imageData,
      imageWidth: baseState.naturalWidth,
      imageHeight: baseState.naturalHeight,
      regions,
      selectedColor,
      tolerance,
      brushSize,
      layerVisibility: layers.layerVisibility,
      layerOpacity: layers.layerOpacity,
    });

    const { warnLarge } = saveProjectToBlob(project);
    if (warnLarge) {
      const confirmed = window.confirm(
        "プロジェクトファイルが 10MB を超えています。保存しますか？"
      );
      if (!confirmed) return;
    }

    downloadProject(project);
    setStatus("プロジェクトを保存しました");
  }, [baseState, regions, selectedColor, tolerance, brushSize, layers]);

  // ---- Project load ----

  const handleLoadProject = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      // Reset input so the same file can be re-loaded
      e.target.value = "";

      try {
        const text = await file.text();
        const project = parseChocoJson(text);
        const { imageData, width, height } = await loadImageFromDataUrl(
          project.image
        );

        const restoredRegions = deserializeRegions(project.regions);

        setBaseState({ imageData, naturalWidth: width, naturalHeight: height });
        regionHistory.reset(restoredRegions);
        setSelectedColor(project.selectedColor);
        setTolerance(project.tolerance);
        setBrushSize(project.brushSize);

        const vis: LayerVisibility = project.layerVisibility ?? {
          background: true,
          edit: true,
        };
        const opa: LayerOpacity = project.layerOpacity ?? {
          background: 100,
          edit: 100,
        };
        layers.resetLayers(vis, opa);

        setStatus(
          `プロジェクト読み込み完了: ${width}x${height}, ${restoredRegions.length} regions`
        );
      } catch (err) {
        setStatus(
          `読み込みエラー: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    },
    [regionHistory, layers]
  );

  // ---- Brush event handlers ----

  const handleBrushMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (spacePressed || mode !== "brush" || !baseState.imageData) return;
      // Guard: only allow drawing on the edit layer
      if (layers.activeLayerId !== "edit") return;
      e.preventDefault();
      const coords = getCanvasCoords(e);
      if (!coords) return;

      isBrushingRef.current = true;
      strokePixelSetRef.current = new Set<number>();
      maskSubtractRef.current = e.altKey;

      if ((e.shiftKey || e.altKey) && regions.length > 0) {
        maskTargetIndexRef.current = regions.length - 1;
      } else {
        maskTargetIndexRef.current = -1;
      }

      const newPixels = getBrushPixels(
        coords.x,
        coords.y,
        brushSize / 2,
        baseState.naturalWidth,
        baseState.naturalHeight
      );
      newPixels.forEach((p) => {
        strokePixelSetRef.current.add(p.y * baseState.naturalWidth + p.x);
      });
    },
    [spacePressed, mode, baseState, brushSize, regions, getCanvasCoords, layers.activeLayerId]
  );

  const handleBrushMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (mode !== "brush" || !baseState.imageData) return;

      const coords = getCanvasCoords(e);

      if (coords) {
        setBrushCursorPos({ cx: coords.x, cy: coords.y });
      } else {
        setBrushCursorPos(null);
      }

      if (!isBrushingRef.current || !coords) return;

      const newPixels = getBrushPixels(
        coords.x,
        coords.y,
        brushSize / 2,
        baseState.naturalWidth,
        baseState.naturalHeight
      );
      newPixels.forEach((p) => {
        strokePixelSetRef.current.add(p.y * baseState.naturalWidth + p.x);
      });
    },
    [mode, baseState, brushSize, getCanvasCoords]
  );

  const commitBrushStroke = useCallback(() => {
    if (!isBrushingRef.current || !baseState.imageData) return;
    isBrushingRef.current = false;

    const pixelSet = strokePixelSetRef.current;
    if (pixelSet.size === 0) return;

    const strokePixels: { x: number; y: number }[] = [];
    for (const key of pixelSet) {
      strokePixels.push({ x: key % baseState.naturalWidth, y: Math.floor(key / baseState.naturalWidth) });
    }

    const targetIdx = maskTargetIndexRef.current;
    const isSubtract = maskSubtractRef.current;

    if (targetIdx >= 0 && targetIdx < regions.length) {
      const target = regions[targetIdx];
      const updatedPixels = isSubtract
        ? subtractPixels(target.pixels, strokePixels, baseState.naturalWidth)
        : mergePixels(target.pixels, strokePixels, baseState.naturalWidth);

      const updatedRegion: PaintRegion = { ...target, pixels: updatedPixels };
      const nextRegions = regions.map((r, i) => (i === targetIdx ? updatedRegion : r));
      regionHistory.push(nextRegions);
      setStatus(
        isSubtract
          ? `マスク削除: ${strokePixels.length}px`
          : `マスク追加: ${strokePixels.length}px`
      );
    } else {
      const newRegion: PaintRegion = {
        id: `region-${Date.now()}`,
        pixels: strokePixels,
        color: selectedColor,
        transparent: false,
      };
      regionHistory.push([...regions, newRegion]);
      setStatus(`ブラシ: ${strokePixels.length}px → ${selectedColor}`);
    }

    strokePixelSetRef.current = new Set();
    maskTargetIndexRef.current = -1;
  }, [baseState, regions, selectedColor, regionHistory]);

  const handleBrushMouseUp = useCallback(() => {
    commitBrushStroke();
  }, [commitBrushStroke]);

  const handleBrushMouseLeave = useCallback(() => {
    setBrushCursorPos(null);
    commitBrushStroke();
  }, [commitBrushStroke]);

  // ---- Bucket / transparent click handler ----

  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (spacePressed || mode === "brush") return;
      // Guard: only allow drawing on the edit layer
      if (layers.activeLayerId !== "edit") return;
      const canvas = canvasRef.current;
      if (!canvas || !baseState.imageData) return;

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
          : `バケツ塗り: ${pixels.length}px → ${selectedColor}`
      );
    },
    [baseState, tolerance, selectedColor, mode, spacePressed, regions, regionHistory, getCanvasCoords, layers.activeLayerId]
  );

  const handleReset = useCallback(() => {
    regionHistory.reset([]);
    setStatus("全リセット完了");
  }, [regionHistory]);

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

    const composited = compositeRegions(
      baseState.imageData,
      regions,
      layers.layerVisibility,
      layers.layerOpacity
    );
    const url = imageDataToPngDataUrl(composited);
    const a = document.createElement("a");
    a.href = url;
    a.download = "export.png";
    a.click();
    setStatus("PNGをエクスポートしました");
  }, [baseState, regions, layers.layerVisibility, layers.layerOpacity]);

  const canvasCursor = spacePressed
    ? zoom.isPanning
      ? "grabbing"
      : "grab"
    : mode === "brush"
      ? "none"
      : baseState.imageData
        ? "crosshair"
        : "default";

  const zoomPercent = Math.round(zoom.scale * 100);

  const isEditLayerActive = layers.activeLayerId === "edit";

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

        {/* Mode buttons */}
        <label style={labelStyle}>モード:</label>
        <button
          type="button"
          onClick={() => setMode("brush")}
          style={{ ...btnStyle, background: mode === "brush" ? "#0066cc" : "#444" }}
          title="ブラシモード (B)"
        >
          ブラシ
        </button>
        <button
          type="button"
          onClick={() => setMode("color")}
          style={{ ...btnStyle, background: mode === "color" ? "#0066cc" : "#444" }}
          title="バケツ塗りモード (G)"
        >
          バケツ
        </button>
        <button
          type="button"
          onClick={() => setMode("transparent")}
          style={{ ...btnStyle, background: mode === "transparent" ? "#0066cc" : "#444" }}
          title="透過モード (E)"
        >
          透過
        </button>

        {/* Brush size (visible in brush mode) */}
        {mode === "brush" && (
          <>
            <label style={labelStyle}>ブラシ: {brushSize}px</label>
            <input
              type="range"
              min={1}
              max={100}
              value={brushSize}
              onChange={(e) => setBrushSize(Number(e.target.value))}
              style={{ width: 80 }}
            />
          </>
        )}

        {/* Color picker area */}
        {(mode === "color" || mode === "brush") && (
          <div style={{ position: "relative" }}>
            <button
              type="button"
              onClick={() => setShowColorPicker((v) => !v)}
              style={{
                ...btnStyle,
                padding: 0,
                width: 32,
                height: 28,
                background: selectedColor,
                border: "2px solid #888",
              }}
              title="色を選択"
            />
            {showColorPicker && (
              <div
                style={{
                  position: "absolute",
                  top: 34,
                  left: 0,
                  zIndex: 100,
                  background: "#222",
                  border: "1px solid #555",
                  borderRadius: 6,
                  padding: 10,
                  minWidth: 240,
                }}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <ColorPicker
                  value={selectedColor}
                  onChange={(hex) => {
                    setSelectedColor(hex);
                  }}
                  recentColors={recentColors}
                  onRecentColorAdd={addRecentColor}
                />
                <div style={{ textAlign: "right", marginTop: 8 }}>
                  <button
                    type="button"
                    onClick={() => setShowColorPicker(false)}
                    style={{ ...btnStyle, fontSize: 11, padding: "2px 8px" }}
                  >
                    閉じる
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Tolerance (bucket/transparent mode) */}
        {mode !== "brush" && (
          <>
            <label style={labelStyle}>許容値: {tolerance}</label>
            <input
              type="range"
              min={0}
              max={128}
              value={tolerance}
              onChange={(e) => setTolerance(Number(e.target.value))}
              style={{ width: 80 }}
            />
          </>
        )}

        <div style={dividerStyle} />

        {/* Undo / Redo */}
        <button
          type="button"
          onClick={handleUndo}
          disabled={!regionHistory.canUndo}
          style={btnStyle}
          title="元に戻す (Ctrl+Z)"
        >
          Undo
        </button>
        <button
          type="button"
          onClick={handleRedo}
          disabled={!regionHistory.canRedo}
          style={btnStyle}
          title="やり直し (Ctrl+Y)"
        >
          Redo
        </button>
        <button
          type="button"
          onClick={handleReset}
          disabled={regions.length === 0}
          style={{ ...btnStyle, background: "#662222" }}
        >
          全リセット
        </button>

        <div style={dividerStyle} />

        {/* Zoom controls */}
        <button
          type="button"
          onClick={handleFit}
          disabled={!baseState.imageData}
          style={btnStyle}
          title="フィット表示 (Ctrl+0)"
        >
          Fit
        </button>
        <button
          type="button"
          onClick={handleScale100}
          disabled={!baseState.imageData}
          style={btnStyle}
          title="100% 表示 (Ctrl+1)"
        >
          100%
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

        <div style={dividerStyle} />

        {/* Project save/load */}
        <button
          type="button"
          onClick={handleSaveProject}
          disabled={!baseState.imageData}
          style={{ ...btnStyle, background: "#225566" }}
          title="プロジェクトを .choco ファイルとして保存"
        >
          保存
        </button>
        <button
          type="button"
          onClick={() => projectFileInputRef.current?.click()}
          style={{ ...btnStyle, background: "#225566" }}
          title="プロジェクトファイル (.choco) を開く"
        >
          読込
        </button>
        <input
          ref={projectFileInputRef}
          type="file"
          accept=".choco,application/json"
          style={{ display: "none" }}
          onChange={handleLoadProject}
        />

        {/* Help */}
        <button
          type="button"
          onClick={() => setShowHelp(true)}
          style={{ ...btnStyle, marginLeft: 4 }}
          title="ショートカット一覧"
        >
          ?
        </button>

        {/* Status */}
        <span style={{ marginLeft: "auto", fontSize: 11, color: "#888" }}>{status}</span>
      </div>

      {/* Main content area: canvas + layer panel */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
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
          onClick={() => {
            if (showColorPicker) setShowColorPicker(false);
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
              }}
            >
              <p style={{ margin: 0, fontSize: 18 }}>ここに画像をドロップ</p>
              <p style={{ margin: "8px 0 0", fontSize: 13 }}>または「画像を開く」ボタン</p>
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
                onMouseDown={handleBrushMouseDown}
                onMouseMove={handleBrushMouseMove}
                onMouseUp={handleBrushMouseUp}
                onMouseLeave={handleBrushMouseLeave}
                style={{
                  cursor: canvasCursor,
                  display: "block",
                  position: "absolute",
                  top: 0,
                  left: 0,
                  opacity: !isEditLayerActive ? 0.6 : 1,
                }}
              />
              {/* Brush cursor overlay */}
              <canvas
                ref={overlayCanvasRef}
                width={baseState.naturalWidth}
                height={baseState.naturalHeight}
                style={{
                  display: "block",
                  position: "absolute",
                  top: 0,
                  left: 0,
                  pointerEvents: "none",
                }}
              />
            </div>
          )}

          {/* Status bar */}
          {baseState.imageData && (
            <div
              style={{
                position: "absolute",
                bottom: 8,
                left: 12,
                fontSize: 11,
                color: "#aaa",
                background: "rgba(0,0,0,0.5)",
                padding: "2px 8px",
                borderRadius: 3,
                pointerEvents: "none",
              }}
            >
              ツール: {MODE_LABEL[mode]} | レイヤー: {isEditLayerActive ? "編集" : "背景"}
            </div>
          )}

          {/* Zoom indicator */}
          {baseState.imageData && (
            <div
              style={{
                position: "absolute",
                bottom: 8,
                right: 12,
                fontSize: 11,
                color: "#aaa",
                background: "rgba(0,0,0,0.5)",
                padding: "2px 6px",
                borderRadius: 3,
                pointerEvents: "none",
              }}
            >
              {zoomPercent}%
            </div>
          )}

          {/* Non-edit layer drawing warning */}
          {baseState.imageData && !isEditLayerActive && (
            <div
              style={{
                position: "absolute",
                top: 8,
                left: "50%",
                transform: "translateX(-50%)",
                fontSize: 12,
                color: "#ffcc44",
                background: "rgba(0,0,0,0.7)",
                padding: "4px 12px",
                borderRadius: 4,
                pointerEvents: "none",
                border: "1px solid #664400",
              }}
            >
              背景レイヤーが選択中 — 描画は編集レイヤーを選択してください
            </div>
          )}
        </div>

        {/* Layer panel */}
        <LayerPanel
          layerVisibility={layers.layerVisibility}
          layerOpacity={layers.layerOpacity}
          activeLayerId={layers.activeLayerId}
          onVisibilityChange={layers.setLayerVisibility}
          onOpacityChange={layers.setLayerOpacity}
          onActiveLayerChange={layers.setActiveLayerId}
        />
      </div>

      {/* Update modal */}
      <UpdateModal updater={updater} />

      {/* Help modal */}
      {showHelp && (
        <div
          onClick={() => setShowHelp(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#1e1e1e",
              border: "1px solid #555",
              borderRadius: 8,
              padding: "24px 32px",
              minWidth: 360,
              color: "#f0f0f0",
            }}
          >
            <h3 style={{ margin: "0 0 16px", fontSize: 16 }}>ショートカット一覧</h3>
            <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
              <tbody>
                {SHORTCUT_HELP.map(({ key, description }) => (
                  <tr key={key}>
                    <td style={{ padding: "4px 16px 4px 0", color: "#88ccff", fontFamily: "monospace", whiteSpace: "nowrap" }}>
                      {key}
                    </td>
                    <td style={{ padding: "4px 0", color: "#ccc" }}>{description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ marginTop: 16, textAlign: "right" }}>
              <button type="button" onClick={() => setShowHelp(false)} style={btnStyle}>
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}
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

const dividerStyle: React.CSSProperties = {
  width: 1,
  height: 24,
  background: "#444",
};

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#aaa",
};
