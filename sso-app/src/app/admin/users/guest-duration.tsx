"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/components/i18n-provider";
import { GUEST_ACCOUNT_DEFAULT_MINUTES, GUEST_ACCOUNT_PRESETS, parseGuestMinutes } from "@/lib/guest-account-duration";

const UNITS = { minutes: 1, hours: 60, days: 24 * 60 } as const;
type Unit = keyof typeof UNITS;
const CUSTOM = "custom";
const fieldClass = "bg-surface-lighter border border-border rounded-lg px-4 py-2.5 text-sm font-semibold text-foreground focus:outline-none focus:border-foreground";

/**
 * Lifetime picker for guest accounts: a quick choice (1 hour … 90 days) or any amount in minutes, hours or days.
 * Reports the lifetime in minutes, null while the custom input is invalid.
 */
export function GuestDuration({ onChange }: { onChange: (minutes: number | null) => void }) {
  const { t } = useI18n();
  const [choice, setChoice] = useState(String(GUEST_ACCOUNT_DEFAULT_MINUTES));
  const [amount, setAmount] = useState("1");
  const [unit, setUnit] = useState<Unit>("hours");
  const [invalid, setInvalid] = useState(false);

  // The picker starts on its default; the form must hold the same value (also when it is mounted again)
  useEffect(() => onChange(GUEST_ACCOUNT_DEFAULT_MINUTES), []); // eslint-disable-line react-hooks/exhaustive-deps

  const customMinutes = (a: string, u: Unit) => parseGuestMinutes(Math.round(Number(a) * UNITS[u]));
  const reportCustom = (a: string, u: Unit) => {
    const minutes = customMinutes(a, u);
    setInvalid(minutes === null);
    onChange(minutes);
  };

  const presetLabel = (minutes: number) =>
    minutes === 60 ? t("1 Stunde") : minutes === 24 * 60 ? t("1 Tag") : t("{days} Tage", { days: minutes / (24 * 60) });

  return (
    <div className="flex flex-wrap gap-2">
      <select
        className={`${fieldClass} flex-1 min-w-[9rem]`}
        value={choice}
        onChange={(e) => {
          setChoice(e.target.value);
          if (e.target.value === CUSTOM) reportCustom(amount, unit);
          else { setInvalid(false); onChange(Number(e.target.value)); }
        }}
      >
        {GUEST_ACCOUNT_PRESETS.map((m) => (
          <option key={m} value={m}>{presetLabel(m)}</option>
        ))}
        <option value={CUSTOM}>{t("Eigene Dauer")}</option>
      </select>
      {choice === CUSTOM && (
        <>
          <input
            type="number"
            min={0}
            inputMode="decimal"
            aria-label={t("Gültig für")}
            className={`${fieldClass} w-24 ${invalid ? "border-danger" : ""}`}
            value={amount}
            onChange={(e) => { setAmount(e.target.value); reportCustom(e.target.value, unit); }}
          />
          <select
            className={fieldClass}
            value={unit}
            onChange={(e) => { setUnit(e.target.value as Unit); reportCustom(amount, e.target.value as Unit); }}
          >
            <option value="minutes">{t("Minuten")}</option>
            <option value="hours">{t("Stunden")}</option>
            <option value="days">{t("Tage")}</option>
          </select>
          {invalid && <p className="w-full text-danger text-xs font-semibold">{t("Bitte eine Zahl größer als 0 eingeben, höchstens 10 Jahre.")}</p>}
        </>
      )}
    </div>
  );
}
