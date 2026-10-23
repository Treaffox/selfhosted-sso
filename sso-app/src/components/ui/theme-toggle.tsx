"use client";

import { useEffect, useState } from "react";
import { useT } from "@/components/i18n-provider";

const STORAGE_KEY = "sso-theme";

function getEffectiveTheme(): "dark" | "light" {
  const attr = document.documentElement.getAttribute("data-theme");
  if (attr === "light" || attr === "dark") return attr;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function ThemeToggle({ className = "" }: { className?: string }) {
  const t = useT();
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    setTheme(getEffectiveTheme());

    // No explicit choice stored yet: keep following the OS setting live.
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => {
      if (!document.documentElement.getAttribute("data-theme")) {
        setTheme(media.matches ? "light" : "dark");
      }
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {}
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={theme === "dark" ? t("Zu hellem Design wechseln") : t("Zu dunklem Design wechseln")}
      title={theme === "dark" ? t("Helles Design") : t("Dunkles Design")}
      className={`text-muted hover:text-foreground transition-colors p-1.5 rounded-md ${className}`}
    >
      {theme === "dark" ? (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="8" cy="8" r="3.5" />
          <path d="M8 1v1.5M8 13.5V15M2.6 2.6l1.05 1.05M12.35 12.35l1.05 1.05M1 8h1.5M13.5 8H15M2.6 13.4l1.05-1.05M12.35 3.65l1.05-1.05" />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 9.3A6 6 0 0 1 6.7 2 6 6 0 1 0 14 9.3Z" />
        </svg>
      )}
    </button>
  );
}
