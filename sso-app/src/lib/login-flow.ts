import { NextResponse } from "next/server";
import { db } from "./db";
import {
  checkAccountLock,
  createAuthCode,
  hasRecentLogin,
  logAudit,
  logLogin,
  resetFailedAttempts,
  verifyPassword,
} from "./auth";
import { checkRateLimit, rateLimitLoginAttempt, resetLoginAttempts, resetRateLimit } from "./rate-limit";
import { createSession, createTrustedDevice } from "./session";
import { sendLoginNotificationEmail } from "./email";
import { getSecuritySettings } from "./security-settings";
import { isAllowedRedirectUri } from "./safe-redirect";
import { N_ } from "./i18n/core";
import { effectivePermission, isExpired } from "./guest-account";
import { deviceHash, ensureDeviceId, isFamiliarDevice } from "./device-cookie";

// Valid bcrypt hash of a random string: unknown users still cost one bcrypt comparison, so response time
// doesn't reveal whether a username exists.
const DUMMY_HASH = "$2a$12$oTXDJxN5DOI9DDd82.0Rp.ySk9GOVFsaSJIqMbXRzj30.hNuX..Hu";

export async function burnPasswordCheck(password: unknown): Promise<void> {
  await verifyPassword(typeof password === "string" ? password.slice(0, 128) : "", DUMMY_HASH);
}

const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;

/**
 * Gate in front of every credential check (password, MFA code, passkey).
 *
 *  - A locked account is refused – unless the request comes from a browser that carries the device cookie of a
 *    recent successful login (lib/device-cookie.ts; IP + user agent alone are not secret). That way someone else typing wrong passwords can't lock the real owner out of their own login.
 *  - Attempts are counted before the check so parallel requests can't exceed the budget: one shared budget per
 *    account for unfamiliar IPs, one per account+IP for familiar ones.
 *
 * Returns an error response, or null if the attempt may proceed.
 */
export async function guardCredentialAttempt(
  userId: string,
  ip: string,
  userAgent: string | undefined,
  conceal?: string
): Promise<NextResponse | null> {
  const lock = await checkAccountLock(userId);
  const familiar = await isFamiliarDevice(userId);

  // `conceal`: steps that run before the password/passkey is proven answer a lock or an exhausted budget with the
  // same 401 as a wrong credential, otherwise "locked" would tell an attacker that the username exists
  if (lock.locked && !familiar) {
    if (conceal) return NextResponse.json({ error: conceal }, { status: 401 });
    return NextResponse.json(
      { error: "Konto gesperrt. Versuche es später erneut.", lockedUntil: lock.until },
      { status: 423 }
    );
  }

  const max = parseInt(process.env.RATE_LIMIT_ATTEMPT_MAX ?? "10", 10);
  const rl = familiar
    ? checkRateLimit(`attempt:${userId}:${ip}`, max, ATTEMPT_WINDOW_MS)
    : rateLimitLoginAttempt(userId);

  if (!rl.allowed) {
    const retryAfter = Math.ceil((rl.resetAt - Date.now()) / 1000);
    await logAudit("RATE_LIMITED", { scope: "credentials", retryAfterSec: retryAfter }, userId, ip, { outcome: "DENIED", useSession: false });
    if (conceal) return NextResponse.json({ error: conceal }, { status: 401 });
    return NextResponse.json({ error: "Zu viele Versuche. Bitte warte.", retryAfter }, { status: 429 });
  }
  return null;
}

/** Same text for an unknown user, a wrong password, a locked account and an exhausted attempt budget. */
export const GENERIC_LOGIN_ERROR = N_("Benutzername oder Passwort falsch, oder das Konto ist vorübergehend gesperrt");

export function clearCredentialAttempts(userId: string, ip: string): void {
  resetLoginAttempts(userId);
  resetRateLimit(`attempt:${userId}:${ip}`);
}

// ─── App context (legacy app-token flow) ──────────────

interface AppContext {
  appId: string;
  redirectUri: string | null;
}

/**
 * Validates the app a login was started for. An unknown/inactive app or a redirect_uri that isn't registered
 * for it yields null: the login then simply continues without an app context (nobody gets a code, nobody is
 * redirected to an attacker-chosen URL).
 */
export async function resolveAppContext(appId: unknown, redirectUri: unknown): Promise<AppContext | null> {
  if (typeof appId !== "string" || !appId || appId.length > 64) return null;

  const app = await db.app.findUnique({ where: { id: appId }, select: { id: true, isActive: true, redirectUris: true } });
  if (!app || !app.isActive) return null;

  let registered: string[] = [];
  try {
    const parsed = JSON.parse(app.redirectUris);
    if (Array.isArray(parsed)) registered = parsed.filter((u): u is string => typeof u === "string");
  } catch {
    return null;
  }

  if (typeof redirectUri === "string" && redirectUri) {
    return isAllowedRedirectUri(registered, redirectUri) ? { appId: app.id, redirectUri } : null;
  }
  // No redirect_uri given: fall back to the app's first registered URI (may be none)
  return { appId: app.id, redirectUri: registered[0] ?? null };
}

// ─── Complete login ───────────────────────────────────

export interface FinishedLoginSession {
  token: string;
  appId: string | null;
  redirectUri: string | null;
  state: string | null;
}

