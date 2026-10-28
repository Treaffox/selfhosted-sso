import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { getClientIp } from "@/lib/ip";
import { logAudit } from "@/lib/audit";
import { sha256 } from "@/lib/crypto";

/** POST: the account owner rejects a request. Body: { id } (prompt) or { token } (QR link). */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Nicht authentifiziert" }, { status: 401 });
  const userId = session.user.id;

  const body = await request.json().catch(() => null);
  const where =
    typeof body?.id === "string" ? { id: body.id }
    : typeof body?.token === "string" && /^[0-9a-f]{64}$/.test(body.token) ? { tokenHash: sha256(body.token) }
    : null;
  if (!where) return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });

  const r = await db.deviceLoginRequest.findFirst({ where: { ...where, userId, status: "PENDING" } });
  if (!r) return NextResponse.json({ error: "Die Anfrage ist nicht mehr gültig" }, { status: 404 });

  await db.deviceLoginRequest.updateMany({ where: { id: r.id, status: "PENDING" }, data: { status: "DENIED" } });
  await logAudit("DEVICE_LOGIN_DENIED", { kind: r.kind }, userId, getClientIp(request), { outcome: "DENIED", appId: r.appId ?? undefined });
  return NextResponse.json({ success: true });
}
