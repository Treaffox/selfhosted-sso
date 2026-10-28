import { NextResponse, type NextRequest } from "next/server";
import { createDeviceLoginRequest } from "@/lib/device-login";
import { rateLimitDeviceRequest } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/ip";
import { logAudit } from "@/lib/audit";

/**
 * POST: the device that wants to sign in asks for an approval on another device.
 * Body: { loginToken, kind: "GUEST" | "DEVICE", returnTo? }
 * Returns the QR code, the 6-digit code and the secret this device polls with.
 */
export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const userAgent = request.headers.get("user-agent") ?? undefined;

  const rl = rateLimitDeviceRequest(ip);
  if (!rl.allowed) {
    const retryAfter = Math.ceil((rl.resetAt - Date.now()) / 1000);
    await logAudit("RATE_LIMITED", { scope: "device-login", retryAfterSec: retryAfter }, undefined, ip, { outcome: "DENIED", useSession: false });
    return NextResponse.json({ error: "Zu viele Anfragen. Bitte warte kurz.", retryAfter }, { status: 429 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
  }
  const { loginToken, kind, returnTo } = body as Record<string, unknown>;
  if (typeof loginToken !== "string" || loginToken.length > 128 || (kind !== "GUEST" && kind !== "DEVICE")) {
    return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
  }

  const result = await createDeviceLoginRequest({
    loginToken,
    kind,
    returnTo: typeof returnTo === "string" ? returnTo.slice(0, 2048) : undefined,
    ip,
    userAgent,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  return NextResponse.json({
    requestId: result.requestId,
    pollSecret: result.pollSecret,
    code: result.code,
    qrSvg: result.qrSvg,
    expiresInSec: Math.max(0, Math.floor((result.expiresAt.getTime() - Date.now()) / 1000)),
  });
}
