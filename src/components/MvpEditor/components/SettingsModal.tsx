import React, { useEffect, useRef, useState, useCallback } from "react";
import { t, type Lang } from "../lib/i18n";
import type { ThemeMode } from "../hooks/useTheme";
import type { ScalePreset } from "./ExportModal";
import {
  SHORTCUT_DEFS,
  getAllShortcuts,
  setShortcut,
  resetShortcuts,
  type ShortcutActionId,
} from "../lib/shortcuts";

// ---------------------------------------------------------------------------
// SettingsModal — Preferences panel (Issue #52)
//
// Aggregates: language, theme, default PNG export scale, undo info, welcome
// All preferences already persist via their own hooks/localStorage keys.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// LocalStorage key for default PNG scale preference
// ---------------------------------------------------------------------------

export const DEFAULT_PNG_SCALE_KEY = "choco:defaultPngScale";
const VALID_SCALES: ScalePreset[] = ["1x", "2x", "4x"];

export function loadDefaultPngScale(): ScalePreset {
  try {
    const raw = localStorage.getItem(DEFAULT_PNG_SCALE_KEY);
    if (raw === "1x" || raw === "2x" || raw === "4x") return raw;
  } catch {
    // ignore
  }
  return "1x";
}

export function saveDefaultPngScale(scale: ScalePreset): void {
  try {
    localStorage.setItem(DEFAULT_PNG_SCALE_KEY, scale);
  } catch {
    // ignore quota errors
  }
}

// ---------------------------------------------------------------------------
// Styles (inline, matching existing modal conventions)
// ---------------------------------------------------------------------------

const OVERLAY: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 9200,
  background: "rgba(0,0,0,0.65)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const BOX: React.CSSProperties = {
  background: "#1c1c1c",
  border: "1px solid rgba(255,255,255,0.14)",
  borderRadius: 8,
  padding: "28px 32px 24px",
  maxWidth: 400,
  width: "90%",
  boxShadow: "0 8px 32px rgba(0,0,0,0.7)",
  fontFamily: "'Inter','Noto Sans JP',system-ui,sans-serif",
  color: "#e8e8e8",
};

const TITLE: React.CSSProperties = {
  margin: "0 0 20px",
  fontSize: 16,
  fontWeight: "bold",
  color: "#ffffff",
};

const SECTION_LABEL: React.CSSProperties = {
  display: "block",
  fontSize: 11,
  color: "#888",
  marginBottom: 6,
  marginTop: 16,
};

const ROW: React.CSSProperties = {
  display: "flex",
  gap: 8,
  flexWrap: "wrap",
};

const radioLabel = (active: boolean): React.CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  padding: "4px 12px",
  background: active ? "#4f8ef7" : "#2a2a2a",
  border: `1px solid ${active ? "#4f8ef7" : "rgba(255,255,255,0.14)"}`,
  borderRadius: 4,
  fontSize: 12,
  color: "#e8e8e8",
  cursor: "pointer",
  userSelect: "none",
  transition: "background 120ms",
});

const NOTE: React.CSSProperties = {
  fontSize: 11,
  color: "#666",
  marginTop: 4,
};

const DIVIDER: React.CSSProperties = {
  borderTop: "1px solid rgba(255,255,255,0.08)",
  margin: "16px 0 0",
};

const FOOTER: React.CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  marginTop: 24,
};

const BTN_CLOSE: React.CSSProperties = {
  padding: "6px 18px",
  borderRadius: 5,
  fontSize: 13,
  fontFamily: "'Inter','Noto Sans JP',system-ui,sans-serif",
  cursor: "pointer",
  background: "#2a2a2a",
  border: "1px solid rgba(255,255,255,0.14)",
  color: "#e8e8e8",
};

