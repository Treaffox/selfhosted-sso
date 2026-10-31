import { db } from "./db";
import { generateToken } from "./crypto";
import { blindIndex } from "./data-crypto";
import { hashPassword, logAudit } from "./auth";
import { getPublicBaseUrl } from "./avatar";
import { INVITE_TTL_DAYS } from "./invite-constants";

/**
 * Invitation link: instead of mailing a password, the admin's "create user" (or "send invitation") creates a one-time link
 * that lets the invited person choose their own password. The link token is only stored as a keyed hash
 * (EmailCode row, type INVITE); a new invitation replaces the old one.
 */
const INVITE_TTL_MS = INVITE_TTL_DAYS * 24 * 60 * 60 * 1000;

const inviteKey = (token: string) => blindIndex("invite", token);

export async function createInvite(userId: string, accountUntil?: Date | null): Promise<{ url: string; expiresAt: Date }> {
  await db.emailCode.updateMany({ where: { userId, type: "INVITE", used: false }, data: { used: true } });
  const token = generateToken(32);
  // A guest account's link ends with the account at the latest
  const expiresAt = new Date(Math.min(Date.now() + INVITE_TTL_MS, accountUntil?.getTime() ?? Infinity));
  await db.emailCode.create({
    data: { userId, type: "INVITE", code: inviteKey(token), expiresAt },
  });
  return { url: `${getPublicBaseUrl()}/auth/invite/${token}`, expiresAt };
}

/** The open invitation behind a link token, or null. */
export async function findInvite(token: string) {
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  const invite = await db.emailCode.findFirst({
    where: { type: "INVITE", code: inviteKey(token), used: false, expiresAt: { gt: new Date() } },
    include: { user: { select: { id: true, username: true } } },
  });
  return invite;
}

/**
 * Sets the password chosen by the invited person. The link works once (atomic claim), and the account's old
 * credentials/sessions end – whoever got a temporary password before must not stay logged in.
 */
export async function acceptInvite(token: string, password: string, ip: string): Promise<{ username: string } | null> {
  const invite = await findInvite(token);
  if (!invite) return null;

  const claimed = await db.emailCode.updateMany({ where: { id: invite.id, used: false }, data: { used: true } });
  if (claimed.count !== 1) return null;

  const passwordHash = await hashPassword(password);
  await db.user.update({
    where: { id: invite.userId },
    data: { passwordHash, forcePasswordChange: false, failedAttempts: 0, lockedUntil: null },
  });
  await db.session.deleteMany({ where: { userId: invite.userId } });
  await db.trustedDevice.deleteMany({ where: { userId: invite.userId } });
  await db.guestGrant.deleteMany({ where: { userId: invite.userId } });

  await logAudit("INVITE_ACCEPTED", {}, invite.userId, ip, { useSession: false });
  return { username: invite.user.username };
}

/**
 * Removes passkeys, authenticator and recovery codes of an account. Offered (and recommended) after a password
 * change or reset: whoever had access before could have added a second factor of their own.
 */
export async function removeSecondFactors(userId: string): Promise<void> {
  await db.passkey.deleteMany({ where: { userId } });
  await db.recoveryCode.deleteMany({ where: { userId } });
  await db.user.update({ where: { id: userId }, data: { totpSecret: null, totpVerified: false } });
}
