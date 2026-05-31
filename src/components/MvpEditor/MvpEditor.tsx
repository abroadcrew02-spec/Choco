import { useRef, useState, useCallback, useEffect } from "react";
import {
  Paintbrush,
  PaintBucket,
  Eraser,
  Pipette,
  Replace,
  Undo2,
  Redo2,
  FolderOpen,
  Maximize2,
  FileCode2,
  Download,
  Copy,
  Wand2,
  Type,
  Square,
  Droplets,
  Layers,
  Palette,
  List,
  Grid3x3,
  Magnet,
  RotateCw,
  FlipHorizontal2,
  FlipVertical2,
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignCenter,
  Save,
  FolderInput,
  Clock,
  Frame,
  HelpCircle,
  Sun,
  Moon,
  Settings,
} from "lucide-react";
import {
  serializeProject,
  deserializeProject,
  downloadChocoFile,
  openChocoFile,
} from "./lib/projectIO";
import { downloadPaletteSet, deserializePaletteSet } from "./lib/paletteIO";
import {
  addRecentFile,
  getRecentFiles,
  makeThumbnail,
  formatRelativeTime,
  type RecentFileEntry,
} from "./lib/recentFiles";
import { useAutoSave } from "./hooks/useAutoSave";
import {
  cropImageData,
  scaleImageData,
  cropRegion,
  scaleRegion,
} from "./lib/canvasResize";
import { CanvasSizeModal } from "./components/CanvasSizeModal";
import type { AnchorPosition, ResizeMode } from "./lib/canvasResize";
import {
  GradientEditor,
  type FillType,
  type GradientConfig,
  DEFAULT_GRADIENT_CONFIG,
  applyLinearGradient,
  applyRadialGradient,
} from "./components/GradientEditor";
import { useEditorHistory } from "./hooks/useEditorHistory";
import { useZoomPan } from "./hooks/useZoomPan";
import { HsvPicker } from "./components/HsvPicker";
import { Tooltip } from "./components/Tooltip";
import { Toast, type ToastMessage } from "./components/Toast";
import { ShortcutHelp } from "./components/ShortcutHelp";
import { WelcomeModal, hasSeenWelcome, markWelcomeSeen, resetWelcomeSeen } from "./components/WelcomeModal";
import {
  SettingsModal,
  loadDefaultPngScale,
  saveDefaultPngScale,
} from "./components/SettingsModal";
import {
  ExportModal,
  getMimeType,
  getFileExtension,
  calcOutputSize,
  type ExportOptions,
} from "./components/ExportModal";

import { T } from "./theme/tokens";
import { useTheme } from "./hooks/useTheme";
import { useLang, t } from "./lib/i18n";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BaseState {
  imageData: ImageData | null;
  naturalWidth: number;
  naturalHeight: number;
}

type EditorMode = "color" | "transparent" | "eyedropper" | "replace-all" | "brush" | "text" | "shape";

interface TextDraft {
  x: number;
  y: number;
  value: string;
}

interface ShapeDraft {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  active: boolean;
}

// Palette sets stored in LocalStorage
const PALETTE_SETS_KEY = "choco_palette_sets";
const PALETTE_SETS_MAX = 10;

interface PaletteSet {
  id: string;
  name: string;
  colors: string[];
}

