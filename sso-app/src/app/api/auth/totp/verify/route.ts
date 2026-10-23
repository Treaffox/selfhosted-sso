import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { verifyTotp, logAudit } from "@/lib/auth";
import { db } from "@/lib/db";
import { totpCodeSchema } from "@/lib/validation";
import { getClientIp } from "@/lib/ip";
import { checkRateLimit, resetRateLimit } from "@/lib/rate-limit";
import { totpSetupToken } from "@/lib/pending";

/** POST: Verify TOTP setup with a test code and activate it. */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Nicht authentifiziert" }, { status: 401 });
  }
  const userId = session.user.id;

  const rl = checkRateLimit(`totpsetup:${userId}`, 10, 15 * 60 * 1000);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Zu viele Versuche. Bitte warte kurz." }, { status: 429 });
  }

  const body = await request.json().catch(() => null);
  const parsed = totpCodeSchema.safeParse(body?.code);
  if (!parsed.success) {
    return NextResponse.json({ error: "Ungültiger Code" }, { status: 400 });
  }

  const pending = await db.loginSession.findUnique({ where: { token: totpSetupToken(userId) } });
  if (!pending?.challenge || pending.expiresAt < new Date()) {
    return NextResponse.json({ error: "Kein TOTP-Secret gefunden. Bitte zuerst einrichten." }, { status: 400 });
  }

  // `challenge` holds the encrypted pending secret
  if (!verifyTotp(parsed.data, pending.challenge)) {
    return NextResponse.json({ error: "Ungültiger Code" }, { status: 401 });
  }

  // Only now the new secret replaces the old one
  await db.user.update({
    where: { id: userId },
    data: { totpSecret: pending.challenge, totpVerified: true },
  });
  await db.loginSession.delete({ where: { id: pending.id } }).catch(() => {});
  resetRateLimit(`totpsetup:${userId}`);

  await logAudit("TOTP_ENABLED", {}, userId, getClientIp(request));

  return NextResponse.json({ success: true });
}
