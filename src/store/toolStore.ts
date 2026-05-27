import { create } from "zustand";

export type ToolType = "brush" | "bucket" | "wand" | "mask" | "move";

interface ToolState {
  activeTool: ToolType;
  brushSize: number;
  brushOpacity: number;
  tolerance: number;
  foregroundColor: [number, number, number, number];
  setActiveTool: (tool: ToolType) => void;
  setBrushSize: (size: number) => void;
  setBrushOpacity: (opacity: number) => void;
  setTolerance: (tolerance: number) => void;
  setForegroundColor: (color: [number, number, number, number]) => void;
}

export const useToolStore = create<ToolState>((set) => ({
  activeTool: "brush",
  brushSize: 20,
  brushOpacity: 1.0,
  tolerance: 32,
  foregroundColor: [0, 0, 0, 255],
  setActiveTool: (tool) => set({ activeTool: tool }),
  setBrushSize: (size) => set({ brushSize: size }),
  setBrushOpacity: (opacity) => set({ brushOpacity: opacity }),
  setTolerance: (tolerance) => set({ tolerance }),
  setForegroundColor: (color) => set({ foregroundColor: color }),
}));
