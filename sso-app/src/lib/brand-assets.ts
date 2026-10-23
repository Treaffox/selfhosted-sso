import { db } from "./db";
import type { AssetKind } from "./site-settings";

export const ASSET_KINDS: AssetKind[] = ["logo", "logoLight", "favicon"];

const LIMITS: Record<AssetKind, number> = {
  logo: 1024 * 1024,
  logoLight: 1024 * 1024,
  favicon: 1024 * 1024, // input; photos are converted to a small PNG
};
const MAX_PIXELS = 16_000_000;

export type AssetMime = "image/png" | "image/jpeg" | "image/webp" | "image/gif" | "image/svg+xml" | "image/x-icon";

const ALLOWED: Record<AssetKind, AssetMime[]> = {
  logo: ["image/png", "image/jpeg", "image/webp", "image/svg+xml"],
  logoLight: ["image/png", "image/jpeg", "image/webp", "image/svg+xml"],
  favicon: ["image/png", "image/jpeg", "image/webp", "image/gif", "image/x-icon", "image/svg+xml"],
};

export const ASSET_LABELS: Record<AssetKind, string> = {
  logo: "Logo",
  logoLight: "Logo für hellen Hintergrund",
  favicon: "Favicon",
};

/** Detects the type from the content (never trusts the client's Content-Type). */
function sniff(buf: Buffer): AssetMime | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 6 && /^GIF8[79]a$/.test(buf.toString("ascii", 0, 6))) return "image/gif";
  if (buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (buf.length >= 4 && buf[0] === 0 && buf[1] === 0 && buf[2] === 1 && buf[3] === 0) return "image/x-icon";
  const head = buf.subarray(0, 2048).toString("utf8").replace(/^﻿/, "").trimStart();
  if (/^(<\?xml[^>]*\?>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(head)) return "image/svg+xml";
  return null;
}

/**
 * SVGs are served from our own origin, so anything that could run script or pull in other resources is refused
 * (on top of that, /api/branding/* answers with a sandboxing Content-Security-Policy).
 */
function svgProblem(svg: string): string | null {
  if (/<!DOCTYPE|<!ENTITY/i.test(svg)) return "SVG mit DOCTYPE/ENTITY ist nicht erlaubt";
  if (/<\s*(script|foreignObject|iframe|object|embed|audio|video|animate|set|style\b[^>]*@import)/i.test(svg)) return "SVG enthält nicht erlaubte Elemente (Skripte, eingebettete Inhalte)";
  if (/\son[a-z]+\s*=/i.test(svg)) return "SVG enthält Event-Handler";
  if (/javascript:/i.test(svg)) return "SVG enthält javascript:-Verweise";
  for (const m of svg.matchAll(/(?:xlink:)?href\s*=\s*["']([^"']*)["']/gi)) {
    const target = m[1].trim();
    if (!target.startsWith("#") && !/^data:image\/(png|jpeg|webp|gif);base64,/i.test(target)) return "SVG darf nur auf interne Elemente (#id) oder eingebettete Bilder verweisen";
  }
  if (/url\(\s*["']?(?!#)/i.test(svg.replace(/url\(\s*["']?data:image\/[a-z]+;base64,[^)]*\)/gi, ""))) return "SVG darf keine externen url(...)-Verweise enthalten";
  return null;
}

/** `data` is what gets stored: the upload itself, except favicons in raster formats (JPG, WebP, GIF, PNG), which become a square PNG. */
export type AssetCheck = { ok: true; mime: AssetMime; data: Buffer } | { ok: false; error: string };

const FAVICON_SIZE = 256;

export async function checkAsset(kind: AssetKind, buf: Buffer): Promise<AssetCheck> {
  if (buf.length === 0) return { ok: false, error: "Datei ist leer" };
  const maxKb = Math.round(LIMITS[kind] / 1024);
  if (buf.length > LIMITS[kind]) return { ok: false, error: `Datei ist zu groß (maximal ${maxKb} KB)` };
  const mime = sniff(buf);
  if (!mime || !ALLOWED[kind].includes(mime)) {
    const names = ALLOWED[kind].map((m) => m.replace("image/", "").replace("svg+xml", "svg").replace("x-icon", "ico").replace("jpeg", "jpg").toUpperCase()).join(", ");
    return { ok: false, error: `Ungültiges Dateiformat (erlaubt: ${names})` };
  }
  if (mime === "image/svg+xml") {
    const problem = svgProblem(buf.toString("utf8"));
    if (problem) return { ok: false, error: problem };
  }
  if (mime === "image/x-icon" || mime === "image/svg+xml" && kind === "favicon") return { ok: true, mime, data: buf };

  // Decoding proves the file really is an image of sane size (and that conversion will work).
  try {
    const sharp = (await import("sharp")).default;
    const image = sharp(buf, { limitInputPixels: MAX_PIXELS });
    const meta = await image.metadata();
    if (!meta.width || !meta.height) return { ok: false, error: "Bild konnte nicht gelesen werden" };
    if (kind === "favicon" && mime !== "image/svg+xml") {
      // JPG/WebP/GIF/PNG → square PNG (browsers handle PNG favicons everywhere; SVG and ICO stay as they are)
      const png = await image
        .resize({ width: FAVICON_SIZE, height: FAVICON_SIZE, fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer();
      return { ok: true, mime: "image/png", data: png };
    }
  } catch {
    return { ok: false, error: "Bild konnte nicht gelesen werden oder ist zu groß" };
  }
  return { ok: true, mime, data: buf };
}

export async function saveAsset(kind: AssetKind, data: Buffer, mime: string): Promise<void> {
  const bytes = new Uint8Array(data);
  await db.brandAsset.upsert({ where: { kind }, create: { kind, data: bytes, mime }, update: { data: bytes, mime } });
  mailLogoCache.clear();
}

export async function deleteAsset(kind: AssetKind): Promise<void> {
  await db.brandAsset.deleteMany({ where: { kind } });
  mailLogoCache.clear();
}

export async function getAsset(kind: AssetKind): Promise<{ data: Buffer; mime: string; updatedAt: number } | null> {
  const row = await db.brandAsset.findUnique({ where: { kind } });
  return row ? { data: Buffer.from(row.data), mime: row.mime, updatedAt: row.updatedAt.getTime() } : null;
}

// ─── E-mail logo ──────────────────────────────────────

const MAIL_LOGO_WIDTH = 280; // shown at 140 px → sharp on high-DPI screens
const mailLogoCache = new Map<string, Buffer>();

/**
 * Mail clients (Gmail, Outlook, ...) don't render SVG, so the logo is converted to PNG for e-mails.
 * `onLightBackground`: use the light-background logo if there is one, else invert the normal one.
 */
export async function getMailLogoPng(onLightBackground: boolean): Promise<Buffer | null> {
  const lightVariant = onLightBackground ? await getAsset("logoLight") : null;
  const source = lightVariant ?? (await getAsset("logo"));
  if (!source) return null;
  const invert = onLightBackground && !lightVariant;
  const key = `${lightVariant ? "l" : "d"}:${source.updatedAt}:${invert}`;
  const hit = mailLogoCache.get(key);
  if (hit) return hit;
  try {
    const sharp = (await import("sharp")).default;
    let img = sharp(source.data, { limitInputPixels: MAX_PIXELS, density: 300 }).resize({ width: MAIL_LOGO_WIDTH, height: 120, fit: "inside", withoutEnlargement: false });
    if (invert) img = img.negate({ alpha: false });
    const png = await img.png().toBuffer();
    if (mailLogoCache.size > 8) mailLogoCache.clear();
    mailLogoCache.set(key, png);
    return png;
  } catch (e) {
    console.error("[BRANDING] Logo-Konvertierung für E-Mails fehlgeschlagen:", e instanceof Error ? e.name : "Fehler");
    return null;
  }
}

/** Built-in favicon used until the admin uploads one. */
export const DEFAULT_FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#0a0a0a"/><path d="M32 12 16 18v12c0 11 7 19 16 22 9-3 16-11 16-22V18z" fill="none" stroke="#fafafa" stroke-width="4" stroke-linejoin="round"/><circle cx="32" cy="29" r="4" fill="#fafafa"/><path d="M32 33v9" stroke="#fafafa" stroke-width="4" stroke-linecap="round"/></svg>`;
