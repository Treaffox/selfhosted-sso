import { effectivePermission } from "@/lib/guest-account";
import { needsMfaSetup } from "@/lib/mfa-policy";
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { validateSessionToken, getSessionTokenFromRequest, getGuestTokenFromRequest } from "@/lib/session";
import { validateGuestCookie } from "@/lib/guest-access";
import { sha256 } from "@/lib/crypto";
import { getAvatarUrl } from "@/lib/avatar";
import { logAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/ip";
import { N_ } from "@/lib/i18n/core";

// This endpoint runs on EVERY proxied request. Log "user accesses app" once per window,
// not once per request (in-memory, resets on restart – that's fine for dedupe).
const ACCESS_WINDOW_MS = 10 * 60 * 1000;
const DENIED_WINDOW_MS = 60 * 1000;
const recentAccess = new Map<string, number>();

function firstInWindow(key: string, windowMs: number): boolean {
  const now = Date.now();
  const last = recentAccess.get(key);
  if (last !== undefined && now - last < windowMs) return false;
  if (recentAccess.size > 5000) {
    for (const [k, t] of recentAccess) if (now - t > ACCESS_WINDOW_MS) recentAccess.delete(k);
  }
  recentAccess.set(key, now);
  return true;
}

/**
 * nginx auth_request endpoint.
 *
 * nginx calls this to check if a request is authenticated.
 * Returns 200 with user info headers on success, 401/403 otherwise.
 *
 * Every caller must identify the app being protected via one of:
 *   X-App-Token header: the app's secret token
 *   ?app_id= query param: the app's public id (as used by nginx.conf.example)
 * A request without either is rejected (400) rather than treated as an
 * auth-only check — an nginx config that forgets to forward the app
 * identity must fail loudly, not silently grant access to any SSO user.
 */
export async function GET(request: NextRequest) {
  const sessionToken = getSessionTokenFromRequest(request);
  const session = sessionToken ? await validateSessionToken(sessionToken) : null;
  const guestToken = session ? null : getGuestTokenFromRequest(request);
  if (!session && !guestToken) {
    return new NextResponse(null, { status: 401 });
  }

  // Resolve the app either via its secret token or its public id
  const appToken = request.headers.get("x-app-token");
  const appId = request.nextUrl.searchParams.get("app_id");

  const loadApp = () => {
    const select = { id: true, isActive: true, defaultPermission: true } as const;
    return appToken
      ? db.app.findUnique({ where: { tokenHash: sha256(appToken) }, select })
      : db.app.findUnique({ where: { id: appId! }, select });
  };

  // Who is asking: a real SSO session, or a guest whose access is bound to exactly this app.
  // A guest cookie that doesn't fit this app (or ran out) counts as "not signed in", so the visitor can log in normally.
  let user: { id: string; username: string; email: string | null; avatarUpdatedAt: Date | null; forcePasswordChange: boolean; expiresAt?: Date | null };
  let subject: string; // identifies the session/grant for the access log window
  let guestUntil: Date | null = null;
  let app: Awaited<ReturnType<typeof loadApp>> | undefined;

  if (session) {
    user = session.user;
    subject = session.id;
  } else {
    if (!appToken && !appId) return new NextResponse(null, { status: 400 });
    app = await loadApp();
    const grant = app?.isActive ? await validateGuestCookie(guestToken!, app.id) : null;
    if (!grant) return new NextResponse(null, { status: 401 });
    user = grant.user;
    subject = grant.id;
    guestUntil = grant.expiresAt;
  }
  const authVia = session ? "EXISTING_SESSION" : "GUEST";

  // Accounts that still have to change a temporary password get no access to apps
  // (same rule the OAuth flows apply at login time)
  if (user.forcePasswordChange) {
    if (firstInWindow(`force:${user.id}`, DENIED_WINDOW_MS)) {
      await logAudit(
        "APP_ACCESS_DENIED",
        { reason: N_("Passwortänderung erforderlich"), path: (request.headers.get("x-original-uri") ?? "").split("?")[0].slice(0, 500) || undefined },
        user.id,
        getClientIp(request),
        { outcome: "DENIED", authVia }
      );
    }
    return new NextResponse(null, { status: 403 });
  }

  // Password-only accounts have to set up a second factor first (guests are bound to a grant the owner approved)
  if (session && (await needsMfaSetup(session.user))) {
    if (firstInWindow(`mfa:${user.id}`, DENIED_WINDOW_MS)) {
      await logAudit(
        "APP_ACCESS_DENIED",
        { reason: N_("Zweiter Faktor erforderlich"), path: (request.headers.get("x-original-uri") ?? "").split("?")[0].slice(0, 500) || undefined },
        user.id,
        getClientIp(request),
        { outcome: "DENIED", authVia }
      );
    }
    return new NextResponse(null, { status: 403 });
  }

  if (!appToken && !appId) {
    return new NextResponse(null, { status: 400 });
  }
  if (app === undefined) app = await loadApp();

  // Prepare response headers
  const headers = new Headers();
  headers.set("X-User-Id", user.id);
  headers.set("X-Username", user.username);
  if (user.email) {
    headers.set("X-Email", user.email);
  }
  // Guest access: the app may want to treat it differently and should end its own session no later than this
  if (guestUntil) {
    headers.set("X-Guest", "1");
    headers.set("X-Guest-Expires", guestUntil.toISOString());
  }

  const avatarUrl = getAvatarUrl(user);
  if (avatarUrl) headers.set("X-Avatar-Url", avatarUrl);

  // Original request as seen by nginx (only if the proxy config forwards it – path only, no query string)
  const originalPath = (request.headers.get("x-original-uri") ?? "").split("?")[0].slice(0, 500) || undefined;
  const originalHost = request.headers.get("x-original-host") ?? undefined;
  const accessPath = originalPath ? `${originalHost ?? ""}${originalPath}` : undefined;
  const ip = getClientIp(request);
  const audit = (action: "APP_ACCESS" | "APP_ACCESS_DENIED", reason?: string) =>
    logAudit(
      action,
      { path: accessPath, reason, host: originalHost },
      user.id,
      ip,
      {
        appId: app?.id ?? appId ?? undefined,
        outcome: action === "APP_ACCESS" ? "SUCCESS" : "DENIED",
        authVia,
        requestPath: originalPath,
        requestMethod: request.headers.get("x-original-method") ?? undefined,
      }
    );

  if (!app || !app.isActive) {
    if (firstInWindow(`deny:${user.id}:${appId ?? "?"}`, DENIED_WINDOW_MS)) {
      await audit("APP_ACCESS_DENIED", app ? N_("App deaktiviert") : N_("App unbekannt"));
    }
    return new NextResponse(null, { status: 403, headers });
  }

  const permission = await db.userAppPermission.findUnique({
    where: {
      userId_appId: { userId: user.id, appId: app.id },
    },
    select: { permissionLevel: true },
  });

  const level = effectivePermission(permission?.permissionLevel, app.defaultPermission, user);
  headers.set("X-Permission", level);

  // DENY → 403
  if (level === "DENY") {
    if (firstInWindow(`deny:${user.id}:${app.id}`, DENIED_WINDOW_MS)) {
      await audit("APP_ACCESS_DENIED", "Berechtigung DENY");
    }
    return new NextResponse(null, { status: 403, headers });
  }

  if (firstInWindow(`ok:${user.id}:${app.id}:${subject}`, ACCESS_WINDOW_MS)) {
    await audit("APP_ACCESS");
  }

  return new NextResponse(null, { status: 200, headers });
}
