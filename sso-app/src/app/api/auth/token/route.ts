import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { exchangeAuthCode, hashAppToken } from "@/lib/auth";
import { rateLimitApi } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/ip";
import { logAudit } from "@/lib/audit";
import { N_ } from "@/lib/i18n/core";

/**
 * Token exchange endpoint.
 *
 * Client apps exchange an authorization code + app token for user info.
 * This is a server-to-server call.
 *
 * POST /api/auth/token
 * Body: { code: string, app_token: string }
 * Returns: { user_id, username, permission }
 */
export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const rl = rateLimitApi(ip);
  if (!rl.allowed) {
    await logAudit("RATE_LIMITED", { scope: "app-token", retryAfterSec: Math.ceil((rl.resetAt - Date.now()) / 1000) }, undefined, ip, { outcome: "DENIED", useSession: false });
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  try {
    const body = await request.json();
    const { code, app_token } = body;

    if (!code || !app_token) {
      return NextResponse.json(
        { error: "Missing code or app_token" },
        { status: 400 }
      );
    }

    const tokenHash = hashAppToken(app_token);
    const result = await exchangeAuthCode(code, tokenHash);

    if (!result) {
      await logAudit("APP_TOKEN_EXCHANGE_FAILED", { reason: N_("ungültiger oder abgelaufener Code bzw. falscher App-Token") }, undefined, ip, { outcome: "FAILURE", useSession: false });
      return NextResponse.json(
        { error: "Invalid or expired code" },
        { status: 401 }
      );
    }

    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
