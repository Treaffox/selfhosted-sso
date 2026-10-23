import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/auth";
import { getClientIp } from "@/lib/ip";
import { AVATAR_MAX_BYTES, detectImageMime } from "@/lib/avatar";

/** PUT: Upload profile picture (raw image body, PNG/JPEG/WebP, max 512 KB). */
export async function PUT(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Nicht authentifiziert" }, { status: 401 });
  }

  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > AVATAR_MAX_BYTES) {
    return NextResponse.json({ error: "Bild ist zu groß (max. 512 KB)" }, { status: 413 });
  }

  // Read the body in chunks and stop at the limit (Content-Length may be missing or wrong, e.g. chunked uploads)
  const chunks: Uint8Array[] = [];
  let received = 0;
  const reader = request.body?.getReader();
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.length;
      if (received > AVATAR_MAX_BYTES) {
        await reader.cancel().catch(() => {});
        return NextResponse.json({ error: "Bild ist zu groß (max. 512 KB)" }, { status: 413 });
      }
      chunks.push(value);
    }
  }
  const buf = Buffer.concat(chunks);
  if (buf.length === 0) {
    return NextResponse.json({ error: "Kein Bild übermittelt" }, { status: 400 });
  }

  const mime = detectImageMime(buf);
  if (!mime) {
    return NextResponse.json({ error: "Nur PNG, JPEG oder WebP erlaubt" }, { status: 400 });
  }

  const now = new Date();
  await db.$transaction([
    db.userAvatar.upsert({
      where: { userId: session.user.id },
      create: { userId: session.user.id, data: buf, mime },
      update: { data: buf, mime },
    }),
    db.user.update({ where: { id: session.user.id }, data: { avatarUpdatedAt: now } }),
  ]);
  await logAudit("AVATAR_UPDATED", {}, session.user.id, getClientIp(request));

  return NextResponse.json({ success: true, avatarUpdatedAt: now.toISOString() });
}

/** DELETE: Remove profile picture. */
export async function DELETE(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Nicht authentifiziert" }, { status: 401 });
  }

  await db.$transaction([
    db.userAvatar.deleteMany({ where: { userId: session.user.id } }),
    db.user.update({ where: { id: session.user.id }, data: { avatarUpdatedAt: null } }),
  ]);
  await logAudit("AVATAR_DELETED", {}, session.user.id, getClientIp(request));

  return NextResponse.json({ success: true });
}
