import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  getLoginSession,
  verifyPasskeyAuthentication,
  recordFailedAttempt,
  logLogin,
} from "@/lib/auth";
import { getClientIp } from "@/lib/ip";
import { rateLimitLogin } from "@/lib/rate-limit";
import { completeLogin, guardCredentialAttempt } from "@/lib/login-flow";

/**
 * Verify passkey authentication response.
 *
 * POST /api/auth/passkey/authenticate/verify
 * Body: { loginToken: string, credential: AuthenticationResponseJSON }
 */
export async function POST(request: NextRequest) {
  try {
    const ip = getClientIp(request);
    const userAgent = request.headers.get("user-agent") ?? undefined;

    const rl = rateLimitLogin(ip);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Zu viele Anmeldeversuche. Bitte warte.", retryAfter: Math.ceil((rl.resetAt - Date.now()) / 1000) },
        { status: 429 }
      );
    }

    const body = await request.json().catch(() => null);
    const loginToken = typeof body?.loginToken === "string" ? body.loginToken.slice(0, 128) : null;
    const credential = body?.credential;
    if (!loginToken || !credential || typeof credential !== "object" || typeof credential.id !== "string") {
      return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
    }

    const loginSession = await getLoginSession(loginToken);
    if (!loginSession?.userId || !loginSession.challenge) {
      return NextResponse.json({ error: "Ungültige Sitzung" }, { status: 400 });
    }

    // The challenge is single-use: claim it atomically, so a (failed or successful) attempt can't be replayed
    const claimed = await db.loginSession.updateMany({
      where: { token: loginSession.token, challenge: loginSession.challenge },
      data: { challenge: null },
    });
    if (claimed.count !== 1) {
      return NextResponse.json({ error: "Ungültige Sitzung" }, { status: 400 });
    }

    const blocked = await guardCredentialAttempt(loginSession.userId, ip, userAgent);
    if (blocked) return blocked;

    const user = await db.user.findUnique({
      where: { id: loginSession.userId },
      select: { id: true, username: true, email: true, isMaster: true, forcePasswordChange: true, sessionDurationHours: true },
    });
    if (!user) {
      return NextResponse.json({ error: "Nutzer nicht gefunden" }, { status: 400 });
    }

    // The passkey must belong to the account that is being logged into
    const result = await verifyPasskeyAuthentication(credential, loginSession.challenge, credential.id, user.id);

    if (!result.ok) {
      await recordFailedAttempt(user.id);
      await logLogin(
        user.id,
        ip,
        userAgent,
        false,
        "PASSKEY",
        result.reason === "wrong_owner" ? "passkey_wrong_owner" : "passkey_verification_failed"
      );
      return NextResponse.json({ error: "Passkey-Verifizierung fehlgeschlagen" }, { status: 401 });
    }

    return await completeLogin(loginSession, user, ip, userAgent, "PASSKEY");
  } catch (error) {
    console.error("[PASSKEY AUTH VERIFY ERROR]", error instanceof Error ? error.message : "unbekannter Fehler");
    return NextResponse.json({ error: "Verifizierung fehlgeschlagen" }, { status: 500 });
  }
}
