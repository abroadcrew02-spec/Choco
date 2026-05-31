// ---------------------------------------------------------------------------
// Design tokens — Professional Dark Studio
// ---------------------------------------------------------------------------

export const T = {
  color: {
    bgBase:      "#141414",
    bgPanel:     "#1c1c1c",
    bgElevated:  "#242424",
    border:      "rgba(255,255,255,0.08)",
    borderMid:   "rgba(255,255,255,0.14)",
    textPrimary: "#e8e8e8",
    textMuted:   "#888",
    textDim:     "#666",
    accent:      "#4f8ef7",
    accentHover: "#6aa3ff",
    danger:      "#e05555",
    dangerDark:  "#7a1a1a",
    success:     "#4caf7d",
    overlay:     "rgba(0,0,0,0.6)",
    overlayMid:  "rgba(0,0,0,0.5)",
    checkerA:    "#2a2a2a",
    checkerB:    "#1e1e1e",
    swatchRemoveBg: "#600",
  },
  space: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const,
  radius: { sm: 4, md: 6, lg: 10 } as const,
  shadow: {
    panel:    "0 1px 3px rgba(0,0,0,0.4)",
    elevated: "0 4px 16px rgba(0,0,0,0.6)",
  },
  font: {
    family: "'Inter','Noto Sans JP',system-ui,sans-serif",
    label:  11,
    body:   13,
    badge:  10,
  },
} as const;
