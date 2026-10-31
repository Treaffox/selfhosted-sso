import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { hashPassword, logAudit } from "@/lib/auth";
import { generateToken } from "@/lib/crypto";
import { createInvite, removeSecondFactors } from "@/lib/invite";
import { guestAccountExpiry } from "@/lib/guest-account";
import { parseGuestMinutes } from "@/lib/guest-account-duration";
import { sendWelcomeEmail } from "@/lib/email";
import { passwordSchema, emailSchema } from "@/lib/validation";
import { getClientIp, setIpRule } from "@/lib/ip";

/** GET: Get user details (master only). */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session?.user.isMaster) {
    return NextResponse.json({ error: "Zugriff verweigert" }, { status: 403 });
  }

  const { id } = await params;

  const user = await db.user.findUnique({
    where: { id },
    select: {
      id: true,
      username: true,
      email: true,
      isMaster: true,
      forcePasswordChange: true,
      totpVerified: true,
      mobileAppEnabled: true,
      expiresAt: true,
      failedAttempts: true,
      lockedUntil: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { passkeys: true, recoveryCodes: true, sessions: true, trustedDevices: true } },
      permissions: {
        select: {
          id: true,
          permissionLevel: true,
          app: { select: { id: true, name: true, permissionLevels: true, defaultPermission: true } },
        },
      },
      ipRules: { select: { id: true, ipAddress: true, type: true, addedBy: true, createdAt: true } },
      loginHistory: {
        select: { id: true, ipAddress: true, success: true, method: true, reason: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 50,
      },
    },
  });

  if (!user) {
    return NextResponse.json({ error: "Nutzer nicht gefunden" }, { status: 404 });
  }

  return NextResponse.json(user);
}

