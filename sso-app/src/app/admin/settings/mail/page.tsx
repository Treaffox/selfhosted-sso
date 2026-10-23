"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageTitle } from "@/components/ui/page-title";
import { usePasswordPrompt } from "@/components/ui/password-prompt";
import { Select } from "@/components/ui/select";
import { useI18n } from "@/components/i18n-provider";

interface Field {
  key: string;
  label: string;
  type: "text" | "password" | "number" | "select" | "checkbox";
  required?: boolean;
  placeholder?: string;
  help?: string;
  options?: { value: string; label: string }[];
  default?: string;
}
interface Provider {
  id: string;
  label: string;
  group: string;
  summary: string;
  docsUrl?: string;
  fields: Field[];
}
interface Channel {
  provider: string;
  config: Record<string, string>;
  secretsSet: string[];
}
interface MailForm {
  fromName: string;
  fromAddress: string;
  replyTo: string;
  primary: Channel | null;
  fallback: Channel | null;
}

const emptyChannel = (p: Provider): Channel => ({
  provider: p.id,
  config: Object.fromEntries(p.fields.filter((f) => f.default !== undefined).map((f) => [f.key, f.default!])),
  secretsSet: [],
});

export default function MailSettingsPage() {
  const { t, te } = useI18n();
  const [form, setForm] = useState<MailForm | null>(null);
  const [saved, setSaved] = useState<string>("");
  const [providers, setProviders] = useState<Provider[]>([]);
  const [groups, setGroups] = useState<Record<string, string>>({});
  const [defaultFromName, setDefaultFromName] = useState("");
  const [testTo, setTestTo] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<"primary" | "fallback" | null>(null);
  const [testResult, setTestResult] = useState<{ channel: string; ok: boolean; message: string } | null>(null);
  const { askPassword, passwordPrompt } = usePasswordPrompt();

  const load = async () => {
    const res = await fetch("/api/admin/settings/mail");
    if (!res.ok) return;
    const data = await res.json();
    setProviders(data.providers);
    setGroups(data.groups);
    setDefaultFromName(data.defaultFromName);
    setTestTo((prev) => prev || data.adminEmail);
    setForm(data.settings);
    setSaved(JSON.stringify(data.settings));
  };
  useEffect(() => {
    load();
  }, []);

  if (!form) return <><PageTitle title={t("E-Mail")} /><div className="loading-bar rounded" /></>;

  const dirty = JSON.stringify(form) !== saved;
  const configured = !!form.fromAddress && !!(saved && JSON.parse(saved).primary);
  const set = <K extends keyof MailForm>(key: K, value: MailForm[K]) => setForm({ ...form, [key]: value });

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const password = await askPassword(t("E-Mail-Einstellungen speichern"));
    if (!password) return;
    setSaving(true);
    const payload = {
      fromName: form.fromName,
      fromAddress: form.fromAddress,
      replyTo: form.replyTo,
      primary: form.primary && { provider: form.primary.provider, config: form.primary.config },
      fallback: form.fallback && { provider: form.fallback.provider, config: form.fallback.config },
      password,
    };
    const res = await fetch("/api/admin/settings/mail", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (res.ok) {
      toast.success(t("Gespeichert"));
      setTestResult(null);
      load();
    } else toast.error(te(data.error, "Fehler beim Speichern"));
  };

  const test = async (channel: "primary" | "fallback") => {
    setTesting(channel);
    setTestResult(null);
    const res = await fetch("/api/admin/settings/mail/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ channel, to: testTo }) });
    const data = await res.json().catch(() => ({}));
    setTesting(null);
    setTestResult({ channel, ok: res.ok, message: res.ok ? t("Testmail wurde vom Anbieter angenommen. Schau im Postfach (und im Spam-Ordner) nach.") : te(data.error, "Fehler") });
  };

  return (
    <form onSubmit={save} className="space-y-6">
      <PageTitle title={t("E-Mail")} />
      {passwordPrompt}

      {!configured && (
        <div className="border border-warning/30 bg-warning/10 text-warning rounded-lg px-4 py-3 text-sm font-semibold">
          {t("Es ist noch kein E-Mail-Versand eingerichtet. Bestätigungscodes, Passwort-Zurücksetzen und Willkommensmails werden nicht zugestellt.")}
        </div>
      )}

      <Card>
        <CardTitle>{t("Absender")}</CardTitle>
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input label={t("Absender-Adresse")} type="email" value={form.fromAddress} onChange={(e) => set("fromAddress", e.target.value)} placeholder={t("sso@example.com")} required />
          <Input label={t("Absender-Name")} value={form.fromName} onChange={(e) => set("fromName", e.target.value)} placeholder={defaultFromName} maxLength={80} />
          <Input label={t("Antwort-Adresse (optional)")} type="email" value={form.replyTo} onChange={(e) => set("replyTo", e.target.value)} placeholder={t("support@example.com")} />
        </div>
        <p className="text-xs text-muted mt-3">
          {t("Die Absender-Adresse muss beim Anbieter freigegeben sein (verifizierte Adresse oder Domain), sonst lehnt er die Mails ab. Ohne Absender-Namen steht der Name des Dienstes im Postfach.")}
        </p>
      </Card>

      <Card>
        <CardTitle>{t("Haupt-Anbieter")}</CardTitle>
        <p className="text-sm text-muted mt-1 mb-4">{t("Darüber gehen alle Mails raus.")}</p>
        <ProviderForm providers={providers} groups={groups} value={form.primary} onChange={(v) => set("primary", v)} required />
      </Card>

      <Card>
        <CardTitle>{t("Ersatz-Anbieter (optional)")}</CardTitle>
        <p className="text-sm text-muted mt-1 mb-4">{t("Springt ein, wenn der Haupt-Anbieter nicht antwortet oder die Mail ablehnt. Am besten ein anderer Dienst als oben.")}</p>
        {form.fallback ? (
          <>
            <ProviderForm providers={providers} groups={groups} value={form.fallback} onChange={(v) => set("fallback", v)} />
            <Button type="button" variant="ghost" size="sm" className="mt-3" onClick={() => set("fallback", null)}>
              {t("Ersatz-Anbieter entfernen")}
            </Button>
          </>
        ) : (
          <Button type="button" variant="secondary" size="sm" disabled={!form.primary} onClick={() => set("fallback", emptyChannel(providers[0]))}>
            {t("Ersatz-Anbieter hinzufügen")}
          </Button>
        )}
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" loading={saving} disabled={!dirty}>
          {t("Speichern")}
        </Button>
        {dirty && <span className="text-xs text-muted">{t("Ungespeicherte Änderungen. Zum Testen zuerst speichern.")}</span>}
      </div>

      <Card>
        <CardTitle>{t("Testmail senden")}</CardTitle>
        <p className="text-sm text-muted mt-1 mb-4">{t("Schickt eine Testmail mit deinem Logo über einen gespeicherten Anbieter und zeigt die echte Fehlermeldung des Anbieters, falls es nicht klappt.")}</p>
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 items-end">
          <Input label={t("Empfänger")} type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder={t("du@example.com")} />
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" loading={testing === "primary"} disabled={dirty || !testTo || !saved || !JSON.parse(saved).primary} onClick={() => test("primary")}>
              {t("Haupt-Anbieter testen")}
            </Button>
            {saved && JSON.parse(saved).fallback && (
              <Button type="button" variant="secondary" loading={testing === "fallback"} disabled={dirty || !testTo} onClick={() => test("fallback")}>
                {t("Ersatz testen")}
              </Button>
            )}
          </div>
        </div>
        {testResult && (
          <p className={`mt-3 text-sm font-semibold break-words ${testResult.ok ? "text-success" : "text-danger"}`}>
            {testResult.ok ? "✓ " : "✗ "}
            {testResult.message}
          </p>
        )}
      </Card>
    </form>
  );
}

function ProviderForm({
  providers,
  groups,
  value,
  onChange,
  required,
}: {
  providers: Provider[];
  groups: Record<string, string>;
  value: Channel | null;
  onChange: (v: Channel | null) => void;
  required?: boolean;
}) {
  const { t, te } = useI18n();
  const provider = providers.find((p) => p.id === value?.provider);
  const order = ["smtp", "smtp-service", "api"];

  return (
    <div className="space-y-4">
      <Select
        label={t("Anbieter")}
        value={value?.provider ?? ""}
        onChange={(e) => {
          const next = providers.find((p) => p.id === e.target.value);
          onChange(next ? emptyChannel(next) : null);
        }}
      >
        {!required || !value ? <option value="">{required ? t("Bitte wählen …") : t("Keiner")}</option> : null}
        {order.map((g) => (
          <optgroup key={g} label={groups[g]}>
            {providers
              .filter((p) => p.group === g)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
          </optgroup>
        ))}
      </Select>

      {provider && value && (
        <>
          <p className="text-xs text-muted">
            {provider.summary}
            {provider.docsUrl && (
              <>
                {" "}
                <a href={provider.docsUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-foreground">
                  {t("Zugangsdaten anlegen →")}
                </a>
              </>
            )}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {provider.fields.map((f) => {
              const current = value.config[f.key] ?? "";
              const update = (v: string) => onChange({ ...value, config: { ...value.config, [f.key]: v } });
              const hint = f.help && <p className="text-xs text-muted mt-1.5 font-semibold">{f.help}</p>;

              if (f.type === "select") {
                return (
                  <div key={f.key}>
                    <Select label={f.label} value={current} onChange={(e) => update(e.target.value)}>
                      {f.options!.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </Select>
                    {hint}
                  </div>
                );
              }
              if (f.type === "checkbox") {
                return (
                  <label key={f.key} className="flex items-start gap-3 sm:col-span-2 text-sm cursor-pointer">
                    <input type="checkbox" className="mt-1" checked={current === "true"} onChange={(e) => update(e.target.checked ? "true" : "false")} />
                    <span>
                      <span className="font-bold">{f.label}</span>
                      {f.help && <span className="block text-xs text-muted">{f.help}</span>}
                    </span>
                  </label>
                );
              }
              const secretStored = f.type === "password" && value.secretsSet.includes(f.key);
              return (
                <div key={f.key}>
                  <Input
                    label={f.label + (f.required ? "" : " (optional)")}
                    type={f.type === "number" ? "text" : f.type}
                    inputMode={f.type === "number" ? "numeric" : undefined}
                    value={current}
                    onChange={(e) => update(e.target.value)}
                    placeholder={secretStored ? "•••••••• gespeichert – leer lassen zum Behalten" : f.placeholder}
                    autoComplete={f.type === "password" ? "new-password" : "off"}
                    required={f.required && !secretStored}
                  />
                  {hint}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
