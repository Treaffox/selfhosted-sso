import { mkdirSync, renameSync, rmSync, statSync, writeFileSync } from "fs";
import path from "path";
import { gunzipSync } from "zlib";
import { open } from "maxmind";
import { N_ } from "./i18n/core";
import { deleteSetting, openSecret, readSetting, sealSecret, writeSetting } from "./settings";
import { describeGeoipDatabase, geoipDir, GEOIP_FILE, resetGeoipReader } from "./geoip";

/**
 * GeoLite2 City database from MaxMind (free, needs an account: https://www.maxmind.com/en/geolite2/signup).
 * The admin enters account ID + license key under Admin → System → GeoIP; the license key is sealed like other
 * secrets. The database is downloaded straight from MaxMind (the only request that leaves this server for GeoIP –
 * lookups themselves are local, see lib/geoip.ts) and refreshed when it is older than a few days.
 */

const DOWNLOAD_URL = "https://download.maxmind.com/geoip/databases/GeoLite2-City/download?suffix=tar.gz";
/** GeoLite2 is released twice a week; checking every few days is plenty (MaxMind allows 30 downloads a day). */
const STALE_AFTER_MS = 3 * 24 * 60 * 60 * 1000;
const RETRY_AFTER_OK_MS = 60 * 60 * 1000;
const RETRY_AFTER_ERROR_MS = 6 * 60 * 60 * 1000;
const MAX_DOWNLOAD_BYTES = 200 * 1024 * 1024;
const MAX_UNPACKED_BYTES = 600 * 1024 * 1024;
const MAX_REDIRECTS = 4;

// ─── Account (Admin → System → GeoIP) ─────────────────

export interface MaxmindConfig {
  accountId: string;
  licenseKey: string;
}

interface StoredMaxmind {
  accountId: string;
  licenseKey: string; // sealed
}

interface UpdateState {
  lastAttemptAt?: number;
  lastSuccessAt?: number;
  /** German text, shown in the admin UI (translated there) */
  lastError?: string;
}

export async function getMaxmindConfig(): Promise<MaxmindConfig | null> {
  const stored = await readSetting<StoredMaxmind>("geoip");
  const licenseKey = openSecret(stored?.licenseKey);
  if (!stored?.accountId || !licenseKey) return null;
  return { accountId: stored.accountId, licenseKey };
}

/** Empty license key = keep the stored one. */
export async function saveMaxmindConfig(input: { accountId: string; licenseKey?: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const accountId = input.accountId.trim();
  if (!/^\d{1,12}$/.test(accountId)) return { ok: false, error: "Die Account-ID besteht nur aus Ziffern" };
  const existing = await getMaxmindConfig();
  const licenseKey = input.licenseKey?.trim() || existing?.licenseKey;
  if (!licenseKey) return { ok: false, error: "Lizenzschlüssel fehlt" };
  if (!/^[A-Za-z0-9_]{10,80}$/.test(licenseKey)) return { ok: false, error: "Der Lizenzschlüssel ist ungültig" };
  await writeSetting("geoip", { accountId, licenseKey: sealSecret(licenseKey) } satisfies StoredMaxmind);
  return { ok: true };
}

/** Removes the account and the downloaded database. */
export async function clearMaxmindConfig(): Promise<void> {
  await Promise.all([deleteSetting("geoip"), deleteSetting("geoip-state")]);
  rmSync(path.join(geoipDir(), GEOIP_FILE), { force: true });
  resetGeoipReader();
}

// ─── Status ───────────────────────────────────────────

let running: Promise<DownloadResult> | null = null;

export async function getGeoipStatus() {
  const [stored, state, database] = await Promise.all([readSetting<StoredMaxmind>("geoip"), readSetting<UpdateState>("geoip-state"), describeGeoipDatabase()]);
  return {
    configured: !!stored?.accountId && !!openSecret(stored.licenseKey),
    accountId: stored?.accountId ?? "",
    database: {
      present: database.present,
      type: database.type,
      builtAt: database.builtAt?.toISOString() ?? null,
      fileUpdatedAt: database.fileUpdatedAt?.toISOString() ?? null,
    },
    updating: running !== null,
    lastAttemptAt: state?.lastAttemptAt ? new Date(state.lastAttemptAt).toISOString() : null,
    lastSuccessAt: state?.lastSuccessAt ? new Date(state.lastSuccessAt).toISOString() : null,
    lastError: state?.lastError ?? null,
  };
}

// ─── Download ─────────────────────────────────────────

export type DownloadResult = { ok: true; builtAt: Date } | { ok: false; error: string };

class DownloadError extends Error {}

/**
 * GET with the account as Basic auth. MaxMind answers with a redirect to a signed storage URL; the credentials only go
 * to download.maxmind.com, every further hop is followed without them (and only over https).
 */
async function fetchArchive(config: MaxmindConfig): Promise<Buffer> {
  let url = DOWNLOAD_URL;
  let headers: Record<string, string> = { Authorization: `Basic ${Buffer.from(`${config.accountId}:${config.licenseKey}`).toString("base64")}` };

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let res: Response;
    try {
      res = await fetch(url, { headers, redirect: "manual", signal: AbortSignal.timeout(180_000) });
    } catch {
      throw new DownloadError(N_("MaxMind ist nicht erreichbar"));
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) throw new DownloadError(N_("MaxMind hat eine ungültige Weiterleitung geschickt"));
      const next = new URL(location, url);
      if (next.protocol !== "https:") throw new DownloadError(N_("MaxMind hat eine unsichere Weiterleitung geschickt"));
      url = next.toString();
      headers = {}; // never send the account on to another host
      continue;
    }

    if (res.status === 401) throw new DownloadError(N_("MaxMind hat die Zugangsdaten abgelehnt. Bitte Account-ID und Lizenzschlüssel prüfen"));
    if (res.status === 403) throw new DownloadError(N_("MaxMind verweigert den Download. Bitte prüfen, ob die GeoLite2-Lizenz im MaxMind-Konto akzeptiert ist"));
    if (res.status === 429) throw new DownloadError(N_("Das Download-Limit bei MaxMind ist erreicht. Bitte später erneut versuchen"));
    if (!res.ok) throw new DownloadError(N_(`MaxMind antwortete mit Status ${res.status}`));

    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > MAX_DOWNLOAD_BYTES) throw new DownloadError(N_("Die Datenbank von MaxMind ist unerwartet groß"));
    const body = Buffer.from(await res.arrayBuffer());
    if (body.length > MAX_DOWNLOAD_BYTES) throw new DownloadError(N_("Die Datenbank von MaxMind ist unerwartet groß"));
    return body;
  }
  throw new DownloadError(N_("MaxMind hat zu viele Weiterleitungen geschickt"));
}

