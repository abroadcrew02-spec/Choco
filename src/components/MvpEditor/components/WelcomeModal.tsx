import { useState } from "react";
import type { Lang } from "../lib/i18n";
import { t } from "../lib/i18n";
import { CANVAS_TEMPLATES, type TemplateBg } from "../lib/canvasTemplates";

// ---------------------------------------------------------------------------
// WelcomeModal — shown on first launch, skipped on subsequent visits.
//
// localStorage key: "choco:welcome-seen"
// Set to "1" when the user dismisses the modal.
// ---------------------------------------------------------------------------

export const WELCOME_SEEN_KEY = "choco:welcome-seen";

export function hasSeenWelcome(): boolean {
  try {
    return localStorage.getItem(WELCOME_SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

export function markWelcomeSeen(): void {
  try {
    localStorage.setItem(WELCOME_SEEN_KEY, "1");
  } catch {
    // ignore quota errors
  }
}

export function resetWelcomeSeen(): void {
  try {
    localStorage.removeItem(WELCOME_SEEN_KEY);
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface WelcomeStartOptions {
  /** If null the modal is dismissed without creating a canvas (user will open an image). */
  templateId: string | null;
  bg: TemplateBg;
}

interface WelcomeModalProps {
  lang: Lang;
  /** Called when user clicks "Start" (no template) or picks a template. */
  onStart: (opts: WelcomeStartOptions) => void;
}

const OVERLAY: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 9000,
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
  maxWidth: 460,
  width: "92%",
  boxShadow: "0 8px 32px rgba(0,0,0,0.7)",
  fontFamily: "'Inter','Noto Sans JP',system-ui,sans-serif",
  color: "#e8e8e8",
};

const TITLE: React.CSSProperties = {
  margin: "0 0 14px",
  fontSize: 18,
  fontWeight: "bold",
  color: "#ffffff",
};

const FEATURE_LIST: React.CSSProperties = {
  margin: "0 0 16px",
  padding: 0,
  listStyle: "none",
};

const FEATURE_ITEM: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: 8,
  marginBottom: 8,
  fontSize: 13,
  color: "#c8c8c8",
  lineHeight: 1.5,
};

const BULLET: React.CSSProperties = {
  color: "#4f8ef7",
  flexShrink: 0,
  marginTop: 1,
  fontSize: 14,
};

const SECTION_TITLE: React.CSSProperties = {
  fontSize: 11,
  color: "#888",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  margin: "0 0 8px",
};

const TEMPLATE_LIST: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  margin: "0 0 14px",
};

const BTN_BASE: React.CSSProperties = {
  fontFamily: "'Inter','Noto Sans JP',system-ui,sans-serif",
  fontSize: 13,
  borderRadius: 5,
  cursor: "pointer",
  transition: "background 120ms",
};

const BTN: React.CSSProperties = {
  ...BTN_BASE,
  display: "block",
  width: "100%",
  padding: "9px 0",
  background: "#4f8ef7",
  color: "#fff",
  border: "none",
  fontWeight: "bold",
  fontSize: 14,
};

const BTN_SUBTLE: React.CSSProperties = {
  ...BTN_BASE,
  display: "block",
  width: "100%",
  padding: "7px 0",
  background: "transparent",
  color: "#888",
  border: "1px solid rgba(255,255,255,0.12)",
  fontSize: 12,
};

export function WelcomeModal({ lang, onStart }: WelcomeModalProps) {
  const [selectedId, setSelectedId] = useState<string>(CANVAS_TEMPLATES[0].id);
  const [bg, setBg] = useState<TemplateBg>("white");

  const features = [
    t("welcome.intro1", lang),
    t("welcome.intro2", lang),
    t("welcome.intro3", lang),
    t("welcome.intro4", lang),
  ];

  const handleCreate = () => {
    onStart({ templateId: selectedId, bg });
  };

  const handleSkip = () => {
    onStart({ templateId: null, bg: "white" });
  };

  return (
    <div style={OVERLAY} role="dialog" aria-modal="true" aria-labelledby="welcome-title">
      <div style={BOX}>
        <h2 id="welcome-title" style={TITLE}>
          {t("welcome.title", lang)}
        </h2>
        <ul style={FEATURE_LIST}>
          {features.map((text, i) => (
            <li key={i} style={FEATURE_ITEM}>
              <span style={BULLET}>&#9679;</span>
              <span>{text}</span>
            </li>
          ))}
        </ul>

        {/* Template selection */}
        <p style={SECTION_TITLE}>{t("template.sectionTitle", lang)}</p>
        <div style={TEMPLATE_LIST} role="radiogroup" aria-label={t("template.sectionTitle", lang)}>
          {CANVAS_TEMPLATES.map((tmpl) => {
            const label = lang === "ja" ? tmpl.labelJa : tmpl.labelEn;
            const hint = lang === "ja" ? tmpl.hintJa : tmpl.hintEn;
            const selected = selectedId === tmpl.id;
            return (
              <label
                key={tmpl.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 10px",
                  borderRadius: 5,
                  border: `1px solid ${selected ? "#4f8ef7" : "rgba(255,255,255,0.10)"}`,
                  background: selected ? "rgba(79,142,247,0.10)" : "transparent",
                  cursor: "pointer",
                  transition: "background 100ms",
                }}
              >
                <input
                  type="radio"
                  name="canvas-template"
                  value={tmpl.id}
                  checked={selected}
                  onChange={() => setSelectedId(tmpl.id)}
                  style={{ cursor: "pointer", accentColor: "#4f8ef7" }}
                />
                <span style={{ flex: 1, fontSize: 13, color: selected ? "#e8e8e8" : "#b8b8b8" }}>
                  {label}
                </span>
                <span style={{ fontSize: 11, color: "#666" }}>{hint}</span>
              </label>
            );
          })}
        </div>

        {/* Background toggle */}
        <div style={{ display: "flex", gap: 8, margin: "0 0 16px", alignItems: "center" }}>
          <span style={{ fontSize: 11, color: "#888" }}>BG:</span>
          {(["white", "transparent"] as TemplateBg[]).map((opt) => (
            <label
              key={opt}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                fontSize: 12,
                color: bg === opt ? "#e8e8e8" : "#888",
                cursor: "pointer",
              }}
            >
              <input
                type="radio"
                name="template-bg"
                value={opt}
                checked={bg === opt}
                onChange={() => setBg(opt)}
                style={{ cursor: "pointer", accentColor: "#4f8ef7" }}
              />
              {opt === "white" ? t("template.bgWhite", lang) : t("template.bgTransparent", lang)}
            </label>
          ))}
        </div>

        <button type="button" style={BTN} onClick={handleCreate} autoFocus>
          {t("template.create", lang)}
        </button>
        <button
          type="button"
          style={{ ...BTN_SUBTLE, marginTop: 8 }}
          onClick={handleSkip}
        >
          {t("template.orOpenImage", lang)}
        </button>
      </div>
    </div>
  );
}
