/**
 * Redirect target validation. Pure (no DB / Node APIs), so it can be used on the server and in client components.
 */

/**
 * Post-login `returnTo` on the SSO itself: only same-origin targets.
 * Accepts a relative path ("/settings") or an absolute URL on one of `allowedOrigins`; everything else
 * (other hosts, `javascript:`, `//evil.com`, backslash tricks) is rejected.
 */
export function safeReturnTo(value: string | null | undefined, allowedOrigins: string[] = []): string | null {
  if (!value || value.length > 2048) return null;
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return null;

  if (value.startsWith("/")) {
    // "//host" and "/\host" are protocol-relative → external
    return value.startsWith("//") ? null : value;
  }

  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (!allowedOrigins.includes(url.origin)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * `redirect_uri` of the legacy app flow against the URIs registered for the app.
 *  - exact match, or
 *  - the registered entry is origin-only (path "/" or empty, no query): any path on that origin is allowed.
 *    This is what nginx auth_request apps need (they send the page the user came from).
 * Only https (plus http for loopback) and explicitly registered custom schemes ever match.
 */
export function isAllowedRedirectUri(registered: string[], candidate: string | null | undefined): boolean {
  if (!candidate || candidate.length > 2048) return false;
  if (/[\u0000-\u001f\u007f\\]/.test(candidate)) return false;

  let cand: URL;
  try {
    cand = new URL(candidate);
  } catch {
    return false;
  }

  for (const entry of registered) {
    if (entry === candidate) return true;

    let reg: URL;
    try {
      reg = new URL(entry);
    } catch {
      continue;
    }
    const originOnly = (reg.protocol === "https:" || reg.protocol === "http:") && (reg.pathname === "/" || reg.pathname === "") && !reg.search && !reg.hash;
    if (originOnly && cand.origin === reg.origin && (cand.protocol === "https:" || cand.protocol === "http:")) {
      if (cand.username || cand.password) continue;
      return true;
    }
  }
  return false;
}

/** Schemes that must never be a redirect target. */
const FORBIDDEN_SCHEMES = new Set(["javascript:", "data:", "vbscript:", "file:", "blob:", "about:", "ftp:"]);

/** Validation for URIs an admin registers for an app. */
export function validateRegisteredRedirectUri(raw: string): string | null {
  if (!raw || raw.length > 2048 || /[\u0000-\u001f\u007f\\\s]/.test(raw)) return "Ungültige URL";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "Ungültige URL";
  }
  if (FORBIDDEN_SCHEMES.has(url.protocol)) return "Dieses URI-Schema ist nicht erlaubt";
  if (url.username || url.password) return "Zugangsdaten in der URL sind nicht erlaubt";
  if (url.hash) return "Redirect-URI darf kein Fragment enthalten";

  if (url.protocol === "https:") return null;
  if (url.protocol === "http:") {
    const host = url.hostname;
    if (host === "localhost" || host === "127.0.0.1" || host === "[::1]") return null;
    return "Redirect-URI muss HTTPS verwenden (außer localhost)";
  }
  // Custom scheme for native apps (e.g. com.example.app:/oauth2redirect)
  if (/^[a-z][a-z0-9+.-]*:$/.test(url.protocol)) return null;
  return "Ungültige URL";
}
