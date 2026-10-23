/**
 * Server configuration that comes from the environment (.env). Everything an admin can change at runtime
 * (name, logo, mail, Cloudflare, ...) lives in the database instead, see site-settings.ts and settings.ts.
 */

/** Public base URL of this SSO without a trailing slash, e.g. https://sso.example.com (env APP_URL). */
export function getAppUrl(): string {
  const raw = (process.env.APP_URL || "http://localhost:8122").trim().replace(/\/+$/, "");
  try {
    return new URL(raw).origin;
  } catch {
    throw new Error(`APP_URL is not a valid URL: ${raw}`);
  }
}

/** Cookies get the Secure flag as soon as the site is served over HTTPS. */
export function isHttpsDeployment(): boolean {
  return getAppUrl().startsWith("https://");
}

/** Cookie domain for sharing the session with sibling subdomains (env COOKIE_DOMAIN, e.g. ".example.com"). */
export function getCookieDomain(): string | undefined {
  return process.env.COOKIE_DOMAIN?.trim() || undefined;
}

/** WebAuthn relying party id: the host name of APP_URL unless WEBAUTHN_RP_ID widens it to a parent domain. */
export function getRpId(): string {
  return process.env.WEBAUTHN_RP_ID?.trim() || new URL(getAppUrl()).hostname;
}

/** Origin the browser reports for WebAuthn ceremonies. */
export function getWebAuthnOrigin(): string {
  return new URL(getAppUrl()).origin;
}

/**
 * Cookie names. Without a shared COOKIE_DOMAIN on HTTPS the cookies get the "__Host-" prefix: the browser then
 * guarantees they were set by exactly this host (no subdomain can plant or overwrite them) and they can never
 * clash with a cookie of the same name that another SSO on a parent domain shares with all its subdomains.
 */
function cookiePrefix(): string {
  return isHttpsDeployment() && !getCookieDomain() ? "__Host-" : "";
}
export const sessionCookieName = () => `${cookiePrefix()}sso_session`;
export const trustedDeviceCookieName = () => `${cookiePrefix()}sso_trusted`;
