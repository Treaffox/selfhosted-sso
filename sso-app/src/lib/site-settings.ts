import { z } from "zod";
import { readSetting, writeSetting } from "./settings";
import { getAppUrl } from "./config";
import { db } from "./db";

export interface FooterLink {
  label: string;
  url: string;
}

export interface SiteSettings {
  /** Product name shown in header, page titles, e-mails, authenticator apps and the passkey prompt. */
  siteName: string;
  /** Line under the logo on the login page and in e-mails; empty hides it. */
  tagline: string;
  /** Operator shown in the copyright line; empty hides the line. */
  orgName: string;
  /** Where users reach the admins (https://… or mailto:…); empty = no link. */
  contactUrl: string;
  footerLinks: FooterLink[];
  /** Background of the e-mail header bar (the logo sits on it). */
  mailHeaderColor: string;
  /** IANA zone used for times in e-mails. */
  timeZone: string;
}

export const DEFAULT_SITE: SiteSettings = {
  siteName: "SSO",
  tagline: "Single Sign-On",
  orgName: "",
  contactUrl: "",
  footerLinks: [],
  mailHeaderColor: "#000000",
  timeZone: "Europe/Berlin",
};

const linkTarget = z
  .string()
  .trim()
  .max(500)
  .refine((v) => /^(https?:\/\/[^\s]+|mailto:[^\s@]+@[^\s@]+|\/[^\s]*)$/i.test(v), "Muss mit https://, http://, mailto: oder / beginnen");

export const siteSettingsSchema = z.object({
  siteName: z.string().trim().min(1, "Name darf nicht leer sein").max(60),
  tagline: z.string().trim().max(60),
  orgName: z.string().trim().max(80),
  contactUrl: z.union([z.literal(""), linkTarget]),
  footerLinks: z
    .array(z.object({ label: z.string().trim().min(1, "Link-Text fehlt").max(40), url: linkTarget }))
    .max(10, "Maximal 10 Footer-Links"),
  mailHeaderColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Farbe im Format #rrggbb"),
  timeZone: z.string().refine((tz) => {
    try {
      new Intl.DateTimeFormat("de-DE", { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, "Unbekannte Zeitzone (z. B. Europe/Berlin)"),
});

export async function getSiteSettings(): Promise<SiteSettings> {
  const stored = await readSetting<Partial<SiteSettings>>("site");
  return { ...DEFAULT_SITE, ...(stored ?? {}) };
}

export async function saveSiteSettings(input: unknown): Promise<{ ok: true; value: SiteSettings } | { ok: false; error: string }> {
  const parsed = siteSettingsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  await writeSetting("site", parsed.data);
  return { ok: true, value: parsed.data };
}

// ─── Brand assets (logo / favicon) ────────────────────

export type AssetKind = "logo" | "logoLight" | "favicon";

export interface AssetInfo {
  mime: string;
  updatedAt: number;
}

export async function getAssetInfos(): Promise<Record<AssetKind, AssetInfo | null>> {
  const rows = await db.brandAsset.findMany({ select: { kind: true, mime: true, updatedAt: true } });
  const out: Record<AssetKind, AssetInfo | null> = { logo: null, logoLight: null, favicon: null };
  for (const r of rows) {
    if (r.kind in out) out[r.kind as AssetKind] = { mime: r.mime, updatedAt: r.updatedAt.getTime() };
  }
  return out;
}

/** Everything the page chrome (header, footer, login, document title) needs about the branding. */
export interface BrandView {
  siteName: string;
  tagline: string;
  /** Relative URLs (cache-busted); null when nothing was uploaded. */
  logoUrl: string | null;
  logoLightUrl: string | null;
  faviconUrl: string;
  footerLinks: FooterLink[];
  copyright: string | null;
  contactUrl: string;
}

export async function getBrandView(): Promise<BrandView> {
  const [site, assets] = await Promise.all([getSiteSettings(), getAssetInfos()]);
  return {
    siteName: site.siteName,
    tagline: site.tagline,
    logoUrl: assets.logo ? `/api/branding/logo?v=${assets.logo.updatedAt}` : null,
    logoLightUrl: assets.logoLight ? `/api/branding/logo-light?v=${assets.logoLight.updatedAt}` : null,
    faviconUrl: `/api/branding/favicon${assets.favicon ? `?v=${assets.favicon.updatedAt}` : ""}`,
    footerLinks: site.footerLinks,
    copyright: site.orgName ? `© ${new Date().getFullYear()} ${site.orgName}` : null,
    contactUrl: site.contactUrl,
  };
}

/** Absolute URL for places outside the browser session (e-mails, OIDC picture claims). */
export function absoluteUrl(path: string): string {
  return `${getAppUrl()}${path}`;
}
