import type { TileCoord, PixelCoord } from "../types/canvas";

export interface TileMeta {
  coord: TileCoord;
  width: number;
  height: number;
}

export interface TileBitmap {
  coord: TileCoord;
  bitmap: ImageBitmap;
}

export interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PathSegment {
  x: number;
  y: number;
}

export interface TilePatch {
  layerId: string;
  coord: TileCoord;
  encoding: "xor" | "full";
  before: Uint8Array;
  after: Uint8Array;
}

export interface ComputeApi {
  init(opts: { wasmUrl: string }): Promise<void>;
  hello(name: string): Promise<string>;
  ingestImage(args: {
    rgba: Uint8Array;
    width: number;
    height: number;
  }): Promise<{
    tileMeta: TileMeta[];
    visibleBitmaps: { coord: TileCoord; bitmap: ImageBitmap }[];
  }>;
  floodFill(args: {
    layerId: string;
    seed: PixelCoord;
    tolerance: number;
    color: [number, number, number, number];
  }): Promise<{ patches: TilePatch[]; bitmaps: TileBitmap[] }>;
  swapOutTile(coord: TileCoord): Promise<{ swapId: string }>;
  swapInTile(swapId: string): Promise<{ bitmap: ImageBitmap }>;
}
