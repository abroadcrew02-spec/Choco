import type { Lang } from "../lib/i18n";
import { t } from "../lib/i18n";

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

interface WelcomeModalProps {
  lang: Lang;
  onClose: () => void;
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
  maxWidth: 420,
  width: "90%",
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

const HINT: React.CSSProperties = {
  margin: "0 0 20px",
  fontSize: 12,
  color: "#888",
};

const BTN: React.CSSProperties = {
  display: "block",
  width: "100%",
  padding: "9px 0",
  background: "#4f8ef7",
  color: "#fff",
  border: "none",
  borderRadius: 5,
  cursor: "pointer",
  fontSize: 14,
  fontFamily: "'Inter','Noto Sans JP',system-ui,sans-serif",
  fontWeight: "bold",
  transition: "background 120ms",
};

export function WelcomeModal({ lang, onClose }: WelcomeModalProps) {
  const features = [
    t("welcome.intro1", lang),
    t("welcome.intro2", lang),
    t("welcome.intro3", lang),
    t("welcome.intro4", lang),
  ];

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
        <p style={HINT}>{t("welcome.hint", lang)}</p>
        <button
          type="button"
          style={BTN}
          onClick={onClose}
          autoFocus
        >
          {t("welcome.start", lang)}
        </button>
      </div>
    </div>
  );
}
