import { statSync } from "fs";
import path from "path";
import { open, type CityResponse, type Reader } from "maxmind";
import type { Locale } from "./i18n/core";

/**
 * Optional place lookup for an IP address from a local MaxMind GeoLite2 database (City, or Country as a fallback).
 * Nothing leaves this server. Without a database file every lookup returns null and the IP address is shown on its
 * own (approval page, guest mail).
 *
 * The file lives in `geoipDir()`. The admin enters the MaxMind account under Admin → System → GeoIP and lib/geoip-update.ts
 * downloads and refreshes it; a file placed there by hand works as well. A replaced file is picked up within a minute.
 */

const CHECK_EVERY_MS = 60_000;
export const GEOIP_FILE = "GeoLite2-City.mmdb";
const FALLBACK_FILES = [GEOIP_FILE, "GeoLite2-Country.mmdb"];

/** Directory of the database (env GEOIP_DIR, default ./geoip; a volume in the Docker setup). */
export function geoipDir(): string {
  return process.env.GEOIP_DIR?.trim() || path.join(process.cwd(), "geoip");
}

interface Loaded {
  file: string;
  mtimeMs: number;
  reader: Reader<CityResponse>;
}

let loaded: Loaded | null = null;
let lastCheck = 0;
let loading: Promise<Loaded | null> | null = null;
let failedMtime = 0; // a broken file is reported once, not on every lookup

function findFile(): { file: string; mtimeMs: number } | null {
  for (const name of FALLBACK_FILES) {
    const file = path.join(geoipDir(), name);
    try {
      const stat = statSync(file);
      if (stat.isFile()) return { file, mtimeMs: stat.mtimeMs };
    } catch {
      // not there, try the next one
    }
  }
  return null;
}

async function refresh(): Promise<Loaded | null> {
  const found = findFile();
  if (!found) {
    loaded = null;
    return null;
  }
  if (loaded && loaded.file === found.file && loaded.mtimeMs === found.mtimeMs) return loaded;
  if (found.mtimeMs === failedMtime) return loaded;

  try {
    const reader = await open<CityResponse>(found.file);
    loaded = { ...found, reader };
    failedMtime = 0;
  } catch {
    failedMtime = found.mtimeMs;
    console.error("[GEOIP] Datenbank konnte nicht gelesen werden");
  }
  return loaded;
}

async function currentReader(): Promise<Reader<CityResponse> | null> {
  if (!loading && Date.now() - lastCheck >= CHECK_EVERY_MS) {
    lastCheck = Date.now();
    loading = refresh().finally(() => {
      loading = null;
    });
    // Keeps a downloaded database current (no-op without MaxMind account or while it is fresh). Imported lazily: the
    // updater needs this module's paths.
    void import("./geoip-update").then((m) => m.refreshIfStale()).catch(() => {});
  }
  if (loading) await loading;
  return loaded?.reader ?? null;
}

/** Forget the cached reader so the next lookup opens the (replaced) file at once. */
export function resetGeoipReader(): void {
  lastCheck = 0;
  failedMtime = 0;
}

const normalize = (ip: string) => ip.trim().replace(/^::ffff:/i, "");

const pickName = (names: object | undefined, locale: Locale) => {
  const byLanguage = names as Record<string, string | undefined> | undefined;
  return byLanguage?.[locale] ?? byLanguage?.en;
};

/**
 * "Berlin, Deutschland" / "Berlin, Germany" (or just the country when the database only knows that) for a public
 * IP address. Null when there is no database, the address is private/unknown or anything goes wrong: callers show the
 * IP alone then.
 */
export async function locateIp(ip: string | null | undefined, locale: Locale = "en"): Promise<string | null> {
  if (!ip) return null;
  try {
    const reader = await currentReader();
    if (!reader) return null;
    const hit = reader.get(normalize(ip));
    if (!hit) return null;

    const country = pickName(hit.country?.names, locale) ?? pickName(hit.registered_country?.names, locale);
    const city = pickName(hit.city?.names, locale);
    const parts = [city, country].filter((p): p is string => !!p);
    return parts.length > 0 ? parts.join(", ") : null;
  } catch {
    return null;
  }
}

export interface GeoipDatabaseInfo {
  present: boolean;
  /** "GeoLite2-City" etc. */
  type: string | null;
  /** When MaxMind built this release. */
  builtAt: Date | null;
  /** When the file on disk was last replaced. */
  fileUpdatedAt: Date | null;
}

/** What is on disk right now (admin status). Opens the file if needed, so a broken file shows as not present. */
export async function describeGeoipDatabase(): Promise<GeoipDatabaseInfo> {
  const found = findFile();
  if (!found) return { present: false, type: null, builtAt: null, fileUpdatedAt: null };
  try {
    const reader = loaded && loaded.file === found.file && loaded.mtimeMs === found.mtimeMs ? loaded.reader : await open<CityResponse>(found.file);
    return {
      present: true,
      type: reader.metadata.databaseType,
      builtAt: reader.metadata.buildEpoch,
      fileUpdatedAt: new Date(found.mtimeMs),
    };
  } catch {
    return { present: false, type: null, builtAt: null, fileUpdatedAt: new Date(found.mtimeMs) };
  }
}
