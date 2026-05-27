export type PixelCoord = { x: number; y: number };
export type TileCoord = { tx: number; ty: number };

export const TILE_SIZE = 256;

export interface Tile {
  coord: TileCoord;
  bitmap: ImageBitmap | null;
  swapId: string | null;
  width: number;
  height: number;
  dirty: boolean;
  lastAccessed: number;
}

export interface Layer {
  id: string;
  name: string;
  kind: "background" | "edit";
  visible: boolean;
  opacity: number;
  locked: boolean;
  tiles: Map<string, Tile>;
}

export interface CanvasDocument {
  id: string;
  width: number;
  height: number;
  layers: Layer[];
  activeLayerId: string;
  createdAt: number;
}

export interface Selection {
  id: string;
  bounds: { x: number; y: number; w: number; h: number };
}
