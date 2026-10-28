import { cookies } from "next/headers";
import { db } from "./db";
import { generateToken } from "./crypto";
import { getCookieDomain, guestCookieName, isHttpsDeployment, sessionCookieName, trustedDeviceCookieName } from "./config";
import { storedToken, tokenLookupKeys } from "./token-store";


function getSessionMaxAge(hours?: number | null): number {
  const h = hours ?? parseInt(process.env.SESSION_MAX_AGE_HOURS ?? "24", 10);
  return h * 60 * 60 * 1000;
}

function getTrustedDeviceMaxAge(): number {
  const days = parseInt(process.env.TRUSTED_DEVICE_MAX_AGE_DAYS ?? "30", 10);
  return days * 24 * 60 * 60 * 1000;
}

function cookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure: isHttpsDeployment(),
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSeconds,
    domain: getCookieDomain(),
  };
}

/** Create a new session and set the cookie. */
export async function createSession(
  userId: string,
  ipAddress: string,
  userAgent?: string,
  sessionDurationHours?: number | null
) {
  const token = generateToken(32);
  const maxAgeMs = getSessionMaxAge(sessionDurationHours);
  const expiresAt = new Date(Date.now() + maxAgeMs);

  await db.session.create({
    data: { userId, token: storedToken(token), ipAddress, userAgent: userAgent ?? null, expiresAt },
  });

  const cookieStore = await cookies();
  cookieStore.set(sessionCookieName(), token, cookieOptions(maxAgeMs / 1000));

  return token;
}

/** Update the expiry of the currently active session (e.g. after the user changes their session duration preference). */
export async function refreshCurrentSessionMaxAge(hours: number) {
  const cookieStore = await cookies();
  const token = cookieStore.get(sessionCookieName())?.value;
  if (!token) return;

  const maxAgeMs = getSessionMaxAge(hours);
  const expiresAt = new Date(Date.now() + maxAgeMs);

  await db.session.updateMany({ where: { token: { in: tokenLookupKeys(token) } }, data: { expiresAt } });

  cookieStore.set(sessionCookieName(), token, cookieOptions(maxAgeMs / 1000));
}

/** Look a session up by the raw cookie value, migrating legacy (unhashed) rows to the hashed form. */
async function loadSession(token: string) {
  const session = await db.session.findFirst({
    where: { token: { in: tokenLookupKeys(token) } },
    include: { user: true },
  });
  if (!session) return null;

  if (session.expiresAt < new Date()) {
    await db.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }

  const hashed = storedToken(token);
  if (session.token !== hashed) {
    await db.session.update({ where: { id: session.id }, data: { token: hashed } }).catch(() => {});
  }
  return session;
}

/** Get the current session from the cookie. Returns user or null. */
export async function getSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(sessionCookieName())?.value;
  if (!token) return null;
  return loadSession(token);
}

/** Destroy the current session. */
export async function destroySession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(sessionCookieName())?.value;
  if (token) {
    await db.session.deleteMany({ where: { token: { in: tokenLookupKeys(token) } } });
    cookieStore.set(sessionCookieName(), "", cookieOptions(0));
  }
}

/** Destroy a specific session by ID. */
export async function destroySessionById(sessionId: string) {
  await db.session.delete({ where: { id: sessionId } }).catch(() => {});
}

/** End every session of a user except (optionally) one – used after credential changes. */
export async function destroyOtherSessions(userId: string, keepSessionId?: string) {
  await db.session.deleteMany({
    where: { userId, ...(keepSessionId ? { id: { not: keepSessionId } } : {}) },
  });
}

/** Get the session token from a Request object (for API routes). */
export function getSessionTokenFromRequest(request: Request): string | null {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const match = cookieHeader.match(
    new RegExp(`(?:^|;\\s*)${sessionCookieName()}=([^;]*)`)
  );
  return match?.[1] ?? null;
}

/** Validate a session token directly (for auth_request endpoint). */
export async function validateSessionToken(token: string) {
  return loadSession(token);
}

// ─── Guest cookie ────────────────────────────────────

