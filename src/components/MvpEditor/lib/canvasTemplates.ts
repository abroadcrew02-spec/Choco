/**
 * Canvas template definitions for blank-canvas creation (Issue #55).
 *
 * Each template specifies a preset size and recommended use case.
 * Background options are handled at the call site (white or transparent).
 */

export type TemplateBg = "white" | "transparent";

export interface CanvasTemplate {
  /** Unique key used in tests and i18n lookups */
  id: string;
  /** Display name (ja) */
  labelJa: string;
  /** Display name (en) */
  labelEn: string;
  /** Canvas width in pixels */
  width: number;
  /** Canvas height in pixels */
  height: number;
  /** Recommended use hint (ja) */
  hintJa: string;
  /** Recommended use hint (en) */
  hintEn: string;
}

export const CANVAS_TEMPLATES: CanvasTemplate[] = [
  {
    id: "business-card",
    labelJa: "名刺 (1004×650)",
    labelEn: "Business card (1004×650)",
    width: 1004,
    height: 650,
    hintJa: "名刺・カード類",
    hintEn: "Business cards",
  },
  {
    id: "sns-square",
    labelJa: "SNSアイコン (1080×1080)",
    labelEn: "SNS icon (1080×1080)",
    width: 1080,
    height: 1080,
    hintJa: "Instagram / Twitter アイコン・投稿",
    hintEn: "Instagram / Twitter icon or post",
  },
  {
    id: "sns-banner",
    labelJa: "横長バナー (1200×630)",
    labelEn: "Horizontal banner (1200×630)",
    width: 1200,
    height: 630,
    hintJa: "OGP画像・横断幕・Twitter Card",
    hintEn: "OGP / banner / Twitter Card",
  },
  {
    id: "icon-512",
    labelJa: "アイコン (512×512)",
    labelEn: "Icon (512×512)",
    width: 512,
    height: 512,
    hintJa: "アプリアイコン・ロゴ",
    hintEn: "App icon / logo",
  },
  {
    id: "business-card-mm",
    labelJa: "名刺 mm換算 (1063×591)",
    labelEn: "Business card mm (1063×591)",
    width: 1063,
    height: 591,
    hintJa: "91×55mm / 350dpi 名刺印刷用",
    hintEn: "91×55mm at 350dpi for print",
  },
];

/**
 * Create a blank ImageData for the given template.
 *
 * @param template - Target template definition
 * @param bg - "white" fills with opaque white; "transparent" leaves all pixels at rgba(0,0,0,0)
 */
export function createBlankImageData(
  template: CanvasTemplate,
  bg: TemplateBg
): ImageData {
  const { width, height } = template;
  const data = new Uint8ClampedArray(width * height * 4);
  if (bg === "white") {
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 255;     // R
      data[i + 1] = 255; // G
      data[i + 2] = 255; // B
      data[i + 3] = 255; // A
    }
  }
  // "transparent": all zeros (default)
  return new ImageData(data, width, height);
}
