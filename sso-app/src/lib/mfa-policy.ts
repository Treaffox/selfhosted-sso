import { getSecuritySettings } from "./security-settings";

/**
 * Guest accounts (lib/guest-account.ts) are exempt. With "MFA required" on (default), an account with neither an authenticator, an e-mail address (e-mail code) nor a
 * passkey can only sign in with the password. The login lets it in so it can set a second factor up, but no app is
 * reachable until it has.
 */
export async function needsMfaSetup(user: { totpVerified: boolean; email: string | null; expiresAt?: Date | null; _count?: { passkeys: number } }): Promise<boolean> {
  if (user.expiresAt) return false; // guest accounts never have a second factor
  if (user.totpVerified || user.email || (user._count?.passkeys ?? 0) > 0) return false;
  return (await getSecuritySettings()).requireMfa;
}
