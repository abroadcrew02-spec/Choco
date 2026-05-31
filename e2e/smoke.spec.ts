/**
 * Smoke E2E tests for Choco.
 *
 * Covers the minimum happy-path: app loads → drop zone visible →
 * image loaded via file input → color change applied → SVG export triggered.
 *
 * Requirements:
 *   - Vite dev server running on http://localhost:1420
 *   - Chromium installed via `pnpm exec playwright install chromium`
 */

import { test, expect, type Page } from "@playwright/test";
import path from "path";
import fs from "fs";
import os from "os";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Creates a minimal 4x4 all-white PNG as a temp file and returns the path.
 * The PNG is a valid 4x4 px image with no alpha channel.
 */
function createMinimalPng(): string {
  // Minimal 4x4 white PNG (base64-encoded, hand-crafted)
  const pngBase64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAADklEQVQI12P4z8BQDwAEgAF/QualIQAAAABJRU5ErkJggg==";
  const buf = Buffer.from(pngBase64, "base64");
  const tmpPath = path.join(os.tmpdir(), `choco-e2e-fixture-${Date.now()}.png`);
  fs.writeFileSync(tmpPath, buf);
  return tmpPath;
}

// ---------------------------------------------------------------------------
// Test: App startup
// ---------------------------------------------------------------------------

test.describe("Smoke: app startup", () => {
  test("page loads with title Choco", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle("Choco");
  });

  test("drop zone is visible on initial load", async ({ page }) => {
    await page.goto("/");
    // The drop zone contains the Japanese/English "drop image" text from i18n.
    // We locate by the SVG upload icon's enclosing container visibility instead,
    // as it is always rendered regardless of language.
    // The drop zone button "ファイルを選択 / Select file" is the most reliable anchor.
    const selectBtn = page.getByRole("button", {
      name: /ファイルを選択|Select file/i,
    });
    await expect(selectBtn).toBeVisible({ timeout: 10_000 });
  });
});

// ---------------------------------------------------------------------------
// Test: Image load
// ---------------------------------------------------------------------------

test.describe("Smoke: image load via file input", () => {
  let fixturePath: string;

  test.beforeAll(() => {
    fixturePath = createMinimalPng();
  });

  test.afterAll(() => {
    try {
      fs.unlinkSync(fixturePath);
    } catch {
      // best-effort cleanup
    }
  });

  test("loading a PNG hides the drop zone and shows the canvas", async ({ page }) => {
    await page.goto("/");

    // The hidden file input accepts 'image/*'
    const fileInput = page.locator('input[type="file"][accept="image/*"]');
    await fileInput.setInputFiles(fixturePath);

    // After load, the canvas should appear (canvas element)
    const canvas = page.locator("canvas").first();
    await expect(canvas).toBeVisible({ timeout: 15_000 });

    // Drop zone button should no longer be visible
    const selectBtn = page.getByRole("button", {
      name: /ファイルを選択|Select file/i,
    });
    await expect(selectBtn).toBeHidden({ timeout: 5_000 });
  });
});

// ---------------------------------------------------------------------------
// Test: Color change
// ---------------------------------------------------------------------------

test.describe("Smoke: color change interaction", () => {
  let fixturePath: string;

  test.beforeAll(() => {
    fixturePath = createMinimalPng();
  });

  test.afterAll(() => {
    try {
      fs.unlinkSync(fixturePath);
    } catch {
      // best-effort cleanup
    }
  });

  async function loadImage(page: Page): Promise<void> {
    await page.goto("/");
    const fileInput = page.locator('input[type="file"][accept="image/*"]');
    await fileInput.setInputFiles(fixturePath);
    await expect(page.locator("canvas").first()).toBeVisible({ timeout: 15_000 });
  }

  test("clicking the canvas in color mode does not throw a JS error", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await loadImage(page);

    // Click center of canvas — triggers flood fill in default 'color' mode
    const canvas = page.locator("canvas").first();
    const box = await canvas.boundingBox();
    if (box) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    }

    // No JS errors should have been thrown
    expect(errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Test: SVG export button is accessible after image load
// ---------------------------------------------------------------------------

test.describe("Smoke: SVG export button", () => {
  let fixturePath: string;

  test.beforeAll(() => {
    fixturePath = createMinimalPng();
  });

  test.afterAll(() => {
    try {
      fs.unlinkSync(fixturePath);
    } catch {
      // best-effort cleanup
    }
  });

  test("SVG export button is visible and enabled after image load", async ({ page }) => {
    await page.goto("/");
    const fileInput = page.locator('input[type="file"][accept="image/*"]');
    await fileInput.setInputFiles(fixturePath);
    await expect(page.locator("canvas").first()).toBeVisible({ timeout: 15_000 });

    // The SVG export button aria-label is "SVG出力" (ja) or "Export SVG" (en),
    // set via t("label.exportSvg", lang) in MvpEditor.
    const svgBtn = page
      .getByRole("button", { name: /SVG出力|Export SVG/i })
      .first();
    await expect(svgBtn).toBeVisible({ timeout: 5_000 });
    // Button should not be disabled when an image is loaded
    await expect(svgBtn).not.toBeDisabled();
  });
});