/** The .mmdb file inside the tar archive of a MaxMind download (null when there is none). */
export function extractMmdb(tar: Buffer): Buffer | null {
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) return null; // end of archive
    const name = header.toString("utf8", 0, 100).split("\0")[0];
    const size = parseInt(header.toString("ascii", 124, 136).split("\0")[0].trim() || "0", 8);
    if (!Number.isFinite(size) || size < 0) return null;
    const type = String.fromCharCode(header[156] || 48);
    const start = offset + 512;
    if ((type === "0" || type === "\0") && name.endsWith(".mmdb")) {
      if (start + size > tar.length) return null;
      return tar.subarray(start, start + size);
    }
    offset = start + Math.ceil(size / 512) * 512;
  }
  return null;
}

async function recordState(patch: UpdateState): Promise<void> {
  const current = (await readSetting<UpdateState>("geoip-state")) ?? {};
  await writeSetting("geoip-state", { ...current, ...patch });
}

async function runDownload(): Promise<DownloadResult> {
  const config = await getMaxmindConfig();
  if (!config) return { ok: false, error: "MaxMind ist nicht eingerichtet" };

  const attemptAt = Date.now();
  try {
    const archive = await fetchArchive(config);
    const mmdb = extractMmdb(gunzipSync(archive, { maxOutputLength: MAX_UNPACKED_BYTES }));
    if (!mmdb) throw new DownloadError(N_("Im Download von MaxMind war keine Datenbank enthalten"));

    const dir = geoipDir();
    mkdirSync(dir, { recursive: true });
    const target = path.join(dir, GEOIP_FILE);
    const temp = path.join(dir, `${GEOIP_FILE}.download-${process.pid}`);
    try {
      writeFileSync(temp, mmdb);
      // Only a file the reader accepts replaces the working one
      const reader = await open(temp);
      if (!/City/i.test(reader.metadata.databaseType)) throw new DownloadError(N_("Die heruntergeladene Datei ist keine GeoLite2-City-Datenbank"));
      renameSync(temp, target);
      resetGeoipReader();
      await recordState({ lastAttemptAt: attemptAt, lastSuccessAt: Date.now(), lastError: undefined });
      return { ok: true, builtAt: reader.metadata.buildEpoch };
    } finally {
      rmSync(temp, { force: true });
    }
  } catch (e) {
    const error = e instanceof DownloadError ? e.message : N_("Die Datenbank konnte nicht gespeichert werden");
    if (!(e instanceof DownloadError)) console.error("[GEOIP] Aktualisierung fehlgeschlagen:", e instanceof Error ? e.name : "Fehler");
    await recordState({ lastAttemptAt: attemptAt, lastError: error }).catch(() => {});
    return { ok: false, error };
  }
}

/** Downloads the current database now. Parallel calls share one download. */
export function downloadGeoipDatabase(): Promise<DownloadResult> {
  if (!running) {
    running = runDownload().finally(() => {
      running = null;
    });
  }
  return running;
}

/**
 * Called from lookups (at most once a minute): downloads when an account is set up and the file is missing or old.
 * After a failure the next attempt waits a few hours, so a wrong key doesn't hammer MaxMind.
 */
export async function refreshIfStale(): Promise<void> {
  if (running) return;
  const config = await getMaxmindConfig();
  if (!config) return;

  const target = path.join(geoipDir(), GEOIP_FILE);
  let ageMs = Infinity;
  try {
    ageMs = Date.now() - statSync(target).mtimeMs;
  } catch {
    // no file yet
  }
  if (ageMs < STALE_AFTER_MS) return;

  const state = await readSetting<UpdateState>("geoip-state");
  const wait = state?.lastError ? RETRY_AFTER_ERROR_MS : RETRY_AFTER_OK_MS;
  if (state?.lastAttemptAt && Date.now() - state.lastAttemptAt < wait) return;

  await downloadGeoipDatabase();
}
