import { useState } from "react";
import {
  LAYER_DEFINITIONS,
  type LayerVisibility,
  type LayerOpacity,
} from "../hooks/useLayers";

interface LayerPanelProps {
  layerVisibility: LayerVisibility;
  layerOpacity: LayerOpacity;
  activeLayerId: "background" | "edit";
  onVisibilityChange: (id: keyof LayerVisibility, value: boolean) => void;
  onOpacityChange: (id: keyof LayerOpacity, value: number) => void;
  onActiveLayerChange: (id: "background" | "edit") => void;
}

export function LayerPanel({
  layerVisibility,
  layerOpacity,
  activeLayerId,
  onVisibilityChange,
  onOpacityChange,
  onActiveLayerChange,
}: LayerPanelProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div
      style={{
        width: collapsed ? 32 : 200,
        background: "#1a1a1a",
        borderLeft: "1px solid #444",
        display: "flex",
        flexDirection: "column",
        flexShrink: 0,
        transition: "width 0.15s ease",
        overflow: "hidden",
      }}
    >
      {/* Panel header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "6px 8px",
          borderBottom: "1px solid #333",
          background: "#111",
          cursor: "pointer",
          flexShrink: 0,
          userSelect: "none",
          whiteSpace: "nowrap",
        }}
        onClick={() => setCollapsed((v) => !v)}
      >
        {!collapsed && (
          <span style={{ fontSize: 12, color: "#aaa", fontWeight: 600 }}>
            レイヤー
          </span>
        )}
        <span
          style={{
            fontSize: 12,
            color: "#888",
            marginLeft: collapsed ? 0 : "auto",
          }}
          title={collapsed ? "レイヤーパネルを開く" : "レイヤーパネルを閉じる"}
        >
          {collapsed ? ">" : "<"}
        </span>
      </div>

      {/* Layer list */}
      {!collapsed && (
        <div style={{ flex: 1, overflowY: "auto" }}>
          {LAYER_DEFINITIONS.map((layer) => {
            const isActive = activeLayerId === layer.id;
            const isVisible = layerVisibility[layer.id];
            const opacity = layerOpacity[layer.id];
            const isBackground = layer.id === "background";

            return (
              <div
                key={layer.id}
                onClick={() => onActiveLayerChange(layer.id)}
                style={{
                  padding: "8px 10px",
                  borderBottom: "1px solid #2a2a2a",
                  background: isActive ? "#2a3a50" : "transparent",
                  cursor: "pointer",
                  userSelect: "none",
                }}
              >
                {/* Layer name row */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    marginBottom: 6,
                  }}
                >
                  <input
                    type="checkbox"
                    id={`layer-vis-${layer.id}`}
                    checked={isVisible}
                    onChange={(e) => {
                      e.stopPropagation();
                      onVisibilityChange(layer.id, e.target.checked);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    style={{ cursor: "pointer", accentColor: "#4488ff" }}
                  />
                  <label
                    htmlFor={`layer-vis-${layer.id}`}
                    style={{
                      fontSize: 12,
                      color: isActive ? "#88ccff" : "#ccc",
                      cursor: "pointer",
                      flex: 1,
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {layer.label}
                  </label>
                  {isBackground && (
                    <span
                      style={{
                        fontSize: 10,
                        color: "#666",
                        border: "1px solid #444",
                        borderRadius: 2,
                        padding: "0 3px",
                      }}
                    >
                      ロック
                    </span>
                  )}
                </div>

                {/* Opacity row */}
                <div
                  style={{ display: "flex", alignItems: "center", gap: 6 }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <span style={{ fontSize: 10, color: "#777", width: 30 }}>
                    {opacity}%
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={opacity}
                    onChange={(e) =>
                      onOpacityChange(layer.id, Number(e.target.value))
                    }
                    style={{ flex: 1, accentColor: "#4488ff" }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
