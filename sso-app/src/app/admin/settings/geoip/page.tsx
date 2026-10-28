"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageTitle } from "@/components/ui/page-title";
import { usePasswordPrompt } from "@/components/ui/password-prompt";
import { useI18n } from "@/components/i18n-provider";
import { dateLocale } from "@/lib/i18n/core";

interface Status {
  configured: boolean;
  accountId: string;
  database: { present: boolean; type: string | null; builtAt: string | null; fileUpdatedAt: string | null };
  updating: boolean;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  /** German text from the server */
  lastError: string | null;
}

export default function GeoipSettingsPage() {
  const { t, tn, te, locale } = useI18n();
  const [status, setStatus] = useState<Status | null>(null);
  const [accountId, setAccountId] = useState("");
  const [licenseKey, setLicenseKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [updating, setUpdating] = useState(false);
  const { askPassword, passwordPrompt } = usePasswordPrompt();

  const load = async () => {
    const res = await fetch("/api/admin/settings/geoip");
    if (res.ok) {
      const data: Status = await res.json();
      setStatus(data);
      setAccountId((current) => current || data.accountId);
    }
  };
  useEffect(() => {
    load();
  }, []);

  if (!status) return <><PageTitle title={t("GeoIP")} /><div className="loading-bar rounded" /></>;

  const date = (iso: string | null) => (iso ? new Date(iso).toLocaleString(dateLocale(locale), { dateStyle: "medium", timeStyle: "short" }) : "–");

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const password = await askPassword(t("MaxMind-Zugang speichern"));
    if (!password) return;
    setSaving(true);
    const res = await fetch("/api/admin/settings/geoip", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountId, licenseKey, password }) });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      toast.error(te(data.error, "Fehler beim Speichern"));
      return;
    }
    setLicenseKey("");
    if (data.download?.ok) toast.success(t("Gespeichert, die Datenbank wurde geladen"));
    else toast.error(t("Gespeichert, aber der Download ist fehlgeschlagen: {error}", { error: te(data.download?.error, "Fehler") }));
    load();
  };

  const updateNow = async () => {
    setUpdating(true);
    const res = await fetch("/api/admin/settings/geoip/update", { method: "POST" });
    const data = await res.json().catch(() => ({}));
    setUpdating(false);
    if (res.ok) toast.success(t("Datenbank aktualisiert"));
    else toast.error(te(data.error, "Fehler"));
    load();
  };

  const disconnect = async () => {
    const password = await askPassword(t("MaxMind trennen"));
    if (!password) return;
    const res = await fetch("/api/admin/settings/geoip", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      toast.success(t("MaxMind getrennt"));
      setAccountId("");
      setLicenseKey("");
      load();
    } else toast.error(te(data.error, "Fehler"));
  };

  return (
    <div className="space-y-6">
      <PageTitle title={t("GeoIP")} />
      {passwordPrompt}

      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <CardTitle>{t("Standort zu IP-Adressen (MaxMind GeoLite2)")}</CardTitle>
          {status.database.present ? <Badge variant="success">{t("aktiv")}</Badge> : <Badge variant="warning">{t("nicht eingerichtet")}</Badge>}
        </div>
        <p className="text-sm text-muted mt-2">
          {tn("Wenn sich jemand über ein anderes Gerät oder als Gast anmelden will, siehst du bei der Freigabe (und im Gast-Zugang-Mail) neben der IP-Adresse auch einen ungefähren Standort. Dafür lädt der SSO die kostenlose {db} von MaxMind herunter. Die Abfragen laufen danach lokal auf diesem Server, es werden keine IP-Adressen an Dritte gesendet. Ohne Datenbank wird nur die IP-Adresse angezeigt.", {
            db: <strong>{t("GeoLite2-City-Datenbank")}</strong>,
          })}
        </p>

        <dl className="grid grid-cols-1 sm:grid-cols-[200px_1fr] gap-x-4 gap-y-2 text-sm mt-4">
          <dt className="text-muted">{t("Datenbank")}</dt>
          <dd>{status.database.present ? `${status.database.type ?? "GeoLite2"} · ${t("Stand {date}", { date: date(status.database.builtAt) })}` : t("noch nicht geladen")}</dd>
          <dt className="text-muted">{t("Zuletzt geladen")}</dt>
          <dd>{date(status.lastSuccessAt ?? status.database.fileUpdatedAt)}</dd>
        </dl>
        {status.lastError && (
          <p className="text-sm font-semibold text-danger mt-3 break-words">
            ✗ {t("Letzter Download fehlgeschlagen: {error}", { error: te(status.lastError, "Fehler") })}
          </p>
        )}

        <form onSubmit={save} className="mt-5 space-y-4">
          <Input label={t("Account-ID")} value={accountId} onChange={(e) => setAccountId(e.target.value)} placeholder="123456" inputMode="numeric" className="font-mono" required />
          <Input
            label={t("Lizenzschlüssel")}
            type="password"
            value={licenseKey}
            onChange={(e) => setLicenseKey(e.target.value)}
            placeholder={status.configured ? t("•••••••• gespeichert – leer lassen zum Behalten") : t("Lizenzschlüssel einfügen")}
            autoComplete="new-password"
            required={!status.configured}
          />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" loading={saving}>
              {t("Speichern und laden")}
            </Button>
            {status.configured && (
              <>
                <Button type="button" variant="secondary" loading={updating} onClick={updateNow}>
                  {t("Jetzt aktualisieren")}
                </Button>
                <Button type="button" variant="ghost" onClick={disconnect}>
                  {t("Trennen")}
                </Button>
              </>
            )}
          </div>
        </form>
      </Card>

      <Card>
        <CardTitle>{t("So kommst du an die Werte")}</CardTitle>
        <ol className="list-decimal list-outside pl-5 mt-3 space-y-2 text-sm text-muted">
          <li>{t("Bei MaxMind ein kostenloses GeoLite2-Konto anlegen (maxmind.com → GeoLite2 → Sign up) und die Lizenzbedingungen akzeptieren.")}</li>
          <li>
            <strong className="text-foreground">{t("Account-ID:")}</strong> {t("Nach dem Login oben rechts im Konto-Menü angezeigt („Account ID“).")}
          </li>
          <li>
            <strong className="text-foreground">{t("Lizenzschlüssel:")}</strong> {t("Konto → Manage License Keys → Generate new license key. Der Schlüssel wird nur einmal angezeigt.")}
          </li>
          <li>{t("Beides hier einfügen und speichern. Die Datenbank wird sofort geladen und danach automatisch alle paar Tage aktualisiert.")}</li>
        </ol>
        <p className="text-xs text-muted mt-3">
          {t("Der Lizenzschlüssel wird verschlüsselt gespeichert und nie wieder im Browser angezeigt. Beim Trennen wird auch die heruntergeladene Datenbank gelöscht.")}
        </p>
      </Card>
    </div>
  );
}
