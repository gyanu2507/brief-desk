"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type ThemeMode = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const STORE_KEY = "brief-desk-theme";

type ThemeContextValue = {
  mode: ThemeMode;
  resolved: ResolvedTheme;
  setMode: (mode: ThemeMode) => void;
  cycle: () => void;
};

const ThemeContext = createContext<ThemeContextValue>({
  mode: "system",
  resolved: "light",
  setMode: () => undefined,
  cycle: () => undefined,
});

function systemTheme(): ResolvedTheme {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(resolved: ResolvedTheme) {
  const root = document.documentElement;
  root.setAttribute("data-theme", resolved);
  root.style.colorScheme = resolved;
  if (resolved === "dark") root.classList.add("dark");
  else root.classList.remove("dark");
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>("system");
  const [resolved, setResolved] = useState<ResolvedTheme>("light");

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORE_KEY) as ThemeMode | null;
      if (saved === "light" || saved === "dark" || saved === "system") {
        setModeState(saved);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    const next = mode === "system" ? systemTheme() : mode;
    setResolved(next);
    applyTheme(next);
    try {
      localStorage.setItem(STORE_KEY, mode);
    } catch {
      // ignore
    }

    if (mode !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      const sys = systemTheme();
      setResolved(sys);
      applyTheme(sys);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [mode]);

  const setMode = useCallback((value: ThemeMode) => {
    setModeState(value);
  }, []);

  const cycle = useCallback(() => {
    setModeState((prev) => (prev === "light" ? "dark" : prev === "dark" ? "system" : "light"));
  }, []);

  const value = useMemo(
    () => ({ mode, resolved, setMode, cycle }),
    [mode, resolved, setMode, cycle],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}

export function ThemeToggle() {
  const { mode, resolved, cycle } = useTheme();
  const label =
    mode === "system" ? `System (${resolved})` : mode === "dark" ? "Dark" : "Light";

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={cycle}
      title={`Theme: ${label}. Click to cycle light → dark → system.`}
      aria-label={`Theme ${label}. Click to change.`}
    >
      {resolved === "dark" ? (
        <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
          <path
            fill="currentColor"
            d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"
          />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
          <path
            fill="currentColor"
            d="M12 4a1 1 0 0 1 1 1v1a1 1 0 1 1-2 0V5a1 1 0 0 1 1-1zm0 13a1 1 0 0 1 1 1v1a1 1 0 1 1-2 0v-1a1 1 0 0 1 1-1zm8-5a1 1 0 0 1-1 1h-1a1 1 0 1 1 0-2h1a1 1 0 0 1 1 1zM6 12a1 1 0 0 1-1 1H4a1 1 0 1 1 0-2h1a1 1 0 0 1 1 1zm11.66 5.66a1 1 0 0 1-1.41 0l-.71-.71a1 1 0 1 1 1.41-1.41l.71.71a1 1 0 0 1 0 1.41zM8.46 8.46a1 1 0 0 1-1.41 0l-.71-.71A1 1 0 0 1 7.75 6.34l.71.71a1 1 0 0 1 0 1.41zm9.2-2.12a1 1 0 0 1 0 1.41l-.71.71A1 1 0 1 1 15.54 7l.71-.71a1 1 0 0 1 1.41 0zM8.46 15.54a1 1 0 0 1 0 1.41l-.71.71A1 1 0 1 1 6.34 16.25l.71-.71a1 1 0 0 1 1.41 0zM12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8z"
          />
        </svg>
      )}
      <span>{mode === "system" ? "Auto" : mode === "dark" ? "Dark" : "Light"}</span>
    </button>
  );
}

/** Inline script for layout: apply stored theme before paint (no FOUC). */
export const THEME_BOOT_SCRIPT = `(function(){try{var k='brief-desk-theme';var m=localStorage.getItem(k)||'system';var d=window.matchMedia('(prefers-color-scheme: dark)').matches;var r=m==='dark'||(m==='system'&&d)?'dark':'light';var e=document.documentElement;e.setAttribute('data-theme',r);e.style.colorScheme=r;if(r==='dark')e.classList.add('dark');else e.classList.remove('dark');}catch(e){}})();`;
