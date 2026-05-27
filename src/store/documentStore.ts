import { create } from "zustand";
import type { CanvasDocument } from "../types/canvas";

interface DocumentState {
  document: CanvasDocument | null;
  setDocument: (doc: CanvasDocument | null) => void;
}

export const useDocumentStore = create<DocumentState>((set) => ({
  document: null,
  setDocument: (doc) => set({ document: doc }),
}));
