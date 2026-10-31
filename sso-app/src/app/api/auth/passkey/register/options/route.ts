import { guestAccountForbidden, isGuestAccount } from "@/lib/guest-account";
import { passkeyRegistrationToken } from "@/lib/pending";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { generatePasskeyRegistrationOptions } from "@/lib/auth";
import { getClientIp } from "@/lib/ip";
import { requireReauth } from "@/lib/reauth";

/** POST: Get registration options for adding a new passkey. Needs the current password. */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Nicht authentifiziert" }, { status: 401 });
  }
  if (isGuestAccount(session.user)) return guestAccountForbidden();

  const body = await request.json().catch(() => null);
  const reauth = await requireReauth(session.user.id, body?.currentPassword, "passkey-add", getClientIp(request));
  if (reauth) return reauth;

  try {
    const options = await generatePasskeyRegistrationOptions(
      session.user.id,
      session.user.username
    );

    // Store challenge temporarily (overwrite any existing). Only a request that passed the password
    // check above can create one, so /register/verify can't be used without it.
    const token = passkeyRegistrationToken(session.user.id);
    await db.loginSession.deleteMany({ where: { token } });
    await db.loginSession.create({
      data: {
        token,
        userId: session.user.id,
        step: "PASSKEY_REGISTER",
        ipAddress: getClientIp(request),
        challenge: options.challenge,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      },
    });

    return NextResponse.json(options);
  } catch (error) {
    console.error("[PASSKEY REG OPTIONS]", error instanceof Error ? error.message : "unbekannter Fehler");
    return NextResponse.json({ error: "Fehler" }, { status: 500 });
  }
}
