"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CheckIcon, MonitorSmartphoneIcon, UserRoundIcon, XIcon } from "@/components/ui/icons";
import { DurationPicker } from "@/components/device/duration-picker";
import { useI18n } from "@/components/i18n-provider";
import { dateLocale } from "@/lib/i18n/core";

interface Props {
  token: string;
  kind: "GUEST" | "DEVICE";
  appName: string | null;
  device: string;
  ip: string;
  location: string | null;
  createdAt: string;
  code: string;
  durations: readonly number[];
  defaultDuration: number;
}

type Outcome = { type: "approved"; hours?: number } | { type: "denied" } | null;

export function ApproveForm({ token, kind, appName, device, ip, location, createdAt, code, durations, defaultDuration }: Props) {
  const { t, te, locale } = useI18n();
  const guest = kind === "GUEST";
  const app = appName ?? t("der App");
  const [hours, setHours] = useState(defaultDuration);
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState<"approve" | "deny" | null>(null);
  const [error, setError] = useState("");
  const [outcome, setOutcome] = useState<Outcome>(null);

  const send = async (url: string, body: Record<string, unknown>) => {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, data };
  };

  const approve = async () => {
    setError("");
    setLoading("approve");
    try {
      const { ok, data } = await send("/api/device/approve", { token, durationHours: guest ? hours : undefined, password: guest ? undefined : password });
      if (ok) setOutcome({ type: "approved", hours: guest ? hours : undefined });
      else setError(te(data.error, "Ein Fehler ist aufgetreten"));
    } catch {
      setError(t("Verbindungsfehler"));
    } finally {
      setLoading(null);
    }
  };

  const deny = async () => {
    setError("");
    setLoading("deny");
    try {
      const { ok, data } = await send("/api/device/deny", { token });
      if (ok) setOutcome({ type: "denied" });
      else setError(te(data.error, "Ein Fehler ist aufgetreten"));
    } catch {
      setError(t("Verbindungsfehler"));
    } finally {
      setLoading(null);
    }
  };

  if (outcome) {
    const approved = outcome.type === "approved";
    return (
      <div>
        <div className={`mb-3 ${approved ? "text-success" : "text-muted"}`}>
          {approved ? <CheckIcon size={24} /> : <XIcon size={24} />}
        </div>
        <h1 className="text-lg font-extrabold mb-1">{approved ? t("Freigegeben") : t("Abgelehnt")}</h1>
        <p className="text-sm text-muted">
          {!approved
            ? t("Das andere Gerät wurde nicht angemeldet.")
            : guest
              ? outcome.hours === 1
                ? t("Der Gast kann {app} jetzt 1 Stunde nutzen.", { app })
                : t("Der Gast kann {app} jetzt {hours} Stunden nutzen.", { app, hours: outcome.hours ?? 0 })
              : t("Das andere Gerät wird jetzt angemeldet.")}
        </p>
        {approved && guest && (
          <Link href="/settings/sessions" className="inline-block mt-3 text-sm text-foreground hover:underline">
            {t("Zugang unter Sitzungen beenden")}
          </Link>
        )}
      </div>
    );
  }

  const time = new Date(createdAt).toLocaleTimeString(dateLocale(locale), { hour: "2-digit", minute: "2-digit" });
  const rows: [string, string][] = [
    ...(guest ? ([[t("App"), app]] as [string, string][]) : []),
    [t("Gerät"), t(device)],
    [t("IP-Adresse"), ip],
    ...(location ? ([[t("Standort (ca.)"), location]] as [string, string][]) : []),
    [t("Angefragt um"), t("{time} Uhr", { time })],
  ];

  return (
    <div>
      <div className="text-muted mb-3">{guest ? <UserRoundIcon size={24} /> : <MonitorSmartphoneIcon size={24} />}</div>
      <h1 className="text-lg font-extrabold mb-1">{guest ? t("Gast-Zugang freigeben") : t("Anmeldung freigeben")}</h1>
      <p className="text-sm text-muted mb-5">
        {guest
          ? t("Ein Gerät möchte {app} mit deinem Konto nutzen. Es erhält nur Zugriff auf diese App.", { app })
          : t("Ein Gerät möchte sich mit deinem Konto anmelden. Es hat danach vollen Zugriff, wie jede deiner Sitzungen.")}
      </p>

      <dl className="space-y-2 mb-5 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-4">
            <dt className="text-muted shrink-0">{label}</dt>
            <dd className="font-bold text-right break-all">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="bg-surface-lighter border border-border rounded-lg p-3 mb-5 text-center">
        <p className="text-xs text-muted mb-1">{t("Code auf dem anfragenden Gerät")}</p>
        <p className="text-2xl font-black tabular-nums tracking-[0.15em]">{`${code.slice(0, 3)} ${code.slice(3)}`}</p>
        <p className="text-xs text-muted mt-1">{t("Gib nur frei, wenn der Code übereinstimmt.")}</p>
      </div>

      <div className="space-y-4">
        {guest ? (
          <DurationPicker options={durations} value={hours} onChange={setHours} />
        ) : (
          <Input
            label={t("Passwort zur Bestätigung")}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            onKeyDown={(e) => {
              if (e.key === "Enter" && password) approve();
            }}
          />
        )}
      </div>

      {error && <p className="text-danger text-xs font-semibold mt-3">{error}</p>}

      <div className="grid grid-cols-2 gap-3 mt-5">
        <Button variant="secondary" onClick={deny} loading={loading === "deny"} disabled={loading !== null}>
          {t("Ablehnen")}
        </Button>
        <Button onClick={approve} loading={loading === "approve"} disabled={loading !== null || (!guest && !password)}>
          {t("Freigeben")}
        </Button>
      </div>
    </div>
  );
}
