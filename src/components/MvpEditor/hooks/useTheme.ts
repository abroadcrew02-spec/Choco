import { useState, useEffect, useCallback } from "react";
import { T, Tlight, type ThemeTokens } from "../theme/tokens";

export type ThemeMode = "dark" | "light";

const STORAGE_KEY = "choco:theme";

function getSystemTheme(): ThemeMode {
  if (typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: light)").matches) {
    return "light";
  }
  return "dark";
}

function loadThemeMode(): ThemeMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // ignore
  }
  return getSystemTheme();
}

export function useTheme(): {
  themeMode: ThemeMode;
  theme: ThemeTokens;
  toggleTheme: () => void;
} {
  const [themeMode, setThemeMode] = useState<ThemeMode>(loadThemeMode);

  // Listen for system preference changes (only applies when no explicit setting is saved)
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const handler = (e: MediaQueryListEvent) => {
      try {
        if (!localStorage.getItem(STORAGE_KEY)) {
          setThemeMode(e.matches ? "light" : "dark");
        }
      } catch {
        setThemeMode(e.matches ? "light" : "dark");
      }
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeMode((prev) => {
      const next: ThemeMode = prev === "dark" ? "light" : "dark";
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // ignore quota errors
      }
      return next;
    });
  }, []);

  const theme = themeMode === "light" ? (Tlight as unknown as ThemeTokens) : T;

  return { themeMode, theme, toggleTheme };
}
