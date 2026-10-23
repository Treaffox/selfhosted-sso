import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { generateTotpSecret, encryptTotpSecret, getTotpUri } from "@/lib/auth";
import { db } from "@/lib/db";
import { getClientIp } from "@/lib/ip";
import { requireReauth } from "@/lib/reauth";
import { totpSetupToken } from "@/lib/pending";
import QRCode from "qrcode";

const TOTP_SETUP_TTL_MS = 10 * 60 * 1000;

/**
 * POST: Generate TOTP secret and QR code URI.
 *
 * The secret is only kept as a pending setup; an existing, active TOTP stays untouched until the user proves
 * possession of the new one (see /api/auth/totp/verify). Needs the current password.
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Nicht authentifiziert" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const reauth = await requireReauth(session.user.id, body?.currentPassword, "totp-setup", getClientIp(request));
  if (reauth) return reauth;

  const { secret } = generateTotpSecret();
  const uri = await getTotpUri(secret, session.user.username);

  // Generate QR code data URL
  const qrDataUrl = await QRCode.toDataURL(uri, {
    width: 256,
    margin: 2,
    color: { dark: "#000000", light: "#ffffff" },
  });

  // Keep the encrypted secret as pending setup (replaces an earlier unfinished one)
  const token = totpSetupToken(session.user.id);
  await db.loginSession.deleteMany({ where: { token } });
  await db.loginSession.create({
    data: {
      token,
      userId: session.user.id,
      step: "TOTP_SETUP",
      ipAddress: getClientIp(request),
      challenge: encryptTotpSecret(secret),
      expiresAt: new Date(Date.now() + TOTP_SETUP_TTL_MS),
    },
  });

  return NextResponse.json({ qrDataUrl, uri, secret });
}
