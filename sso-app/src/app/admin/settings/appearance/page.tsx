"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageTitle } from "@/components/ui/page-title";
import { useI18n } from "@/components/i18n-provider";
import { N_ } from "@/lib/i18n/core";

interface Site {
  siteName: string;
  tagline: string;
  orgName: string;
  contactUrl: string;
  footerLinks: { label: string; url: string }[];
  mailHeaderColor: string;
  timeZone: string;
}
type Kind = "logo" | "logoLight" | "favicon";
type Assets = Record<Kind, { mime: string; updatedAt: number } | null>;

const ASSET_UI: { kind: Kind; title: string; help: string; accept: string; previewClass: string; src: (v: number) => string; bg: string }[] = [
  {
    kind: "logo",
    title: N_("Logo"),
    help: N_("Wird im Header, auf der Anmeldeseite und in E-Mails gezeigt. Gedacht für dunklen Hintergrund (hell oder farbig). PNG, SVG, WebP oder JPEG bis 1 MB, am besten mit transparentem Hintergrund."),
    accept: "image/png,image/svg+xml,image/webp,image/jpeg",
    previewClass: "h-8",
    src: (v) => `/api/branding/logo?v=${v}`,
    bg: "bg-[#050505]",
  },
  {
    kind: "logoLight",
    title: N_("Logo für hellen Hintergrund (optional)"),
    help: N_("Wird im hellen Design genutzt. Ohne diese Datei wird das Logo dort automatisch invertiert – das passt nur bei einfarbigen Logos."),
    accept: "image/png,image/svg+xml,image/webp,image/jpeg",
    previewClass: "h-8",
    src: (v) => `/api/branding/logo-light?v=${v}`,
    bg: "bg-white",
  },
  {
    kind: "favicon",
    title: N_("Favicon"),
    help: N_("Das kleine Symbol im Browser-Tab. Quadratisch, mindestens 64 × 64 Pixel. SVG und ICO bleiben unverändert, JPG, PNG, WebP und GIF werden automatisch in ein PNG umgewandelt (bis 1 MB)."),
    accept: "image/png,image/jpeg,image/svg+xml,image/x-icon,image/webp,image/gif,.ico",
    previewClass: "h-8 w-8",
    src: (v) => `/api/branding/favicon?v=${v}`,
    bg: "bg-surface-lighter",
  },
];

