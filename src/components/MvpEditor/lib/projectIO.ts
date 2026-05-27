/**
 * Project save/load logic for .choco files (JSON format).
 */

export interface PaintRegionSerialized {
  id: string;
  pixels: [number, number][];
  color: string;
  transparent: boolean;
}

export interface LayerVisibility {
  background: boolean;
  edit: boolean;
}

export interface LayerOpacity {
  background: number;
  edit: number;
}

export interface ChocoProject {
  version: 1;
  image: string;
  imageWidth: number;
  imageHeight: number;
  regions: PaintRegionSerialized[];
  selectedColor: string;
  tolerance: number;
  brushSize: number;
  layerVisibility: LayerVisibility;
  layerOpacity: LayerOpacity;
}

export interface PaintRegionRuntime {
  id: string;
  pixels: { x: number; y: number }[];
  color: string;
  transparent: boolean;
}

const LARGE_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

export function serializeProject(params: {
  imageData: ImageData;
  imageWidth: number;
  imageHeight: number;
  regions: PaintRegionRuntime[];
  selectedColor: string;
  tolerance: number;
  brushSize: number;
  layerVisibility: LayerVisibility;
  layerOpacity: LayerOpacity;
}): ChocoProject {
  const {
    imageData,
    imageWidth,
    imageHeight,
    regions,
    selectedColor,
    tolerance,
    brushSize,
    layerVisibility,
    layerOpacity,
  } = params;

  const canvas = document.createElement("canvas");
  canvas.width = imageWidth;
  canvas.height = imageHeight;
  const ctx = canvas.getContext("2d")!;
  ctx.putImageData(imageData, 0, 0);
  const imageBase64 = canvas.toDataURL("image/png");

  const serializedRegions: PaintRegionSerialized[] = regions.map((r) => ({
    id: r.id,
    pixels: r.pixels.map((p) => [p.x, p.y] as [number, number]),
    color: r.color,
    transparent: r.transparent,
  }));

  return {
    version: 1,
    image: imageBase64,
    imageWidth,
    imageHeight,
    regions: serializedRegions,
    selectedColor,
    tolerance,
    brushSize,
    layerVisibility,
    layerOpacity,
  };
}

export function saveProjectToBlob(project: ChocoProject): { blob: Blob; warnLarge: boolean } {
  const json = JSON.stringify(project);
  const blob = new Blob([json], { type: "application/json" });
  return { blob, warnLarge: blob.size > LARGE_FILE_BYTES };
}

export function downloadProject(project: ChocoProject, filename = "project.choco"): void {
  const { blob } = saveProjectToBlob(project);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function parseChocoJson(json: string): ChocoProject {
  const data = JSON.parse(json) as unknown;
  if (
    typeof data !== "object" ||
    data === null ||
    (data as Record<string, unknown>)["version"] !== 1
  ) {
    throw new Error("Invalid .choco file format");
  }
  return data as ChocoProject;
}

export function deserializeRegions(
  serialized: PaintRegionSerialized[]
): PaintRegionRuntime[] {
  return serialized.map((r) => ({
    id: r.id,
    pixels: r.pixels.map(([x, y]) => ({ x, y })),
    color: r.color,
    transparent: r.transparent,
  }));
}

export function loadImageFromDataUrl(
  dataUrl: string
): Promise<{ imageData: ImageData; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, w, h);
      resolve({ imageData, width: w, height: h });
    };
    img.onerror = () => reject(new Error("Failed to load image from data URL"));
    img.src = dataUrl;
  });
}
