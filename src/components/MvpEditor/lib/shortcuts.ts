/**
 * Keyboard shortcut customization — Issue #53
 *
 * Provides default key bindings for editor actions, with localStorage
 * persistence so users can remap individual keys.
 *
 * Storage key: "choco:shortcuts"
 * Format: { [actionId]: string }  e.g. { "brush": "q" }
 *
 * A stored entry overrides the default for that action. Unset entries
 * fall back to DEFAULT_SHORTCUTS.
 */

export type ShortcutActionId =
  | "brush"
  | "eyedropper"
  | "replaceAll"
  | "text"
  | "shape"
  | "color"
  | "transparent";

export interface ShortcutDef {
  /** Action identifier */
  id: ShortcutActionId;
  /** Human-readable label (en) */
  label: string;
  /** Human-readable label (ja) */
  labelJa: string;
  /** Default key (single character, lowercase) */
  defaultKey: string;
}

export const SHORTCUT_DEFS: ShortcutDef[] = [
  { id: "brush",       label: "Brush",        labelJa: "ブラシ",        defaultKey: "b" },
  { id: "eyedropper",  label: "Eyedropper",   labelJa: "スポイト",      defaultKey: "i" },
  { id: "replaceAll",  label: "Replace-All",  labelJa: "一括置換",      defaultKey: "r" },
  { id: "text",        label: "Text",         labelJa: "テキスト",      defaultKey: "t" },
  { id: "shape",       label: "Shape",        labelJa: "シェイプ",      defaultKey: "u" },
  { id: "color",       label: "Color",        labelJa: "色変更",        defaultKey: "g" },
  { id: "transparent", label: "Transparent",  labelJa: "透過",          defaultKey: "e" },
];

const DEFAULT_SHORTCUTS: Record<ShortcutActionId, string> = Object.fromEntries(
  SHORTCUT_DEFS.map((d) => [d.id, d.defaultKey])
) as Record<ShortcutActionId, string>;

const STORAGE_KEY = "choco:shortcuts";

// ---------------------------------------------------------------------------
// Internal persistence helpers
// ---------------------------------------------------------------------------

function loadRaw(): Partial<Record<ShortcutActionId, string>> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    return parsed as Partial<Record<ShortcutActionId, string>>;
  } catch {
    return {};
  }
}

function saveRaw(data: Partial<Record<ShortcutActionId, string>>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // ignore quota errors
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns the effective key for an action.
 * Custom mapping from localStorage takes precedence over the default.
 */
export function getShortcut(actionId: ShortcutActionId): string {
  const custom = loadRaw();
  const key = custom[actionId];
  if (typeof key === "string" && key.length === 1) return key.toLowerCase();
  return DEFAULT_SHORTCUTS[actionId];
}

/**
 * Persists a custom key for an action.
 * Pass an empty string or the default key to clear the customization.
 */
export function setShortcut(actionId: ShortcutActionId, key: string): void {
  const normalized = key.toLowerCase().trim();
  const custom = loadRaw();
  if (!normalized || normalized === DEFAULT_SHORTCUTS[actionId]) {
    delete custom[actionId];
  } else {
    custom[actionId] = normalized;
  }
  saveRaw(custom);
}

/**
 * Resets all shortcuts to defaults by clearing the storage entry.
 */
export function resetShortcuts(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

/**
 * Returns a full map of actionId -> effective key (custom or default).
 */
export function getAllShortcuts(): Record<ShortcutActionId, string> {
  const custom = loadRaw();
  return Object.fromEntries(
    SHORTCUT_DEFS.map((d) => {
      const key = custom[d.id];
      const effective = typeof key === "string" && key.length === 1 ? key.toLowerCase() : d.defaultKey;
      return [d.id, effective];
    })
  ) as Record<ShortcutActionId, string>;
}
