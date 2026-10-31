import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/ip";
import { guestAccountForbidden, isGuestAccount } from "@/lib/guest-account";

/**
 * PATCH: opt out of (or back into) guest access and sign-in on another device.
 * Body: { guestLoginEnabled?: boolean, deviceLoginEnabled?: boolean }
 */
export async function PATCH(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Nicht authentifiziert" }, { status: 401 });
  const user = session.user;
  if (isGuestAccount(user)) return guestAccountForbidden();

  const body = await request.json().catch(() => null);
  const data: { guestLoginEnabled?: boolean; deviceLoginEnabled?: boolean } = {};
  if (body?.guestLoginEnabled !== undefined) {
    if (typeof body.guestLoginEnabled !== "boolean") return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
    if (user.isMaster) return NextResponse.json({ error: "Für das Master-Konto nicht verfügbar" }, { status: 400 });
    data.guestLoginEnabled = body.guestLoginEnabled;
  }
  if (body?.deviceLoginEnabled !== undefined) {
    if (typeof body.deviceLoginEnabled !== "boolean") return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
    data.deviceLoginEnabled = body.deviceLoginEnabled;
  }
  if (Object.keys(data).length === 0) return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });

  await db.user.update({ where: { id: user.id }, data });

  // Switching a kind off also ends what is still waiting for it
  const switchedOff = [
    ...(data.guestLoginEnabled === false ? ["GUEST"] : []),
    ...(data.deviceLoginEnabled === false ? ["DEVICE"] : []),
  ];
  if (switchedOff.length > 0) {
    await db.deviceLoginRequest.deleteMany({ where: { userId: user.id, kind: { in: switchedOff }, status: { in: ["PENDING", "APPROVED"] } } });
  }

  await logAudit("DEVICE_LOGIN_SETTINGS_UPDATED", data, user.id, getClientIp(request));
  return NextResponse.json({ success: true, ...data });
}
