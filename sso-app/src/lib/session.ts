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

/** A guest account's session never outlives the account. */
async function cappedMaxAge(userId: string, maxAgeMs: number): Promise<number> {
  const account = await db.user.findUnique({ where: { id: userId }, select: { expiresAt: true } });
  if (!account?.expiresAt) return maxAgeMs;
  return Math.max(1000, Math.min(maxAgeMs, account.expiresAt.getTime() - Date.now()));
}

/** Create a new session and set the cookie. */
export async function createSession(
  userId: string,
  ipAddress: string,
  userAgent?: string,
  sessionDurationHours?: number | null
) {
  const token = generateToken(32);
  const maxAgeMs = await cappedMaxAge(userId, getSessionMaxAge(sessionDurationHours));
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

  const current = await db.session.findFirst({ where: { token: { in: tokenLookupKeys(token) } }, select: { userId: true } });
  if (!current) return;
  const maxAgeMs = await cappedMaxAge(current.userId, getSessionMaxAge(hours));
  const expiresAt = new Date(Date.now() + maxAgeMs);

  await db.session.updateMany({ where: { token: { in: tokenLookupKeys(token) } }, data: { expiresAt } });

  cookieStore.set(sessionCookieName(), token, cookieOptions(maxAgeMs / 1000));
}

/** Look a session up by the raw cookie value, migrating legacy (unhashed) rows to the hashed form. */
async function loadSession(token: string) {
  const session = await db.session.findFirst({
    where: { token: { in: tokenLookupKeys(token) } },
    include: { user: { include: { _count: { select: { passkeys: true } } } } },
  });
  if (!session) return null;

  // A guest account whose time is up has no session any more (the account itself is removed by the sweep)
  if (session.expiresAt < new Date() || (session.user.expiresAt && session.user.expiresAt.getTime() <= Date.now())) {
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
    // approved requests may still be picked up for a minute after their expiry (api/auth/device/status)
    db.deviceLoginRequest.deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - 5 * 60 * 1000) } } }),
    db.guestGrant.deleteMany({ where: { expiresAt: { lt: now } } }),
  ]);

  await purgeExpiredGuests();
}

/**
 * Guest accounts whose time is up are removed together with everything that hangs on them (sessions, tokens, grants).
 * `username` limits it to one name: creating an account must not fail because of an expired one that only waits for the sweep.
 */
export async function purgeExpiredGuests(username?: string) {
  const now = new Date();
  const gone = await db.user.findMany({ where: { expiresAt: { lte: now }, isMaster: false, ...(username ? { username } : {}) }, select: { id: true, username: true } });
  if (gone.length === 0) return;
  const { logAudit } = await import("./audit"); // audit.ts reads the request context from here: no static import (cycle)
  for (const u of gone) {
    await db.user.deleteMany({ where: { id: u.id, expiresAt: { lte: now } } });
    await logAudit("GUEST_ACCOUNT_EXPIRED", { username: u.username, userId: u.id }, undefined, undefined, { useSession: false });
  }
}

// Expired rows are only removed when someone presents them, so unused ones (every username typed on the sign-in page
// creates a login session) would pile up and keep IP addresses forever. Sweep them hourly, once per process.
const sweepState = globalThis as { __ssoSweepStarted?: boolean };
if (!sweepState.__ssoSweepStarted && process.env.NEXT_RUNTIME !== "edge") {
  sweepState.__ssoSweepStarted = true;
  const sweep = () => cleanupExpired().catch(() => console.error("[CLEANUP] Aufräumen abgelaufener Einträge fehlgeschlagen"));
  setTimeout(sweep, 30_000).unref();
  setInterval(sweep, 60 * 60 * 1000).unref();
}
