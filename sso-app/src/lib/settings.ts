import { db } from "./db";
import { decrypt, encrypt } from "./crypto";

/**
 * Admin-managed settings (table SystemSetting). One row per area ("site", "mail", "cloudflare") holding JSON.
 * Secrets inside (API keys, passwords) are sealed with lib/crypto.ts and never leave the server in plain text.
 */

const TTL_MS = 5_000;

type Cache = { at: number; rows: Map<string, string> };
const g = globalThis as unknown as { __settingsCache?: Cache | null };

async function loadRows(): Promise<Map<string, string>> {
  const cached = g.__settingsCache;
  if (cached && Date.now() - cached.at < TTL_MS) return cached.rows;
  const rows = new Map((await db.systemSetting.findMany()).map((r) => [r.key, r.value]));
  g.__settingsCache = { at: Date.now(), rows };
  return rows;
}

export function invalidateSettingsCache(): void {
  g.__settingsCache = null;
}

export async function readSetting<T>(key: string): Promise<T | null> {
  const raw = (await loadRows()).get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function writeSetting(key: string, value: unknown): Promise<void> {
  const json = JSON.stringify(value);
  await db.systemSetting.upsert({ where: { key }, create: { key, value: json }, update: { value: json } });
  invalidateSettingsCache();
}

export async function deleteSetting(key: string): Promise<void> {
  await db.systemSetting.deleteMany({ where: { key } });
  invalidateSettingsCache();
}

// ─── Secrets ──────────────────────────────────────────

const SEALED = "sec:";

export function sealSecret(plain: string): string {
  return SEALED + encrypt(plain);
}

/** Plain text of a sealed value, or undefined when it is empty or can't be decrypted (ENCRYPTION_KEY changed). */
export function openSecret(sealed: string | undefined | null): string | undefined {
  if (!sealed || !sealed.startsWith(SEALED)) return undefined;
  try {
    return decrypt(sealed.slice(SEALED.length));
  } catch {
    return undefined;
  }
}
