import { db } from "./db";
import { generateToken, sha256 } from "./crypto";

/**
 * Guest access: a device may use exactly one app of an account for a limited time, without an SSO session.
 * The grant is the single source of truth: auth codes and tokens issued for it are deleted with it (FK cascade).
 */

export async function createGuestGrant(input: {
  userId: string;
  appId: string;
  hours: number;
  ip: string;
  userAgent?: string;
  /** apps behind nginx auth_request check a cookie on every request */
  withCookie: boolean;
}) {
  const cookieToken = input.withCookie ? generateToken(32) : undefined;
  const grant = await db.guestGrant.create({
    data: {
      userId: input.userId,
      appId: input.appId,
      tokenHash: cookieToken ? sha256(cookieToken) : null,
      ipAddress: input.ip,
      userAgent: input.userAgent ?? null,
      expiresAt: new Date(Date.now() + input.hours * 60 * 60 * 1000),
    },
  });
  return { grant, cookieToken };
}

/**
 * The guest behind a cookie value, if it is valid for exactly this app. Anything else (unknown, expired, another
 * app's grant) is null: the caller treats the visitor as not signed in.
 */
export async function validateGuestCookie(rawToken: string, appId: string) {
  const grant = await db.guestGrant.findUnique({
    where: { tokenHash: sha256(rawToken) },
    include: { user: { select: { id: true, username: true, email: true, avatarUpdatedAt: true, forcePasswordChange: true } } },
  });
  if (!grant) return null;
  if (grant.expiresAt < new Date()) {
    await db.guestGrant.delete({ where: { id: grant.id } }).catch(() => {});
    return null;
  }
  if (grant.appId !== appId) return null;
  return grant;
}

/** Active guest accesses given by a user. */
export function listGuestGrants(userId: string) {
  return db.guestGrant.findMany({
    where: { userId, expiresAt: { gt: new Date() } },
    select: { id: true, ipAddress: true, userAgent: true, createdAt: true, expiresAt: true, app: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
  });
}

/** Ends guest accesses of a user (one, or all with no id). Returns how many were ended and for which apps. */
export async function revokeGuestGrants(userId: string, grantId?: string) {
  const grants = await db.guestGrant.findMany({
    where: { userId, ...(grantId ? { id: grantId } : {}) },
    select: { id: true, appId: true, app: { select: { name: true } } },
  });
  if (grants.length === 0) return [];
  await db.guestGrant.deleteMany({ where: { id: { in: grants.map((g) => g.id) } } });
  return grants;
}

/** A guest signs out (e.g. the app links to the SSO logout): the grant ends with the cookie. */
export async function endGuestAccess(rawToken: string | null | undefined) {
  if (!rawToken) return;
  await db.guestGrant.deleteMany({ where: { tokenHash: sha256(rawToken) } });
}
