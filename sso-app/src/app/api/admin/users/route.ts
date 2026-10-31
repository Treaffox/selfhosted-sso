import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession, purgeExpiredGuests } from "@/lib/session";
import { hashPassword, createRecoveryCodes, logAudit } from "@/lib/auth";
import { generateToken } from "@/lib/crypto";
import { createInvite } from "@/lib/invite";
import { guestAccountExpiry } from "@/lib/guest-account";
import { parseGuestMinutes } from "@/lib/guest-account-duration";
import { usernameSchema, passwordSchema, emailSchema } from "@/lib/validation";
import { getClientIp } from "@/lib/ip";
import { sendWelcomeEmail } from "@/lib/email";

/** GET: List all users (master only). */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session?.user.isMaster) {
    return NextResponse.json({ error: "Zugriff verweigert" }, { status: 403 });
  }

  const users = await db.user.findMany({
    select: {
      id: true,
      username: true,
      email: true,
      isMaster: true,
      forcePasswordChange: true,
      totpVerified: true,
      expiresAt: true,
      createdAt: true,
      _count: { select: { passkeys: true, sessions: true } },
      permissions: {
        select: {
          permissionLevel: true,
          app: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(users);
}

/** POST: Create a new user (master only). */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session?.user.isMaster) {
    return NextResponse.json({ error: "Zugriff verweigert" }, { status: 403 });
  }

  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
    }
    const { username, password, email, guestMinutes } = body;

    // Guest account: expires after the chosen number of minutes (see lib/guest-account.ts)
    let expiresAt: Date | null = null;
    if (guestMinutes !== undefined && guestMinutes !== null) {
      const minutes = parseGuestMinutes(guestMinutes);
      if (minutes === null) return NextResponse.json({ error: "Ungültige Gültigkeitsdauer" }, { status: 400 });
      expiresAt = guestAccountExpiry(minutes);
    }

    // Validate
    const uResult = usernameSchema.safeParse(username);
    if (!uResult.success) {
      return NextResponse.json({ error: uResult.error.issues[0].message }, { status: 400 });
    }

    // The password is optional: without one the account gets an unusable random password and the person
    // chooses their own through the invitation link
    const pResult = password ? passwordSchema.safeParse(password) : null;
    if (pResult && !pResult.success) {
      return NextResponse.json({ error: pResult.error.issues[0].message }, { status: 400 });
    }

    if (email) {
      const eResult = emailSchema.safeParse(email);
      if (!eResult.success) {
        return NextResponse.json({ error: eResult.error.issues[0].message }, { status: 400 });
      }
    }

    // Check uniqueness (an expired guest account only waits for the sweep: its name is free again)
    await purgeExpiredGuests(uResult.data);
    const existing = await db.user.findUnique({ where: { username: uResult.data } });
    if (existing) {
      return NextResponse.json({ error: "Benutzername bereits vergeben" }, { status: 409 });
    }

    const passwordHash = await hashPassword(pResult?.success ? pResult.data : generateToken(24));

    const user = await db.user.create({
      data: {
        username: uResult.data,
        passwordHash,
        email: email || null,
        forcePasswordChange: true,
        expiresAt,
      },
    });

    // Recovery codes only belong to accounts with a second factor
    if (!expiresAt) await createRecoveryCodes(user.id);

    await logAudit(
      "USER_CREATED",
      { username: user.username, createdBy: session.user.username, ...(expiresAt ? { guestUntil: expiresAt.toISOString() } : {}) },
      session.user.id,
      getClientIp(request)
    );

    // Invitation link (the password itself is never mailed). Shown to the admin too, for hand-over without e-mail.
    const invite = await createInvite(user.id, expiresAt);
    const mailed = email ? await sendWelcomeEmail(email, user.username, invite.url, invite.expiresAt, expiresAt).catch(() => false) : false;

    return NextResponse.json({ success: true, user: { id: user.id, username: user.username }, inviteUrl: invite.url, inviteExpiresAt: invite.expiresAt, mailed }, { status: 201 });
  } catch (error) {
    if (error instanceof SyntaxError) return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
    console.error("[CREATE USER ERROR]", error instanceof Error ? error.name : "unbekannter Fehler");
    return NextResponse.json({ error: "Fehler beim Erstellen" }, { status: 500 });
  }
}