/** Set the guest cookie (raw token); it lives exactly as long as the grant. */
export async function setGuestCookie(rawToken: string, expiresAt: Date) {
  const maxAgeSeconds = Math.max(1, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
  const cookieStore = await cookies();
  cookieStore.set(guestCookieName(), rawToken, cookieOptions(maxAgeSeconds));
}

export async function clearGuestCookie() {
  const cookieStore = await cookies();
  cookieStore.set(guestCookieName(), "", cookieOptions(0));
}

/** Get the guest token from a Request object. */
export function getGuestTokenFromRequest(request: Request): string | null {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${guestCookieName()}=([^;]*)`));
  return match?.[1] ?? null;
}

// ─── Trusted Devices ─────────────────────────────────

/** Create a trusted device entry and set the cookie. */
export async function createTrustedDevice(
  userId: string,
  ipAddress: string,
  userAgent?: string,
  deviceName?: string
) {
  const deviceToken = generateToken(32);
  const expiresAt = new Date(Date.now() + getTrustedDeviceMaxAge());

  await db.trustedDevice.create({
    data: {
      userId,
      deviceToken: storedToken(deviceToken),
      deviceName: deviceName ?? "Browser",
      ipAddress,
      userAgent: userAgent ?? null,
      expiresAt,
    },
  });

  const cookieStore = await cookies();
  cookieStore.set(trustedDeviceCookieName(), deviceToken, cookieOptions(getTrustedDeviceMaxAge() / 1000));

  return deviceToken;
}

/** Find a valid trusted device for this cookie value and user (migrates legacy rows to the hashed form). */
export async function findTrustedDevice(rawToken: string | null | undefined, userId: string) {
  if (!rawToken) return null;

  const device = await db.trustedDevice.findFirst({
    where: { deviceToken: { in: tokenLookupKeys(rawToken) } },
  });
  if (!device) return null;

  if (device.userId !== userId || device.expiresAt < new Date()) {
    if (device.expiresAt < new Date()) {
      await db.trustedDevice.delete({ where: { id: device.id } }).catch(() => {});
    }
    return null;
  }

  const hashed = storedToken(rawToken);
  if (device.deviceToken !== hashed) {
    await db.trustedDevice.update({ where: { id: device.id }, data: { deviceToken: hashed } }).catch(() => {});
  }
  return device;
}

/** Check if the current device is trusted for the given user. */
export async function isTrustedDevice(userId: string): Promise<boolean> {
  const cookieStore = await cookies();
  const token = cookieStore.get(trustedDeviceCookieName())?.value;
  return (await findTrustedDevice(token, userId)) !== null;
}

/** Get trusted device token from a Request object. */
export function getTrustedDeviceTokenFromRequest(
  request: Request
): string | null {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const match = cookieHeader.match(
    new RegExp(`(?:^|;\\s*)${trustedDeviceCookieName()}=([^;]*)`)
  );
  return match?.[1] ?? null;
}

/** Trusted devices of a user; `isCurrent` marks the one this browser holds. */
export async function listTrustedDevices(userId: string, currentRawToken?: string | null) {
  const devices = await db.trustedDevice.findMany({
    where: { userId, expiresAt: { gt: new Date() } },
    select: { id: true, deviceName: true, ipAddress: true, userAgent: true, createdAt: true, expiresAt: true, deviceToken: true },
    orderBy: { createdAt: "desc" },
  });
  const currentKeys = currentRawToken ? tokenLookupKeys(currentRawToken) : [];
  return devices.map(({ deviceToken, ...d }) => ({ ...d, isCurrent: currentKeys.includes(deviceToken) }));
}

/** Remove one (or all) trusted devices of a user, so the next login asks for MFA again. */
export async function revokeTrustedDevices(userId: string, deviceId?: string) {
  const res = await db.trustedDevice.deleteMany({ where: { userId, ...(deviceId ? { id: deviceId } : {}) } });
  return res.count;
}

// ─── Cleanup ─────────────────────────────────────────

/** Remove expired sessions and login sessions. */
export async function cleanupExpired() {
  const now = new Date();
  await Promise.all([
    db.session.deleteMany({ where: { expiresAt: { lt: now } } }),
    db.loginSession.deleteMany({ where: { expiresAt: { lt: now } } }),
    db.trustedDevice.deleteMany({ where: { expiresAt: { lt: now } } }),
    db.authCode.deleteMany({ where: { expiresAt: { lt: now } } }),
    db.emailCode.deleteMany({ where: { expiresAt: { lt: now } } }),
    db.deviceLoginRequest.deleteMany({ where: { expiresAt: { lt: now } } }),
    db.guestGrant.deleteMany({ where: { expiresAt: { lt: now } } }),
  ]);
}