const BTN_RESHOW: React.CSSProperties = {
  padding: "5px 14px",
  borderRadius: 5,
  fontSize: 12,
  fontFamily: "'Inter','Noto Sans JP',system-ui,sans-serif",
  cursor: "pointer",
  background: "#2a2a2a",
  border: "1px solid rgba(255,255,255,0.14)",
  color: "#c8c8c8",
};

// Shortcut editor styles (Issue #53)
const SC_GRID: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr auto",
  gap: "4px 8px",
  alignItems: "center",
};

const SC_LABEL_STYLE: React.CSSProperties = {
  fontSize: 12,
  color: "#c8c8c8",
};

const SC_BTN_BASE: React.CSSProperties = {
  padding: "2px 10px",
  borderRadius: 4,
  fontSize: 12,
  fontFamily: "monospace",
  cursor: "pointer",
  color: "#e8e8e8",
  minWidth: 36,
  textAlign: "center",
};

const SC_BTN_IDLE: React.CSSProperties = {
  ...SC_BTN_BASE,
  background: "#2a2a2a",
  border: "1px solid rgba(255,255,255,0.14)",
};

const SC_BTN_ACTIVE: React.CSSProperties = {
  ...SC_BTN_BASE,
  background: "#4f8ef7",
  border: "1px solid #4f8ef7",
};

