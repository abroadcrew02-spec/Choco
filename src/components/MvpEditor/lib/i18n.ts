/**
 * Lightweight i18n for MvpEditor.
 * No external libraries — plain TypeScript dictionary + hook.
 */

import { useState, useEffect, useCallback } from "react";

export type Lang = "ja" | "en";

// ---------------------------------------------------------------------------
// Dictionary
// ---------------------------------------------------------------------------

export const dict: Record<Lang, Record<string, string>> = {
  ja: {
    // Status messages
    "status.loadImage": "画像を読み込んでください",
    "status.loaded": "画像読み込み完了",
    "status.undo": "元に戻しました",
    "status.redo": "やり直しました",
    "status.reset": "全リセット完了",
    "status.autoSaved": "自動保存しました",
    "status.autoSaveError": "自動保存できませんでした（容量超過）",
    "status.projectSaved": "プロジェクトを保存しました (.choco)",
    "status.projectSaveFailed": "プロジェクトの保存に失敗しました",
    "status.projectLoaded": "プロジェクトを読み込みました",
    "status.projectLoadFailed.prefix": "読込失敗: ",
    "status.regionRestored": "リージョンと設定を復元しました。元画像を再読み込みしてください",
    "status.restoreFailed": "復元に失敗しました",
    "status.brushDraw": "ブラシ描画",
    "status.regionRemoved": "リージョンを削除しました",
    "status.clipboardNoApi": "クリップボードAPIが利用できません",
    "status.clipboardDenied": "クリップボードへのアクセスが拒否されました",
    "status.clipboardReadError": "クリップボード読み込みエラー",
    "status.clipboardNoImage": "クリップボードに画像がありません",
    "status.clipboardLoaded": "クリップボードから読み込み",
    "status.clipboardImageLoadFailed": "クリップボード画像の読み込みに失敗しました",
    "status.referenceSet": "参照画像を設定しました",
    "status.referenceLoadFailed": "参照画像の読み込みに失敗しました",
    "status.referenceCleared": "参照画像をクリアしました",
    "status.noWhitePixel": "白ピクセルが見つかりませんでした",
    "status.whiteTransparent": "白を透過",
    "status.svgParseFailed": "SVGの解析に失敗しました",
    "status.svgImageLoadFailed": "SVG画像の読み込みに失敗しました",
    "status.fileReadFailed": "ファイルの読み込みに失敗しました",
    "status.imageLoadFailed": "画像の読み込みに失敗しました",
    "status.svgExported": "SVGをエクスポートしました",
    "status.svgExportedFallback": "SVGをエクスポートしました (大領域のため矩形で近似)",
    "status.canvasResized": "キャンバスサイズ変更",
    "status.brandColorSaved": "ブランドカラーに保存",
    "status.eyedropper": "スポイト",
    "status.replaceAll": "一括置換",
    "status.replaceAllSmooth": "滑らか置換",
    "status.replaceAllFeather": "一括置換 (フェザー",
    "status.colorChange": "色変更",
    "status.colorChangeFeather": "色変更 (フェザー",
    "status.transparent": "透過",
    "status.transparentFeather": "透過 (フェザー",
    "status.shapeDrawn": "シェイプ描画",
    "status.textDrawn": "テキスト描画",
    "status.autoSaveToast": "オートセーブできませんでした（容量超過）",
    "status.copySuccess": "画像をクリップボードにコピーしました",
    "status.copyFailed": "クリップボードへのコピーに失敗しました",
    "status.copyNoApi": "クリップボードAPIが利用できません",
    "status.convertFailed": "画像の変換に失敗しました",
    "status.svgFallbackToast": "大領域のため矩形パスで出力しました",

    // Toolbar / Tooltip labels
    "label.openImage": "画像を開く",
    "label.saveProject": "プロジェクト保存 (.choco)",
    "label.loadProject": "プロジェクト読込 (.choco)",
    "label.recentFiles": "最近開いたファイル",
    "label.recentFilesList": "最近開いたファイル一覧",
    "label.undo": "元に戻す",
    "label.redo": "やり直し",
    "label.resetAll": "全リセット",
    "label.fitView": "フィット表示",
    "label.exportSvg": "SVG出力",
    "label.exportImage": "画像出力 (PNG/JPEG/WebP)",
    "label.copyClipboard": "クリップボードにコピー (Ctrl+C)",
    "label.transparentWhite": "白を透過",
    "label.canvasSize": "キャンバスサイズ変更",
    "label.referenceLayer": "参照画像を貼る (Ctrl+Shift+V)",
    "label.opacity": "不透明度",
    "label.blendMode": "ブレンドモード",
    "label.grid": "グリッド表示",
    "label.snap": "スナップ",
    "label.compare": "比較",
    "label.gradient": "グラデーション設定",
    "label.rotate": "回転角度",
    "label.flipH": "水平反転",
    "label.flipV": "垂直反転",
    "label.alignH": "水平中央揃え",
    "label.alignV": "垂直中央揃え",
    "label.alignBoth": "画面中央",
    "label.help": "ヘルプ (右クリックでも開けます)",

    // Mode names
    "mode.color": "色変更 / Color",
    "mode.transparent": "透過 / Transparent",
    "mode.eyedropper": "スポイト / Eyedropper",
    "mode.brush": "ブラシ / Brush",
    "mode.text": "テキスト / Text",
    "mode.shape": "シェイプ / Shape",
    "mode.replaceAll": "一括置換 / Replace-All",

    // Tool names (left toolbar aria-label)
    "tool.color": "色変更",
    "tool.transparent": "透過",
    "tool.eyedropper": "スポイト",
    "tool.replaceAll": "同色一括",
    "tool.brush": "ブラシ",
    "tool.text": "テキスト",
    "tool.shape": "シェイプ",

    // Property bar labels
    "prop.brushSize": "太さ",
    "prop.tolerance": "許容値",
    "prop.holeFill": "穴埋め",
    "prop.feather": "フェザー",
    "prop.smoothReplace": "滑らかに置換",
    "prop.antialiasEdge": "境界含める",
    "prop.8neighbor": "8近傍",
    "prop.saveColor": "色を保存",
    "prop.fontSize": "サイズ",
    "prop.polygonSides": "辺数",
    "prop.fill": "塗り",
    "prop.stroke": "線",
    "prop.strokeWidth": "線幅",
    "prop.gridSize": "間隔",
    "prop.referenceOpacity": "参照",
    "prop.referenceClear": "参照クリア",

    // Right panel
    "panel.palette": "パレット",
    "panel.log": "ログ",
    "panel.mainColors": "主要色",
    "panel.recentColors": "最近",
    "panel.brandColors": "ブランド",
    "panel.paletteSets": "パレットセット",
    "panel.newPalette": "+ 新しいパレット",
    "panel.noPalette": "パレットがありません",
    "panel.addCurrentColor": "+ 現在の色を追加",
    "panel.editLog": "編集ログ",

    // Drop zone
    "drop.title": "画像をドロップ",
    "drop.formats": "PNG / JPG / SVG / WebP",
    "drop.or": "または",
    "drop.selectFile": "ファイルを選択",

    // Restore modal
    "restore.message": "前回の編集データが見つかりました。復元しますか？",
    "restore.note": "※ リージョンと設定のみ復元されます。元画像は復元後に再読み込みしてください。",
    "restore.discard": "破棄",
    "restore.restore": "復元する",

    // Blend mode options
    "blend.normal": "通常",
    "blend.multiply": "乗算",
    "blend.screen": "スクリーン",
    "blend.overlay": "オーバーレイ",
    "blend.darken": "暗く",
    "blend.lighten": "明るく",

    // Language toggle
    "lang.toggle": "English",
  },

  en: {
    // Status messages
    "status.loadImage": "Drop or open an image to get started",
    "status.loaded": "Image loaded",
    "status.undo": "Undo",
    "status.redo": "Redo",
    "status.reset": "All regions reset",
    "status.autoSaved": "Auto-saved",
    "status.autoSaveError": "Auto-save failed (storage quota exceeded)",
    "status.projectSaved": "Project saved (.choco)",
    "status.projectSaveFailed": "Failed to save project",
    "status.projectLoaded": "Project loaded",
    "status.projectLoadFailed.prefix": "Load failed: ",
    "status.regionRestored": "Regions and settings restored. Please reload the original image.",
    "status.restoreFailed": "Restore failed",
    "status.brushDraw": "Brush stroke",
    "status.regionRemoved": "Region removed",
    "status.clipboardNoApi": "Clipboard API not available",
    "status.clipboardDenied": "Clipboard access denied",
    "status.clipboardReadError": "Clipboard read error",
    "status.clipboardNoImage": "No image in clipboard",
    "status.clipboardLoaded": "Pasted from clipboard",
    "status.clipboardImageLoadFailed": "Failed to load clipboard image",
    "status.referenceSet": "Reference image set",
    "status.referenceLoadFailed": "Failed to load reference image",
    "status.referenceCleared": "Reference image cleared",
    "status.noWhitePixel": "No white pixels found",
    "status.whiteTransparent": "White to transparent",
    "status.svgParseFailed": "SVG parse failed",
    "status.svgImageLoadFailed": "Failed to load SVG image",
    "status.fileReadFailed": "File read failed",
    "status.imageLoadFailed": "Failed to load image",
    "status.svgExported": "SVG exported",
    "status.svgExportedFallback": "SVG exported (large regions approximated with rectangles)",
    "status.canvasResized": "Canvas resized",
    "status.brandColorSaved": "Brand color saved",
    "status.eyedropper": "Eyedropper",
    "status.replaceAll": "Replace all",
    "status.replaceAllSmooth": "Smooth replace",
    "status.replaceAllFeather": "Replace all (feather",
    "status.colorChange": "Color changed",
    "status.colorChangeFeather": "Color changed (feather",
    "status.transparent": "Transparent",
    "status.transparentFeather": "Transparent (feather",
    "status.shapeDrawn": "Shape drawn",
    "status.textDrawn": "Text drawn",
    "status.autoSaveToast": "Auto-save failed (storage quota exceeded)",
    "status.copySuccess": "Image copied to clipboard",
    "status.copyFailed": "Failed to copy to clipboard",
    "status.copyNoApi": "Clipboard API not available",
    "status.convertFailed": "Image conversion failed",
    "status.svgFallbackToast": "Large region output as rectangle path",

    // Toolbar / Tooltip labels
    "label.openImage": "Open image",
    "label.saveProject": "Save project (.choco)",
    "label.loadProject": "Load project (.choco)",
    "label.recentFiles": "Recent files",
    "label.recentFilesList": "Recent files list",
    "label.undo": "Undo",
    "label.redo": "Redo",
    "label.resetAll": "Reset all",
    "label.fitView": "Fit to view",
    "label.exportSvg": "Export SVG",
    "label.exportImage": "Export image (PNG/JPEG/WebP)",
    "label.copyClipboard": "Copy to clipboard (Ctrl+C)",
    "label.transparentWhite": "White to transparent",
    "label.canvasSize": "Canvas size",
    "label.referenceLayer": "Paste as reference (Ctrl+Shift+V)",
    "label.opacity": "Opacity",
    "label.blendMode": "Blend mode",
    "label.grid": "Show grid",
    "label.snap": "Snap",
    "label.compare": "Compare",
    "label.gradient": "Gradient settings",
    "label.rotate": "Rotation",
    "label.flipH": "Flip horizontal",
    "label.flipV": "Flip vertical",
    "label.alignH": "Align center horizontally",
    "label.alignV": "Align center vertically",
    "label.alignBoth": "Center on canvas",
    "label.help": "Help (also right-click)",

    // Mode names
    "mode.color": "Color / Color",
    "mode.transparent": "Transparent / Transparent",
    "mode.eyedropper": "Eyedropper / Eyedropper",
    "mode.brush": "Brush / Brush",
    "mode.text": "Text / Text",
    "mode.shape": "Shape / Shape",
    "mode.replaceAll": "Replace-All / Replace-All",

    // Tool names
    "tool.color": "Color",
    "tool.transparent": "Transparent",
    "tool.eyedropper": "Eyedropper",
    "tool.replaceAll": "Replace-All",
    "tool.brush": "Brush",
    "tool.text": "Text",
    "tool.shape": "Shape",

    // Property bar labels
    "prop.brushSize": "Size",
    "prop.tolerance": "Tolerance",
    "prop.holeFill": "Hole-fill",
    "prop.feather": "Feather",
    "prop.smoothReplace": "Smooth replace",
    "prop.antialiasEdge": "Include edge",
    "prop.8neighbor": "8-neighbor",
    "prop.saveColor": "Save color",
    "prop.fontSize": "Size",
    "prop.polygonSides": "Sides",
    "prop.fill": "Fill",
    "prop.stroke": "Stroke",
    "prop.strokeWidth": "Width",
    "prop.gridSize": "Size",
    "prop.referenceOpacity": "Ref",
    "prop.referenceClear": "Clear ref",

    // Right panel
    "panel.palette": "Palette",
    "panel.log": "Log",
    "panel.mainColors": "Main colors",
    "panel.recentColors": "Recent",
    "panel.brandColors": "Brand",
    "panel.paletteSets": "Palette sets",
    "panel.newPalette": "+ New palette",
    "panel.noPalette": "No palettes",
    "panel.addCurrentColor": "+ Add current color",
    "panel.editLog": "Edit log",

    // Drop zone
    "drop.title": "Drop image here",
    "drop.formats": "PNG / JPG / SVG / WebP",
    "drop.or": "or",
    "drop.selectFile": "Select file",

    // Restore modal
    "restore.message": "Previous edit data found. Restore it?",
    "restore.note": "Only regions and settings are restored. Please reload the original image.",
    "restore.discard": "Discard",
    "restore.restore": "Restore",

    // Blend mode options
    "blend.normal": "Normal",
    "blend.multiply": "Multiply",
    "blend.screen": "Screen",
    "blend.overlay": "Overlay",
    "blend.darken": "Darken",
    "blend.lighten": "Lighten",

    // Language toggle
    "lang.toggle": "日本語",
  },
};

