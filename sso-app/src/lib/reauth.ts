import { NextResponse } from "next/server";
import { db } from "./db";
import { verifyPassword } from "./auth";
import { logAudit } from "./audit";
import { rateLimitReauth, resetReauth } from "./rate-limit";

/**
 * Step-up for sensitive account changes (MFA, passkeys, recovery codes, e-mail): a stolen or hijacked session
 * alone must not be enough to take an account over permanently, so the current password is required again.
 *
 * Returns an error response to send back, or null when the password was confirmed.
 */
export async function requireReauth(userId: string, password: unknown, scope: string, ip?: string): Promise<NextResponse | null> {
  if (typeof password !== "string" || password.length === 0 || password.length > 256) {
    return NextResponse.json({ error: "Bitte bestätige die Änderung mit deinem Passwort", code: "REAUTH_REQUIRED" }, { status: 401 });
  }

  const rl = rateLimitReauth(userId);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Zu viele Versuche. Bitte warte kurz.", retryAfter: Math.ceil((rl.resetAt - Date.now()) / 1000) },
      { status: 429 }
    );
  }

  const user = await db.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    await logAudit("REAUTH_FAILED", { scope }, userId, ip, { outcome: "FAILURE" });
    return NextResponse.json({ error: "Passwort falsch", code: "REAUTH_FAILED" }, { status: 401 });
  }

  resetReauth(userId);
  return null;
}
