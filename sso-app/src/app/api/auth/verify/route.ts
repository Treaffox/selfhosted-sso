import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { validateSessionToken, getSessionTokenFromRequest } from "@/lib/session";
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
  // Get session token from cookie
  const sessionToken = getSessionTokenFromRequest(request);
  if (!sessionToken) {
    return new NextResponse(null, { status: 401 });
  }

  // Validate session
  const session = await validateSessionToken(sessionToken);
  if (!session) {
    return new NextResponse(null, { status: 401 });
  }

  // Accounts that still have to change a temporary password get no access to apps
  // (same rule the OAuth flows apply at login time)
  if (session.user.forcePasswordChange) {
    if (firstInWindow(`force:${session.user.id}`, DENIED_WINDOW_MS)) {
      await logAudit(
        "APP_ACCESS_DENIED",
        { reason: N_("Passwortänderung erforderlich"), path: (request.headers.get("x-original-uri") ?? "").split("?")[0].slice(0, 500) || undefined },
        session.user.id,
        getClientIp(request),
        { outcome: "DENIED", authVia: "EXISTING_SESSION" }
      );
    }
    return new NextResponse(null, { status: 403 });
  }

  // Resolve the app either via its secret token or its public id
  const appToken = request.headers.get("x-app-token");
  const appId = request.nextUrl.searchParams.get("app_id");

  if (!appToken && !appId) {
    return new NextResponse(null, { status: 400 });
  }

  const app = appToken
    ? await db.app.findUnique({
        where: { tokenHash: sha256(appToken) },
        select: { id: true, isActive: true, defaultPermission: true },
      })
    : await db.app.findUnique({
        where: { id: appId! },
        select: { id: true, isActive: true, defaultPermission: true },
      });

  // Prepare response headers
  const headers = new Headers();
  headers.set("X-User-Id", session.user.id);
  headers.set("X-Username", session.user.username);
  if (session.user.email) {
    headers.set("X-Email", session.user.email);
  }

  const avatarUrl = getAvatarUrl(session.user);
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
      session.user.id,
      ip,
      {
        appId: app?.id ?? appId ?? undefined,
        outcome: action === "APP_ACCESS" ? "SUCCESS" : "DENIED",
        authVia: "EXISTING_SESSION",
        requestPath: originalPath,
        requestMethod: request.headers.get("x-original-method") ?? undefined,
      }
    );

  if (!app || !app.isActive) {
    if (firstInWindow(`deny:${session.user.id}:${appId ?? "?"}`, DENIED_WINDOW_MS)) {
      await audit("APP_ACCESS_DENIED", app ? N_("App deaktiviert") : N_("App unbekannt"));
    }
    return new NextResponse(null, { status: 403, headers });
  }

  const permission = await db.userAppPermission.findUnique({
    where: {
      userId_appId: { userId: session.user.id, appId: app.id },
    },
    select: { permissionLevel: true },
  });

  const level = permission?.permissionLevel ?? app.defaultPermission;
  headers.set("X-Permission", level);

  // DENY → 403
  if (level === "DENY") {
    if (firstInWindow(`deny:${session.user.id}:${app.id}`, DENIED_WINDOW_MS)) {
      await audit("APP_ACCESS_DENIED", "Berechtigung DENY");
    }
    return new NextResponse(null, { status: 403, headers });
  }

  if (firstInWindow(`ok:${session.user.id}:${app.id}:${session.id}`, ACCESS_WINDOW_MS)) {
    await audit("APP_ACCESS");
  }

  return new NextResponse(null, { status: 200, headers });
}