export default function AppearancePage() {
  const { t, te } = useI18n();
  const [site, setSite] = useState<Site | null>(null);
  const [assets, setAssets] = useState<Assets | null>(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const res = await fetch("/api/admin/settings/site");
    if (res.ok) {
      const data = await res.json();
      setSite(data.site);
      setAssets(data.assets);
    }
  };
  useEffect(() => {
    load();
  }, []);

  if (!site || !assets) return <><PageTitle title={t("Erscheinungsbild")} /><div className="loading-bar rounded" /></>;

  const set = <K extends keyof Site>(key: K, value: Site[K]) => setSite({ ...site, [key]: value });

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const res = await fetch("/api/admin/settings/site", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(site) });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (res.ok) toast.success(t("Gespeichert"));
    else toast.error(te(data.error, "Fehler beim Speichern"));
  };

  const upload = async (kind: Kind, file: File) => {
    const form = new FormData();
    form.set("file", file);
    const res = await fetch(`/api/admin/settings/assets/${kind}`, { method: "PUT", body: form });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      toast.success(t("Hochgeladen"));
      load();
    } else toast.error(te(data.error, "Upload fehlgeschlagen"));
  };

  const remove = async (kind: Kind) => {
    const res = await fetch(`/api/admin/settings/assets/${kind}`, { method: "DELETE" });
    if (res.ok) {
      toast.success(t("Entfernt"));
      load();
    } else toast.error(t("Fehler"));
  };

  const linkRow = (i: number, patch: Partial<{ label: string; url: string }>) =>
    set("footerLinks", site.footerLinks.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  const logoVersion = Math.max(assets.logo?.updatedAt ?? 0, assets.logoLight?.updatedAt ?? 0);

  return (
    <div className="space-y-6">
      <PageTitle title={t("Erscheinungsbild")} />

      <Card>
        <CardTitle>{t("Logo und Favicon")}</CardTitle>
        <p className="text-sm text-muted mt-1 mb-4">{t("Ohne Upload zeigt der SSO den Namen als Text und ein neutrales Symbol als Favicon.")}</p>
        <div className="space-y-5">
          {ASSET_UI.map((ui) => (
            <AssetRow key={ui.kind} ui={ui} info={assets[ui.kind]} onUpload={(f) => upload(ui.kind, f)} onRemove={() => remove(ui.kind)} />
          ))}
        </div>
      </Card>

      <form onSubmit={save} className="space-y-6">
        <Card>
          <CardTitle>{t("Name und Texte")}</CardTitle>
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input label={t("Name des Dienstes")} value={site.siteName} onChange={(e) => set("siteName", e.target.value)} maxLength={60} required />
            <Input label={t("Untertitel")} value={site.tagline} onChange={(e) => set("tagline", e.target.value)} maxLength={60} placeholder={t("Single Sign-On")} />
            <Input label={t("Betreiber (für „© Jahr …“)")} value={site.orgName} onChange={(e) => set("orgName", e.target.value)} maxLength={80} placeholder={t("Beispiel GmbH")} />
            <Input label={t("Kontakt-Link")} value={site.contactUrl} onChange={(e) => set("contactUrl", e.target.value)} maxLength={500} placeholder={t("mailto:admin@example.com oder https://…")} />
          </div>
          <p className="text-xs text-muted mt-3">
            {t("Der Name erscheint im Header, in Seitentiteln, in E-Mails, in Authenticator-Apps und beim Passkey-Dialog. Der Kontakt-Link steht im Footer und in der Dokumentation.")}
          </p>
        </Card>

        <Card>
          <CardTitle>{t("Footer-Links")}</CardTitle>
          <p className="text-sm text-muted mt-1 mb-4">{t("Z. B. Datenschutz und Impressum. Sie erscheinen unten auf jeder Seite und in E-Mails (dort nur vollständige https://-Adressen).")}</p>
          <div className="space-y-2">
            {site.footerLinks.map((link, i) => (
              <div key={i} className="grid grid-cols-[1fr_auto] sm:grid-cols-[200px_1fr_auto] gap-2 items-start">
                <Input aria-label={t("Link-Text")} placeholder={t("Datenschutz")} value={link.label} onChange={(e) => linkRow(i, { label: e.target.value })} maxLength={40} />
                <Input aria-label={t("Adresse")} placeholder={t("https://example.com/datenschutz")} value={link.url} onChange={(e) => linkRow(i, { url: e.target.value })} maxLength={500} className="sm:col-auto col-span-2 row-start-2 sm:row-start-auto" />
                <Button type="button" variant="ghost" size="sm" className="mt-2" onClick={() => set("footerLinks", site.footerLinks.filter((_, idx) => idx !== i))}>
                  {t("Entfernen")}
                </Button>
              </div>
            ))}
          </div>
          {site.footerLinks.length < 10 && (
            <Button type="button" variant="secondary" size="sm" className="mt-3" onClick={() => set("footerLinks", [...site.footerLinks, { label: "", url: "" }])}>
              {t("Link hinzufügen")}
            </Button>
          )}
        </Card>

        <Card>
          <CardTitle>{t("E-Mail-Design")}</CardTitle>
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-muted mb-1.5 uppercase tracking-wider">{t("Farbe der Kopfzeile")}</label>
              <div className="flex gap-2">
                <input
                  type="color"
                  aria-label={t("Farbe wählen")}
                  value={/^#[0-9a-fA-F]{6}$/.test(site.mailHeaderColor) ? site.mailHeaderColor : "#000000"}
                  onChange={(e) => set("mailHeaderColor", e.target.value)}
                  className="h-[46px] w-14 rounded-lg border border-border bg-surface-light p-1 cursor-pointer"
                />
                <Input aria-label={t("Farbwert")} value={site.mailHeaderColor} onChange={(e) => set("mailHeaderColor", e.target.value)} maxLength={7} className="font-mono" />
              </div>
            </div>
            <Input label={t("Zeitzone für Zeitangaben in E-Mails")} value={site.timeZone} onChange={(e) => set("timeZone", e.target.value)} placeholder={t("Europe/Berlin")} />
          </div>
          <div className="mt-4 rounded-lg overflow-hidden border border-border max-w-[320px]">
            <div className="px-6 py-5 text-center" style={{ background: /^#[0-9a-fA-F]{6}$/.test(site.mailHeaderColor) ? site.mailHeaderColor : "#000" }}>
              {assets.logo || assets.logoLight ? (
                <img
                  src={`/api/branding/mail-logo?bg=${isLight(site.mailHeaderColor) ? "light" : "dark"}&v=${logoVersion}`}
                  alt={t("Vorschau")}
                  className="mx-auto h-auto w-[140px]"
                />
              ) : (
                <span className="font-black" style={{ color: isLight(site.mailHeaderColor) ? "#111" : "#fff" }}>{site.siteName}</span>
              )}
              {site.tagline && (
                <p className="mt-2 text-[10px] font-bold uppercase tracking-[3px] opacity-70" style={{ color: isLight(site.mailHeaderColor) ? "#111" : "#fff" }}>
                  {site.tagline}
                </p>
              )}
            </div>
            <p className="text-xs text-muted px-4 py-2 bg-surface-light">{t("Vorschau der Kopfzeile. Das Logo kommt in E-Mails als PNG von der öffentlichen Adresse dieses Servers.")}</p>
          </div>
        </Card>

        <Button type="submit" loading={saving}>
          {t("Speichern")}
        </Button>
      </form>
    </div>
  );
}

function isLight(hex: string): boolean {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return false;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4;
}

function AssetRow({
  ui,
  info,
  onUpload,
  onRemove,
}: {
  ui: (typeof ASSET_UI)[number];
  info: { mime: string; updatedAt: number } | null;
  onUpload: (file: File) => Promise<void>;
  onRemove: () => void;
}) {
  const { t, te } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  return (
    <div className="flex flex-col sm:flex-row gap-4 sm:items-center">
      <div className={`${ui.bg} border border-border rounded-lg w-full sm:w-48 h-20 shrink-0 flex items-center justify-center px-4`}>
        {info ? <img src={ui.src(info.updatedAt)} alt="" className={`${ui.previewClass} w-auto max-w-full object-contain`} /> : <span className="text-xs text-muted">{t("nicht gesetzt")}</span>}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold">{t(ui.title)}</p>
        <p className="text-xs text-muted mt-0.5">{t(ui.help)}</p>
        <div className="flex gap-2 mt-2">
          <input
            ref={input}
            type="file"
            accept={ui.accept}
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              setBusy(true);
              await onUpload(file);
              setBusy(false);
            }}
          />
          <Button type="button" variant="secondary" size="sm" loading={busy} onClick={() => input.current?.click()}>
            {info ? t("Ersetzen") : t("Hochladen")}
          </Button>
          {info && (
            <Button type="button" variant="ghost" size="sm" onClick={onRemove}>
              {t("Entfernen")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
