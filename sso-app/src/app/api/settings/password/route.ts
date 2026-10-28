import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession, destroyOtherSessions, revokeTrustedDevices } from "@/lib/session";
import { hashPassword, logAudit } from "@/lib/auth";
import { passwordSchema } from "@/lib/validation";
import { getClientIp } from "@/lib/ip";
import { requireReauth } from "@/lib/reauth";
import { revokeGuestGrants } from "@/lib/guest-access";

/** POST: Change password. Ends all other sessions and trusted devices. */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Nicht authentifiziert" }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => null);
    const { currentPassword, newPassword } = body ?? {};
    const ip = getClientIp(request);

    // Validate new password
    const pResult = passwordSchema.safeParse(newPassword);
    if (!pResult.success) {
      return NextResponse.json({ error: pResult.error.issues[0].message }, { status: 400 });
    }

    // Verify current password (rate-limited per account)
    const reauth = await requireReauth(session.user.id, currentPassword, "password-change", ip);
    if (reauth) {
      // keep the old wording for the common case
      return reauth.status === 401 ? NextResponse.json({ error: "Aktuelles Passwort falsch" }, { status: 401 }) : reauth;
    }

    // Update password
    const newHash = await hashPassword(pResult.data);
    await db.user.update({
      where: { id: session.user.id },
      data: { passwordHash: newHash, forcePasswordChange: false },
    });

    // Whoever held the old password (or a stolen session) must not stay logged in
    await destroyOtherSessions(session.user.id, session.id);
    await revokeTrustedDevices(session.user.id);
    await revokeGuestGrants(session.user.id);

    await logAudit("PASSWORD_CHANGED", {}, session.user.id, ip);

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Fehler" }, { status: 500 });
  }
}
