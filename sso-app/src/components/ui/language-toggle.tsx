"use client";

import { useRouter } from "next/navigation";
import { LOCALES, LOCALE_COOKIE, LOCALE_NAMES, type Locale } from "@/lib/i18n/core";
import { useLocale } from "@/components/i18n-provider";

/** Language switch for pages without an account (sign-in): remembers the choice in a cookie. */
export function LanguageToggle({ className = "" }: { className?: string }) {
  const locale = useLocale();
  const router = useRouter();

  const choose = (next: Locale) => {
    if (next === locale) return;
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=${365 * 24 * 3600}; samesite=lax${location.protocol === "https:" ? "; secure" : ""}`;
    router.refresh();
  };

  return (
    <div className={`flex items-center rounded-lg border border-border overflow-hidden text-xs font-bold ${className}`} role="group" aria-label="Language">
      {LOCALES.map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => choose(l)}
          aria-pressed={l === locale}
          title={LOCALE_NAMES[l]}
          className={`px-2.5 py-2 uppercase transition-colors ${l === locale ? "bg-surface-lighter text-foreground" : "text-muted hover:text-foreground"}`}
        >
          {l}
        </button>
      ))}
    </div>
  );
}
