"use client";

import type { CSSProperties } from "react";
import { Card, CardTitle } from "@/components/ui/card";
import { useI18n } from "@/components/i18n-provider";

export interface PreviewSite {
  siteName: string;
  tagline: string;
  orgName: string;
  contactUrl: string;
  footerLinks: { label: string; url: string }[];
}

/** `updatedAt` of the uploaded images (null = not uploaded); doubles as cache buster. */
export interface PreviewAssets {
  logo: number | null;
  logoLight: number | null;
  favicon: number | null;
}

/** The two colour sets of app/globals.css, so each pane looks like the real page in that theme whatever the admin is using. */
const THEMES = {
  dark: {
    "--background": "5 5 5",
    "--surface": "10 10 10",
    "--surface-light": "17 17 17",
    "--surface-lighter": "26 26 26",
    "--border": "34 34 34",
    "--foreground": "255 255 255",
    "--muted": "136 136 136",
    "--accent": "255 255 255",
    "--accent-foreground": "0 0 0",
  },
  light: {
    "--background": "255 255 255",
    "--surface": "250 250 250",
    "--surface-light": "255 255 255",
    "--surface-lighter": "241 241 241",
    "--border": "224 224 224",
    "--foreground": "10 10 10",
    "--muted": "107 107 107",
    "--accent": "10 10 10",
    "--accent-foreground": "255 255 255",
  },
} as const;

type Theme = keyof typeof THEMES;

/** Same choice as components/ui/brand-logo.tsx: dark logo, light logo, or the dark one inverted. */
function Logo({ theme, site, assets, className }: { theme: Theme; site: PreviewSite; assets: PreviewAssets; className: string }) {
  const size = `${className} w-auto max-w-[240px] object-contain`;
  if (theme === "light" && assets.logoLight) return <img src={`/api/branding/logo-light?v=${assets.logoLight}`} alt="" className={size} />;
  if (assets.logo) {
    return <img src={`/api/branding/logo?v=${assets.logo}`} alt="" className={size} style={theme === "light" && !assets.logoLight ? { filter: "invert(1)" } : undefined} />;
  }
  return <span className="text-base font-black tracking-tight text-foreground">{site.siteName || "…"}</span>;
}

function ThemePane({ theme, site, assets }: { theme: Theme; site: PreviewSite; assets: PreviewAssets }) {
  const { t } = useI18n();
  const links = site.contactUrl && !site.footerLinks.some((l) => l.url === site.contactUrl) ? [...site.footerLinks, { label: t("Kontakt"), url: site.contactUrl }] : site.footerLinks;
  const shownLinks = links.filter((l) => l.label.trim());
  const copyright = site.orgName ? `© ${new Date().getFullYear()} ${site.orgName}` : null;

  return (
    <div>
      <p className="text-[11px] font-bold uppercase tracking-wider text-muted mb-1.5">{theme === "dark" ? t("Dunkles Design") : t("Helles Design")}</p>
      <div className="rounded-lg overflow-hidden border border-border bg-background text-foreground" style={THEMES[theme] as unknown as CSSProperties} data-preview-theme={theme}>
        <div className="h-14 border-b border-border bg-surface flex items-center px-4 gap-3" data-preview="header">
          <Logo theme={theme} site={site} assets={assets} className="h-6" />
          {assets.logo && <span className="text-xs font-black text-muted border-l border-border pl-3 uppercase tracking-widest">SSO</span>}
        </div>
        <div className="px-5 pt-6 pb-4" data-preview="login">
          <div className="text-center mb-4">
            <div className="flex justify-center mb-2">
              <Logo theme={theme} site={site} assets={assets} className="h-8" />
            </div>
            {site.tagline && <p className="text-[10px] text-muted uppercase tracking-[0.2em] font-bold">{site.tagline}</p>}
          </div>
          <div className="bg-surface-light border border-border rounded-lg p-3 space-y-2">
            <p className="text-[11px] text-muted uppercase tracking-wider">{t("Benutzername")}</p>
            <div className="h-7 rounded-md border border-border bg-background" />
            <div className="h-7 rounded-md bg-accent text-accent-foreground text-xs font-bold flex items-center justify-center">{t("Weiter")}</div>
          </div>
          <div className="mt-4 text-center text-[10px] text-muted">
            {shownLinks.length > 0 && <p className="flex flex-wrap justify-center gap-x-3 gap-y-1">{shownLinks.map((l, i) => <span key={i}>{l.label}</span>)}</p>}
            {copyright && <p className={`opacity-70 ${shownLinks.length > 0 ? "mt-1.5" : ""}`}>{copyright}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Live preview of what the branding looks like on the pages (sizes 1:1). Reads the unsaved form values. */
export function BrandPreview({ site, assets }: { site: PreviewSite; assets: PreviewAssets }) {
  const { t } = useI18n();
  const favicon = `/api/branding/favicon${assets.favicon ? `?v=${assets.favicon}` : ""}`;

  return (
    <Card className="p-4" >
      <CardTitle className="text-base">{t("Vorschau")}</CardTitle>
      <p className="text-xs text-muted mt-1 mb-4">{t("So erscheint es später auf den Seiten, in Originalgröße. Name, Untertitel und Footer aus dem Formular siehst du sofort, Bilder nach dem Hochladen.")}</p>

      <div className="space-y-4">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-muted mb-1.5">{t("Browser-Tab")}</p>
          <div className="rounded-lg bg-[#202124] px-2 pt-2 flex items-end gap-3" data-preview="tab">
            <div className="bg-[#35363a] rounded-t-lg px-3 py-2 flex items-center gap-2 min-w-0 max-w-[230px]">
              <img src={favicon} alt="" width={16} height={16} className="h-4 w-4 shrink-0 object-contain" />
              <span className="text-xs text-[#e8eaed] truncate">{t("Anmelden")} | {site.siteName || "…"}</span>
            </div>
            <div className="ml-auto pb-2 flex items-center gap-1.5" title={t("Dasselbe Bild vergrößert")}>
              <img src={favicon} alt="" width={32} height={32} className="h-8 w-8 object-contain" />
            </div>
          </div>
        </div>

        <ThemePane theme="dark" site={site} assets={assets} />
        <ThemePane theme="light" site={site} assets={assets} />
        {assets.logo && !assets.logoLight && (
          <p className="text-xs text-muted" data-preview="invert-note">
            {t("Im hellen Design wird das Logo automatisch invertiert, weil kein eigenes Logo für hellen Hintergrund hochgeladen ist. Das passt nur bei einfarbigen Logos.")}
          </p>
        )}
        {!assets.logo && <p className="text-xs text-muted">{t("Ohne Logo erscheint der Name als Text, ohne Favicon ein neutrales Symbol.")}</p>}
      </div>
    </Card>
  );
}