// ---------------------------------------------------------------------------
// t() — core translation function
// ---------------------------------------------------------------------------

/**
 * Returns the translated string for `key` in the given `lang`.
 * Falls back to the key itself if no translation is found.
 */
export function t(key: string, lang: Lang): string {
  return dict[lang][key] ?? key;
}

// ---------------------------------------------------------------------------
// useLang() — React hook with localStorage persistence
// ---------------------------------------------------------------------------

const LANG_STORAGE_KEY = "choco_lang";

function detectBrowserLang(): Lang {
  if (typeof navigator === "undefined") return "ja";
  return navigator.language.startsWith("ja") ? "ja" : "en";
}

function loadStoredLang(): Lang | null {
  try {
    const raw = localStorage.getItem(LANG_STORAGE_KEY);
    if (raw === "ja" || raw === "en") return raw;
    return null;
  } catch {
    return null;
  }
}

/**
 * React hook: manages current language with localStorage persistence.
 * Initial value priority: localStorage > browser language detection > "ja".
 */
export function useLang(): { lang: Lang; setLang: (l: Lang) => void } {
  const [lang, setLangState] = useState<Lang>(() => {
    return loadStoredLang() ?? detectBrowserLang();
  });

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem(LANG_STORAGE_KEY, l);
    } catch {
      // ignore quota errors
    }
  }, []);

  // Sync to localStorage whenever lang changes (covers external storage events)
  useEffect(() => {
    try {
      localStorage.setItem(LANG_STORAGE_KEY, lang);
    } catch {
      // ignore
    }
  }, [lang]);

  return { lang, setLang };
}
