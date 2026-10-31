import { NextResponse } from "next/server";

/**
 * Guest accounts: a normal account with an expiry date (`User.expiresAt`). Differences:
 *  - password only, never any second factor (no authenticator, passkey, recovery codes, e-mail code)
 *  - reaches only the apps it was explicitly granted (the app's default level does not apply)
 *  - no "guest sign-in" / "sign in on another device" (neither asking nor approving)
 *  - sessions and tokens end with the account, and the account is deleted once it has expired (hourly sweep)
 *  - the lifetime is chosen freely by the admin, in minutes (lib/guest-account-duration.ts)
 */
export const guestAccountExpiry = (minutes: number): Date => new Date(Date.now() + minutes * 60 * 1000);

export const isGuestAccount = (user: { expiresAt?: Date | null }): boolean => !!user.expiresAt;

export const isExpired = (user: { expiresAt?: Date | null }): boolean => !!user.expiresAt && user.expiresAt.getTime() <= Date.now();

/**
 * The level of a user for an app: the explicit assignment, otherwise the app's default.
 * Guest accounts have no fallback: without an explicit assignment they are denied.
 */
export function effectivePermission(explicit: string | null | undefined, appDefault: string, user: { expiresAt?: Date | null }): string {
  if (explicit) return explicit;
  return isGuestAccount(user) ? "DENY" : appDefault;
}

/** 403 for features that don't exist for guest accounts (second factors, sign-in on another device, guest access). */
export function guestAccountForbidden(): NextResponse {
  return NextResponse.json({ error: "Für Gastkonten nicht verfügbar" }, { status: 403 });
}
