import { useState, useCallback } from "react";
import type { LayerVisibility, LayerOpacity } from "../lib/projectIO";

export type { LayerVisibility, LayerOpacity };

export interface LayerInfo {
  id: "background" | "edit";
  label: string;
}

export const LAYER_DEFINITIONS: LayerInfo[] = [
  { id: "background", label: "背景" },
  { id: "edit", label: "編集" },
];

export interface UseLayersReturn {
  layerVisibility: LayerVisibility;
  layerOpacity: LayerOpacity;
  activeLayerId: "background" | "edit";
  setLayerVisibility: (id: keyof LayerVisibility, value: boolean) => void;
  setLayerOpacity: (id: keyof LayerOpacity, value: number) => void;
  setActiveLayerId: (id: "background" | "edit") => void;
  resetLayers: (visibility?: LayerVisibility, opacity?: LayerOpacity) => void;
}

const DEFAULT_VISIBILITY: LayerVisibility = { background: true, edit: true };
const DEFAULT_OPACITY: LayerOpacity = { background: 100, edit: 100 };

export function useLayers(): UseLayersReturn {
  const [layerVisibility, setLayerVisibilityState] =
    useState<LayerVisibility>(DEFAULT_VISIBILITY);
  const [layerOpacity, setLayerOpacityState] =
    useState<LayerOpacity>(DEFAULT_OPACITY);
  const [activeLayerId, setActiveLayerIdState] = useState<"background" | "edit">("edit");

  const setLayerVisibility = useCallback(
    (id: keyof LayerVisibility, value: boolean) => {
      setLayerVisibilityState((prev) => ({ ...prev, [id]: value }));
    },
    []
  );

  const setLayerOpacity = useCallback(
    (id: keyof LayerOpacity, value: number) => {
      const clamped = Math.max(0, Math.min(100, value));
      setLayerOpacityState((prev) => ({ ...prev, [id]: clamped }));
    },
    []
  );

  const setActiveLayerId = useCallback((id: "background" | "edit") => {
    setActiveLayerIdState(id);
  }, []);

  const resetLayers = useCallback(
    (
      visibility: LayerVisibility = DEFAULT_VISIBILITY,
      opacity: LayerOpacity = DEFAULT_OPACITY
    ) => {
      setLayerVisibilityState(visibility);
      setLayerOpacityState(opacity);
      setActiveLayerIdState("edit");
    },
    []
  );

  return {
    layerVisibility,
    layerOpacity,
    activeLayerId,
    setLayerVisibility,
    setLayerOpacity,
    setActiveLayerId,
    resetLayers,
  };
}
