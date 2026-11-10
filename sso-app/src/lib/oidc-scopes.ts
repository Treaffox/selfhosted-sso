/**
 * OIDC scopes. Pure helpers (no server imports): also used by the admin page.
 *
 * `openid` is always granted; `profile` (username, picture) and `email` add claims to the ID token and /oauth/userinfo.
 * Per app the admin chooses which of them the app may receive (`App.allowedScopes`); what the app asks for beyond that
 * is dropped, never granted, and the token response's `scope` tells the app what it actually got (RFC 6749 §3.3).
 */
export const SUPPORTED_SCOPES = ["openid", "profile", "email"] as const;

/** The scopes an admin can switch per app (`openid` can't be switched off). */
export const OPTIONAL_SCOPES = ["profile", "email"] as const;

/** Reads `App.allowedScopes` (JSON array). Empty = default (all supported); unreadable = only `openid`, so a damaged value never widens access. */
export function parseAllowedScopes(raw: string | null | undefined): string[] {
  if (!raw) return [...SUPPORTED_SCOPES];
  try {
    const value: unknown = JSON.parse(raw);
    if (Array.isArray(value)) return SUPPORTED_SCOPES.filter((s) => s === "openid" || value.includes(s));
  } catch {
    // falls through
  }
  return ["openid"];
}

/** Validates the admin's choice: an array of supported scopes; `openid` is added if missing. Null if anything else is in it. */
export function normalizeAllowedScopes(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  if (!value.every((s) => typeof s === "string" && (SUPPORTED_SCOPES as readonly string[]).includes(s))) return null;
  return SUPPORTED_SCOPES.filter((s) => s === "openid" || value.includes(s));
}

/** The scopes an app receives: what it asked for, limited to what it may have. Unknown scopes are ignored (OIDC Core §3.1.2.1). */
export function grantedScopes(requested: string[], allowed: string[]): string[] {
  return SUPPORTED_SCOPES.filter((s) => s === "openid" || (requested.includes(s) && allowed.includes(s)));
}
