import { sha256 } from "./crypto";

/**
 * Session and trusted-device tokens are stored as SHA-256 hashes ("h1:<hex>"), so a database leak
 * doesn't hand out usable cookies. The cookie keeps the raw token.
 *
 * Rows written before this change hold the raw 64-hex token; they are still found (and migrated to the
 * hashed form on first use). A presented value starting with "h1:" never matches a raw row, so a leaked
 * hash can't be replayed as a cookie.
 */
const PREFIX = "h1:";
const RAW_SHAPE = /^[0-9a-f]{64}$/;

export function storedToken(raw: string): string {
  return `${PREFIX}${sha256(raw)}`;
}

/** Column values that may hold this cookie value (hashed form first, legacy raw form second). */
export function tokenLookupKeys(raw: string): string[] {
  const keys = [storedToken(raw)];
  if (RAW_SHAPE.test(raw)) keys.push(raw);
  return keys;
}
