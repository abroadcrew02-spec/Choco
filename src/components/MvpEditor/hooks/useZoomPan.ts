import { useCallback, useRef, useState } from "react";

const ZOOM_MIN = 0.1;
const ZOOM_MAX = 10.0;
const ZOOM_STEP_FACTOR = 0.001;

export interface ZoomPanState {
  scale: number;
  offsetX: number;
  offsetY: number;
}

export interface UseZoomPanReturn {
  scale: number;
  offsetX: number;
  offsetY: number;
  isPanning: boolean;
  onWheel: (e: React.WheelEvent<HTMLElement>) => void;
  onMouseDown: (e: React.MouseEvent<HTMLElement>) => void;
  onMouseMove: (e: React.MouseEvent<HTMLElement>) => void;
  onMouseUp: () => void;
  fitToContainer: (containerWidth: number, containerHeight: number, imageWidth: number, imageHeight: number) => void;
  setScale100: () => void;
}

export function useZoomPan(spacePressed: boolean): UseZoomPanReturn {
  const [scale, setScale] = useState(1);
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const [isPanning, setIsPanning] = useState(false);

  const panStartRef = useRef<{ mouseX: number; mouseY: number; offsetX: number; offsetY: number } | null>(null);

  const clampScale = (s: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, s));

  const onWheel = useCallback(
    (e: React.WheelEvent<HTMLElement>) => {
      e.preventDefault();
      const delta = -e.deltaY * ZOOM_STEP_FACTOR;
      setScale((prev) => {
        const next = clampScale(prev + delta * prev);
        const ratio = next / prev;
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        setOffsetX((ox) => mouseX - (mouseX - ox) * ratio);
        setOffsetY((oy) => mouseY - (mouseY - oy) * ratio);
        return next;
      });
    },
    []
  );

  const onMouseDown = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      if (!spacePressed) return;
      e.preventDefault();
      setIsPanning(true);
      panStartRef.current = {
        mouseX: e.clientX,
        mouseY: e.clientY,
        offsetX,
        offsetY,
      };
    },
    [spacePressed, offsetX, offsetY]
  );

  const onMouseMove = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      if (!isPanning || !panStartRef.current) return;
      const dx = e.clientX - panStartRef.current.mouseX;
      const dy = e.clientY - panStartRef.current.mouseY;
      setOffsetX(panStartRef.current.offsetX + dx);
      setOffsetY(panStartRef.current.offsetY + dy);
    },
    [isPanning]
  );

  const onMouseUp = useCallback(() => {
    setIsPanning(false);
    panStartRef.current = null;
  }, []);

  const fitToContainer = useCallback(
    (containerWidth: number, containerHeight: number, imageWidth: number, imageHeight: number) => {
      if (imageWidth === 0 || imageHeight === 0) return;
      const scaleX = containerWidth / imageWidth;
      const scaleY = containerHeight / imageHeight;
      const fit = clampScale(Math.min(scaleX, scaleY));
      setScale(fit);
      setOffsetX((containerWidth - imageWidth * fit) / 2);
      setOffsetY((containerHeight - imageHeight * fit) / 2);
    },
    []
  );

  const setScale100 = useCallback(() => {
    setScale(1);
    setOffsetX(0);
    setOffsetY(0);
  }, []);

  return {
    scale,
    offsetX,
    offsetY,
    isPanning,
    onWheel,
    onMouseDown,
    onMouseMove,
    onMouseUp,
    fitToContainer,
    setScale100,
  };
}