function loadPaletteSets(): PaletteSet[] {
  try {
    const raw = localStorage.getItem(PALETTE_SETS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    return [];
  } catch {
    return [];
  }
}

function savePaletteSets(sets: PaletteSet[]): void {
  try {
    localStorage.setItem(PALETTE_SETS_KEY, JSON.stringify(sets));
  } catch {
    // ignore quota errors
  }
}

// Brand swatches stored in LocalStorage
const BRAND_SWATCHES_KEY = "choco_brand_swatches";
const BRAND_SWATCHES_MAX = 8;

// Recent colors — in-memory only, max 8
const RECENT_COLORS_MAX = 8;

function loadBrandSwatches(): string[] {
  try {
    const raw = localStorage.getItem(BRAND_SWATCHES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((v) => typeof v === "string");
    return [];
  } catch {
    return [];
  }
}

function saveBrandSwatches(swatches: string[]): void {
  try {
    localStorage.setItem(BRAND_SWATCHES_KEY, JSON.stringify(swatches));
  } catch {
    // ignore quota errors
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_COLOR = "#ff0000";
const DEFAULT_TOLERANCE = 32;

// ---------------------------------------------------------------------------
// Pure image-processing utilities (extracted to ./lib/imageProcessing.ts, Issue #17).
// Re-exported here so existing imports (tests, callers) continue to resolve.
// ---------------------------------------------------------------------------

import {
  hexToRgb,
  rgbToHex,
  floodFillSelect,
  replaceAllSelect,
  pickPixelColor,
  extractPaletteColors,
  compositeRegions,
  smoothReplaceAll,
  exportImageData,
  removeCollinear,
  simplifyPath,
  marchingSquaresPath,
  buildSvg,
  makeWhiteTransparent,
  closeMask,
  blurMask,
  applyFeatheredFill,
  copyImageDataInto,
  rewriteSvgForHighResRasterize,
  normalizeBbox,
  buildShapePath,
  drawShape,
  isAcceptedImageFile,
  isInputFocused,
  snapCoord as snapCoordPure,
  type PaintRegion,
  type ShapeKind,
} from "./lib/imageProcessing";

export {
  hexToRgb,
  rgbToHex,
  floodFillSelect,
  replaceAllSelect,
  pickPixelColor,
  extractPaletteColors,
  compositeRegions,
  smoothReplaceAll,
  exportImageData,
  removeCollinear,
  simplifyPath,
  marchingSquaresPath,
  buildSvg,
  makeWhiteTransparent,
  closeMask,
  blurMask,
  applyFeatheredFill,
  normalizeBbox,
  drawShape,
  isAcceptedImageFile,
  isInputFocused,
};
export type { PaintRegion };

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const DEFAULT_BRUSH_SIZE = 15;

export function MvpEditor() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [baseState, setBaseState] = useState<BaseState>({
    imageData: null,
    naturalWidth: 0,
    naturalHeight: 0,
  });

  const editorHistory = useEditorHistory();
  const regions = editorHistory.regions;
  const bakeLayerRef = editorHistory.bakeLayerRef;

  // Brush stroke state
  const brushDrawingRef = useRef<boolean>(false);
  const brushLastPosRef = useRef<{ x: number; y: number } | null>(null);
  // Offscreen canvas used for current stroke accumulation
  const strokeCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const [mode, setMode] = useState<EditorMode>("color");
  const [pressedBtn, setPressedBtn] = useState<string | null>(null);
  const [selectedColor, setSelectedColor] = useState(DEFAULT_COLOR);
  const [tolerance, setTolerance] = useState(DEFAULT_TOLERANCE);
  const [brushSize, setBrushSize] = useState(DEFAULT_BRUSH_SIZE);
  const [smoothReplace, setSmoothReplace] = useState(false);
  const [status, setStatus] = useState(() => t("status.loadImage", "ja"));
  const [spacePressed, setSpacePressed] = useState(false);
  const [hoverInfo, setHoverInfo] = useState<string | null>(null);
  const [palette, setPalette] = useState<string[]>([]);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [showMapping, setShowMapping] = useState(true);
  const [showPalette, setShowPalette] = useState(true);
  // B-2: brand color swatches
  const [brandSwatches, setBrandSwatches] = useState<string[]>(loadBrandSwatches);
  // B-2: antialias boundary inclusion
  const [includeAntialias, setIncludeAntialias] = useState(false);
  // B-3: connectivity mode (4-neighbor vs 8-neighbor)
  const [connectivity, setConnectivity] = useState<4 | 8>(4);
  // B-3: before/after comparison mode (show base without regions)
  const [comparing, setComparing] = useState(false);

  // S2: HSV picker popup open/closed
  const [hsvPickerOpen, setHsvPickerOpen] = useState(false);
  // S2: hole-fill radius (0 = OFF, 1-5)
  const [closeRadius, setCloseRadius] = useState(0);

  // S3: feather radius (0 = no blur, 1-20)
  const [featherRadius, setFeatherRadius] = useState(0);

  // S3: recent colors (in-memory, up to 8, most recent first)
  const [recentColors, setRecentColors] = useState<string[]>([]);

  // S3: toast notification
  const [currentToast, setCurrentToast] = useState<ToastMessage | null>(null);
  const toastIdRef = useRef(0);

  // S3: shortcut help popover
  const [shortcutPos, setShortcutPos] = useState<{ x: number; y: number } | null>(null);

  // Ref for the color swatch button (to position the HSV picker)
  const colorSwatchRef = useRef<HTMLButtonElement>(null);

  // S5-2: palette sets
  const [paletteSets, setPaletteSets] = useState<PaletteSet[]>(loadPaletteSets);
  const [activePaletteSetId, setActivePaletteSetId] = useState<string | null>(null);

  // S5-1: text tool draft
  const [textDraft, setTextDraft] = useState<TextDraft | null>(null);
  const [textFontFamily, setTextFontFamily] = useState<string>("sans-serif");
  const [textFontSize, setTextFontSize] = useState<number>(48);
  const textInputRef = useRef<HTMLInputElement>(null);

  // S6-1: shape tool state
  const [shapeKind, setShapeKind] = useState<ShapeKind>("rect");
  const [polyVertices, setPolyVertices] = useState<number>(6);
  const shapeDraftRef = useRef<ShapeDraft | null>(null);
  const shapeOverlayCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // S6-2: stroke/fill state
  const [strokeColor, setStrokeColor] = useState<string>("#000000");
  const [strokeWidth, setStrokeWidth] = useState<number>(2);
  const [useFill, setUseFill] = useState<boolean>(true);
  const [useStroke, setUseStroke] = useState<boolean>(true);

  // S7: opacity (0-100, default 100)
  const [opacity, setOpacity] = useState<number>(100);

  // S7: blend mode
  type BlendMode = "normal" | "multiply" | "screen" | "overlay" | "darken" | "lighten";
  const [blendMode, setBlendMode] = useState<BlendMode>("normal");

  // S7: fill type + gradient config
  const [fillType, setFillType] = useState<FillType>("solid");
  const [gradientConfig, setGradientConfig] = useState<GradientConfig>(DEFAULT_GRADIENT_CONFIG);
  const [gradientEditorOpen, setGradientEditorOpen] = useState<boolean>(false);

  // Issue #5: autosave restore modal
  const [showRestoreModal, setShowRestoreModal] = useState<boolean>(false);

  // Issue #29: welcome modal
  const [showWelcome, setShowWelcome] = useState<boolean>(() => !hasSeenWelcome());

  // Issue #52: settings modal
  const [settingsModalOpen, setSettingsModalOpen] = useState<boolean>(false);
  const [defaultPngScale, setDefaultPngScale] = useState(() => loadDefaultPngScale());

  // Issue #7: recent files dropdown
  const [recentFiles, setRecentFiles] = useState<RecentFileEntry[]>(() => getRecentFiles());
  const [recentMenuOpen, setRecentMenuOpen] = useState<boolean>(false);
  const recentMenuRef = useRef<HTMLDivElement>(null);

  // S8: grid / snap
  const [gridEnabled, setGridEnabled] = useState<boolean>(false);
  const [snapEnabled, setSnapEnabled] = useState<boolean>(false);
  const [gridSize, setGridSize] = useState<number>(20);

  // S8: draft transform (rotate + flip) — applied on shape/text commit
  const [draftRotateDeg, setDraftRotateDeg] = useState<number>(0);
  const [draftFlipX, setDraftFlipX] = useState<boolean>(false);
  const [draftFlipY, setDraftFlipY] = useState<boolean>(false);

  // Issue #9: canvas size modal
  const [canvasSizeModalOpen, setCanvasSizeModalOpen] = useState<boolean>(false);

  // Issue #24: reference layer for tracing
  const [referenceImage, setReferenceImage] = useState<ImageData | null>(null);
  const [referenceOpacity, setReferenceOpacity] = useState<number>(50);

  const { lang, setLang } = useLang();
  const { themeMode, theme, toggleTheme } = useTheme();

  const zoom = useZoomPan(spacePressed);

  // ---------------------------------------------------------------------------
  // Issue #5: AutoSave
  // ---------------------------------------------------------------------------

  const getAutoSaveState = useCallback(() => {
    if (!baseState.imageData) return null;
    return {
      imageData: baseState.imageData,
      naturalWidth: baseState.naturalWidth,
      naturalHeight: baseState.naturalHeight,
      regions,
      bakeLayer: bakeLayerRef.current,
      selectedColor,
      tolerance,
    };
  }, [baseState, regions, selectedColor, tolerance]);

  const autoSave = useAutoSave(getAutoSaveState, !!baseState.imageData, {
    onSave: () => setStatus(t("status.autoSaved", lang)),
    onError: () => {
      setStatus(t("status.autoSaveError", lang));
      toastIdRef.current += 1;
      setCurrentToast({
        message: t("status.autoSaveToast", lang),
        type: "error",
        id: toastIdRef.current,
      });
    },
  });

  // On mount: check for autosave and show restore modal if found
  useEffect(() => {
    if (autoSave.hasAutoSave()) {
      setShowRestoreModal(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Issue #7: close recent-files dropdown on outside click
  useEffect(() => {
    if (!recentMenuOpen) return;
    const handleOutside = (e: MouseEvent) => {
      if (
        recentMenuRef.current &&
        !recentMenuRef.current.contains(e.target as Node)
      ) {
        setRecentMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [recentMenuOpen]);

  // ---------------------------------------------------------------------------
  // S3: Toast helper
  // ---------------------------------------------------------------------------

  const showToast = useCallback((message: string, type: ToastMessage["type"] = "success") => {
    toastIdRef.current += 1;
    setCurrentToast({ message, type, id: toastIdRef.current });
  }, []);

  // ---------------------------------------------------------------------------
  // S3: Recent colors helper
  // ---------------------------------------------------------------------------

  const addRecentColor = useCallback((hex: string) => {
    setRecentColors((prev) => {
      const normalized = hex.toLowerCase();
      const filtered = prev.filter((c) => c.toLowerCase() !== normalized);
      return [hex, ...filtered].slice(0, RECENT_COLORS_MAX);
    });
  }, []);

  // Trigger an explicit canvas redraw without changing React state for regions.
  // Used by brush strokes (which mutate bakeLayerRef directly) and Undo/Redo.
  const [redrawTick, setRedrawTick] = useState(0);
  const triggerRedraw = useCallback(() => {
    setRedrawTick((n) => n + 1);
  }, []);

  // ---------------------------------------------------------------------------
  // S5-1: Auto-focus text input when textDraft is set
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (textDraft !== null) {
      // Use rAF to ensure the input has rendered before focusing
      requestAnimationFrame(() => {
        textInputRef.current?.focus();
      });
    }
  }, [textDraft]);


  // ---------------------------------------------------------------------------
  // Keyboard shortcuts: Ctrl+Z, Ctrl+Y, Ctrl+0, Space, I, R, B
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore bare tool shortcuts when an input element has focus.
      // Modifier-based shortcuts (Ctrl/Meta) are always processed.
      if (!e.ctrlKey && !e.metaKey && isInputFocused(e.target)) return;

      if (e.code === "Space") {
        e.preventDefault();
        setSpacePressed(true);
        return;
      }
      if (e.ctrlKey && e.key === "z") {
        e.preventDefault();
        editorHistory.undo();
        triggerRedraw();
        setStatus(t("status.undo", lang));
        return;
      }
      if (e.ctrlKey && (e.key === "y" || (e.shiftKey && e.key === "Z"))) {
        e.preventDefault();
        editorHistory.redo();
        triggerRedraw();
        setStatus(t("status.redo", lang));
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
      // Ctrl+C: copy composited canvas to clipboard as PNG (Issue #8)
      // Only fires when no input element is focused (text copy is handled by browser default).
      if (e.ctrlKey && e.key === "c" && !isInputFocused(e.target)) {
        e.preventDefault();
        handleCopyToClipboard();
        return;
      }
      // Ctrl+Shift+V: paste image as reference layer (Issue #24)
      if (e.ctrlKey && e.shiftKey && e.key === "V") {
        e.preventDefault();
        handleReferencePaste();
        return;
      }
      // Ctrl+V: paste image from clipboard (B-1)
      if (e.ctrlKey && !e.shiftKey && e.key === "v") {
        e.preventDefault();
        handleClipboardPaste();
        return;
      }
      // B = brush
      if (!e.ctrlKey && !e.altKey && e.key === "b") {
        setMode("brush");
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
      // T = text tool
      if (!e.ctrlKey && !e.altKey && e.key === "t") {
        setMode("text");
        return;
      }
      // U = shape tool
      if (!e.ctrlKey && !e.altKey && e.key === "u") {
        setMode("shape");
        return;
      }
      // Escape: cancel text draft
      if (e.key === "Escape") {
        setTextDraft(null);
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorHistory, baseState.naturalWidth, baseState.naturalHeight, zoom, triggerRedraw]);

  // ---------------------------------------------------------------------------
  // Canvas redraw
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !baseState.imageData) return;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (comparing) {
      // B-3: before/after comparison — show base + bakeLayer without regions applied
      const preRegions = compositeRegions(baseState.imageData, [], bakeLayerRef.current);
      ctx.putImageData(preRegions, 0, 0);
    } else {
      const composited = compositeRegions(baseState.imageData, regions, bakeLayerRef.current);
      ctx.putImageData(composited, 0, 0);
    }
    // S6-1: Draw shape overlay on top (preview during drag)
    if (!comparing && shapeOverlayCanvasRef.current) {
      ctx.drawImage(shapeOverlayCanvasRef.current, 0, 0);
    }
    // Issue #24: Draw reference image overlay (above base+regions, below grid)
    if (!comparing && referenceImage) {
      const refOffscreen = document.createElement("canvas");
      refOffscreen.width = referenceImage.width;
      refOffscreen.height = referenceImage.height;
      const refCtx = refOffscreen.getContext("2d")!;
      refCtx.putImageData(referenceImage, 0, 0);
      ctx.save();
      ctx.globalAlpha = referenceOpacity / 100;
      ctx.drawImage(refOffscreen, 0, 0, canvas.width, canvas.height);
      ctx.restore();
    }
    // S8: Draw grid overlay
    if (!comparing && gridEnabled && gridSize > 0) {
      const w = canvas.width;
      const h = canvas.height;
      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,0.12)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = gridSize; x < w; x += gridSize) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
      }
      for (let y = gridSize; y < h; y += gridSize) {
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
      }
      ctx.stroke();
      ctx.restore();
    }
  // redrawTick is intentionally included so brush strokes (ref mutations) trigger redraws
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseState, regions, comparing, redrawTick, gridEnabled, gridSize, referenceImage, referenceOpacity]);

  // ---------------------------------------------------------------------------
  // Image loading
  // ---------------------------------------------------------------------------

  // Fit canvas to container with clientWidth > 0 guard and one rAF retry.
  const tryFitContainer = useCallback(
    (w: number, h: number) => {
      const attempt = () => {
        const c = containerRef.current;
        if (c && c.clientWidth > 0 && c.clientHeight > 0) {
          zoom.fitToContainer(c.clientWidth, c.clientHeight, w, h);
          return true;
        }
        return false;
      };
      requestAnimationFrame(() => {
        if (!attempt()) {
          requestAnimationFrame(() => { attempt(); });
        }
      });
    },
    [zoom]
  );

  // Common post-load sequence shared by SVG and non-SVG paths in loadImageFromFile.
  const applyLoadedImageData = useCallback(
    (imageData: ImageData, w: number, h: number, fileName: string) => {
      setBaseState({ imageData, naturalWidth: w, naturalHeight: h });
      editorHistory.reset();
      setPalette(extractPaletteColors(imageData, 8));
      setStatus(`画像読み込み完了: ${w}x${h}`);
      // Issue #7: record recent file
      const thumb = makeThumbnail(imageData);
      addRecentFile(fileName, thumb);
      setRecentFiles(getRecentFiles());
      // B-1: auto-fit on load
      tryFitContainer(w, h);
    },
    [editorHistory, tryFitContainer]
  );

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
            applyLoadedImageData(imageData, w, h, file.name);
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
        applyLoadedImageData(imageData, w, h, file.name);
      };
      img.onerror = () => {
        setStatus("画像の読み込みに失敗しました");
        URL.revokeObjectURL(url);
      };
      img.src = url;
    },
    [applyLoadedImageData]
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
  // S8: Snap helper — rounds coord to nearest grid multiple when snap is ON
  // ---------------------------------------------------------------------------

  const snapCoord = useCallback(
    (v: number): number => snapCoordPure(v, snapEnabled, gridSize),
    [snapEnabled, gridSize]
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

  const handleTextPlace = useCallback(
    (x: number, y: number) => {
      setTextDraft({ x: snapCoord(x), y: snapCoord(y), value: "" });
      // Focus will be handled by useEffect after render
    },
    [snapCoord]
  );

  const handleEyedropper = useCallback(
    (x: number, y: number) => {
      if (!baseState.imageData) return;
      const rgb = pickPixelColor(baseState.imageData, x, y);
      if (!rgb) return;
      const hex = rgbToHex(rgb[0], rgb[1], rgb[2]);
      setSelectedColor(hex);
      addRecentColor(hex);
      setMode("color");
      setStatus(`${t("status.eyedropper", lang)}: ${hex.toUpperCase()}`);
    },
    [baseState.imageData, addRecentColor]
  );

  const handleReplaceAll = useCallback(
    (x: number, y: number) => {
      if (!baseState.imageData) return;
      if (smoothReplace) {
        // smoothReplace modifies pixels directly; store result in bakeLayer
        const newColor = hexToRgb(selectedColor);
        const newImageData = smoothReplaceAll(
          compositeRegions(baseState.imageData, regions, bakeLayerRef.current),
          x, y, tolerance, newColor, true
        );
        // Store the result as an updated bakeLayer that encodes the full visual state.
        // Strategy: bake current regions+bake into a new bakeLayer snapshot,
        // then apply smooth replace on top of it.
        // Since smoothReplace produces a new ImageData (base-relative), we store
        // it as a "full bake" by diffing against base.
        const w = baseState.naturalWidth;
        const h = baseState.naturalHeight;
        const newBake = new ImageData(new Uint8ClampedArray(w * h * 4), w, h);
        copyImageDataInto(newBake, newImageData);
        bakeLayerRef.current = newBake;
        editorHistory.push([], newBake);
        triggerRedraw();
        addRecentColor(selectedColor);
        setStatus(`${t("status.replaceAllSmooth", lang)} → ${selectedColor}`);
        return;
      }
      let replacePixels = replaceAllSelect(baseState.imageData, x, y, tolerance);
      if (replacePixels.length === 0) return;
      if (closeRadius > 0) {
        replacePixels = closeMask(replacePixels, baseState.naturalWidth, baseState.naturalHeight, closeRadius);
      }

      // Apply feather if featherRadius > 0
      if (featherRadius > 0) {
        const composited = compositeRegions(baseState.imageData, regions, bakeLayerRef.current);
        const newColor = hexToRgb(selectedColor);
        const feathered = applyFeatheredFill(composited, replacePixels, newColor, featherRadius, false);
        const w = baseState.naturalWidth;
        const hh = baseState.naturalHeight;
        const newBake2 = new ImageData(new Uint8ClampedArray(w * hh * 4), w, hh);
        copyImageDataInto(newBake2, feathered);
        bakeLayerRef.current = newBake2;
        editorHistory.push([...regions], newBake2);
        triggerRedraw();
        addRecentColor(selectedColor);
        setStatus(`${t("status.replaceAllFeather", lang)}${featherRadius}): ${replacePixels.length}px → ${selectedColor}`);
        return;
      }

      const newRegion: PaintRegion = {
        id: `region-${crypto.randomUUID()}`,
        pixels: replacePixels,
        color: selectedColor,
        transparent: false,
      };
      editorHistory.push([...regions, newRegion], bakeLayerRef.current);
      addRecentColor(selectedColor);
      setStatus(`${t("status.replaceAll", lang)}: ${replacePixels.length}px → ${selectedColor}`);
    },
    [baseState, tolerance, selectedColor, regions, editorHistory, smoothReplace, closeRadius, featherRadius, triggerRedraw, addRecentColor]
  );

  const handleFloodFill = useCallback(
    (x: number, y: number) => {
      if (!baseState.imageData) return;
      // Color / transparent mode: flood fill (with optional 8-neighbor connectivity)
      let pixels = floodFillSelect(
        baseState.imageData, x, y, tolerance,
        includeAntialias ? "antialias" : "normal",
        connectivity
      );
      if (pixels.length === 0) return;

      // Apply hole-fill (closeRadius > 0)
      if (closeRadius > 0) {
        pixels = closeMask(pixels, baseState.naturalWidth, baseState.naturalHeight, closeRadius);
      }

      // Apply feather if featherRadius > 0
      if (featherRadius > 0) {
        const composited = compositeRegions(baseState.imageData, regions, bakeLayerRef.current);
        const newColor = hexToRgb(selectedColor);
        const feathered = applyFeatheredFill(composited, pixels, newColor, featherRadius, mode === "transparent");
        const w2 = baseState.naturalWidth;
        const h2 = baseState.naturalHeight;
        const newBakeF = new ImageData(new Uint8ClampedArray(w2 * h2 * 4), w2, h2);
        copyImageDataInto(newBakeF, feathered);
        bakeLayerRef.current = newBakeF;
        editorHistory.push([...regions], newBakeF);
        triggerRedraw();
        if (mode !== "transparent") addRecentColor(selectedColor);
        setStatus(
          mode === "transparent"
            ? `${t("status.transparentFeather", lang)}${featherRadius}): ${pixels.length}px`
            : `${t("status.colorChangeFeather", lang)}${featherRadius}): ${pixels.length}px → ${selectedColor}`
        );
        return;
      }

      const newRegion: PaintRegion = {
        id: `region-${crypto.randomUUID()}`,
        pixels,
        color: selectedColor,
        transparent: mode === "transparent",
      };

      editorHistory.push([...regions, newRegion], bakeLayerRef.current);
      if (mode !== "transparent") addRecentColor(selectedColor);
      setStatus(
        mode === "transparent"
          ? `${t("status.transparent", lang)}: ${pixels.length}px`
          : `${t("status.colorChange", lang)}: ${pixels.length}px → ${selectedColor}`
      );
    },
    [baseState, tolerance, selectedColor, mode, regions, editorHistory, includeAntialias, connectivity, closeRadius, featherRadius, triggerRedraw, addRecentColor]
  );

  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (spacePressed) return;
      if (!baseState.imageData) return;
      // brush/shape mode uses mousedown/mousemove/mouseup, not click
      if (mode === "brush" || mode === "shape") return;
      const coords = getCanvasCoords(e);
      if (!coords) return;
      const { x, y } = coords;

      switch (mode) {
        case "text":        return handleTextPlace(x, y);
        case "eyedropper":  return handleEyedropper(x, y);
        case "replace-all": return handleReplaceAll(x, y);
        default:            return handleFloodFill(x, y);
      }
    },
    [baseState.imageData, mode, spacePressed, getCanvasCoords, handleTextPlace, handleEyedropper, handleReplaceAll, handleFloodFill]
  );

  // ---------------------------------------------------------------------------
  // Brush stroke handlers
  // ---------------------------------------------------------------------------

  const handleBrushMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (mode !== "brush" || spacePressed || !baseState.imageData) return;
      const coords = getCanvasCoords(e);
      if (!coords) return;
      const { x, y } = coords;
      const w = baseState.naturalWidth;
      const h = baseState.naturalHeight;

      // Initialize bakeLayer if not yet created
      if (!bakeLayerRef.current) {
        bakeLayerRef.current = new ImageData(new Uint8ClampedArray(w * h * 4), w, h);
      }

      // Initialize stroke offscreen canvas
      if (!strokeCanvasRef.current ||
          strokeCanvasRef.current.width !== w ||
          strokeCanvasRef.current.height !== h) {
        const sc = document.createElement("canvas");
        sc.width = w;
        sc.height = h;
        strokeCanvasRef.current = sc;
      }
      const sc = strokeCanvasRef.current;
      const sctx = sc.getContext("2d")!;
      sctx.clearRect(0, 0, w, h);

      brushDrawingRef.current = true;
      brushLastPosRef.current = { x, y };

      // Draw initial dot
      sctx.save();
      sctx.globalAlpha = opacity / 100;
      if (blendMode !== "normal") sctx.globalCompositeOperation = blendMode as GlobalCompositeOperation;
      sctx.fillStyle = selectedColor;
      sctx.beginPath();
      sctx.arc(x, y, brushSize / 2, 0, Math.PI * 2);
      sctx.fill();
      sctx.restore();

      // Merge stroke canvas into bakeLayer
      mergeBrushStroke(w, h);
      triggerRedraw();
    },
    [mode, spacePressed, baseState, getCanvasCoords, selectedColor, brushSize, opacity, blendMode, triggerRedraw]
  );

  const handleBrushMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!brushDrawingRef.current || mode !== "brush" || !baseState.imageData) return;
      const coords = getCanvasCoords(e);
      if (!coords) return;
      const { x, y } = coords;
      const last = brushLastPosRef.current;
      if (!last) return;

      const sc = strokeCanvasRef.current;
      if (!sc) return;
      const sctx = sc.getContext("2d")!;

      // Draw line from last to current position (HTML prototype: line method)
      sctx.save();
      sctx.globalAlpha = opacity / 100;
      if (blendMode !== "normal") sctx.globalCompositeOperation = blendMode as GlobalCompositeOperation;
      sctx.strokeStyle = selectedColor;
      sctx.lineWidth = brushSize;
      sctx.lineCap = "round";
      sctx.beginPath();
      sctx.moveTo(last.x, last.y);
      sctx.lineTo(x, y);
      sctx.stroke();
      sctx.restore();

      brushLastPosRef.current = { x, y };
      mergeBrushStroke(baseState.naturalWidth, baseState.naturalHeight);
      triggerRedraw();
    },
    [mode, baseState, getCanvasCoords, selectedColor, brushSize, opacity, blendMode, triggerRedraw]
  );

  const handleBrushMouseUp = useCallback(() => {
    if (!brushDrawingRef.current) return;
    brushDrawingRef.current = false;
    brushLastPosRef.current = null;

    // Commit stroke to undo history
    editorHistory.push([...regions], bakeLayerRef.current);
    setStatus(t("status.brushDraw", lang));
  }, [editorHistory, regions]);

  /**
   * Merges the current stroke offscreen canvas into bakeLayerRef.
   * Called on every tick during a brush stroke.
   */
  function mergeBrushStroke(w: number, h: number) {
    const sc = strokeCanvasRef.current;
    if (!sc || !bakeLayerRef.current) return;
    const sctx = sc.getContext("2d")!;
    const strokeData = sctx.getImageData(0, 0, w, h);
    const bakeData = bakeLayerRef.current.data;
    const sd = strokeData.data;
    for (let i = 0; i < w * h; i++) {
      const k = i * 4;
      const sa = sd[k + 3];
      if (sa === 0) continue;
      if (sa === 255) {
        bakeData[k] = sd[k];
        bakeData[k + 1] = sd[k + 1];
        bakeData[k + 2] = sd[k + 2];
        bakeData[k + 3] = 255;
      } else {
        const alpha = sa / 255;
        const inv = 1 - alpha;
        bakeData[k] = Math.round(bakeData[k] * inv + sd[k] * alpha);
        bakeData[k + 1] = Math.round(bakeData[k + 1] * inv + sd[k + 1] * alpha);
        bakeData[k + 2] = Math.round(bakeData[k + 2] * inv + sd[k + 2] * alpha);
        bakeData[k + 3] = Math.min(255, bakeData[k + 3] + sa);
      }
    }
    // Clear stroke canvas after merging so next tick only adds new pixels
    sctx.clearRect(0, 0, w, h);
  }

  // ---------------------------------------------------------------------------
  // S5-1: Text tool: commit draft to bake layer
  // ---------------------------------------------------------------------------

  const commitTextDraft = useCallback(
    (draft: TextDraft) => {
      if (!baseState.imageData || draft.value.trim() === "") {
        setTextDraft(null);
        return;
      }
      const w = baseState.naturalWidth;
      const h = baseState.naturalHeight;

      if (!bakeLayerRef.current) {
        bakeLayerRef.current = new ImageData(new Uint8ClampedArray(w * h * 4), w, h);
      }

      const offscreen = document.createElement("canvas");
      offscreen.width = w;
      offscreen.height = h;
      const ctx = offscreen.getContext("2d")!;

      // Draw existing bake layer first
      ctx.putImageData(bakeLayerRef.current, 0, 0);

      // Draw text
      const fontStr = `${textFontSize}px ${textFontFamily}`;
      ctx.save();
      ctx.globalAlpha = opacity / 100;
      if (blendMode !== "normal") ctx.globalCompositeOperation = blendMode as GlobalCompositeOperation;
      ctx.font = fontStr;
      ctx.textBaseline = "top";

      // S8: apply rotate + flip around text anchor point
      const textMetrics = ctx.measureText(draft.value);
      const textW = textMetrics.width;
      const textH = textFontSize;
      const textCx = draft.x + textW / 2;
      const textCy = draft.y + textH / 2;
      ctx.translate(textCx, textCy);
      if (draftRotateDeg !== 0) ctx.rotate((draftRotateDeg * Math.PI) / 180);
      if (draftFlipX) ctx.scale(-1, 1);
      if (draftFlipY) ctx.scale(1, -1);
      ctx.translate(-textCx, -textCy);

      if (useFill) {
        if (fillType === "linearGradient") {
          // Measure text to approximate bounding box for gradient
          applyLinearGradient(ctx, draft.x, draft.y, textW, textH, gradientConfig.stops, gradientConfig.angle);
        } else if (fillType === "radialGradient") {
          applyRadialGradient(ctx, draft.x, draft.y, textW, textH, gradientConfig.stops);
        } else {
          ctx.fillStyle = selectedColor;
        }
        ctx.fillText(draft.value, draft.x, draft.y);
      }
      if (useStroke && strokeWidth > 0) {
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = strokeWidth;
        ctx.strokeText(draft.value, draft.x, draft.y);
      }
      ctx.restore();

      const newBake = ctx.getImageData(0, 0, w, h);
      bakeLayerRef.current = newBake;
      editorHistory.push([...regions], newBake);
      triggerRedraw();
      addRecentColor(selectedColor);
      setStatus(`${t("status.textDrawn", lang)}: "${draft.value}"`);
      setTextDraft(null);
    },
    [baseState, selectedColor, strokeColor, strokeWidth, useFill, useStroke, textFontFamily, textFontSize, opacity, blendMode, fillType, gradientConfig, regions, editorHistory, triggerRedraw, addRecentColor, draftRotateDeg, draftFlipX, draftFlipY]
  );

  // ---------------------------------------------------------------------------
  // S6-1: Shape tool: draw draft overlay
  // ---------------------------------------------------------------------------

  const drawShapeOverlay = useCallback(
    (draft: ShapeDraft) => {
      if (!baseState.imageData) return;
      const w = baseState.naturalWidth;
      const h = baseState.naturalHeight;

      // Ensure overlay canvas exists and matches image size
      if (!shapeOverlayCanvasRef.current ||
          shapeOverlayCanvasRef.current.width !== w ||
          shapeOverlayCanvasRef.current.height !== h) {
        const oc = document.createElement("canvas");
        oc.width = w;
        oc.height = h;
        shapeOverlayCanvasRef.current = oc;
      }

      const oc = shapeOverlayCanvasRef.current;
      const octx = oc.getContext("2d")!;
      octx.clearRect(0, 0, w, h);

      const { x, y, w: bw, h: bh } = normalizeBbox(draft.startX, draft.startY, draft.endX, draft.endY);
      drawShape(
        octx,
        shapeKind,
        x, y, bw, bh,
        useFill ? selectedColor : null,
        useStroke && strokeWidth > 0 ? strokeColor : null,
        strokeWidth,
        polyVertices
      );

      // Merge overlay into bake for preview via triggerRedraw
      // We store overlay in a separate ref and composite in the redraw effect
    },
    [baseState, shapeKind, selectedColor, strokeColor, strokeWidth, useFill, useStroke, polyVertices]
  );

  const commitShapeDraft = useCallback(
    (draft: ShapeDraft) => {
      if (!baseState.imageData) return;
      const w = baseState.naturalWidth;
      const h = baseState.naturalHeight;
      const { x, y, w: bw, h: bh } = normalizeBbox(draft.startX, draft.startY, draft.endX, draft.endY);
      if (bw < 2 && bh < 2) {
        shapeDraftRef.current = null;
        triggerRedraw();
        return;
      }

      if (!bakeLayerRef.current) {
        bakeLayerRef.current = new ImageData(new Uint8ClampedArray(w * h * 4), w, h);
      }

      const offscreen = document.createElement("canvas");
      offscreen.width = w;
      offscreen.height = h;
      const ctx = offscreen.getContext("2d")!;
      ctx.putImageData(bakeLayerRef.current, 0, 0);

      // S7: apply opacity + blend mode
      ctx.save();
      ctx.globalAlpha = opacity / 100;
      if (blendMode !== "normal") ctx.globalCompositeOperation = blendMode as GlobalCompositeOperation;

      // S8: apply rotate + flip around shape bounding box center
      const shapeCx = x + bw / 2;
      const shapeCy = y + bh / 2;
      ctx.translate(shapeCx, shapeCy);
      if (draftRotateDeg !== 0) ctx.rotate((draftRotateDeg * Math.PI) / 180);
      if (draftFlipX) ctx.scale(-1, 1);
      if (draftFlipY) ctx.scale(1, -1);
      ctx.translate(-shapeCx, -shapeCy);

      // S7: apply gradient fill if selected
      if (useFill && fillType !== "solid" && bw > 0 && bh > 0) {
        ctx.save();
        ctx.beginPath();
        buildShapePath(ctx, shapeKind, x, y, bw, bh, polyVertices);
        if (fillType === "linearGradient") {
          applyLinearGradient(ctx, x, y, bw, bh, gradientConfig.stops, gradientConfig.angle);
        } else {
          applyRadialGradient(ctx, x, y, bw, bh, gradientConfig.stops);
        }
        ctx.fill();
        if (useStroke && strokeWidth > 0) {
          ctx.strokeStyle = strokeColor;
          ctx.lineWidth = strokeWidth;
          ctx.stroke();
        }
        ctx.restore();
      } else {
        drawShape(
          ctx,
          shapeKind,
          x, y, bw, bh,
          useFill ? selectedColor : null,
          useStroke && strokeWidth > 0 ? strokeColor : null,
          strokeWidth,
          polyVertices
        );
      }
      ctx.restore();

      const newBake = ctx.getImageData(0, 0, w, h);
      bakeLayerRef.current = newBake;
      editorHistory.push([...regions], newBake);

      shapeDraftRef.current = null;
      if (shapeOverlayCanvasRef.current) {
        const oc = shapeOverlayCanvasRef.current;
        const octx = oc.getContext("2d")!;
        octx.clearRect(0, 0, oc.width, oc.height);
      }
      triggerRedraw();
      addRecentColor(selectedColor);
      setStatus(`${t("status.shapeDrawn", lang)}: ${shapeKind}`);
    },
    [baseState, shapeKind, selectedColor, strokeColor, strokeWidth, useFill, useStroke, polyVertices, opacity, blendMode, fillType, gradientConfig, regions, editorHistory, triggerRedraw, addRecentColor, draftRotateDeg, draftFlipX, draftFlipY]
  );

  // ---------------------------------------------------------------------------
  // S6-1: Shape mouse handlers
  // ---------------------------------------------------------------------------

  const handleShapeMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (mode !== "shape" || spacePressed || !baseState.imageData) return;
      const coords = getCanvasCoords(e);
      if (!coords) return;
      const sx = snapCoord(coords.x);
      const sy = snapCoord(coords.y);
      shapeDraftRef.current = { startX: sx, startY: sy, endX: sx, endY: sy, active: true };
    },
    [mode, spacePressed, baseState, getCanvasCoords, snapCoord]
  );

  const handleShapeMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (mode !== "shape" || !shapeDraftRef.current?.active || !baseState.imageData) return;
      const coords = getCanvasCoords(e);
      if (!coords) return;
      let x = snapCoord(coords.x);
      let y = snapCoord(coords.y);
      const draft = shapeDraftRef.current;

      // Shift: constrain to square/circle
      if (e.shiftKey) {
        const dx = x - draft.startX;
        const dy = y - draft.startY;
        const size = Math.min(Math.abs(dx), Math.abs(dy));
        x = draft.startX + Math.sign(dx) * size;
        y = draft.startY + Math.sign(dy) * size;
      }

      shapeDraftRef.current = { ...draft, endX: x, endY: y };
      drawShapeOverlay(shapeDraftRef.current);
      triggerRedraw();
    },
    [mode, baseState, getCanvasCoords, drawShapeOverlay, triggerRedraw, snapCoord]
  );

  const handleShapeMouseUp = useCallback(
    () => {
      if (mode !== "shape" || !shapeDraftRef.current?.active) return;
      const draft = shapeDraftRef.current;
      shapeDraftRef.current = { ...draft, active: false };
      commitShapeDraft(draft);
    },
    [mode, commitShapeDraft]
  );

  // ---------------------------------------------------------------------------
  // Remove a specific region by id (mapping table undo)
  // ---------------------------------------------------------------------------

  const handleRemoveRegion = useCallback(
    (id: string) => {
      const next = regions.filter((r) => r.id !== id);
      editorHistory.push(next, bakeLayerRef.current);
      setStatus(t("status.regionRemoved", lang));
    },
    [regions, editorHistory]
  );

  // ---------------------------------------------------------------------------
  // S8: Center-align draft helpers — reposition textDraft or shapeDraft to canvas center
  // ---------------------------------------------------------------------------

  const centerAlignDraftH = useCallback(() => {
    if (!baseState.imageData) return;
    const w = baseState.naturalWidth;
    setTextDraft((d) => d ? { ...d, x: Math.round(w / 2) } : null);
    if (shapeDraftRef.current) {
      const draft = shapeDraftRef.current;
      const bw = Math.abs(draft.endX - draft.startX);
      const newStartX = Math.round((w - bw) / 2);
      shapeDraftRef.current = { ...draft, startX: newStartX, endX: newStartX + bw };
      drawShapeOverlay(shapeDraftRef.current);
      triggerRedraw();
    }
  }, [baseState, drawShapeOverlay, triggerRedraw]);

  const centerAlignDraftV = useCallback(() => {
    if (!baseState.imageData) return;
    const h = baseState.naturalHeight;
    setTextDraft((d) => d ? { ...d, y: Math.round(h / 2) } : null);
    if (shapeDraftRef.current) {
      const draft = shapeDraftRef.current;
      const bh = Math.abs(draft.endY - draft.startY);
      const newStartY = Math.round((h - bh) / 2);
      shapeDraftRef.current = { ...draft, startY: newStartY, endY: newStartY + bh };
      drawShapeOverlay(shapeDraftRef.current);
      triggerRedraw();
    }
  }, [baseState, drawShapeOverlay, triggerRedraw]);

  const centerAlignDraftBoth = useCallback(() => {
    if (!baseState.imageData) return;
    const w = baseState.naturalWidth;
    const h = baseState.naturalHeight;
    setTextDraft((d) => d ? { ...d, x: Math.round(w / 2), y: Math.round(h / 2) } : null);
    if (shapeDraftRef.current) {
      const draft = shapeDraftRef.current;
      const bw = Math.abs(draft.endX - draft.startX);
      const bh = Math.abs(draft.endY - draft.startY);
      const newStartX = Math.round((w - bw) / 2);
      const newStartY = Math.round((h - bh) / 2);
      shapeDraftRef.current = { ...draft, startX: newStartX, endX: newStartX + bw, startY: newStartY, endY: newStartY + bh };
      drawShapeOverlay(shapeDraftRef.current);
      triggerRedraw();
    }
  }, [baseState, drawShapeOverlay, triggerRedraw]);

  // ---------------------------------------------------------------------------
  // B-1: Clipboard paste (Ctrl+V)
  // ---------------------------------------------------------------------------

  const handleClipboardPaste = useCallback(async () => {
    if (!navigator.clipboard?.read) {
      setStatus(t("status.clipboardNoApi", lang));
      return;
    }
    let items: ClipboardItems;
    try {
      items = await navigator.clipboard.read();
    } catch {
      setStatus(t("status.clipboardDenied", lang));
      return;
    }
    for (const item of items) {
      const imageType = item.types.find((tp) => tp.startsWith("image/"));
      if (!imageType) continue;
      let blob: Blob;
      try {
        blob = await item.getType(imageType);
      } catch {
        setStatus(t("status.clipboardReadError", lang));
        return;
      }
      const url = URL.createObjectURL(blob);
      const img = new Image();
      await new Promise<void>((resolve) => {
        img.onload = () => resolve();
        img.onerror = () => {
          setStatus(t("status.clipboardImageLoadFailed", lang));
          URL.revokeObjectURL(url);
          resolve();
        };
        img.src = url;
      });
      if (!img.naturalWidth) return;
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
      editorHistory.reset();
      setPalette(extractPaletteColors(imageData, 8));
      setStatus(`${t("status.clipboardLoaded", lang)}: ${w}x${h}`);
      // auto-fit on paste
      tryFitContainer(w, h);
      return;
    }
    setStatus(t("status.clipboardNoImage", lang));
  }, [editorHistory, tryFitContainer, lang]);

  // ---------------------------------------------------------------------------
  // Issue #24: Paste image as reference layer (Ctrl+Shift+V)
  // ---------------------------------------------------------------------------

  const handleReferencePaste = useCallback(async () => {
    if (!navigator.clipboard?.read) {
      setStatus(t("status.clipboardNoApi", lang));
      return;
    }
    let items: ClipboardItems;
    try {
      items = await navigator.clipboard.read();
    } catch {
      setStatus(t("status.clipboardDenied", lang));
      return;
    }
    for (const item of items) {
      const imageType = item.types.find((tp) => tp.startsWith("image/"));
      if (!imageType) continue;
      let blob: Blob;
      try {
        blob = await item.getType(imageType);
      } catch {
        setStatus(t("status.clipboardReadError", lang));
        return;
      }
      const url = URL.createObjectURL(blob);
      const img = new Image();
      await new Promise<void>((resolve) => {
        img.onload = () => resolve();
        img.onerror = () => {
          setStatus(t("status.referenceLoadFailed", lang));
          URL.revokeObjectURL(url);
          resolve();
        };
        img.src = url;
      });
      if (!img.naturalWidth) return;
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      const offscreen = document.createElement("canvas");
      offscreen.width = w;
      offscreen.height = h;
      const ctx = offscreen.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, w, h);
      URL.revokeObjectURL(url);
      setReferenceImage(imageData);
      setStatus(`${t("status.referenceSet", lang)}: ${w}x${h}`);
      showToast(`${t("status.referenceSet", lang)} (${w}x${h})`);
      return;
    }
    setStatus(t("status.clipboardNoImage", lang));
  }, [showToast, lang]);

  // ---------------------------------------------------------------------------
  // Issue #8: Copy composited canvas to clipboard as PNG
  // ---------------------------------------------------------------------------

  const handleCopyToClipboard = useCallback(() => {
    if (!baseState.imageData) return;
    if (!navigator.clipboard?.write) {
      showToast(t("status.copyNoApi", lang), "error");
      return;
    }
    const composited = compositeRegions(baseState.imageData, regions, bakeLayerRef.current);
    const offscreen = document.createElement("canvas");
    offscreen.width = composited.width;
    offscreen.height = composited.height;
    const ctx = offscreen.getContext("2d")!;
    ctx.putImageData(composited, 0, 0);
    offscreen.toBlob((blob) => {
      if (!blob) {
        showToast(t("status.convertFailed", lang), "error");
        return;
      }
      navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]).then(() => {
        showToast(t("status.copySuccess", lang));
      }).catch(() => {
        showToast(t("status.copyFailed", lang), "error");
      });
    }, "image/png");
  }, [baseState.imageData, regions, bakeLayerRef, showToast]);

  // ---------------------------------------------------------------------------
  // B-1: Transparent white
  // ---------------------------------------------------------------------------

  const handleTransparentWhite = useCallback(() => {
    if (!baseState.imageData) return;
    const { pixels } = makeWhiteTransparent(baseState.imageData, 5);
    if (pixels.length === 0) {
      setStatus(t("status.noWhitePixel", lang));
      showToast(t("status.noWhitePixel", lang), "error");
      return;
    }
    const newRegion: PaintRegion = {
      id: `region-${crypto.randomUUID()}`,
      pixels,
      color: "#ffffff",
      transparent: true,
    };
    editorHistory.push([...regions, newRegion], bakeLayerRef.current);
    setStatus(`${t("status.whiteTransparent", lang)}: ${pixels.length}px`);
    showToast(`${t("status.whiteTransparent", lang)} (${pixels.length}px)`);
  }, [baseState.imageData, regions, editorHistory, showToast]);

  // ---------------------------------------------------------------------------
  // Issue #9: Canvas size change (crop / scale)
  // ---------------------------------------------------------------------------

  const handleCanvasSizeApply = useCallback(
    (newW: number, newH: number, anchor: AnchorPosition, mode: ResizeMode) => {
      if (!baseState.imageData) return;

      const oldW = baseState.naturalWidth;
      const oldH = baseState.naturalHeight;

      // Transform base ImageData
      const newBaseImageData =
        mode === "crop"
          ? cropImageData(baseState.imageData, newW, newH, anchor)
          : scaleImageData(baseState.imageData, newW, newH);

      // Transform bakeLayer if present
      let newBakeLayer: ImageData | null = null;
      if (bakeLayerRef.current) {
        newBakeLayer =
          mode === "crop"
            ? cropImageData(bakeLayerRef.current, newW, newH, anchor)
            : scaleImageData(bakeLayerRef.current, newW, newH);
      }

      // Transform all regions
      const newRegions = regions.map((r) =>
        mode === "crop"
          ? cropRegion(r, oldW, oldH, newW, newH, anchor)
          : scaleRegion(r, oldW, oldH, newW, newH)
      );

      // Update bakeLayerRef before push so history snapshot captures new layer
      bakeLayerRef.current = newBakeLayer;

      // Commit as a single undo-able action
      editorHistory.push(newRegions, newBakeLayer);

      setBaseState({
        imageData: newBaseImageData,
        naturalWidth: newW,
        naturalHeight: newH,
      });

      setCanvasSizeModalOpen(false);
      setStatus(`${t("status.canvasResized", lang)}: ${newW} × ${newH} px`);
      showToast(`${t("status.canvasResized", lang)}: ${newW} × ${newH}`);
    },
    [baseState, regions, editorHistory, showToast]
  );

  // ---------------------------------------------------------------------------
  // B-2: Save brand swatch
  // ---------------------------------------------------------------------------

  const handleSaveBrandSwatch = useCallback(() => {
    setBrandSwatches((prev) => {
      if (prev.includes(selectedColor)) return prev;
      const next = [selectedColor, ...prev].slice(0, BRAND_SWATCHES_MAX);
      saveBrandSwatches(next);
      return next;
    });
    setStatus(`${t("status.brandColorSaved", lang)}: ${selectedColor.toUpperCase()}`);
    showToast(`${t("status.brandColorSaved", lang)}: ${selectedColor.toUpperCase()}`);
  }, [selectedColor, showToast]);

  const handleRemoveBrandSwatch = useCallback((hex: string) => {
    setBrandSwatches((prev) => {
      const next = prev.filter((c) => c !== hex);
      saveBrandSwatches(next);
      return next;
    });
  }, []);

  // ---------------------------------------------------------------------------
  // S5-2: Palette sets
  // ---------------------------------------------------------------------------

  const handleAddPaletteSet = useCallback(() => {
    const id = `ps-${Date.now()}`;
    setPaletteSets((prev) => {
      const name = `パレット${prev.length + 1}`;
      const newSet: PaletteSet = { id, name, colors: [] };
      const next = [...prev, newSet].slice(-PALETTE_SETS_MAX);
      savePaletteSets(next);
      return next;
    });
    setActivePaletteSetId(id);
  }, []);

  const handleAddColorToPaletteSet = useCallback((setId: string) => {
    setPaletteSets((prev) => {
      const next = prev.map((ps) => {
        if (ps.id !== setId) return ps;
        if (ps.colors.includes(selectedColor)) return ps;
        return { ...ps, colors: [...ps.colors, selectedColor].slice(0, 16) };
      });
      savePaletteSets(next);
      return next;
    });
  }, [selectedColor]);

  const handleRemoveColorFromPaletteSet = useCallback((setId: string, hex: string) => {
    setPaletteSets((prev) => {
      const next = prev.map((ps) => {
        if (ps.id !== setId) return ps;
        return { ...ps, colors: ps.colors.filter((c) => c !== hex) };
      });
      savePaletteSets(next);
      return next;
    });
  }, []);

  const handleDeletePaletteSet = useCallback((setId: string) => {
    setPaletteSets((prev) => {
      const next = prev.filter((ps) => ps.id !== setId);
      savePaletteSets(next);
      return next;
    });
    setActivePaletteSetId((prev) => (prev === setId ? null : prev));
  }, []);

  const handleExportPaletteSet = useCallback((setId: string) => {
    const ps = paletteSets.find((s) => s.id === setId);
    if (!ps) return;
    downloadPaletteSet(ps);
  }, [paletteSets]);

  const handleImportPaletteSet = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result;
        if (typeof text !== "string") return;
        const imported = deserializePaletteSet(text);
        if (!imported) {
          showToast(t("panel.importPaletteError", lang), "error");
          return;
        }
        setPaletteSets((prev) => {
          const next = [...prev, imported].slice(-PALETTE_SETS_MAX);
          savePaletteSets(next);
          return next;
        });
        setActivePaletteSetId(imported.id);
      };
      reader.readAsText(file);
    };
    input.click();
  }, [lang, showToast]);

  // ---------------------------------------------------------------------------
  // Export handlers
  // ---------------------------------------------------------------------------

  const handleExportSvg = useCallback(() => {
    if (!baseState.imageData) return;
    let usedFallback = false;
    const svgString = buildSvg(
      baseState.imageData,
      regions,
      baseState.naturalWidth,
      baseState.naturalHeight,
      () => { usedFallback = true; }
    );
    const blob = new Blob([svgString], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "export.svg";
    a.click();
    URL.revokeObjectURL(url);
    if (usedFallback) {
      setStatus(t("status.svgExportedFallback", lang));
      showToast(t("status.svgFallbackToast", lang), "error");
    } else {
      setStatus(t("status.svgExported", lang));
      showToast(t("status.svgExported", lang));
    }
  }, [baseState, regions, showToast]);

  const handleExport = useCallback((options: ExportOptions) => {
    if (!baseState.imageData) return;
    const composited = compositeRegions(baseState.imageData, regions, bakeLayerRef.current);
    const { width, height } = calcOutputSize(
      baseState.naturalWidth,
      baseState.naturalHeight,
      options
    );
    const mimeType = getMimeType(options.format);
    const ext = getFileExtension(options.format);
    const filename = `export_${width}x${height}.${ext}`;
    exportImageData(composited, width, height, mimeType, options.quality, filename);
    const label = options.format.toUpperCase();
    setStatus(`${label}をエクスポートしました (${width}×${height})`);
    showToast(`${label}をエクスポートしました (${width}×${height})`);
  }, [baseState, regions, showToast]);

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
  // Issue #5: Project save / load
  // ---------------------------------------------------------------------------

  const handleSaveProject = useCallback(() => {
    if (!baseState.imageData) return;
    try {
      const project = serializeProject({
        imageData: baseState.imageData,
        naturalWidth: baseState.naturalWidth,
        naturalHeight: baseState.naturalHeight,
        regions,
        bakeLayer: bakeLayerRef.current,
        selectedColor,
        tolerance,
      });
      downloadChocoFile(project);
      autoSave.clearAutoSave();
      setStatus(t("status.projectSaved", lang));
      showToast(t("status.projectSaved", lang));
    } catch (err) {
      setStatus(t("status.projectSaveFailed", lang));
      showToast(t("status.projectSaveFailed", lang), "error");
      console.error("[handleSaveProject]", err);
    }
  }, [baseState, regions, selectedColor, tolerance, autoSave, showToast]);

  const handleLoadProject = useCallback(async () => {
    try {
      const raw = await openChocoFile();
      const state = await deserializeProject(raw);
      setBaseState({
        imageData: state.imageData,
        naturalWidth: state.naturalWidth,
        naturalHeight: state.naturalHeight,
      });
      editorHistory.reset();
      // Restore regions via history so undo works correctly
      editorHistory.push(state.regions, state.bakeLayer ?? null);
      bakeLayerRef.current = state.bakeLayer;
      setSelectedColor(state.selectedColor);
      setTolerance(state.tolerance);
      setPalette(extractPaletteColors(state.imageData, 8));
      setStatus(t("status.projectLoaded", lang));
      showToast(t("status.projectLoaded", lang));
      tryFitContainer(state.naturalWidth, state.naturalHeight);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown error";
      setStatus(t("status.projectLoadFailed.prefix", lang) + msg);
      showToast(t("status.projectSaveFailed", lang), "error");
      console.error("[handleLoadProject]", err);
    }
  }, [editorHistory, showToast, tryFitContainer]);

  const handleRestoreAutoSave = useCallback(async () => {
    setShowRestoreModal(false);
    try {
      const state = await autoSave.loadAutoSave();
      if (!state) {
        setStatus(t("status.regionRestored", lang));
        return;
      }
      // Autosave is image-omitted (lite format): restore regions and settings only.
      // imageData is null — the user must reload the original image separately.
      setBaseState({
        imageData: null,
        naturalWidth: state.naturalWidth,
        naturalHeight: state.naturalHeight,
      });
      editorHistory.reset();
      editorHistory.push(state.regions, null);
      bakeLayerRef.current = null;
      setSelectedColor(state.selectedColor);
      setTolerance(state.tolerance);
      setStatus(t("status.regionRestored", lang));
      showToast(t("status.regionRestored", lang), "info");
    } catch (err) {
      setStatus(t("status.restoreFailed", lang));
      showToast(t("status.restoreFailed", lang), "error");
      console.error("[handleRestoreAutoSave]", err);
    }
  }, [autoSave, editorHistory, showToast]);

  // Issue #29: welcome modal dismiss
  const handleWelcomeClose = useCallback(() => {
    markWelcomeSeen();
    setShowWelcome(false);
  }, []);

  // Issue #5: Ctrl+S / Ctrl+O global shortcuts (defined after handlers to avoid forward ref)
  useEffect(() => {
    const handleProjectShortcut = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "s") {
        e.preventDefault();
        handleSaveProject();
      } else if (e.ctrlKey && e.key === "o") {
        e.preventDefault();
        handleLoadProject();
      }
    };
    window.addEventListener("keydown", handleProjectShortcut);
    return () => window.removeEventListener("keydown", handleProjectShortcut);
  }, [handleSaveProject, handleLoadProject]);

  // ---------------------------------------------------------------------------
  // Derived values
  // ---------------------------------------------------------------------------

  const canvasCursor = spacePressed
    ? zoom.isPanning
      ? "grabbing"
      : "grab"
    : mode === "eyedropper"
      ? "cell"
      : mode === "replace-all"
        ? "crosshair"
        : mode === "brush"
          ? "crosshair"
          : mode === "text"
            ? "text"
            : mode === "shape"
              ? "crosshair"
              : mode === "color" || mode === "transparent"
                ? baseState.imageData ? "crosshair" : "default"
                : "default";

  const zoomPercent = Math.round(zoom.scale * 100);

  // Mapping entries: color regions only, most recent first
  const mappingEntries = regions.filter((r) => !r.transparent).slice().reverse();

  // Mode label for status bar
  const modeLabel =
    mode === "color" ? t("mode.color", lang) :
    mode === "transparent" ? t("mode.transparent", lang) :
    mode === "eyedropper" ? t("mode.eyedropper", lang) :
    mode === "brush" ? t("mode.brush", lang) :
    mode === "text" ? t("mode.text", lang) :
    mode === "shape" ? t("mode.shape", lang) :
    t("mode.replaceAll", lang);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div style={{ ...rootStyle, background: theme.color.bgBase, color: theme.color.textPrimary }}>
      {/* ===== Property Bar (top, full-width) — 2-row layout ===== */}
      <div style={{ ...propertyBarStyle, background: theme.color.bgPanel, borderBottomColor: theme.color.border }}>
        {/* --- Upper row: always-visible common controls --- */}
        <div style={{ ...propertyBarUpperRowStyle, borderBottomColor: theme.color.border }}>
          {/* File open */}
          <Tooltip label={t("label.openImage", lang)}>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              style={iconBtnStyle}
              aria-label={t("label.openImage", lang)}
            >
              <FolderOpen size={16} />
            </button>
          </Tooltip>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={handleFileChange}
          />

          {/* Issue #5: Project save */}
          <Tooltip label={t("label.saveProject", lang)} shortcut="Ctrl+S">
            <button
              type="button"
              onClick={handleSaveProject}
              disabled={!baseState.imageData}
              aria-disabled={!baseState.imageData}
              style={!baseState.imageData ? { ...iconBtnStyle, opacity: 0.35, pointerEvents: "none" } : iconBtnStyle}
              aria-label={t("label.saveProject", lang)}
            >
              <Save size={16} />
            </button>
          </Tooltip>

          {/* Issue #5: Project load */}
          <Tooltip label={t("label.loadProject", lang)} shortcut="Ctrl+O">
            <button
              type="button"
              onClick={handleLoadProject}
              style={iconBtnStyle}
              aria-label={t("label.loadProject", lang)}
            >
              <FolderInput size={16} />
            </button>
          </Tooltip>

          {/* Issue #7: Recent files dropdown */}
          <div ref={recentMenuRef} style={{ position: "relative" }}>
            <Tooltip label={t("label.recentFiles", lang)}>
              <button
                type="button"
                onClick={() => setRecentMenuOpen((v) => !v)}
                style={recentFiles.length === 0 ? { ...iconBtnStyle, opacity: 0.35 } : iconBtnStyle}
                aria-label={t("label.recentFiles", lang)}
                aria-haspopup="listbox"
                aria-expanded={recentMenuOpen}
              >
                <Clock size={16} />
              </button>
            </Tooltip>
            {recentMenuOpen && recentFiles.length > 0 && (
              <div
                role="listbox"
                aria-label={t("label.recentFilesList", lang)}
                style={recentMenuDropdownStyle}
              >
                {recentFiles.map((entry) => (
                  <button
                    key={entry.name + entry.lastAccessedAt}
                    type="button"
                    role="option"
                    aria-selected={false}
                    onClick={() => {
                      setRecentMenuOpen(false);
                      fileInputRef.current?.click();
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: T.space.sm,
                      width: "100%",
                      padding: `${T.space.xs}px ${T.space.sm}px`,
                      background: "transparent",
                      border: "none",
                      cursor: "pointer",
                      color: T.color.textPrimary,
                      fontFamily: T.font.family,
                      fontSize: T.font.body,
                      textAlign: "left",
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.background = T.color.bgPanel;
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.background = "transparent";
                    }}
                  >
                    <img
                      src={entry.thumbnailDataUrl}
                      alt=""
                      aria-hidden="true"
                      style={{
                        width: 32,
                        height: 32,
                        objectFit: "contain",
                        borderRadius: T.radius.sm,
                        border: `1px solid ${T.color.border}`,
                        background: T.color.checkerA,
                        flexShrink: 0,
                      }}
                    />
                    <div style={overflowFlex1Style}>
                      <div
                        style={{
                          fontSize: T.font.body,
                          color: T.color.textPrimary,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {entry.name}
                      </div>
                      <div style={{ fontSize: T.font.badge, color: T.color.textMuted }}>
                        {formatRelativeTime(entry.lastAccessedAt)}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div style={dividerStyle} />

          {/* Undo / Redo / Reset */}
          <Tooltip label={t("label.undo", lang)} shortcut="Ctrl+Z">
            <button
              type="button"
              onClick={() => { editorHistory.undo(); triggerRedraw(); setStatus(t("status.undo", lang)); }}
              disabled={!editorHistory.canUndo}
              aria-disabled={!editorHistory.canUndo}
              style={!editorHistory.canUndo ? { ...iconBtnStyle, opacity: 0.35, pointerEvents: "none" } : iconBtnStyle}
              aria-label={t("label.undo", lang)}
            >
              <Undo2 size={16} />
            </button>
          </Tooltip>
          <Tooltip label={t("label.redo", lang)} shortcut="Ctrl+Y">
            <button
              type="button"
              onClick={() => { editorHistory.redo(); triggerRedraw(); setStatus(t("status.redo", lang)); }}
              disabled={!editorHistory.canRedo}
              aria-disabled={!editorHistory.canRedo}
              style={!editorHistory.canRedo ? { ...iconBtnStyle, opacity: 0.35, pointerEvents: "none" } : iconBtnStyle}
              aria-label={t("label.redo", lang)}
            >
              <Redo2 size={16} />
            </button>
          </Tooltip>
          <button
            type="button"
            onClick={() => { editorHistory.reset(); triggerRedraw(); setStatus(t("status.reset", lang)); }}
            disabled={regions.length === 0}
            aria-disabled={regions.length === 0}
            style={regions.length === 0 ? { ...btnDangerStyle, opacity: 0.35, pointerEvents: "none" } : btnDangerStyle}
          >
            {t("label.resetAll", lang)}
          </button>

          <div style={dividerStyle} />

          {/* Zoom fit */}
          <Tooltip label={t("label.fitView", lang)} shortcut="Ctrl+0">
            <button
              type="button"
              onClick={handleFit}
              disabled={!baseState.imageData}
              aria-disabled={!baseState.imageData}
              style={!baseState.imageData ? { ...iconBtnStyle, opacity: 0.35, pointerEvents: "none" } : iconBtnStyle}
              aria-label={t("label.fitView", lang)}
            >
              <Maximize2 size={16} />
            </button>
          </Tooltip>

          <div style={dividerStyle} />

          {/* Export SVG */}
          <Tooltip label={t("label.exportSvg", lang)}>
            <button
              type="button"
              onClick={handleExportSvg}
              disabled={!baseState.imageData}
              aria-disabled={!baseState.imageData}
              style={!baseState.imageData ? { ...iconBtnSuccessStyle, opacity: 0.35, pointerEvents: "none" } : iconBtnSuccessStyle}
              aria-label={t("label.exportSvg", lang)}
            >
              <FileCode2 size={16} />
            </button>
          </Tooltip>

          {/* Export image modal trigger */}
          <Tooltip label={t("label.exportImage", lang)}>
            <button
              type="button"
              onClick={() => setExportModalOpen(true)}
              disabled={!baseState.imageData}
              aria-disabled={!baseState.imageData}
              style={!baseState.imageData ? { ...iconBtnSuccessStyle, opacity: 0.35, pointerEvents: "none" } : iconBtnSuccessStyle}
              aria-label={t("label.exportImage", lang)}
            >
              <Download size={16} />
            </button>
          </Tooltip>

          {/* Issue #8: Copy canvas to clipboard */}
          <Tooltip label={t("label.copyClipboard", lang)}>
            <button
              type="button"
              onClick={handleCopyToClipboard}
              disabled={!baseState.imageData}
              aria-disabled={!baseState.imageData}
              style={!baseState.imageData ? { ...iconBtnSuccessStyle, opacity: 0.35, pointerEvents: "none" } : iconBtnSuccessStyle}
              aria-label={t("label.copyClipboard", lang)}
            >
              <Copy size={16} />
            </button>
          </Tooltip>

          <div style={dividerStyle} />

          {/* B-1: Transparent white */}
          <Tooltip label={t("label.transparentWhite", lang)}>
            <button
              type="button"
              onClick={handleTransparentWhite}
              disabled={!baseState.imageData}
              aria-disabled={!baseState.imageData}
              style={!baseState.imageData ? { ...iconBtnStyle, opacity: 0.35, pointerEvents: "none" } : iconBtnStyle}
              aria-label={t("label.transparentWhite", lang)}
            >
              <Wand2 size={16} />
            </button>
          </Tooltip>

          {/* Issue #9: Canvas size */}
          <Tooltip label={t("label.canvasSize", lang)}>
            <button
              type="button"
              onClick={() => setCanvasSizeModalOpen(true)}
              disabled={!baseState.imageData}
              aria-disabled={!baseState.imageData}
              style={!baseState.imageData ? { ...iconBtnStyle, opacity: 0.35, pointerEvents: "none" } : iconBtnStyle}
              aria-label={t("label.canvasSize", lang)}
            >
              <Frame size={16} />
            </button>
          </Tooltip>

          <div style={dividerStyle} />

          {/* Issue #24: Reference layer controls */}
          <Tooltip label={t("label.referenceLayer", lang)}>
            <button
              type="button"
              onClick={handleReferencePaste}
              style={referenceImage ? { ...iconBtnStyle, background: T.color.accent, border: `1px solid ${T.color.accent}` } : iconBtnStyle}
              aria-label={t("label.referenceLayer", lang)}
              aria-pressed={!!referenceImage}
            >
              <Layers size={16} />
            </button>
          </Tooltip>
          {referenceImage && (
            <>
              <span style={labelStyle}>{t("prop.referenceOpacity", lang)}: {referenceOpacity}%</span>
              <input
                type="range"
                min={0}
                max={100}
                value={referenceOpacity}
                onChange={(e) => setReferenceOpacity(Number(e.target.value))}
                style={{ width: 62 }}
                title={`参照画像の不透明度: ${referenceOpacity}%`}
                aria-label={t("aria.referenceOpacity", lang)}
                aria-valuetext={`${referenceOpacity}%`}
              />
              <button
                type="button"
                onClick={() => { setReferenceImage(null); setStatus(t("status.referenceCleared", lang)); }}
                style={btnStyle}
                title={t("prop.referenceClear", lang)}
                aria-label={t("prop.referenceClear", lang)}
              >
                {t("prop.referenceClear", lang)}
              </button>
            </>
          )}

          <div style={dividerStyle} />

          {/* S7: Opacity slider */}
          <Tooltip label="不透明度">
            <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
              <Droplets size={14} style={{ color: T.color.textMuted, flexShrink: 0 }} />
            </span>
          </Tooltip>
          <span style={labelStyle}>{opacity}%</span>
          <input
            type="range"
            min={0}
            max={100}
            value={opacity}
            onChange={(e) => setOpacity(Number(e.target.value))}
            style={{ width: 62 }}
            title={`不透明度: ${opacity}%`}
            aria-label={t("aria.opacity", lang)}
            aria-valuetext={`${opacity}%`}
          />

          {/* S7: Blend mode */}
          <Tooltip label="ブレンドモード">
            <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
              <Layers size={14} style={{ color: T.color.textMuted, flexShrink: 0 }} />
            </span>
          </Tooltip>
          <select
            value={blendMode}
            onChange={(e) => setBlendMode(e.target.value as "normal" | "multiply" | "screen" | "overlay" | "darken" | "lighten")}
            style={selectStyle}
            title={t("label.blendMode", lang)}
          >
            <option value="normal">{t("blend.normal", lang)}</option>
            <option value="multiply">{t("blend.multiply", lang)}</option>
            <option value="screen">{t("blend.screen", lang)}</option>
            <option value="overlay">{t("blend.overlay", lang)}</option>
            <option value="darken">{t("blend.darken", lang)}</option>
            <option value="lighten">{t("blend.lighten", lang)}</option>
          </select>

          <div style={dividerStyle} />

          {/* S8: Grid + Snap controls */}
          <Tooltip label={t("label.grid", lang)}>
            <button
              type="button"
              onClick={() => setGridEnabled((v) => !v)}
              style={gridEnabled ? { ...iconBtnStyle, background: T.color.accent, border: `1px solid ${T.color.accent}` } : iconBtnStyle}
              aria-label={t("label.grid", lang)}
              aria-pressed={gridEnabled}
            >
              <Grid3x3 size={16} />
            </button>
          </Tooltip>
          {gridEnabled && (
            <>
              <span style={labelStyle}>{t("prop.gridSize", lang)}: {gridSize}</span>
              <input
                type="range"
                min={5}
                max={100}
                step={5}
                value={gridSize}
                onChange={(e) => setGridSize(Number(e.target.value))}
                style={{ width: 62 }}
                title={`グリッド間隔: ${gridSize}px`}
                aria-label={t("aria.gridSize", lang)}
                aria-valuetext={`${gridSize}px`}
              />
            </>
          )}
          <Tooltip label={t("label.snap", lang)}>
            <button
              type="button"
              onClick={() => setSnapEnabled((v) => !v)}
              style={snapEnabled ? { ...iconBtnStyle, background: T.color.accent, border: `1px solid ${T.color.accent}` } : iconBtnStyle}
              aria-label={t("label.snap", lang)}
              aria-pressed={snapEnabled}
            >
              <Magnet size={16} />
            </button>
          </Tooltip>

          <div style={dividerStyle} />

          {/* Before/after comparison */}
          <button
            type="button"
            onMouseDown={() => setComparing(true)}
            onMouseUp={() => setComparing(false)}
            onMouseLeave={() => setComparing(false)}
            disabled={!baseState.imageData || regions.length === 0}
            aria-disabled={!baseState.imageData || regions.length === 0}
            style={
              (!baseState.imageData || regions.length === 0)
                ? { ...btnStyle, opacity: 0.35, pointerEvents: "none" }
                : comparing
                  ? { ...btnStyle, background: T.color.bgElevated, border: `1px solid ${T.color.accent}` }
                  : btnStyle
            }
            title={t("label.compare", lang)}
          >
            {t("label.compare", lang)}
          </button>

          <div style={dividerStyle} />

          {/* Language toggle */}
          <button
            type="button"
            onClick={() => setLang(lang === "ja" ? "en" : "ja")}
            style={btnStyle}
            title={t("lang.toggle", lang)}
            aria-label={t("lang.toggle", lang)}
          >
            {t("lang.toggle", lang)}
          </button>
        </div>

        {/* --- Lower row: mode-specific controls (hidden for eyedropper) --- */}
        {mode !== "eyedropper" && (
          <div style={propertyBarLowerRowStyle}>
            {/* Color swatch + HSV picker — color / replace-all / brush modes */}
            {(mode === "color" || mode === "replace-all" || mode === "brush") && (
              <div style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 2 }}>
                <button
                  ref={colorSwatchRef}
                  type="button"
                  onClick={() => setHsvPickerOpen((v) => !v)}
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: "50%",
                    background: selectedColor,
                    border: `2px solid ${T.color.borderMid}`,
                    cursor: "pointer",
                    padding: 0,
                    flexShrink: 0,
                  }}
                  title="HSVピッカーで色を選択"
                  aria-label="HSVピッカーを開く"
                />
                <input
                  type="color"
                  value={selectedColor}
                  onChange={(e) => {
                    setSelectedColor(e.target.value);
                    setHsvPickerOpen(false);
                  }}
                  style={{
                    width: 16,
                    height: 16,
                    cursor: "pointer",
                    border: `1px solid ${T.color.borderMid}`,
                    borderRadius: T.radius.sm,
                    background: "none",
                    padding: 0,
                    outline: "none",
                    opacity: 0.7,
                  }}
                  title="色を直接入力"
                />
                {hsvPickerOpen && (
                  <div style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 200 }}>
                    <HsvPicker
                      hex={selectedColor}
                      onChange={(h) => setSelectedColor(h)}
                      onClose={() => setHsvPickerOpen(false)}
                    />
                  </div>
                )}
              </div>
            )}

            {/* Brush size — brush mode only */}
            {mode === "brush" && (
              <>
                <span style={labelStyle}>{t("prop.brushSize", lang)}: {brushSize}</span>
                <input
                  type="range"
                  min={1}
                  max={100}
                  value={brushSize}
                  onChange={(e) => setBrushSize(Number(e.target.value))}
                  style={{ width: 72 }}
                  title="ブラシサイズ (1-100px)"
                  aria-label={t("aria.brushSize", lang)}
                  aria-valuetext={`${brushSize}px`}
                />
              </>
            )}

            {/* Tolerance — color / replace-all / transparent modes */}
            {(mode === "color" || mode === "replace-all" || mode === "transparent") && (
              <>
                <Tooltip label={t("prop.toleranceTip", lang)}>
                  <span style={labelStyle}>{t("prop.tolerance", lang)}: {tolerance}</span>
                </Tooltip>
                <input
                  type="range"
                  min={0}
                  max={128}
                  value={tolerance}
                  onChange={(e) => setTolerance(Number(e.target.value))}
                  style={{ width: 72 }}
                  aria-label={t("aria.tolerance", lang)}
                  aria-valuetext={String(tolerance)}
                />
              </>
            )}

            {/* Hole-fill — color / replace-all / transparent modes */}
            {(mode === "color" || mode === "replace-all" || mode === "transparent") && (
              <>
                <Tooltip label={t("prop.holeFillTip", lang)}>
                  <span style={labelStyle}>{t("prop.holeFill", lang)}: {closeRadius}</span>
                </Tooltip>
                <input
                  type="range"
                  min={0}
                  max={5}
                  step={1}
                  value={closeRadius}
                  onChange={(e) => setCloseRadius(Number(e.target.value))}
                  style={{ width: 54 }}
                  aria-label={t("aria.holeFill", lang)}
                  aria-valuetext={closeRadius === 0 ? "OFF" : String(closeRadius)}
                />
              </>
            )}

            {/* Feather radius — transparent mode */}
            {mode === "transparent" && (
              <>
                <Tooltip label={t("prop.featherTip", lang)}>
                  <span style={labelStyle}>{t("prop.feather", lang)}: {featherRadius}</span>
                </Tooltip>
                <input
                  type="range"
                  min={0}
                  max={20}
                  step={1}
                  value={featherRadius}
                  onChange={(e) => setFeatherRadius(Number(e.target.value))}
                  style={{ width: 62 }}
                  aria-label={t("aria.feather", lang)}
                  aria-valuetext={featherRadius === 0 ? "OFF" : `${featherRadius}px`}
                />
              </>
            )}

            {/* Smooth replace — replace-all mode only */}
            {mode === "replace-all" && (
              <label style={{ ...labelStyle, display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }} title={t("prop.smoothReplace", lang)}>
                <input
                  type="checkbox"
                  checked={smoothReplace}
                  onChange={(e) => setSmoothReplace(e.target.checked)}
                  style={{ cursor: "pointer" }}
                />
                {t("prop.smoothReplace", lang)}
              </label>
            )}

            {/* Antialias boundary — color / transparent modes */}
            {(mode === "color" || mode === "transparent") && (
              <label style={{ ...labelStyle, display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={includeAntialias}
                  onChange={(e) => setIncludeAntialias(e.target.checked)}
                  style={{ cursor: "pointer" }}
                />
                <Tooltip label={t("prop.antialiasEdgeTip", lang)}>
                  <span>{t("prop.antialiasEdge", lang)}</span>
                </Tooltip>
              </label>
            )}

            {/* 8-neighbor connectivity — color / transparent modes */}
            {(mode === "color" || mode === "transparent") && (
              <label style={{ ...labelStyle, display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={connectivity === 8}
                  onChange={(e) => setConnectivity(e.target.checked ? 8 : 4)}
                  style={{ cursor: "pointer" }}
                />
                <Tooltip label={t("prop.8neighborTip", lang)}>
                  <span>{t("prop.8neighbor", lang)}</span>
                </Tooltip>
              </label>
            )}

            {/* Save brand swatch — color/replace-all mode */}
            {(mode === "color" || mode === "replace-all") && (
              <button
                type="button"
                onClick={handleSaveBrandSwatch}
                style={btnStyle}
                title={t("prop.saveColorTooltip", lang)}
              >
                {t("prop.saveColor", lang)}
              </button>
            )}

            {/* S5-1: Text tool options */}
            {mode === "text" && (
              <>
                <select
                  value={textFontFamily}
                  onChange={(e) => setTextFontFamily(e.target.value)}
                  style={selectStyle}
                  title="フォント"
                >
                  <option value="sans-serif">Sans-serif</option>
                  <option value="serif">Serif</option>
                  <option value="monospace">Monospace</option>
                  <option value="'Noto Sans JP', sans-serif">Noto Sans JP</option>
                  <option value="cursive">Cursive</option>
                  <option value="fantasy">Fantasy</option>
                </select>
                <span style={labelStyle}>{t("prop.fontSize", lang)}: {textFontSize}</span>
                <input
                  type="range"
                  min={10}
                  max={200}
                  value={textFontSize}
                  onChange={(e) => setTextFontSize(Number(e.target.value))}
                  style={{ width: 72 }}
                  title="フォントサイズ (10-200px)"
                  aria-label={t("aria.fontSize", lang)}
                  aria-valuetext={`${textFontSize}px`}
                />
              </>
            )}

            {/* S6-1: Shape kind selector */}
            {mode === "shape" && (
              <>
                <select
                  value={shapeKind}
                  onChange={(e) => setShapeKind(e.target.value as ShapeKind)}
                  style={selectStyle}
                  title="シェイプの種類"
                >
                  <option value="rect">矩形</option>
                  <option value="circle">楕円</option>
                  <option value="polygon">多角形</option>
                  <option value="star">星</option>
                </select>
                {shapeKind === "polygon" && (
                  <>
                    <span style={labelStyle}>{t("prop.polygonSides", lang)}: {polyVertices}</span>
                    <input
                      type="range"
                      min={3}
                      max={12}
                      value={polyVertices}
                      onChange={(e) => setPolyVertices(Number(e.target.value))}
                      style={{ width: 54 }}
                      title="多角形の辺数 (3-12)"
                      aria-label={t("aria.polygonSides", lang)}
                      aria-valuetext={String(polyVertices)}
                    />
                  </>
                )}
              </>
            )}

            {/* S6-2: Stroke/Fill options — text and shape modes */}
            {(mode === "text" || mode === "shape") && (
              <>
                <div style={dividerStyle} />
                <label style={{ ...labelStyle, display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={useFill}
                    onChange={(e) => setUseFill(e.target.checked)}
                    style={{ cursor: "pointer" }}
                  />
                  {t("prop.fill", lang)}
                </label>
                <label style={{ ...labelStyle, display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={useStroke}
                    onChange={(e) => setUseStroke(e.target.checked)}
                    style={{ cursor: "pointer" }}
                  />
                  {t("prop.stroke", lang)}
                </label>
                {useStroke && (
                  <>
                    <input
                      type="color"
                      value={strokeColor}
                      onChange={(e) => setStrokeColor(e.target.value)}
                      style={{
                        width: 24,
                        height: 24,
                        cursor: "pointer",
                        border: `1px solid ${T.color.borderMid}`,
                        borderRadius: T.radius.sm,
                        background: "none",
                        padding: 0,
                        outline: "none",
                      }}
                      title="線色"
                    />
                    <span style={labelStyle}>{t("prop.strokeWidth", lang)}: {strokeWidth}</span>
                    <input
                      type="range"
                      min={0}
                      max={20}
                      value={strokeWidth}
                      onChange={(e) => setStrokeWidth(Number(e.target.value))}
                      style={{ width: 62 }}
                      title="線幅 (0-20px)"
                      aria-label={t("aria.strokeWidth", lang)}
                      aria-valuetext={`${strokeWidth}px`}
                    />
                  </>
                )}
              </>
            )}

            {/* S7: Gradient fill button — brush/text/shape modes */}
            {(mode === "brush" || mode === "text" || mode === "shape") && (
              <>
                <div style={dividerStyle} />
                <div style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
                  <Tooltip label="グラデーション設定">
                    <button
                      type="button"
                      onClick={() => setGradientEditorOpen((v) => !v)}
                      style={{
                        ...iconBtnStyle,
                        background: gradientEditorOpen ? T.color.accent : T.color.bgElevated,
                        border: `1px solid ${gradientEditorOpen ? T.color.accent : T.color.borderMid}`,
                        padding: "0 6px",
                        width: "auto",
                        gap: 4,
                        fontSize: T.font.label,
                      }}
                      aria-label="グラデーション設定"
                    >
                      <span style={{
                        width: 14,
                        height: 14,
                        borderRadius: 2,
                        background: fillType === "solid"
                          ? selectedColor
                          : fillType === "linearGradient"
                            ? `linear-gradient(90deg, ${gradientConfig.stops[0]?.color ?? "#ff0000"}, ${gradientConfig.stops[gradientConfig.stops.length - 1]?.color ?? "#0000ff"})`
                            : `radial-gradient(circle, ${gradientConfig.stops[0]?.color ?? "#ff0000"}, ${gradientConfig.stops[gradientConfig.stops.length - 1]?.color ?? "#0000ff"})`,
                        border: `1px solid ${T.color.borderMid}`,
                        flexShrink: 0,
                        display: "inline-block",
                      }} />
                      塗り
                    </button>
                  </Tooltip>
                  {gradientEditorOpen && (
                    <div style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 300 }}>
                      <GradientEditor
                        fillType={fillType}
                        gradientConfig={gradientConfig}
                        onFillTypeChange={setFillType}
                        onGradientConfigChange={setGradientConfig}
                        onClose={() => setGradientEditorOpen(false)}
                        lang={lang}
                      />
                    </div>
                  )}
                </div>
              </>
            )}

            {/* S8: Rotate + Flip + Align — shape/text modes only */}
            {(mode === "shape" || mode === "text") && (
              <>
                <div style={dividerStyle} />
                <Tooltip label="回転角度">
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                    <RotateCw size={14} style={{ color: T.color.textMuted, flexShrink: 0 }} />
                  </span>
                </Tooltip>
                <span style={labelStyle}>{draftRotateDeg}°</span>
                <input
                  type="range"
                  min={-180}
                  max={180}
                  step={1}
                  value={draftRotateDeg}
                  onChange={(e) => setDraftRotateDeg(Number(e.target.value))}
                  style={{ width: 72 }}
                  title={`回転: ${draftRotateDeg}°`}
                  aria-label={t("aria.rotation", lang)}
                  aria-valuetext={`${draftRotateDeg}°`}
                />
                <Tooltip label="水平反転">
                  <button
                    type="button"
                    onClick={() => setDraftFlipX((v) => !v)}
                    style={draftFlipX ? { ...iconBtnStyle, background: T.color.accent, border: `1px solid ${T.color.accent}` } : iconBtnStyle}
                    aria-label="水平反転"
                    aria-pressed={draftFlipX}
                  >
                    <FlipHorizontal2 size={16} />
                  </button>
                </Tooltip>
                <Tooltip label="垂直反転">
                  <button
                    type="button"
                    onClick={() => setDraftFlipY((v) => !v)}
                    style={draftFlipY ? { ...iconBtnStyle, background: T.color.accent, border: `1px solid ${T.color.accent}` } : iconBtnStyle}
                    aria-label="垂直反転"
                    aria-pressed={draftFlipY}
                  >
                    <FlipVertical2 size={16} />
                  </button>
                </Tooltip>
                <div style={dividerStyle} />
                <Tooltip label="水平中央揃え">
                  <button
                    type="button"
                    onClick={centerAlignDraftH}
                    disabled={!baseState.imageData}
                    aria-disabled={!baseState.imageData}
                    style={!baseState.imageData ? { ...iconBtnStyle, opacity: 0.35, pointerEvents: "none" } : iconBtnStyle}
                    aria-label="水平中央揃え"
                  >
                    <AlignCenterHorizontal size={16} />
                  </button>
                </Tooltip>
                <Tooltip label="垂直中央揃え">
                  <button
                    type="button"
                    onClick={centerAlignDraftV}
                    disabled={!baseState.imageData}
                    aria-disabled={!baseState.imageData}
                    style={!baseState.imageData ? { ...iconBtnStyle, opacity: 0.35, pointerEvents: "none" } : iconBtnStyle}
                    aria-label="垂直中央揃え"
                  >
                    <AlignCenterVertical size={16} />
                  </button>
                </Tooltip>
                <Tooltip label="画面中央">
                  <button
                    type="button"
                    onClick={centerAlignDraftBoth}
                    disabled={!baseState.imageData}
                    aria-disabled={!baseState.imageData}
                    style={!baseState.imageData ? { ...iconBtnStyle, opacity: 0.35, pointerEvents: "none" } : iconBtnStyle}
                    aria-label="画面中央"
                  >
                    <AlignCenter size={16} />
                  </button>
                </Tooltip>
              </>
            )}
          </div>
        )}
      </div>

      {/* ===== Main body: left toolbar + canvas + right panel ===== */}
      <div style={mainBodyStyle}>

        {/* Left vertical toolbar */}
        <div style={{ ...leftToolbarStyle, background: theme.color.bgPanel, borderRightColor: theme.color.border }}>
          <Tooltip label={t("tool.color", lang)}>
            <button
              type="button"
              aria-pressed={mode === "color"}
              onClick={() => setMode("color")}
              onMouseDown={() => setPressedBtn("color")}
              onMouseUp={() => setPressedBtn(null)}
              onMouseLeave={() => setPressedBtn(null)}
              style={{ ...(mode === "color" ? leftToolBtnActiveStyle : leftToolBtnStyle), transform: pressedBtn === "color" ? "scale(0.92)" : "scale(1)" }}
              aria-label={t("tool.color", lang)}
            >
              <PaintBucket size={18} />
            </button>
          </Tooltip>
          <Tooltip label={t("tool.transparent", lang)}>
            <button
              type="button"
              aria-pressed={mode === "transparent"}
              onClick={() => setMode("transparent")}
              onMouseDown={() => setPressedBtn("transparent")}
              onMouseUp={() => setPressedBtn(null)}
              onMouseLeave={() => setPressedBtn(null)}
              style={{ ...(mode === "transparent" ? leftToolBtnActiveStyle : leftToolBtnStyle), transform: pressedBtn === "transparent" ? "scale(0.92)" : "scale(1)" }}
              aria-label={t("tool.transparent", lang)}
            >
              <Eraser size={18} />
            </button>
          </Tooltip>
          <Tooltip label={`${t("tool.eyedropper", lang)} (I)`}>
            <button
              type="button"
              aria-pressed={mode === "eyedropper"}
              onClick={() => setMode("eyedropper")}
              onMouseDown={() => setPressedBtn("eyedropper")}
              onMouseUp={() => setPressedBtn(null)}
              onMouseLeave={() => setPressedBtn(null)}
              style={{ ...(mode === "eyedropper" ? leftToolBtnActiveStyle : leftToolBtnStyle), transform: pressedBtn === "eyedropper" ? "scale(0.92)" : "scale(1)" }}
              aria-label={t("tool.eyedropper", lang)}
            >
              <Pipette size={18} />
            </button>
          </Tooltip>
          <Tooltip label={`${t("tool.replaceAll", lang)} (R)`}>
            <button
              type="button"
              aria-pressed={mode === "replace-all"}
              onClick={() => setMode("replace-all")}
              onMouseDown={() => setPressedBtn("replace-all")}
              onMouseUp={() => setPressedBtn(null)}
              onMouseLeave={() => setPressedBtn(null)}
              style={{ ...(mode === "replace-all" ? leftToolBtnActiveStyle : leftToolBtnStyle), transform: pressedBtn === "replace-all" ? "scale(0.92)" : "scale(1)" }}
              aria-label={t("tool.replaceAll", lang)}
            >
              <Replace size={18} />
            </button>
          </Tooltip>
          <Tooltip label={`${t("tool.brush", lang)} (B)`}>
            <button
              type="button"
              aria-pressed={mode === "brush"}
              onClick={() => setMode("brush")}
              onMouseDown={() => setPressedBtn("brush")}
              onMouseUp={() => setPressedBtn(null)}
              onMouseLeave={() => setPressedBtn(null)}
              style={{ ...(mode === "brush" ? leftToolBtnActiveStyle : leftToolBtnStyle), transform: pressedBtn === "brush" ? "scale(0.92)" : "scale(1)" }}
              aria-label={t("tool.brush", lang)}
            >
              <Paintbrush size={18} />
            </button>
          </Tooltip>
          <Tooltip label={`${t("tool.text", lang)} (T)`}>
            <button
              type="button"
              aria-pressed={mode === "text"}
              onClick={() => setMode("text")}
              onMouseDown={() => setPressedBtn("text")}
              onMouseUp={() => setPressedBtn(null)}
              onMouseLeave={() => setPressedBtn(null)}
              style={{ ...(mode === "text" ? leftToolBtnActiveStyle : leftToolBtnStyle), transform: pressedBtn === "text" ? "scale(0.92)" : "scale(1)" }}
              aria-label={t("tool.text", lang)}
            >
              <Type size={18} />
            </button>
          </Tooltip>
          <Tooltip label={`${t("tool.shape", lang)} (U)`}>
            <button
              type="button"
              aria-pressed={mode === "shape"}
              onClick={() => setMode("shape")}
              onMouseDown={() => setPressedBtn("shape")}
              onMouseUp={() => setPressedBtn(null)}
              onMouseLeave={() => setPressedBtn(null)}
              style={{ ...(mode === "shape" ? leftToolBtnActiveStyle : leftToolBtnStyle), transform: pressedBtn === "shape" ? "scale(0.92)" : "scale(1)" }}
              aria-label={t("tool.shape", lang)}
            >
              <Square size={18} />
            </button>
          </Tooltip>
          {/* Issue #52: Settings modal */}
          <Tooltip label={t("label.settings", lang)}>
            <button
              type="button"
              onClick={() => setSettingsModalOpen(true)}
              onMouseDown={() => setPressedBtn("settings")}
              onMouseUp={() => setPressedBtn(null)}
              onMouseLeave={() => setPressedBtn(null)}
              style={{ ...leftToolBtnStyle, marginTop: "auto", transform: pressedBtn === "settings" ? "scale(0.92)" : "scale(1)" }}
              aria-label={t("label.settings", lang)}
            >
              <Settings size={18} />
            </button>
          </Tooltip>
          <Tooltip label={themeMode === "dark" ? "ライトテーマに切替" : "ダークテーマに切替"}>
            <button
              type="button"
              onClick={toggleTheme}
              onMouseDown={() => setPressedBtn("theme")}
              onMouseUp={() => setPressedBtn(null)}
              onMouseLeave={() => setPressedBtn(null)}
              style={{ ...leftToolBtnStyle, transform: pressedBtn === "theme" ? "scale(0.92)" : "scale(1)" }}
              aria-label={themeMode === "dark" ? "ライトテーマに切替" : "ダークテーマに切替"}
              aria-pressed={themeMode === "light"}
            >
              {themeMode === "dark" ? <Sun size={18} /> : <Moon size={18} />}
            </button>
          </Tooltip>
          <Tooltip label={t("label.help", lang)}>
            <button
              type="button"
              onClick={() => setShortcutPos({
                x: Math.max(8, window.innerWidth / 2 - 130),
                y: Math.max(8, window.innerHeight / 2 - 120),
              })}
              onMouseDown={() => setPressedBtn("help")}
              onMouseUp={() => setPressedBtn(null)}
              onMouseLeave={() => setPressedBtn(null)}
              style={{ ...leftToolBtnStyle, transform: pressedBtn === "help" ? "scale(0.92)" : "scale(1)" }}
              aria-label="キーボードショートカット一覧を開く"
            >
              <HelpCircle size={18} />
            </button>
          </Tooltip>
          <Tooltip label={t("welcome.reshow", lang)}>
            <button
              type="button"
              onClick={() => setShowWelcome(true)}
              onMouseDown={() => setPressedBtn("welcome")}
              onMouseUp={() => setPressedBtn(null)}
              onMouseLeave={() => setPressedBtn(null)}
              style={{ ...leftToolBtnStyle, transform: pressedBtn === "welcome" ? "scale(0.92)" : "scale(1)" }}
              aria-label={t("welcome.reshow", lang)}
            >
              <span style={welcomeReshowIconStyle}>?</span>
            </button>
          </Tooltip>
        </div>

        {/* Canvas area */}
        <div
          ref={containerRef}
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          onContextMenu={(e) => {
            e.preventDefault();
            setShortcutPos({ x: e.clientX, y: e.clientY });
          }}
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
              `linear-gradient(45deg, ${theme.color.checkerA} 25%, transparent 25%), ` +
              `linear-gradient(-45deg, ${theme.color.checkerA} 25%, transparent 25%), ` +
              `linear-gradient(45deg, transparent 75%, ${theme.color.checkerA} 75%), ` +
              `linear-gradient(-45deg, transparent 75%, ${theme.color.checkerA} 75%)`,
            backgroundSize: "16px 16px",
            backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0px",
            backgroundColor: theme.color.checkerB,
          }}
        >
          {!baseState.imageData ? (
            <div style={dropZoneStyle}>
              <svg
                width="40"
                height="40"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={dropZoneIconStyle}
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              <div>
                <p style={dropZoneTitleStyle}>
                  {t("drop.title", lang)}
                </p>
                <p style={dropZoneSubStyle}>
                  {t("drop.formats", lang)}
                </p>
              </div>
              <div style={dropZoneDividerStyle}>
                <span style={dropZoneDividerLineStyle} />
                {t("drop.or", lang)}
                <span style={dropZoneDividerLineStyle} />
              </div>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                style={dropZoneButtonStyle}
              >
                {t("drop.selectFile", lang)}
              </button>
              <p style={dropZonePasteHintStyle}>{t("drop.paste", lang)}</p>
            </div>
          ) : (
            <div
              style={{
                transform: `translate(${zoom.offsetX}px, ${zoom.offsetY}px) scale(${zoom.scale})`,
                transformOrigin: "top left",
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
                onMouseDown={(e) => { handleBrushMouseDown(e); handleShapeMouseDown(e); }}
                onMouseMove={(e) => { handleCanvasMouseMove(e); handleBrushMouseMove(e); handleShapeMouseMove(e); }}
                onMouseUp={() => { handleBrushMouseUp(); handleShapeMouseUp(); }}
                onMouseLeave={() => { handleCanvasMouseLeave(); handleBrushMouseUp(); handleShapeMouseUp(); }}
                style={{ cursor: canvasCursor, display: "block" } as React.CSSProperties}
              />
            </div>
          )}

          {/* S5-1: Text draft input overlay */}
          {textDraft !== null && baseState.imageData && (
            <div
              style={{
                position: "absolute",
                left: zoom.offsetX + textDraft.x * zoom.scale,
                top: zoom.offsetY + textDraft.y * zoom.scale,
                zIndex: 500,
                pointerEvents: "auto",
              }}
            >
              <input
                ref={textInputRef}
                type="text"
                value={textDraft.value}
                onChange={(e) => setTextDraft((d) => d ? { ...d, value: e.target.value } : null)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    e.stopPropagation();
                    if (textDraft) commitTextDraft(textDraft);
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    e.stopPropagation();
                    setTextDraft(null);
                  }
                }}
                placeholder="テキストを入力してEnter"
                style={{
                  fontSize: Math.max(10, textFontSize * zoom.scale),
                  fontFamily: textFontFamily,
                  color: selectedColor,
                  background: "rgba(0,0,0,0.55)",
                  border: `1px dashed ${T.color.accent}`,
                  borderRadius: T.radius.sm,
                  padding: "2px 4px",
                  outline: "none",
                  minWidth: 120,
                  caretColor: T.color.accent,
                }}
              />
            </div>
          )}

          {/* Canvas status overlay (bottom-left) */}
          {baseState.imageData && hoverInfo && (
            <div style={statusBarStyle}>
              <span style={statusModeLabelStyle}>[{modeLabel}]</span>
              {hoverInfo}
            </div>
          )}

          {/* Zoom indicator (bottom-right) */}
          {baseState.imageData && (
            <div style={zoomIndicatorStyle}>
              {zoomPercent}%
            </div>
          )}
        </div>

        {/* Right panel */}
        {(showPalette || showMapping) && (
          <div style={{ ...rightPanelStyle, background: theme.color.bgPanel, borderLeftColor: theme.color.border }}>
            {/* Panel toggle tabs */}
            <div style={rightPanelHeaderRowStyle}>
              <button
                type="button"
                onClick={() => setShowPalette((v) => !v)}
                style={showPalette ? panelTabBtnActiveStyle : panelTabBtnStyle}
              >
                {t("panel.palette", lang)}
              </button>
              <button
                type="button"
                onClick={() => setShowMapping((v) => !v)}
                style={showMapping ? panelTabBtnActiveStyle : panelTabBtnStyle}
              >
                {t("panel.log", lang)}
              </button>
            </div>

            <div style={panelScrollStyle}>
              {/* Main palette colors */}
              {showPalette && palette.length > 0 && (
                <div style={rightPanelSectionStyle}>
                  <div style={rightPanelSectionHeaderStyle}>{t("panel.mainColors", lang)}</div>
                  <div style={swatchGridStyle}>
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
                          width: 22,
                          height: 22,
                          background: hex,
                          border: selectedColor === hex
                            ? `2px solid ${T.color.accent}`
                            : `1px solid ${T.color.borderMid}`,
                          borderRadius: T.radius.sm,
                          cursor: "pointer",
                          padding: 0,
                          flexShrink: 0,
                        }}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Recent colors */}
              {showPalette && recentColors.length > 0 && (
                <div style={rightPanelSectionStyle}>
                  <div style={rightPanelSectionHeaderStyle}>{t("panel.recentColors", lang)}</div>
                  <div style={swatchGridStyle}>
                    {recentColors.map((hex, i) => (
                      <button
                        key={`${hex}-${i}`}
                        type="button"
                        onClick={() => {
                          setSelectedColor(hex);
                          if (mode !== "color" && mode !== "replace-all") setMode("color");
                        }}
                        title={hex.toUpperCase()}
                        style={{
                          width: 22,
                          height: 22,
                          background: hex,
                          border: selectedColor === hex
                            ? `2px solid ${T.color.accent}`
                            : `1px solid ${T.color.borderMid}`,
                          borderRadius: T.radius.sm,
                          cursor: "pointer",
                          padding: 0,
                          flexShrink: 0,
                          transition: "transform 80ms",
                        }}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Brand color swatches */}
              {showPalette && brandSwatches.length > 0 && (
                <div style={rightPanelSectionStyle}>
                  <div style={rightPanelSectionHeaderStyle}>{t("panel.brandColors", lang)}</div>
                  <div style={swatchGridStyle}>
                    {brandSwatches.map((hex) => (
                      <div key={hex} style={relativeInlineFlexStyle}>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedColor(hex);
                            if (mode !== "color" && mode !== "replace-all") setMode("color");
                          }}
                          title={hex.toUpperCase()}
                          style={{
                            width: 22,
                            height: 22,
                            background: hex,
                            border: selectedColor === hex
                              ? `2px solid ${T.color.accent}`
                              : `1px solid ${T.color.borderMid}`,
                            borderRadius: T.radius.sm,
                            cursor: "pointer",
                            padding: 0,
                            flexShrink: 0,
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => handleRemoveBrandSwatch(hex)}
                          title={`${hex.toUpperCase()} を削除`}
                          style={{
                            position: "absolute",
                            top: -4,
                            right: -4,
                            width: 12,
                            height: 12,
                            background: T.color.swatchRemoveBg,
                            color: T.color.textPrimary,
                            border: "none",
                            borderRadius: "50%",
                            cursor: "pointer",
                            fontSize: 8,
                            lineHeight: "12px",
                            padding: 0,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* S5-2: Palette sets */}
              {showPalette && (
                <div style={rightPanelSectionStyle}>
                  <div style={paletteSectionHeaderRowStyle}>
                    <div style={rightPanelSectionHeaderStyle}>{t("panel.paletteSets", lang)}</div>
                    <div style={paletteSectionHeaderBtnsStyle}>
                      <button
                        type="button"
                        onClick={handleImportPaletteSet}
                        style={{ ...btnStyle, padding: "1px 6px", fontSize: T.font.badge }}
                        title={t("panel.importPalette", lang)}
                      >
                        {t("panel.importPalette", lang)}
                      </button>
                      <button
                        type="button"
                        onClick={handleAddPaletteSet}
                        style={{ ...btnStyle, padding: "1px 6px", fontSize: T.font.badge }}
                        title={t("panel.newPalette", lang)}
                      >
                        {t("panel.newPalette", lang)}
                      </button>
                    </div>
                  </div>
                  {paletteSets.length === 0 && (
                    <div style={{ color: T.color.textDim, fontSize: T.font.badge }}>{t("panel.noPalette", lang)}</div>
                  )}
                  {paletteSets.map((ps) => (
                    <div key={ps.id} style={{ marginBottom: T.space.xs }}>
                      <div style={paletteSetsRowStyle}>
                        <button
                          type="button"
                          onClick={() => setActivePaletteSetId(activePaletteSetId === ps.id ? null : ps.id)}
                          style={{
                            flex: 1,
                            textAlign: "left",
                            background: activePaletteSetId === ps.id ? T.color.bgElevated : "transparent",
                            color: activePaletteSetId === ps.id ? T.color.textPrimary : T.color.textMuted,
                            border: `1px solid ${activePaletteSetId === ps.id ? T.color.accent : T.color.border}`,
                            borderRadius: T.radius.sm,
                            padding: "2px 6px",
                            fontSize: T.font.badge,
                            cursor: "pointer",
                            fontFamily: T.font.family,
                            overflow: "hidden",
                            whiteSpace: "nowrap",
                            textOverflow: "ellipsis",
                          }}
                          title={ps.name}
                        >
                          {ps.name}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleExportPaletteSet(ps.id)}
                          style={{ ...btnStyle, padding: "1px 5px", fontSize: T.font.badge, flexShrink: 0 }}
                          title={t("panel.exportPalette", lang)}
                        >
                          {t("panel.exportPalette", lang)}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeletePaletteSet(ps.id)}
                          style={sidebarRemoveBtnStyle}
                          title="パレットを削除"
                        >
                          x
                        </button>
                      </div>
                      {activePaletteSetId === ps.id && (
                        <div>
                          <div style={{ ...swatchGridStyle, marginBottom: 4 }}>
                            {ps.colors.map((hex) => (
                              <div key={hex} style={relativeInlineFlexStyle}>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSelectedColor(hex);
                                    if (mode !== "color" && mode !== "replace-all" && mode !== "text" && mode !== "shape") setMode("color");
                                  }}
                                  title={hex.toUpperCase()}
                                  style={{
                                    width: 22,
                                    height: 22,
                                    background: hex,
                                    border: selectedColor === hex
                                      ? `2px solid ${T.color.accent}`
                                      : `1px solid ${T.color.borderMid}`,
                                    borderRadius: T.radius.sm,
                                    cursor: "pointer",
                                    padding: 0,
                                    flexShrink: 0,
                                  }}
                                />
                                <button
                                  type="button"
                                  onClick={() => handleRemoveColorFromPaletteSet(ps.id, hex)}
                                  title={`${hex.toUpperCase()} を削除`}
                                  style={{
                                    position: "absolute",
                                    top: -4,
                                    right: -4,
                                    width: 12,
                                    height: 12,
                                    background: T.color.swatchRemoveBg,
                                    color: T.color.textPrimary,
                                    border: "none",
                                    borderRadius: "50%",
                                    cursor: "pointer",
                                    fontSize: 8,
                                    lineHeight: "12px",
                                    padding: 0,
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                  }}
                                >
                                  ×
                                </button>
                              </div>
                            ))}
                          </div>
                          <button
                            type="button"
                            onClick={() => handleAddColorToPaletteSet(ps.id)}
                            style={{ ...btnStyle, padding: "1px 6px", fontSize: T.font.badge, width: "100%" }}
                            title={t("panel.addCurrentColor", lang)}
                          >
                            {t("panel.addCurrentColor", lang)}
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Edit log */}
              {showMapping && mappingEntries.length > 0 && (
                <div style={rightPanelSectionStyle}>
                  <div style={rightPanelSectionHeaderStyle}>
                    {t("panel.editLog", lang)} ({mappingEntries.length})
                  </div>
                  {mappingEntries.map((region) => (
                    <div key={region.id} style={sidebarRowStyle}>
                      <span
                        style={{
                          width: 14,
                          height: 14,
                          background: region.color,
                          border: `1px solid ${T.color.borderMid}`,
                          borderRadius: T.radius.sm,
                          flexShrink: 0,
                          display: "inline-block",
                        }}
                      />
                      <span style={sidebarColorLabelStyle}>
                        {region.color.toUpperCase()}
                        <br />
                        <span style={sidebarPixelCountStyle}>{region.pixels.length}px</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => handleRemoveRegion(region.id)}
                        style={sidebarRemoveBtnStyle}
                        title="このリージョンを削除"
                      >
                        x
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Right panel collapsed — show reopen buttons */}
        {!showPalette && !showMapping && (
          <div style={{ ...rightPanelCollapsedStyle, background: theme.color.bgPanel, borderLeftColor: theme.color.border }}>
            <button
              type="button"
              onClick={() => setShowPalette(true)}
              style={panelTabBtnStyle}
              title={t("panel.palette", lang)}
              aria-label={t("panel.palette", lang)}
            >
              <Palette size={14} />
            </button>
            <button
              type="button"
              onClick={() => setShowMapping(true)}
              style={panelTabBtnStyle}
              title={t("panel.log", lang)}
              aria-label={t("panel.log", lang)}
            >
              <List size={14} />
            </button>
          </div>
        )}
      </div>

      {/* ===== Status bar (bottom, full-width) ===== */}
      <div style={{ ...bottomStatusBarStyle, background: theme.color.bgPanel, borderTopColor: theme.color.border, color: theme.color.textPrimary }}>
        <span style={statusModeLabelStyle}>[{modeLabel}]</span>
        <span>{hoverInfo ?? status}</span>
        {baseState.imageData && (
          <span style={{ marginLeft: "auto", color: T.color.textDim }}>{zoomPercent}%</span>
        )}
      </div>

      {/* Issue #5: Autosave restore modal */}
      {showRestoreModal && (
        <div style={restoreModalOverlayStyle}>
          <div style={restoreModalBoxStyle}>
            <p style={restoreModalTextStyle}>
              {t("restore.message", lang)}
            </p>
            <p style={{ ...restoreModalTextStyle, fontSize: 11, color: "#aaa", margin: "0 0 16px" }}>
              {t("restore.note", lang)}
            </p>
            <div style={restoreModalActionsStyle}>
              <button
                type="button"
                onClick={() => {
                  autoSave.clearAutoSave();
                  setShowRestoreModal(false);
                }}
                style={btnSubtleStyle}
              >
                {t("restore.discard", lang)}
              </button>
              <button
                type="button"
                onClick={handleRestoreAutoSave}
                style={btnAccentStyle}
              >
                {t("restore.restore", lang)}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* S3: Toast notification */}
      <Toast
        toast={currentToast}
        onDismiss={() => setCurrentToast(null)}
      />

      {/* S3: Shortcut help popover */}
      {shortcutPos && (
        <ShortcutHelp
          x={shortcutPos.x}
          y={shortcutPos.y}
          onClose={() => setShortcutPos(null)}
        />
      )}

      {/* Issue #6: Export modal */}
      {exportModalOpen && baseState.imageData && (
        <ExportModal
          naturalWidth={baseState.naturalWidth}
          naturalHeight={baseState.naturalHeight}
          onExport={handleExport}
          onClose={() => setExportModalOpen(false)}
          lang={lang}
          initialScale={defaultPngScale}
        />
      )}

      {/* Issue #9: Canvas size modal */}
      {canvasSizeModalOpen && baseState.imageData && (
        <CanvasSizeModal
          currentWidth={baseState.naturalWidth}
          currentHeight={baseState.naturalHeight}
          onApply={handleCanvasSizeApply}
          onClose={() => setCanvasSizeModalOpen(false)}
        />
      )}

      {/* Issue #29: Welcome modal */}
      {showWelcome && (
        <WelcomeModal lang={lang} onClose={handleWelcomeClose} />
      )}

      {/* Issue #52: Settings modal */}
      {settingsModalOpen && (
        <SettingsModal
          lang={lang}
          themeMode={themeMode}
          defaultPngScale={defaultPngScale}
          onLangChange={setLang}
          onThemeToggle={toggleTheme}
          onDefaultPngScaleChange={(s) => {
            setDefaultPngScale(s);
            saveDefaultPngScale(s);
          }}
          onReshowWelcome={() => {
            resetWelcomeSeen();
            setShowWelcome(true);
          }}
          onClose={() => setSettingsModalOpen(false)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared styles
// ---------------------------------------------------------------------------

const btnStyle: React.CSSProperties = {
  padding: "3px 10px",
  background: T.color.bgElevated,
  color: T.color.textPrimary,
  border: `1px solid ${T.color.borderMid}`,
  borderRadius: T.radius.sm,
  cursor: "pointer",
  fontSize: T.font.label,
  fontFamily: T.font.family,
  transition: "background 120ms",
};

const btnDangerStyle: React.CSSProperties = {
  ...btnStyle,
  background: T.color.danger,
  border: `1px solid ${T.color.danger}`,
};

const btnSubtleStyle: React.CSSProperties = {
  ...btnStyle,
  background: "transparent",
  border: `1px solid ${T.color.borderMid}`,
};

const dividerStyle: React.CSSProperties = {
  width: 1,
  height: 22,
  background: T.color.border,
  flexShrink: 0,
};

const labelStyle: React.CSSProperties = {
  fontSize: T.font.label,
  color: T.color.textMuted,
  fontFamily: T.font.family,
};

const statusBarStyle: React.CSSProperties = {
  position: "absolute",
  bottom: T.space.sm,
  left: T.space.md,
  fontSize: T.font.label,
  color: T.color.textPrimary,
  background: T.color.overlay,
  padding: "2px 8px",
  borderRadius: T.radius.sm,
  pointerEvents: "none",
  maxWidth: "60%",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  fontFamily: T.font.family,
};

const zoomIndicatorStyle: React.CSSProperties = {
  position: "absolute",
  bottom: T.space.sm,
  right: T.space.md,
  fontSize: T.font.label,
  color: T.color.textMuted,
  background: T.color.overlayMid,
  padding: "2px 6px",
  borderRadius: T.radius.sm,
  pointerEvents: "none",
  fontFamily: T.font.family,
};

const statusModeLabelStyle: React.CSSProperties = {
  color: T.color.textMuted,
  marginRight: T.space.xs + 2,
};

// Drop zone (empty state)
const dropZoneStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: T.space.md,
  border: `2px dashed ${T.color.borderMid}`,
  borderRadius: T.radius.lg,
  padding: `${T.space.xl * 2}px ${T.space.xl * 3}px`,
  textAlign: "center",
  color: T.color.textMuted,
  pointerEvents: "auto",
  background: "rgba(255,255,255,0.02)",
};

const dropZoneIconStyle: React.CSSProperties = {
  color: T.color.textMuted,
  flexShrink: 0,
};

const dropZoneTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: T.font.body,
  color: T.color.textPrimary,
  fontFamily: T.font.family,
};

const dropZoneSubStyle: React.CSSProperties = {
  margin: `${T.space.xs}px 0 0`,
  fontSize: T.font.label,
  color: T.color.textMuted,
  fontFamily: T.font.family,
};

const dropZoneDividerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: T.space.sm,
  color: T.color.textDim,
  fontSize: T.font.label,
  fontFamily: T.font.family,
};

const dropZoneDividerLineStyle: React.CSSProperties = {
  width: 40,
  height: 1,
  background: T.color.border,
  display: "inline-block",
};

const dropZoneButtonStyle: React.CSSProperties = {
  ...btnSubtleStyle,
  pointerEvents: "auto",
  fontSize: T.font.label,
  padding: "5px 16px",
  borderRadius: T.radius.md,
};

const dropZonePasteHintStyle: React.CSSProperties = {
  margin: 0,
  fontSize: T.font.label,
  color: T.color.textDim,
  fontFamily: T.font.family,
};

// Mapping sidebar rows (used in right panel)
const sidebarRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: T.space.xs + 2,
  padding: `${T.space.xs}px ${T.space.sm}px`,
  borderBottom: `1px solid ${T.color.border}`,
  fontSize: T.font.label,
};

const sidebarColorLabelStyle: React.CSSProperties = {
  color: T.color.textPrimary,
  flex: 1,
  fontFamily: "monospace",
  fontSize: T.font.badge,
};

const sidebarPixelCountStyle: React.CSSProperties = {
  color: T.color.textDim,
};

const sidebarRemoveBtnStyle: React.CSSProperties = {
  background: T.color.dangerDark,
  color: T.color.danger,
  border: "none",
  borderRadius: T.radius.sm,
  cursor: "pointer",
  fontSize: T.font.badge,
  padding: "1px 5px",
  flexShrink: 0,
  fontFamily: T.font.family,
};

// Icon button styles (S2: lucide-react icon buttons)
const iconBtnStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 30,
  height: 30,
  padding: 0,
  background: T.color.bgElevated,
  color: T.color.textPrimary,
  border: `1px solid ${T.color.borderMid}`,
  borderRadius: T.radius.sm,
  cursor: "pointer",
  // S3: transition補完
  transition: "background 120ms, transform 80ms",
  flexShrink: 0,
};

const iconBtnSuccessStyle: React.CSSProperties = {
  ...iconBtnStyle,
  background: T.color.success,
  border: `1px solid ${T.color.success}`,
};

const selectStyle: React.CSSProperties = {
  background: T.color.bgElevated,
  color: T.color.textPrimary,
  border: `1px solid ${T.color.borderMid}`,
  borderRadius: T.radius.sm,
  fontSize: T.font.label,
  fontFamily: T.font.family,
  padding: "3px 4px",
  cursor: "pointer",
};

// S4a: New layout styles
const leftToolbarStyle: React.CSSProperties = {
  width: 48,
  flexShrink: 0,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: T.space.xs,
  padding: `${T.space.sm}px 0`,
  background: T.color.bgPanel,
  borderRight: `1px solid ${T.color.border}`,
  boxShadow: T.shadow.panel,
};

const leftToolBtnStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 36,
  height: 36,
  padding: 0,
  background: "transparent",
  color: T.color.textMuted,
  border: "none",
  borderRadius: T.radius.md,
  cursor: "pointer",
  transition: "background 120ms, color 120ms, transform 80ms",
  flexShrink: 0,
};

const leftToolBtnActiveStyle: React.CSSProperties = {
  ...leftToolBtnStyle,
  background: T.color.accent,
  color: "#fff",
  boxShadow: "inset 0 1px 3px rgba(0,0,0,0.35)",
};

const rightPanelStyle: React.CSSProperties = {
  width: 200,
  flexShrink: 0,
  display: "flex",
  flexDirection: "column",
  background: T.color.bgPanel,
  borderLeft: `1px solid ${T.color.border}`,
  boxShadow: T.shadow.panel,
  overflow: "hidden",
};

const rightPanelCollapsedStyle: React.CSSProperties = {
  width: 32,
  flexShrink: 0,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: T.space.xs,
  padding: `${T.space.sm}px 0`,
  background: T.color.bgPanel,
  borderLeft: `1px solid ${T.color.border}`,
};

const rightPanelHeaderRowStyle: React.CSSProperties = {
  display: "flex",
  gap: 0,
  borderBottom: `1px solid ${T.color.border}`,
  flexShrink: 0,
};

const panelTabBtnStyle: React.CSSProperties = {
  flex: 1,
  padding: "5px 4px",
  background: "transparent",
  color: T.color.textMuted,
  border: "none",
  borderBottom: `2px solid transparent`,
  cursor: "pointer",
  fontSize: T.font.label,
  fontFamily: T.font.family,
  transition: "color 120ms",
};

const panelTabBtnActiveStyle: React.CSSProperties = {
  ...panelTabBtnStyle,
  color: T.color.textPrimary,
  borderBottom: `2px solid ${T.color.accent}`,
};

const rightPanelSectionStyle: React.CSSProperties = {
  padding: `${T.space.xs}px ${T.space.sm}px`,
  borderBottom: `1px solid ${T.color.border}`,
};

const rightPanelSectionHeaderStyle: React.CSSProperties = {
  fontSize: T.font.badge,
  color: T.color.textDim,
  fontFamily: T.font.family,
  marginBottom: T.space.xs,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};

const swatchGridStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: T.space.xs,
};

const paletteSectionHeaderRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  marginBottom: T.space.xs,
};

const paletteSectionHeaderBtnsStyle: React.CSSProperties = {
  display: "flex",
  gap: 4,
};

// Issue #5: Autosave restore modal styles
const restoreModalOverlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.6)",
  zIndex: 9999,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const restoreModalBoxStyle: React.CSSProperties = {
  background: T.color.bgPanel,
  border: `1px solid ${T.color.borderMid}`,
  borderRadius: T.radius.lg,
  padding: `${T.space.xl}px`,
  maxWidth: 360,
  width: "90%",
  boxShadow: T.shadow.elevated,
  fontFamily: T.font.family,
  color: T.color.textPrimary,
};

const restoreModalTextStyle: React.CSSProperties = {
  margin: "0 0 16px",
  fontSize: T.font.body,
};

const restoreModalActionsStyle: React.CSSProperties = {
  display: "flex",
  gap: T.space.sm,
  justifyContent: "flex-end",
};

const btnAccentStyle: React.CSSProperties = {
  padding: "3px 10px",
  background: T.color.accent,
  color: "#fff",
  border: `1px solid ${T.color.accent}`,
  borderRadius: T.radius.sm,
  cursor: "pointer",
  fontSize: T.font.label,
  fontFamily: T.font.family,
  transition: "background 120ms",
};

// Issue #29: welcome modal reshow button icon
const welcomeReshowIconStyle: React.CSSProperties = {
  fontSize: 14,
  lineHeight: 1,
};

const bottomStatusBarStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: T.space.sm,
  padding: `3px ${T.space.md}px`,
  background: T.color.bgPanel,
  borderTop: `1px solid ${T.color.border}`,
  fontSize: T.font.label,
  color: T.color.textPrimary,
  fontFamily: T.font.family,
  flexShrink: 0,
};

const rootStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  height: "100%",
  width: "100%",
  background: T.color.bgBase,
  color: T.color.textPrimary,
  fontFamily: T.font.family,
};

const propertyBarStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  background: T.color.bgPanel,
  borderBottom: `1px solid ${T.color.border}`,
  flexShrink: 0,
};

const propertyBarUpperRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: T.space.xs,
  padding: `5px ${T.space.sm}px`,
  flexWrap: "wrap",
  maxHeight: 74,
  overflow: "hidden",
  borderBottom: `1px solid ${T.color.border}`,
};

const propertyBarLowerRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: T.space.xs,
  padding: `4px ${T.space.sm}px`,
  flexWrap: "wrap",
  maxHeight: 68,
  overflow: "hidden",
};

const mainBodyStyle: React.CSSProperties = {
  display: "flex",
  flex: 1,
  overflow: "hidden",
};

const recentMenuDropdownStyle: React.CSSProperties = {
  position: "absolute",
  top: "calc(100% + 4px)",
  left: 0,
  zIndex: 200,
  background: T.color.bgElevated,
  border: `1px solid ${T.color.borderMid}`,
  borderRadius: T.radius.md,
  boxShadow: T.shadow.elevated,
  minWidth: 220,
  padding: "4px 0",
};

const overflowFlex1Style: React.CSSProperties = {
  overflow: "hidden",
  flex: 1,
};

const panelScrollStyle: React.CSSProperties = {
  flex: 1,
  overflowY: "auto",
};

const relativeInlineFlexStyle: React.CSSProperties = {
  position: "relative",
  display: "inline-flex",
};

const paletteSetsRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 4,
  marginBottom: 2,
};
