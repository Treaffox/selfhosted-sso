import { guestAccountForbidden, isGuestAccount } from "@/lib/guest-account";
import { passkeyRegistrationToken } from "@/lib/pending";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { verifyPasskeyRegistration, logAudit } from "@/lib/auth";
import { getClientIp } from "@/lib/ip";

/** POST: Verify passkey registration and store credential. */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Nicht authentifiziert" }, { status: 401 });
  }
  if (isGuestAccount(session.user)) return guestAccountForbidden();

  try {
    const body = await request.json().catch(() => null);
    const credential = body?.credential;
    const deviceName = typeof body?.deviceName === "string" ? body.deviceName.trim().slice(0, 64) : "";
    if (!credential || typeof credential !== "object") {
      return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
    }

    // Get stored challenge
    const challengeSession = await db.loginSession.findUnique({
      where: { token: passkeyRegistrationToken(session.user.id) },
    });

    if (!challengeSession?.challenge || challengeSession.expiresAt < new Date()) {
      return NextResponse.json({ error: "Keine Challenge gefunden" }, { status: 400 });
    }

    // The challenge is single-use
    const claimed = await db.loginSession.deleteMany({ where: { id: challengeSession.id } });
    if (claimed.count !== 1) {
      return NextResponse.json({ error: "Keine Challenge gefunden" }, { status: 400 });
    }

    const result = await verifyPasskeyRegistration(
      session.user.id,
      credential,
      challengeSession.challenge
    );

    if (!result.verified || !result.registrationInfo) {
      return NextResponse.json({ error: "Verifizierung fehlgeschlagen" }, { status: 400 });
    }

    const { credential: regCredential } = result.registrationInfo;

    // Store passkey
    await db.passkey.create({
      data: {
        userId: session.user.id,
        credentialId: regCredential.id,
        publicKey: Buffer.from(regCredential.publicKey).toString("base64url"),
        counter: regCredential.counter,
        transports: credential.response?.transports
          ? JSON.stringify(credential.response.transports)
          : null,
        deviceName: deviceName || "Passkey",
      },
    });

    await logAudit("PASSKEY_ADDED", { deviceName: deviceName || "Passkey" }, session.user.id, getClientIp(request));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[PASSKEY REG VERIFY]", error instanceof Error ? error.message : "unbekannter Fehler");
    return NextResponse.json({ error: "Fehler bei der Registrierung" }, { status: 500 });
  }
}
