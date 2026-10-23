import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getLoginSession, createEmailCode } from "@/lib/auth";
import { rateLimitEmail, rateLimitLogin } from "@/lib/rate-limit";
import { sendVerificationCodeEmail } from "@/lib/email";
import { logAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/ip";

// Which code may be requested in which login step. A code can only be sent once the password has been verified
// (that is what moves the login session to MFA), never right after the bare username.
const TYPE_FOR_STEP: Record<string, "LOGIN_MFA"> = {
  MFA: "LOGIN_MFA",
};

/**
 * Send a verification code via email.
 *
 * POST /api/auth/email-code/send
 * Body: { loginToken: string }
 */
export async function POST(request: NextRequest) {
  try {
    const ip = getClientIp(request);
    const ipLimit = rateLimitLogin(ip);
    if (!ipLimit.allowed) {
      return NextResponse.json({ error: "Zu viele Anfragen. Bitte warte." }, { status: 429 });
    }

    const body = await request.json().catch(() => null);
    const loginToken = typeof body?.loginToken === "string" ? body.loginToken.slice(0, 128) : null;

    const loginSession = loginToken ? await getLoginSession(loginToken) : null;
    const type = loginSession ? TYPE_FOR_STEP[loginSession.step] : undefined;
    if (!loginSession?.userId || !type) {
      return NextResponse.json({ error: "Ungültige Sitzung" }, { status: 400 });
    }

    const rl = rateLimitEmail(loginSession.userId);
    if (!rl.allowed) {
      await logAudit("RATE_LIMITED", { scope: "email-code", retryAfterSec: Math.ceil((rl.resetAt - Date.now()) / 1000) }, loginSession.userId, undefined, { outcome: "DENIED", useSession: false });
      return NextResponse.json(
        { error: "Zu viele E-Mails. Bitte warte.", retryAfter: Math.ceil((rl.resetAt - Date.now()) / 1000) },
        { status: 429 }
      );
    }

    const user = await db.user.findUnique({
      where: { id: loginSession.userId },
      select: { email: true, username: true, locale: true },
    });

    if (!user?.email) {
      return NextResponse.json({ error: "Keine E-Mail-Adresse hinterlegt" }, { status: 400 });
    }

    const code = await createEmailCode(loginSession.userId, type);
    const sent = await sendVerificationCodeEmail(user.email, user.username, code, user.locale);

    if (!sent) {
      console.error("[MFA EMAIL] Versand fehlgeschlagen");
      return NextResponse.json({ error: "E-Mail konnte nicht gesendet werden" }, { status: 500 });
    }

    // Return masked email for display
    const [local, domain] = user.email.split("@");
    const masked = `${local.substring(0, 2)}***@${domain}`;

    return NextResponse.json({ success: true, email: masked });
  } catch (error) {
    console.error("[MFA EMAIL] Unerwarteter Fehler:", error instanceof Error ? error.message : "unbekannt");
    return NextResponse.json({ error: "Fehler" }, { status: 500 });
  }
}
