import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { hashAppToken } from "@/lib/auth";
import { rateLimitApi } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/ip";
import { getAvatarUrl } from "@/lib/avatar";
import { effectivePermission } from "@/lib/guest-account";
import { logAudit } from "@/lib/audit";
import { N_ } from "@/lib/i18n/core";

/**
 * Accounts with access to the app (read-only, server-to-server).
 *
 * Lets an app list who may use it, e.g. to show people before they ever signed in there.
 * The app token is the authentication, no session cookie is involved.
 *
 * POST /api/auth/users
 * Body: { app_token: string }
 * Returns: { users: [{ user_id, username, permission, picture }] }
 *
 * Regular accounts whose effective level for this app is not DENY (explicit assignment, else the app's
 * default). Guest accounts are never listed. Anyone missing from the list has no access.
 */
export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const rl = rateLimitApi(ip);
  if (!rl.allowed) {
    await logAudit("RATE_LIMITED", { scope: "app-token", retryAfterSec: Math.ceil((rl.resetAt - Date.now()) / 1000) }, undefined, ip, { outcome: "DENIED", useSession: false });
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  try {
    const appToken = (body as { app_token?: unknown }).app_token;
    const app =
      typeof appToken === "string" && appToken
        ? await db.app.findUnique({ where: { tokenHash: hashAppToken(appToken) }, select: { id: true, name: true, isActive: true, defaultPermission: true } })
        : null;

    // Missing, unknown and disabled look the same from outside
    if (!app || !app.isActive) {
      await logAudit("APP_USERS_LIST_FAILED", { reason: N_("fehlender oder falscher App-Token bzw. App deaktiviert") }, undefined, ip, { outcome: "DENIED", useSession: false });
      return NextResponse.json({ error: "Invalid app token" }, { status: 401 });
    }

    const accounts = await db.user.findMany({
      where: { expiresAt: null },
      orderBy: { username: "asc" },
      select: {
        id: true,
        username: true,
        avatarUpdatedAt: true,
        expiresAt: true,
        permissions: { where: { appId: app.id }, select: { permissionLevel: true } },
      },
    });

    const users = accounts
      .map((u) => ({
        user_id: u.id,
        username: u.username,
        permission: effectivePermission(u.permissions[0]?.permissionLevel, app.defaultPermission, u),
        picture: getAvatarUrl(u),
      }))
      .filter((u) => u.permission !== "DENY");

    await logAudit("APP_USERS_LISTED", { count: users.length }, undefined, ip, { appId: app.id, appName: app.name, authVia: "APP_TOKEN", useSession: false });

    return NextResponse.json({ users });
  } catch {
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
