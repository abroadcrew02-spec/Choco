import { expose } from "comlink";
import type { ComputeApi } from "./api";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let wasmModule: any = null;

const api: ComputeApi = {
  async init({ wasmUrl }: { wasmUrl: string }) {
    // Dynamic import of the WASM module by URL at runtime
    wasmModule = await import(/* @vite-ignore */ wasmUrl);
    if (typeof wasmModule.default === "function") {
      await wasmModule.default();
    }
  },

  async hello(name: string): Promise<string> {
    if (!wasmModule) throw new Error("WASM not initialized");
    return wasmModule.hello(name) as string;
  },

  async ingestImage(_args) {
    // Stub for M1 - full implementation in M2
    return { tileMeta: [], visibleBitmaps: [] };
  },

  async floodFill(_args) {
    // Stub for M1 - full implementation in M4
    return { patches: [], bitmaps: [] };
  },

  async swapOutTile(_coord) {
    // Stub for M1 - full implementation in M3
    return { swapId: "" };
  },

  async swapInTile(_swapId) {
    // Stub for M1 - full implementation in M3
    throw new Error("swapInTile not yet implemented (M3)");
  },
};

expose(api);
