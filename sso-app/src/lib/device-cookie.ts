import { cookies } from "next/headers";
import { generateToken } from "./crypto";
import { blindIndex } from "./data-crypto";
import { db } from "./db";

/**
 * "Familiar device" = the browser carries a random cookie that a successful login of this account already saw.
 * The cookie is host-only (not shared with subdomain apps), httpOnly and a secret nobody else knows – unlike
 * IP + user agent, which anyone behind the same NAT with a common browser shares. The database only keeps a keyed hash.
 */
export const DEVICE_COOKIE = "sso_dev";
const MAX_AGE_S = 400 * 24 * 60 * 60; // the longest a browser keeps a cookie
const FAMILIAR_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const SHAPE = /^[0-9a-f]{48}$/;

export function deviceHash(deviceId: string): string {
  return blindIndex("device", deviceId);
}

export async function currentDeviceId(): Promise<string | null> {
  const value = (await cookies()).get(DEVICE_COOKIE)?.value;
  return value && SHAPE.test(value) ? value : null;
}

/** Id of this browser; sets the cookie if it has none yet (call at the end of a successful login). */
export async function ensureDeviceId(): Promise<string> {
  const existing = await currentDeviceId();
  const id = existing ?? generateToken(24);
  // Refresh on every login so an active device stays familiar
  (await cookies()).set(DEVICE_COOKIE, id, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_S,
  });
  return id;
}

/** True if this browser already completed a login for the account in the last 30 days. */
export async function isFamiliarDevice(userId: string): Promise<boolean> {
  const id = await currentDeviceId();
  if (!id) return false;
  const hit = await db.loginHistory.findFirst({
    where: { userId, success: true, deviceHash: deviceHash(id), createdAt: { gt: new Date(Date.now() - FAMILIAR_WINDOW_MS) } },
    select: { id: true },
  });
  return !!hit;
}
