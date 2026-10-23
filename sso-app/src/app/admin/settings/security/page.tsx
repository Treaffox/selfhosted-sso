"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { PageTitle } from "@/components/ui/page-title";
import { usePasswordPrompt } from "@/components/ui/password-prompt";
import { useI18n } from "@/components/i18n-provider";

export default function SecuritySettingsPage() {
  const { t, te } = useI18n();
  const [requireMfa, setRequireMfa] = useState<boolean | null>(null);
  const [saved, setSaved] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const { askPassword, passwordPrompt } = usePasswordPrompt();

  useEffect(() => {
    fetch("/api/admin/settings/security").then(async (res) => {
      if (!res.ok) return;
      const { settings } = await res.json();
      setRequireMfa(settings.requireMfa);
      setSaved(settings.requireMfa);
    });
  }, []);

  if (requireMfa === null) return <><PageTitle title={t("Sicherheit")} /><div className="loading-bar rounded" /></>;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const password = await askPassword(t("Sicherheitsrichtlinie ändern"));
    if (!password) return;
    setSaving(true);
    const res = await fetch("/api/admin/settings/security", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requireMfa, password }) });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (res.ok) {
      toast.success(t("Gespeichert"));
      setSaved(requireMfa);
    } else toast.error(te(data.error, "Fehler beim Speichern"));
  };

  const option = (value: boolean, title: string, text: string) => (
    <label className={`flex items-start gap-3 rounded-lg border p-4 cursor-pointer transition-colors ${requireMfa === value ? "border-foreground" : "border-border hover:border-border-light"}`}>
      <input type="radio" name="requireMfa" className="mt-1" checked={requireMfa === value} onChange={() => setRequireMfa(value)} />
      <span>
        <span className="block text-sm font-bold">{title}</span>
        <span className="block text-xs text-muted mt-0.5">{text}</span>
      </span>
    </label>
  );

  return (
    <form onSubmit={save} className="space-y-6">
      <PageTitle title={t("Sicherheit")} />
      {passwordPrompt}

      <Card>
        <CardTitle>{t("Zwei-Faktor-Anmeldung (MFA)")}</CardTitle>
        <p className="text-sm text-muted mt-1 mb-4">{t("Legt fest, ob sich Nutzer mit einem zweiten Faktor (Authenticator-App oder E-Mail-Code) anmelden müssen. Passkeys sind davon unabhängig und gelten immer als starke Anmeldung.")}</p>
        <div className="space-y-3">
          {option(true, t("Verpflichtend (empfohlen)"), t("Jedes Konto braucht einen zweiten Faktor. Wer noch keinen hat, wird nach der Anmeldung zur Einrichtung geleitet; Admins kommen erst nach der Einrichtung in den Admin-Bereich."))}
          {option(false, t("Optional"), t("Nutzer melden sich mit dem Passwort an. Nur wer in seinen Einstellungen eine Authenticator-App aktiviert hat, wird nach einem Code gefragt. Der Admin-Bereich ist auch ohne MFA erreichbar."))}
        </div>
        {requireMfa === false && (
          <p className="mt-4 text-xs font-semibold text-warning">{t("Ohne verpflichtendes MFA reicht ein erratenes oder gestohlenes Passwort für den Zugang, auch zum Admin-Konto. Aktiviere MFA mindestens für Admins in deren Einstellungen.")}</p>
        )}
      </Card>

      <Button type="submit" loading={saving} disabled={requireMfa === saved}>
        {t("Speichern")}
      </Button>
    </form>
  );
}
