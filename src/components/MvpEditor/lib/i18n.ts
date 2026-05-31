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
    "prop.toleranceTip": "クリックした色との差異をどこまで許容するか (0=完全一致, 128=最大)",
    "prop.holeFillTip": "選択領域内の小さな穴を塗りつぶす半径 (0=OFF, 1–5px)",
    "prop.featherTip": "選択境界をぼかして自然に合成する半径 (0=OFF, 1–20px)",
    "prop.antialiasEdgeTip": "アンチエイリアス処理された境界ピクセルも選択に含める",
    "prop.8neighborTip": "斜め方向も含む8近傍でフラッドフィルを実行する (デフォルトは4近傍)",
    "prop.saveColor": "ブランドカラーに保存",
    "prop.saveColorTooltip": "ブランドカラーに保存（最大8色）",
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
    "panel.exportPalette": "書き出し",
    "panel.importPalette": "読み込み",
    "panel.importPaletteError": "パレットファイルの読み込みに失敗しました",
    "panel.editLog": "編集ログ",

    // Drop zone
    "drop.title": "画像をドロップ",
    "drop.formats": "PNG / JPG / SVG / WebP",
    "drop.or": "または",
    "drop.selectFile": "ファイルを選択",
    "drop.paste": "または Ctrl+V で貼り付け",

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

    // Slider aria-labels (Issue #34)
    "aria.referenceOpacity": "参照画像の不透明度",
    "aria.opacity": "不透明度",
    "aria.gridSize": "グリッド間隔",
    "aria.brushSize": "ブラシサイズ",
    "aria.tolerance": "色許容値",
    "aria.holeFill": "穴埋め半径",
    "aria.feather": "フェザー半径",
    "aria.fontSize": "フォントサイズ",
    "aria.polygonSides": "多角形の辺数",
    "aria.strokeWidth": "線幅",
    "aria.rotation": "回転角度",
    "aria.gradientAngle": "グラデーション角度",
    "aria.gradientStopPos": "グラデーション色ストップ位置",
    "aria.jpegQuality": "JPEG画質",

    // Welcome modal (Issue #29)
    "welcome.title": "Choco へようこそ",
    "welcome.intro1": "画像を開いてクリックするだけで色を変更できます",
    "welcome.intro2": "透過ツールで背景を切り抜き、透明にできます",
    "welcome.intro3": "SVG / PNG / JPEG でそのまま書き出せます",
    "welcome.intro4": "パレット・ブラシ・テキスト・シェイプなど多彩なツールを搭載",
    "welcome.hint": "ヘルプ (?) からいつでもショートカット一覧を確認できます",
    "welcome.start": "始める",
    "welcome.reshow": "使い方を見る",

    // Settings modal (Issue #52)
    "settings.title": "設定",
    "settings.language": "言語",
    "settings.theme": "テーマ",
    "settings.themeDark": "ダーク",
    "settings.themeLight": "ライト",
    "settings.pngScale": "デフォルト PNG 倍率",
    "settings.undoLimit": "Undo 履歴上限",
    "settings.undoLimitNote": "現在のセッションに反映済み（変更不要）",
    "settings.reshowWelcome": "使い方を再表示",
    "settings.reshowWelcomeBtn": "ウェルカム画面を表示",
    "settings.close": "閉じる",
    "label.settings": "設定",

    // Canvas templates (Issue #55)
    "template.sectionTitle": "テンプレートから新規作成",
    "template.bgWhite": "白背景",
    "template.bgTransparent": "透明",
    "template.create": "作成",
    "template.orOpenImage": "または画像を開く / ドロップ",
    "status.templateCreated": "空キャンバスを作成しました",
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
    "prop.toleranceTip": "How far from the clicked color to select (0=exact, 128=max)",
    "prop.holeFillTip": "Fill small holes in the selection using morphological closing (0=OFF, 1–5px radius)",
    "prop.featherTip": "Blur the selection boundary for a softer blend (0=OFF, 1–20px radius)",
    "prop.antialiasEdgeTip": "Include anti-aliased boundary pixels in the selection",
    "prop.8neighborTip": "Flood-fill in 8 directions including diagonals (default is 4-neighbor)",
    "prop.saveColor": "Save to brand colors",
    "prop.saveColorTooltip": "Save to brand colors (max 8)",
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
    "panel.exportPalette": "Export",
    "panel.importPalette": "Import",
    "panel.importPaletteError": "Failed to import palette file",
    "panel.editLog": "Edit log",

    // Drop zone
    "drop.title": "Drop image here",
    "drop.formats": "PNG / JPG / SVG / WebP",
    "drop.or": "or",
    "drop.selectFile": "Select file",
    "drop.paste": "or paste with Ctrl+V",

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

    // Slider aria-labels (Issue #34)
    "aria.referenceOpacity": "Reference image opacity",
    "aria.opacity": "Opacity",
    "aria.gridSize": "Grid size",
    "aria.brushSize": "Brush size",
    "aria.tolerance": "Color tolerance",
    "aria.holeFill": "Hole-fill radius",
    "aria.feather": "Feather radius",
    "aria.fontSize": "Font size",
    "aria.polygonSides": "Polygon sides",
    "aria.strokeWidth": "Stroke width",
    "aria.rotation": "Rotation",
    "aria.gradientAngle": "Gradient angle",
    "aria.gradientStopPos": "Gradient stop position",
    "aria.jpegQuality": "JPEG quality",

    // Welcome modal (Issue #29)
    "welcome.title": "Welcome to Choco",
    "welcome.intro1": "Open an image and click to recolor any area instantly",
    "welcome.intro2": "Use the transparent tool to remove backgrounds with one click",
    "welcome.intro3": "Export directly as SVG, PNG, or JPEG",
    "welcome.intro4": "Palette, brush, text, shape tools and more included",
    "welcome.hint": "Press ? (Help) anytime to see keyboard shortcuts",
    "welcome.start": "Get started",
    "welcome.reshow": "Show intro",

    // Settings modal (Issue #52)
    "settings.title": "Settings",
    "settings.language": "Language",
    "settings.theme": "Theme",
    "settings.themeDark": "Dark",
    "settings.themeLight": "Light",
    "settings.pngScale": "Default PNG scale",
    "settings.undoLimit": "Undo history limit",
    "settings.undoLimitNote": "Applied to current session (no change needed)",
    "settings.reshowWelcome": "Show intro",
    "settings.reshowWelcomeBtn": "Show welcome screen",
    "settings.close": "Close",
    "label.settings": "Settings",

    // Canvas templates (Issue #55)
    "template.sectionTitle": "New from template",
    "template.bgWhite": "White",
    "template.bgTransparent": "Transparent",
    "template.create": "Create",
    "template.orOpenImage": "or open / drop an image",
    "status.templateCreated": "Blank canvas created",
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
