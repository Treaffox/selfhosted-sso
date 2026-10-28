import crypto from "crypto";
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { sha256 } from "@/lib/crypto";
import { finishDeviceLogin } from "@/lib/device-login";
import { rateLimitApi } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/ip";
import { logAudit } from "@/lib/audit";

/** An approved request can still be picked up this long after its expiry (approval happened in time). */
const PICKUP_GRACE_MS = 60 * 1000;

/**
 * POST: the waiting device asks whether its request was approved.
 * Body: { requestId, pollSecret }
 * Answers { status: "pending" | "expired" | "denied" }, or – once approved – the login ending ({ success, redirect }).
 */
export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const userAgent = request.headers.get("user-agent") ?? undefined;

  const rl = rateLimitApi(ip);
  if (!rl.allowed) return NextResponse.json({ error: "Zu viele Anfragen" }, { status: 429 });

  const body = await request.json().catch(() => null);
  const requestId = typeof body?.requestId === "string" ? body.requestId.slice(0, 64) : "";
  const pollSecret = typeof body?.pollSecret === "string" ? body.pollSecret.slice(0, 128) : "";
  if (!requestId || !pollSecret) return NextResponse.json({ status: "expired" }, { status: 404 });

  const r = await db.deviceLoginRequest.findUnique({ where: { id: requestId } });
  const given = Buffer.from(sha256(pollSecret));
  const stored = Buffer.from(r?.pollHash ?? "0".repeat(64));
  if (!r || given.length !== stored.length || !crypto.timingSafeEqual(given, stored)) {
    return NextResponse.json({ status: "expired" }, { status: 404 });
  }

  const now = Date.now();

  if (r.status === "PENDING") {
    if (r.expiresAt.getTime() > now) {
      return NextResponse.json({ status: "pending", expiresAt: r.expiresAt.toISOString() });
    }
    const expired = await db.deviceLoginRequest.updateMany({ where: { id: r.id, status: "PENDING" }, data: { status: "EXPIRED" } });
    if (expired.count === 1 && r.userId) {
      await logAudit("DEVICE_LOGIN_EXPIRED", { kind: r.kind }, r.userId, ip, { outcome: "FAILURE", useSession: false });
    }
    return NextResponse.json({ status: "expired" });
  }

  if (r.status === "APPROVED") {
    if (r.expiresAt.getTime() + PICKUP_GRACE_MS < now) return NextResponse.json({ status: "expired" });
    return finishDeviceLogin(r, ip, userAgent);
  }

  if (r.status === "DENIED") {
    await db.deviceLoginRequest.delete({ where: { id: r.id } }).catch(() => {});
    return NextResponse.json({ status: "denied" });
  }

  return NextResponse.json({ status: "expired" });
}
