import { readFileSync } from "fs";
import { join } from "path";
import { Reader } from "maxmind";

/**
 * Country of an IP address from a local database (CC0, derived from the regional internet registries' data).
 * Nothing leaves the server: no IP is sent to an external service. Only used to pick the default language.
 */
const DB_FILE = join(process.cwd(), "node_modules/@ip-location-db/geo-whois-asn-country-mmdb/geo-whois-asn-country.mmdb");

// The ip-location-db files use a flat { country_code } record instead of MaxMind's nested country object.
interface CountryDb {
  get(ip: string): { country_code?: string } | null;
}
const g = globalThis as unknown as { __geoReader?: CountryDb | null };

function reader() {
  if (g.__geoReader === undefined) {
    try {
      g.__geoReader = new Reader(readFileSync(DB_FILE)) as unknown as CountryDb;
    } catch {
      console.error("[I18N] Länderdatenbank nicht gefunden, die Sprache richtet sich nur nach dem Browser");
      g.__geoReader = null;
    }
  }
  return g.__geoReader;
}

export function countryOf(ip: string | undefined): string | null {
  if (!ip) return null;
  try {
    return reader()?.get(ip)?.country_code ?? null;
  } catch {
    return null;
  }
}

/** Countries whose visitors get German unless they chose otherwise. */
export const GERMAN_SPEAKING = new Set(["DE", "AT", "CH"]);