/** PATCH: Update user (master only). */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session?.user.isMaster) {
    return NextResponse.json({ error: "Zugriff verweigert" }, { status: 403 });
  }

  const { id } = await params;

  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
    }
    const updates: Record<string, unknown> = {};

    if (body.password !== undefined) {
      const pResult = passwordSchema.safeParse(body.password);
      if (!pResult.success) {
        return NextResponse.json({ error: pResult.error.issues[0].message }, { status: 400 });
      }
      updates.passwordHash = await hashPassword(pResult.data);
      updates.forcePasswordChange = true;
      // A reset usually follows a suspicion: nobody may stay logged in with the old credentials
      await db.session.deleteMany({ where: { userId: id } });
      await db.trustedDevice.deleteMany({ where: { userId: id } });
      await db.guestGrant.deleteMany({ where: { userId: id } });
    }

    // Guest account: `guestMinutes` sets (or extends) the lifetime from now on, null makes it a regular account again
    if (body.guestMinutes !== undefined) {
      const target = await db.user.findUnique({ where: { id }, select: { isMaster: true } });
      if (!target) return NextResponse.json({ error: "Nutzer nicht gefunden" }, { status: 404 });
      if (body.guestMinutes === null) {
        updates.expiresAt = null;
        // A regular account needs a second factor again (when MFA is required): it has to set one up before it reaches apps
      } else {
        const minutes = parseGuestMinutes(body.guestMinutes);
        if (minutes === null) return NextResponse.json({ error: "Ungültige Gültigkeitsdauer" }, { status: 400 });
        if (target.isMaster || id === session.user.id) return NextResponse.json({ error: "Dieses Konto kann kein Gastkonto sein" }, { status: 400 });
        updates.expiresAt = guestAccountExpiry(minutes);
      }
    }

    // Invitation link instead of a typed password: the old password stops working, the person chooses a new one
    let inviteUrl: string | undefined;
    let inviteExpiresAt: Date | undefined;
    let mailed = false;
    if (body.sendInvite === true) {
      const target = await db.user.findUnique({ where: { id }, select: { id: true, username: true, email: true, locale: true, expiresAt: true } });
      if (!target) return NextResponse.json({ error: "Nutzer nicht gefunden" }, { status: 404 });
      const until = (updates.expiresAt as Date | null | undefined) !== undefined ? (updates.expiresAt as Date | null) : target.expiresAt;
      updates.passwordHash = await hashPassword(generateToken(24));
      updates.forcePasswordChange = true;
      await db.session.deleteMany({ where: { userId: id } });
      await db.trustedDevice.deleteMany({ where: { userId: id } });
      await db.guestGrant.deleteMany({ where: { userId: id } });
      const invite = await createInvite(id, until);
      inviteUrl = invite.url;
      inviteExpiresAt = invite.expiresAt;
      mailed = target.email ? await sendWelcomeEmail(target.email, target.username, inviteUrl, invite.expiresAt, until, target.locale).catch(() => false) : false;
    }

    if (body.email !== undefined) {
      if (body.email) {
        const eResult = emailSchema.safeParse(body.email);
        if (!eResult.success) {
          return NextResponse.json({ error: eResult.error.issues[0].message }, { status: 400 });
        }
        updates.email = eResult.data;
      } else {
        updates.email = null;
      }
    }

    if (body.forcePasswordChange !== undefined) {
      updates.forcePasswordChange = !!body.forcePasswordChange;
    }

    // Unlock account
    if (body.unlock) {
      updates.lockedUntil = null;
      updates.failedAttempts = 0;
    }

    if (Object.keys(updates).length > 0) {
      await db.user.update({ where: { id }, data: updates });
    }

    // After a reset: optionally also drop passkeys / authenticator / recovery codes (recommended, but the admin decides)
    const credentialsReset = body.password !== undefined || body.sendInvite === true;
    if (credentialsReset && body.removeSecondFactors === true) {
      await removeSecondFactors(id);
      await logAudit("SECOND_FACTORS_REMOVED", { userId: id }, session.user.id, getClientIp(request));
    }

    // Handle permission updates ({ appId, permissionLevel } assigns, { appId, remove: true } falls back to the app default)
    const touchedPermissions = Array.isArray(body.permissions) && body.permissions.length > 0;
    if (body.permissions && Array.isArray(body.permissions)) {
      for (const perm of body.permissions) {
        if (!perm.appId) continue;
        if (perm.remove) {
          await db.userAppPermission.deleteMany({ where: { userId: id, appId: String(perm.appId) } });
          continue;
        }
        if (!perm.permissionLevel) continue;
        const app = await db.app.findUnique({ where: { id: String(perm.appId) }, select: { permissionLevels: true } });
        if (!app || !(JSON.parse(app.permissionLevels) as string[]).includes(perm.permissionLevel)) {
          return NextResponse.json({ error: `Ungültiger Level: ${String(perm.permissionLevel)}` }, { status: 400 });
        }
        await db.userAppPermission.upsert({
          where: { userId_appId: { userId: id, appId: perm.appId } },
          create: { userId: id, appId: perm.appId, permissionLevel: perm.permissionLevel },
          update: { permissionLevel: perm.permissionLevel },
        });
      }
    }

    // Handle IP rules
    if (body.ipRules && Array.isArray(body.ipRules)) {
      for (const rule of body.ipRules) {
        if (rule.delete) {
          await db.userIpRule.delete({ where: { id: rule.id } }).catch(() => {});
        } else if (rule.ipAddress && rule.type) {
          await setIpRule(id, rule.ipAddress, rule.type, "ADMIN");
        }
      }
    }

    await logAudit(
      "USER_UPDATED",
      { userId: id, fields: touchedPermissions ? [...Object.keys(updates), "permissions"] : Object.keys(updates) },
      session.user.id,
      getClientIp(request)
    );

    return NextResponse.json({ success: true, inviteUrl, inviteExpiresAt, mailed });
  } catch (error) {
    if (error instanceof SyntaxError) return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
    console.error("[UPDATE USER ERROR]", error instanceof Error ? error.name : "unbekannter Fehler");
    return NextResponse.json({ error: "Fehler beim Aktualisieren" }, { status: 500 });
  }
}

/** DELETE: Delete user (master only). */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session?.user.isMaster) {
    return NextResponse.json({ error: "Zugriff verweigert" }, { status: 403 });
  }

  const { id } = await params;

  // Prevent deleting yourself
  if (id === session.user.id) {
    return NextResponse.json({ error: "Du kannst dich nicht selbst löschen" }, { status: 400 });
  }

  await db.user.delete({ where: { id } });

  await logAudit("USER_DELETED", { userId: id }, session.user.id, getClientIp(request));

  return NextResponse.json({ success: true });
}