const SC_RESET_BTN: React.CSSProperties = {
  marginTop: 6,
  padding: "3px 10px",
  borderRadius: 4,
  fontSize: 11,
  cursor: "pointer",
  background: "#2a2a2a",
  border: "1px solid rgba(255,255,255,0.14)",
  color: "#aaa",
  fontFamily: "'Inter','Noto Sans JP',system-ui,sans-serif",
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface SettingsModalProps {
  lang: Lang;
  themeMode: ThemeMode;
  defaultPngScale: ScalePreset;
  onLangChange: (l: Lang) => void;
  onThemeToggle: () => void;
  onDefaultPngScaleChange: (s: ScalePreset) => void;
  onReshowWelcome: () => void;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SettingsModal({
  lang,
  themeMode,
  defaultPngScale,
  onLangChange,
  onThemeToggle,
  onDefaultPngScaleChange,
  onReshowWelcome,
  onClose,
}: SettingsModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Shortcut customization state (Issue #53)
  const [shortcuts, setShortcutsState] = useState<Record<ShortcutActionId, string>>(() =>
    getAllShortcuts()
  );
  const [capturingId, setCapturingId] = useState<ShortcutActionId | null>(null);

  const handleShortcutKeyCapture = useCallback(
    (e: KeyboardEvent) => {
      if (capturingId === null) return;
      e.preventDefault();
      e.stopPropagation();
      const key = e.key;
      // Accept single printable character only; Escape cancels
      if (key === "Escape") {
        setCapturingId(null);
        return;
      }
      if (key.length === 1) {
        setShortcut(capturingId, key);
        setShortcutsState(getAllShortcuts());
        setCapturingId(null);
      }
    },
    [capturingId]
  );

  useEffect(() => {
    if (capturingId === null) return;
    document.addEventListener("keydown", handleShortcutKeyCapture, true);
    return () => document.removeEventListener("keydown", handleShortcutKeyCapture, true);
  }, [capturingId, handleShortcutKeyCapture]);

  const handleResetShortcuts = useCallback(() => {
    resetShortcuts();
    setShortcutsState(getAllShortcuts());
    setCapturingId(null);
  }, []);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [onClose]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  return (
    <div style={OVERLAY} role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <div ref={panelRef} style={BOX}>
        <h2 id="settings-title" style={TITLE}>
          {t("settings.title", lang)}
        </h2>

        {/* Language */}
        <span style={{ ...SECTION_LABEL, marginTop: 0 }}>
          {t("settings.language", lang)}
        </span>
        <div style={ROW}>
          <label style={radioLabel(lang === "ja")}>
            <input
              type="radio"
              name="settings-lang"
              value="ja"
              checked={lang === "ja"}
              onChange={() => onLangChange("ja")}
              style={{ display: "none" }}
            />
            日本語
          </label>
          <label style={radioLabel(lang === "en")}>
            <input
              type="radio"
              name="settings-lang"
              value="en"
              checked={lang === "en"}
              onChange={() => onLangChange("en")}
              style={{ display: "none" }}
            />
            English
          </label>
        </div>

        {/* Theme */}
        <span style={SECTION_LABEL}>{t("settings.theme", lang)}</span>
        <div style={ROW}>
          <label style={radioLabel(themeMode === "dark")}>
            <input
              type="radio"
              name="settings-theme"
              value="dark"
              checked={themeMode === "dark"}
              onChange={() => { if (themeMode !== "dark") onThemeToggle(); }}
              style={{ display: "none" }}
            />
            {t("settings.themeDark", lang)}
          </label>
          <label style={radioLabel(themeMode === "light")}>
            <input
              type="radio"
              name="settings-theme"
              value="light"
              checked={themeMode === "light"}
              onChange={() => { if (themeMode !== "light") onThemeToggle(); }}
              style={{ display: "none" }}
            />
            {t("settings.themeLight", lang)}
          </label>
        </div>

        {/* Default PNG scale */}
        <span style={SECTION_LABEL}>{t("settings.pngScale", lang)}</span>
        <div style={ROW}>
          {VALID_SCALES.map((s) => (
            <label key={s} style={radioLabel(defaultPngScale === s)}>
              <input
                type="radio"
                name="settings-png-scale"
                value={s}
                checked={defaultPngScale === s}
                onChange={() => onDefaultPngScaleChange(s)}
                style={{ display: "none" }}
              />
              {s}
            </label>
          ))}
        </div>

        {/* Undo history limit (info only) */}
        <span style={SECTION_LABEL}>{t("settings.undoLimit", lang)}</span>
        <p style={NOTE}>{t("settings.undoLimitNote", lang)}</p>

        {/* Keyboard shortcuts (Issue #53) */}
        <span style={SECTION_LABEL}>{t("settings.shortcuts", lang)}</span>
        <div style={SC_GRID}>
          {SHORTCUT_DEFS.map((def) => {
            const isCapturing = capturingId === def.id;
            const currentKey = shortcuts[def.id].toUpperCase();
            const btnLabel = lang === "ja" ? def.labelJa : def.label;
            return (
              <React.Fragment key={def.id}>
                <span style={SC_LABEL_STYLE}>
                  {btnLabel}
                </span>
                <button
                  type="button"
                  onClick={() => setCapturingId(isCapturing ? null : def.id)}
                  style={isCapturing ? SC_BTN_ACTIVE : SC_BTN_IDLE}
                  aria-label={`${btnLabel} shortcut`}
                  aria-pressed={Boolean(isCapturing)}
                >
                  {isCapturing ? "..." : currentKey}
                </button>
              </React.Fragment>
            );
          })}
        </div>
        <p style={NOTE}>{t("settings.shortcutsNote", lang)}</p>
        <button
          type="button"
          onClick={handleResetShortcuts}
          style={SC_RESET_BTN}
        >
          {t("settings.shortcutsReset", lang)}
        </button>

        <div style={DIVIDER} />

        {/* Welcome reshow */}
        <div style={{ marginTop: 14, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 12, color: "#c8c8c8" }}>{t("settings.reshowWelcome", lang)}</span>
          <button
            type="button"
            style={BTN_RESHOW}
            onClick={() => { onReshowWelcome(); onClose(); }}
          >
            {t("settings.reshowWelcomeBtn", lang)}
          </button>
        </div>

        {/* Footer */}
        <div style={FOOTER}>
          <button type="button" style={BTN_CLOSE} onClick={onClose} autoFocus>
            {t("settings.close", lang)}
          </button>
        </div>
      </div>
    </div>
  );
}
