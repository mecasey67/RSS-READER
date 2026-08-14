"use client";

import { useEffect, useState } from "react";

export function ThemeToggle() {
  const [isDark, setIsDark] = useState<boolean | null>(null);

  useEffect(() => {
    // Reading DOM state set by the pre-hydration inline script in layout.tsx
    // (see themeInitScript) — this is genuinely synchronizing with state
    // that only exists in the browser, not deriving state from props.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggle() {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
    setIsDark(next);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      className="rounded px-2 py-1 text-sm text-muted hover:bg-surface-hover"
    >
      {isDark === null ? "" : isDark ? "☀" : "☾"}
    </button>
  );
}
