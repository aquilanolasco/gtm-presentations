"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";

type Theme = "light" | "dark";
type Ctx = { theme: Theme; setTheme: (t: Theme) => void; toggle: () => void; mounted: boolean };

const ThemeContext = createContext<Ctx>({ theme: "light", setTheme: () => {}, toggle: () => {}, mounted: false });

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Server renders "light"; on mount we adopt whatever the pre-paint script already set
  // on <html data-theme>, so there is no flash and no hydration mismatch on the toggle.
  const [theme, setThemeState] = useState<Theme>("light");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const current = (document.documentElement.getAttribute("data-theme") as Theme) || "light";
    setThemeState(current);
    setMounted(true);
  }, []);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    try {
      document.documentElement.setAttribute("data-theme", t);
      localStorage.setItem("theme", t);
    } catch { /* ignore */ }
  }, []);

  const toggle = useCallback(() => setTheme((theme === "dark" ? "light" : "dark")), [theme, setTheme]);

  return <ThemeContext.Provider value={{ theme, setTheme, toggle, mounted }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}

// Sun / moon switch for the header.
export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { theme, toggle, mounted } = useTheme();
  const dark = theme === "dark";
  return (
    <button
      onClick={toggle}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      title={dark ? "Light mode" : "Dark mode"}
      style={{
        width: compact ? 34 : 36, height: compact ? 34 : 36, borderRadius: 999,
        border: "1px solid var(--border)", background: "var(--surface-2)", color: "var(--body)",
        cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center",
        padding: 0, flexShrink: 0, transition: "background .15s, color .15s, border-color .15s",
      }}
    >
      {/* Render the icon only after mount so SSR and client agree. */}
      {mounted && (dark ? (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="4.2" />
          <path d="M12 2.5v2.4M12 19.1v2.4M4.6 4.6l1.7 1.7M17.7 17.7l1.7 1.7M2.5 12h2.4M19.1 12h2.4M4.6 19.4l1.7-1.7M17.7 6.3l1.7-1.7" />
        </svg>
      ) : (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.8A8.5 8.5 0 1 1 11.2 3a6.6 6.6 0 0 0 9.8 9.8z" />
        </svg>
      ))}
    </button>
  );
}