export interface LoginUser {
  id: string;
  username: string;
  isMaster: boolean;
  forcePasswordChange: boolean;
  email?: string | null;
  sessionDurationHours?: number | null;
}

/**
 * Shared ending of every successful authentication (password, MFA, passkey, recovery code), so all paths
 * follow the same rules: session, notification, audit and – for app logins – DENY / forced password change /
 * missing MFA are enforced identically.
 */
export async function completeLogin(
  loginSession: FinishedLoginSession,
  user: LoginUser,
  ip: string,
  userAgent: string | undefined,
  method: string,
  trustDevice?: boolean
): Promise<NextResponse> {
  // Guest account past its date: same answer as a wrong password (the sweep removes the account shortly)
  const account = await db.user.findUnique({ where: { id: user.id }, select: { expiresAt: true } });
  if (account && isExpired(account)) {
    return NextResponse.json({ error: GENERIC_LOGIN_ERROR }, { status: 401 });
  }

  await resetFailedAttempts(user.id);
  clearCredentialAttempts(user.id, ip);

  // Decide on the "new login" mail BEFORE logging (so we don't find our own record)
  const shouldNotify = !!user.email && !(await hasRecentLogin(user.id, ip, userAgent));

  const deviceId = await ensureDeviceId();
  await logLogin(user.id, ip, userAgent, true, method, undefined, deviceHash(deviceId));
  await createSession(user.id, ip, userAgent, user.sessionDurationHours);

  if (trustDevice) {
    await createTrustedDevice(user.id, ip, userAgent);
  }

  if (shouldNotify) {
    const { locale } = (await db.user.findUnique({ where: { id: user.id }, select: { locale: true } })) ?? { locale: null };
    sendLoginNotificationEmail(user.email!, user.username, ip, userAgent ?? "Unbekannter Browser", new Date(), method, locale)
      .then((ok) => { if (!ok) console.error("[LOGIN NOTIFY] E-Mail konnte nicht gesendet werden"); })
      .catch(() => console.error("[LOGIN NOTIFY] E-Mail-Versand fehlgeschlagen"));
  }

  await db.loginSession.delete({ where: { token: loginSession.token } }).catch(() => {});
  await logAudit("USER_LOGIN", { method, ip }, user.id, ip, { authVia: method, userAgent, useSession: false });

  // Fixed redirects (MFA setup / password change) apply to app logins and direct logins alike
  const mfaSetupRequired = method === "PASSWORD_NO_MFA" && (await getSecuritySettings()).requireMfa;
  const direct = (): NextResponse => {
    let redirect = "/settings";
    if (user.isMaster) redirect = "/admin";
    if (mfaSetupRequired) redirect = "/settings/security?setupMfa=1";
    if (user.forcePasswordChange) redirect = "/settings/security?changePassword=1";
    return NextResponse.json({ success: true, redirect });
  };

  if (!loginSession.appId) return direct();

  // Re-validate: the stored context was checked at the username step, but never trust it blindly
  const ctx = await resolveAppContext(loginSession.appId, loginSession.redirectUri ?? undefined);
  if (!ctx || !ctx.redirectUri) return direct();

  if (mfaSetupRequired) {
    return NextResponse.json({ success: true, redirect: "/settings/security?setupMfa=1" });
  }
  if (user.forcePasswordChange) {
    return NextResponse.json({ success: true, redirect: "/settings/security?changePassword=1" });
  }

  const permission = await db.userAppPermission.findUnique({
    where: { userId_appId: { userId: user.id, appId: ctx.appId } },
  });
  const app = await db.app.findUnique({ where: { id: ctx.appId }, select: { name: true, defaultPermission: true } });
  const permissionLevel = app ? effectivePermission(permission?.permissionLevel, app.defaultPermission, account ?? {}) : "DENY";

  // Same rule as /oauth/authorize and the existing-session login: DENY never gets a code.
  if (permissionLevel === "DENY") {
    const errorUrl = new URL(ctx.redirectUri);
    errorUrl.searchParams.set("error", "access_denied");
    errorUrl.searchParams.set("error_description", "User does not have permission");
    if (loginSession.state) errorUrl.searchParams.set("state", loginSession.state);

    await logAudit(
      "APP_ACCESS_DENIED",
      { protocol: "app-token", reason: N_("Berechtigung DENY"), path: "/api/auth/login" },
      user.id,
      ip,
      { appId: ctx.appId, outcome: "DENIED", authVia: method, userAgent, useSession: false }
    );
    return NextResponse.json({ success: true, redirect: errorUrl.toString() });
  }

  const code = await createAuthCode(ctx.appId, user.id, permissionLevel, ctx.redirectUri, loginSession.state ?? undefined);

  const redirectUrl = new URL(ctx.redirectUri);
  redirectUrl.searchParams.set("code", code);
  if (loginSession.state) redirectUrl.searchParams.set("state", loginSession.state);

  await logAudit(
    "APP_LOGIN",
    {
      protocol: "app-token",
      method,
      via: "FRESH_LOGIN",
      redirect: redirectUrl.origin + redirectUrl.pathname,
      permission: permissionLevel,
    },
    user.id,
    ip,
    { appId: ctx.appId, authVia: method, userAgent, useSession: false }
  );

  return NextResponse.json({ success: true, redirect: redirectUrl.toString() });
}
