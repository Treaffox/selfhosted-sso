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

export default function CloudflareSettingsPage() {
  const { t, tn, te } = useI18n();
  const [loaded, setLoaded] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [zoneId, setZoneId] = useState("");
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const { askPassword, passwordPrompt } = usePasswordPrompt();

  const load = async () => {
    const res = await fetch("/api/admin/settings/cloudflare");
    if (res.ok) {
      const data = await res.json();
      setConfigured(data.configured);
      setZoneId(data.zoneId);
      setLoaded(true);
    }
  };
  useEffect(() => {
    load();
  }, []);

  if (!loaded) return <><PageTitle title={t("Cloudflare")} /><div className="loading-bar rounded" /></>;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const password = await askPassword(t("Cloudflare-Zugang speichern"));
    if (!password) return;
    setSaving(true);
    const res = await fetch("/api/admin/settings/cloudflare", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, zoneId, password }) });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (res.ok) {
      toast.success(t("Gespeichert"));
      setToken("");
      setTestResult(null);
      load();
    } else toast.error(te(data.error, "Fehler beim Speichern"));
  };

  const disconnect = async () => {
    const password = await askPassword(t("Cloudflare trennen"));
    if (!password) return;
    const res = await fetch("/api/admin/settings/cloudflare", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      toast.success(t("Cloudflare getrennt"));
      setZoneId("");
      setTestResult(null);
      load();
    } else toast.error(te(data.error, "Fehler"));
  };

  const test = async () => {
    setTesting(true);
    const res = await fetch("/api/admin/settings/cloudflare/test", { method: "POST" });
    const data = await res.json().catch(() => ({}));
    setTesting(false);
    setTestResult({ ok: res.ok, message: res.ok ? t("Verbindung steht. Zone: {zone}", { zone: data.zoneName }) : te(data.error, "Fehler") });
  };

  return (
    <div className="space-y-6">
      <PageTitle title={t("Cloudflare")} />
      {passwordPrompt}

      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <CardTitle>{t("DNS über Cloudflare verwalten")}</CardTitle>
          {configured ? <Badge variant="success">{t("verbunden")}</Badge> : <Badge>{t("nicht verbunden")}</Badge>}
        </div>
        <p className="text-sm text-muted mt-2">
          {tn("Optional. Wenn du Cloudflare verbindest, kannst du bei jeder App unter {where} DNS-Einträge anlegen, ändern und löschen. Es lassen sich nur Einträge ändern, die hier angelegt wurden – alles andere in deiner Zone bleibt unberührt. Ohne Verbindung fehlt nur dieser Bereich.", {
            where: <strong>{t("Admin → Apps")}</strong>,
          })}
        </p>

        <form onSubmit={save} className="mt-5 space-y-4">
          <Input label={t("Zonen-ID")} value={zoneId} onChange={(e) => setZoneId(e.target.value)} placeholder={t("32 Zeichen, z. B. 023e105f4ecef8ad9ca31a8372d0c353")} className="font-mono" required />
          <Input
            label={t("API-Token")}
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={configured ? t("•••••••• gespeichert – leer lassen zum Behalten") : t("Token einfügen")}
            autoComplete="new-password"
            required={!configured}
          />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" loading={saving}>
              {t("Speichern")}
            </Button>
            {configured && (
              <>
                <Button type="button" variant="secondary" loading={testing} onClick={test}>
                  {t("Verbindung testen")}
                </Button>
                <Button type="button" variant="ghost" onClick={disconnect}>
                  {t("Trennen")}
                </Button>
              </>
            )}
          </div>
          {testResult && <p className={`text-sm font-semibold break-words ${testResult.ok ? "text-success" : "text-danger"}`}>{testResult.ok ? "✓ " : "✗ "}{testResult.message}</p>}
        </form>
      </Card>

      <Card>
        <CardTitle>{t("So kommst du an die Werte")}</CardTitle>
        <ol className="list-decimal list-outside pl-5 mt-3 space-y-2 text-sm text-muted">
          <li>
            <strong className="text-foreground">{t("Zonen-ID:")}</strong> {t("Im Cloudflare-Dashboard die Domain öffnen → Übersicht → rechte Spalte, Abschnitt „API“ → Zonen-ID kopieren.")}
          </li>
          <li>
            <strong className="text-foreground">{t("API-Token:")}</strong> {t("Dashboard → Mein Profil → API-Tokens → Token erstellen → Vorlage „DNS bearbeiten“. Bei „Zonenressourcen“ nur diese eine Domain auswählen. Mehr Rechte braucht der SSO nicht.")}
          </li>
          <li>{t("Token und Zonen-ID hier einfügen, speichern, dann „Verbindung testen“.")}</li>
        </ol>
        <p className="text-xs text-muted mt-3">{t("Der Token wird verschlüsselt gespeichert und nie wieder im Browser angezeigt.")}</p>
      </Card>
    </div>
  );
}
