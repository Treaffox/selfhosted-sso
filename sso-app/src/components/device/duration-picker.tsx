"use client";

import { useT } from "@/components/i18n-provider";

/** Choice of how long a guest keeps access. */
export function DurationPicker({
  options,
  value,
  onChange,
}: {
  options: readonly number[];
  value: number;
  onChange: (hours: number) => void;
}) {
  const t = useT();
  return (
    <div>
      <p className="block text-xs text-muted mb-1.5 uppercase tracking-wider">{t("Zugang gültig für")}</p>
      <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label={t("Gültigkeitsdauer")}>
        {options.map((hours) => (
          <button
            key={hours}
            type="button"
            role="radio"
            aria-checked={value === hours}
            onClick={() => onChange(hours)}
            className={`text-xs font-bold py-2 px-3 rounded-lg border transition-colors ${
              value === hours
                ? "border-foreground text-foreground bg-surface-lighter"
                : "border-border text-muted hover:text-foreground"
            }`}
          >
            {hours === 1 ? t("1 Stunde") : t("{hours} Stunden", { hours })}
          </button>
        ))}
      </div>
    </div>
  );
}
