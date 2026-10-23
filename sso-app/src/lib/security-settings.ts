import { readSetting, writeSetting } from "./settings";

export interface SecuritySettings {
  /**
   * true (default): every account needs a second factor. Accounts without one are sent to the setup after login,
   * and admins can't use the admin area before they have an authenticator app or a passkey.
   * false: MFA is optional. Only accounts that enabled an authenticator app are asked for a second factor.
   */
  requireMfa: boolean;
}

export const DEFAULT_SECURITY: SecuritySettings = { requireMfa: true };

export async function getSecuritySettings(): Promise<SecuritySettings> {
  const stored = await readSetting<Partial<SecuritySettings>>("security");
  return { ...DEFAULT_SECURITY, ...(stored ?? {}), requireMfa: stored?.requireMfa !== false };
}

export async function saveSecuritySettings(input: unknown): Promise<{ ok: true; value: SecuritySettings } | { ok: false; error: string }> {
  const requireMfa = (input as { requireMfa?: unknown } | null)?.requireMfa;
  if (typeof requireMfa !== "boolean") return { ok: false, error: "Ungültige Eingabe" };
  const value = { requireMfa };
  await writeSetting("security", value);
  return { ok: true, value };
}
