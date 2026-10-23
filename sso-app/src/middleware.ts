import { NextResponse, type NextRequest } from "next/server";
import { sessionCookieName } from "./lib/config";

const PUBLIC_PATHS = [
  "/documentation",
  "/auth/login",
  "/api/auth/login",
  "/api/auth/verify",
  "/api/auth/token",
  "/api/auth/passkey/authenticate",
  "/api/auth/passkey/authenticate/options",
  "/api/auth/email-code/send",
  "/api/avatar/",
  "/api/branding",
  // OIDC endpoints (must handle auth internally)
  "/oauth/authorize",
  "/oauth/token",
  "/oauth/userinfo",
  "/.well-known/openid-configuration",
  "/.well-known/jwks.json",
];

/** Pages that need a signed-in user; the middleware sends everyone else to the sign-in page. */
const PROTECTED_PAGES = ["/admin", "/settings"];

/** Server-to-server / token endpoints: called without the browser session cookie, so no CSRF concern. */
const CSRF_EXEMPT = ["/oauth/token", "/api/auth/token", "/oauth/userinfo"];

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Path equals the entry or lies below it (so "/api/auth/login" doesn't also match "/api/auth/login-x"). */
function matchesPath(entry: string, pathname: string): boolean {
  if (pathname === entry) return true;
  return pathname.startsWith(entry.endsWith("/") ? entry : `${entry}/`);
}

/**
 * State-changing request that did not come from this site's own pages.
 * SameSite=Lax doesn't help here: the session cookie is shared with every *.example.com subdomain, which all count as
 * "same-site". Browsers tell us where a request really comes from (Sec-Fetch-Site / Origin).
 */
function isForeignWrite(request: NextRequest): boolean {
  if (SAFE_METHODS.has(request.method)) return false;

  const site = request.headers.get("sec-fetch-site");
  if (site) return site !== "same-origin" && site !== "none";

  const origin = request.headers.get("origin");
  if (origin) {
    const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
    try {
      return new URL(origin).host !== host;
    } catch {
      return true;
    }
  }
  return false; // non-browser client (no cookies attached automatically)
}

/** GET /api/auth/logout may only be a navigation, never an embedded request (img, fetch, iframe) from elsewhere. */
function isForeignLogoutEmbed(request: NextRequest): boolean {
  if (request.method !== "GET") return false;
  const site = request.headers.get("sec-fetch-site");
  if (!site || site === "same-origin" || site === "none") return false;
  return request.headers.get("sec-fetch-dest") !== "document";
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Hand path + method to route handlers for the audit log (path only: query strings can carry codes/tokens).
  // Always overwritten, so a client can never spoof these headers.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-audit-path", pathname);
  requestHeaders.set("x-audit-method", request.method);
  const next = () => NextResponse.next({ request: { headers: requestHeaders } });

  // Cross-origin writes never reach a handler (login, settings, admin – everything that changes state)
  if (!CSRF_EXEMPT.some((p) => matchesPath(p, pathname)) && isForeignWrite(request)) {
    return NextResponse.json({ error: "Ungültiger Ursprung der Anfrage" }, { status: 403 });
  }
  if (pathname === "/api/auth/logout" && isForeignLogoutEmbed(request)) {
    return NextResponse.json({ error: "Ungültiger Ursprung der Anfrage" }, { status: 403 });
  }

  // Public paths – always accessible
  if (
    pathname === "/" ||
    PUBLIC_PATHS.some((p) => matchesPath(p, pathname)) ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon")
  ) {
    return next();
  }

  // Pages outside the signed-in areas are either unknown (→ the 404 page) or handle access themselves
  if (!pathname.startsWith("/api/") && !PROTECTED_PAGES.some((p) => matchesPath(p, pathname))) {
    return next();
  }

  // Check session cookie
  const sessionToken = request.cookies.get(sessionCookieName())?.value;
  if (!sessionToken) {
    // API routes return 401
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Nicht authentifiziert" }, { status: 401 });
    }
    // Pages redirect to login
    const loginUrl = new URL("/auth/login", request.url);
    loginUrl.searchParams.set("returnTo", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Note: the actual session validation (expiry, user role) happens in the
  // API route / page handler because we can't do async DB calls in Edge middleware.
  // The middleware only ensures the cookie exists for protected routes.

  return next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
