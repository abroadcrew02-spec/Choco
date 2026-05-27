import { useEffect, useRef } from "react";
import { Stage, Layer, Rect } from "react-konva";

const CHECKER_SIZE = 16;
const CHECKER_LIGHT = "#cccccc";
const CHECKER_DARK = "#ffffff";

interface CanvasStageProps {
  width: number;
  height: number;
}

export function CanvasStage({ width, height }: CanvasStageProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Stage is ready - this is where we'd initialize the BrushEngine in M3
  }, []);

  // Build a checkerboard pattern using alternating rects
  const checkerRects: React.ReactNode[] = [];
  const cols = Math.ceil(width / CHECKER_SIZE);
  const rows = Math.ceil(height / CHECKER_SIZE);

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const isLight = (row + col) % 2 === 0;
      checkerRects.push(
        <Rect
          key={`${row}-${col}`}
          x={col * CHECKER_SIZE}
          y={row * CHECKER_SIZE}
          width={CHECKER_SIZE}
          height={CHECKER_SIZE}
          fill={isLight ? CHECKER_LIGHT : CHECKER_DARK}
        />
      );
    }
  }

  return (
    <div ref={containerRef} style={{ overflow: "hidden" }}>
      <Stage width={width} height={height}>
        {/* Transparency checker layer */}
        <Layer listening={false}>{checkerRects}</Layer>
        {/* Edit layer - empty for M1 */}
        <Layer />
      </Stage>
    </div>
  );
}
