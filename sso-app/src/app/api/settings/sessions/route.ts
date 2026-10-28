import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  getSession,
  destroySessionById,
  getTrustedDeviceTokenFromRequest,
  listTrustedDevices,
  revokeTrustedDevices,
} from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { listGuestGrants, revokeGuestGrants } from "@/lib/guest-access";

/** GET: List active sessions, trusted devices and guest accesses. */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Nicht authentifiziert" }, { status: 401 });
  }

  const sessions = await db.session.findMany({
    where: { userId: session.user.id },
    select: {
      id: true,
      ipAddress: true,
      userAgent: true,
      createdAt: true,
      expiresAt: true,
    },
    orderBy: { createdAt: "desc" },
  });

  const trustedDevices = await listTrustedDevices(session.user.id, getTrustedDeviceTokenFromRequest(request));

  const guestGrants = await listGuestGrants(session.user.id);

  return NextResponse.json({
    sessions: sessions.map((s) => ({
      ...s,
      isCurrent: s.id === session.id,
    })),
    trustedDevices,
    guestGrants,
  });
}

/** DELETE: Revoke a session, a trusted device (`trustedDeviceId`) or a guest access (`guestGrantId`); "all" removes every one. */
export async function DELETE(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Nicht authentifiziert" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);

  if (typeof body?.trustedDeviceId === "string") {
    const id = body.trustedDeviceId;
    const removed = await revokeTrustedDevices(session.user.id, id === "all" ? undefined : id);
    if (removed === 0 && id !== "all") {
      return NextResponse.json({ error: "Gerät nicht gefunden" }, { status: 404 });
    }
    await logAudit("TRUSTED_DEVICE_REVOKED", { count: removed }, session.user.id);
    return NextResponse.json({ success: true });
  }

  if (typeof body?.guestGrantId === "string") {
    const id = body.guestGrantId;
    const ended = await revokeGuestGrants(session.user.id, id === "all" ? undefined : id);
    if (ended.length === 0 && id !== "all") {
      return NextResponse.json({ error: "Gast-Zugang nicht gefunden" }, { status: 404 });
    }
    await logAudit(
      "GUEST_ACCESS_REVOKED",
      { all: id === "all", count: ended.length },
      session.user.id,
      undefined,
      id === "all" ? {} : { appId: ended[0]?.appId, appName: ended[0]?.app.name }
    );
    return NextResponse.json({ success: true });
  }

  const sessionId = body?.sessionId;
  if (typeof sessionId !== "string" || !sessionId) {
    return NextResponse.json({ error: "Session-ID erforderlich" }, { status: 400 });
  }

  // Verify the session belongs to this user
  const target = await db.session.findUnique({ where: { id: sessionId } });
  if (!target || target.userId !== session.user.id) {
    return NextResponse.json({ error: "Sitzung nicht gefunden" }, { status: 404 });
  }

  await destroySessionById(sessionId);
  await logAudit("SESSION_REVOKED", { sessionId, revokedIp: target.ipAddress }, session.user.id);

  return NextResponse.json({ success: true });
}
