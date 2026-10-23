import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import { verifyEmailCode, logAudit } from "@/lib/auth";
import { decrypt } from "@/lib/crypto";
import { totpCodeSchema } from "@/lib/validation";
import { getClientIp } from "@/lib/ip";
import { rateLimitEmailVerify, resetRateLimit } from "@/lib/rate-limit";
import { pendingEmailToken } from "@/lib/pending";

/**
 * POST: Confirm a pending e-mail change with the code sent to the NEW address.
 * Only now does the address replace the active one (see PATCH /api/settings/profile).
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Nicht authentifiziert" }, { status: 401 });
  }
  const userId = session.user.id;

  const rl = rateLimitEmailVerify(userId);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Zu viele Versuche. Bitte warte kurz.", retryAfter: Math.ceil((rl.resetAt - Date.now()) / 1000) },
      { status: 429 }
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = totpCodeSchema.safeParse(body?.code);
  if (!parsed.success) {
    return NextResponse.json({ error: "Der Code hat 6 Ziffern" }, { status: 400 });
  }

  const token = pendingEmailToken(userId);
  const pending = await db.loginSession.findUnique({ where: { token } });
  if (!pending?.challenge || pending.userId !== userId || pending.expiresAt < new Date()) {
    return NextResponse.json({ error: "Keine ausstehende Änderung. Bitte fordere die E-Mail-Änderung erneut an." }, { status: 400 });
  }

  if (!(await verifyEmailCode(userId, parsed.data, "EMAIL_CHANGE"))) {
    return NextResponse.json({ error: "Ungültiger oder abgelaufener Code" }, { status: 401 });
  }

  let newEmail: string;
  try {
    newEmail = decrypt(pending.challenge);
  } catch {
    await db.loginSession.deleteMany({ where: { token } });
    return NextResponse.json({ error: "Die ausstehende Änderung ist ungültig. Bitte erneut anfordern." }, { status: 400 });
  }

  await db.user.update({ where: { id: userId }, data: { email: newEmail } });
  await db.loginSession.deleteMany({ where: { token } });
  resetRateLimit(`emailverify:${userId}`);

  await logAudit("EMAIL_CHANGED", {}, userId, getClientIp(request));

  return NextResponse.json({ success: true, email: newEmail });
}
