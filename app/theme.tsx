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
  const { mode, resolved, setMode } = useTheme();
  const label =
    mode === "system" ? `System (${resolved})` : mode === "dark" ? "Dark" : "Light";

  return (
    <select
      className="theme-toggle select-theme field-select"
      value={mode}
      onChange={(e) => setMode(e.target.value as ThemeMode)}
      title={`Theme: ${label}`}
      aria-label="Color theme"
    >
      <option value="system">System</option>
      <option value="light">Light</option>
      <option value="dark">Dark</option>
    </select>
  );
}

/** Inline script for layout: apply stored theme before paint (no FOUC). */
export const THEME_BOOT_SCRIPT = `(function(){try{var k='brief-desk-theme';var m=localStorage.getItem(k)||'system';var d=window.matchMedia('(prefers-color-scheme: dark)').matches;var r=m==='dark'||(m==='system'&&d)?'dark':'light';var e=document.documentElement;e.setAttribute('data-theme',r);e.style.colorScheme=r;if(r==='dark')e.classList.add('dark');else e.classList.remove('dark');}catch(e){}})();`;
