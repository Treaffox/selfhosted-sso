import bcrypt from "bcryptjs";
import { authenticator } from "otplib";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type VerifiedRegistrationResponse,
  type VerifiedAuthenticationResponse,
} from "@simplewebauthn/server";
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
} from "@simplewebauthn/types";
import { db } from "./db";
import { encrypt, decrypt, sha256, generateToken, generateEmailCode, generateRecoveryCodes, normalizeEmailCode } from "./crypto";
import { blindIndex } from "./data-crypto";
import { getAvatarUrl } from "./avatar";
import { isInternalLoginToken } from "./pending";
import { effectivePermission, isExpired } from "./guest-account";
import { logAudit } from "./audit";
import { getRpId, getWebAuthnOrigin } from "./config";
import { getSiteSettings } from "./site-settings";

const BCRYPT_ROUNDS = 12;
const LOGIN_SESSION_TTL = 5 * 60 * 1000; // 5 minutes
const AUTH_CODE_TTL = 5 * 60 * 1000; // 5 minutes
const EMAIL_CODE_TTL = 10 * 60 * 1000; // 10 minutes
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION = 15 * 60 * 1000; // 15 minutes

// ─── Password ─────────────────────────────────────────

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// ─── Account Lockout ──────────────────────────────────

export async function checkAccountLock(
  userId: string
): Promise<{ locked: boolean; until?: Date }> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { lockedUntil: true, failedAttempts: true },
  });
  if (!user) return { locked: false };

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    return { locked: true, until: user.lockedUntil };
  }

  // Reset lock if expired
  if (user.lockedUntil) {
    await db.user.update({
      where: { id: userId },
      data: { lockedUntil: null, failedAttempts: 0 },
    });
  }

  return { locked: false };
}

export async function recordFailedAttempt(userId: string): Promise<void> {
  const user = await db.user.update({
    where: { id: userId },
    data: { failedAttempts: { increment: 1 } },
  });

  if (user.failedAttempts >= MAX_FAILED_ATTEMPTS) {
    await db.user.update({
      where: { id: userId },
      data: { lockedUntil: new Date(Date.now() + LOCKOUT_DURATION) },
    });
  }
}

export async function resetFailedAttempts(userId: string): Promise<void> {
  await db.user.update({
    where: { id: userId },
    data: { failedAttempts: 0, lockedUntil: null },
  });
}

// ─── Login Sessions ───────────────────────────────────

interface LoginSessionOptions {
  appId?: string;
  redirectUri?: string;
  state?: string;
  oidcScopes?: string[];
  oidcNonce?: string;
  oidcCodeChallenge?: string;
  oidcCodeChallengeMethod?: string;
}

export async function createLoginSession(ipAddress: string, options?: LoginSessionOptions) {
  const token = generateToken(32);
  const session = await db.loginSession.create({
    data: {
      token,
      ipAddress,
      appId: options?.appId,
      redirectUri: options?.redirectUri,
      state: options?.state,
      oidcScopes: options?.oidcScopes ? JSON.stringify(options.oidcScopes) : null,
      oidcNonce: options?.oidcNonce,
      oidcCodeChallenge: options?.oidcCodeChallenge,
      oidcCodeChallengeMethod: options?.oidcCodeChallengeMethod,
      expiresAt: new Date(Date.now() + LOGIN_SESSION_TTL),
    },
  });
  return { token, session };
}

export async function getLoginSession(token: string) {
  if (isInternalLoginToken(token)) return null;
  const session = await db.loginSession.findUnique({ where: { token } });
  if (!session || session.expiresAt < new Date()) {
    if (session) await db.loginSession.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  return session;
}

export async function updateLoginSession(token: string, data: Record<string, unknown>) {
  return db.loginSession.update({ where: { token }, data });
}

// ─── TOTP ─────────────────────────────────────────────

export function generateTotpSecret(): { secret: string; uri: string } {
  const secret = authenticator.generateSecret();
  return { secret, uri: "" }; // URI will be built with user info
}

export async function getTotpUri(secret: string, username: string): Promise<string> {
  return authenticator.keyuri(username, (await getSiteSettings()).siteName, secret);
}

// Codes already accepted per user: a TOTP code is single-use inside its validity window
const usedTotpCodes = new Map<string, number>();
const TOTP_REPLAY_WINDOW_MS = 90 * 1000;

export function verifyTotp(token: string, encryptedSecret: string, userId?: string): boolean {
  const secret = decrypt(encryptedSecret);
  if (!authenticator.check(token, secret)) return false;

  if (userId) {
    const now = Date.now();
    for (const [k, until] of usedTotpCodes) if (until < now) usedTotpCodes.delete(k);
    const key = `${userId}:${token}`;
    if (usedTotpCodes.has(key)) return false;
    usedTotpCodes.set(key, now + TOTP_REPLAY_WINDOW_MS);
  }
  return true;
}

export function encryptTotpSecret(secret: string): string {
  return encrypt(secret);
}

export function decryptTotpSecret(encrypted: string): string {
  return decrypt(encrypted);
}

// ─── Email Codes ──────────────────────────────────────

/** Only a keyed hash of an e-mail code is stored (bound to account and purpose), never the code itself. */
function emailCodeHash(userId: string, type: string, code: string): string {
  return blindIndex(`emailcode:${userId}:${type}`, code);
}

export async function createEmailCode(
  userId: string,
  type: "LOGIN_MFA" | "EMAIL_CHANGE"
): Promise<string> {
  // Invalidate previous codes of same type
  await db.emailCode.updateMany({
    where: { userId, type, used: false },
    data: { used: true },
  });

  const code = generateEmailCode();
  await db.emailCode.create({
    data: {
      userId,
      code: emailCodeHash(userId, type, code),
      type,
      expiresAt: new Date(Date.now() + EMAIL_CODE_TTL),
    },
  });

  return code;
}

export async function verifyEmailCode(
  userId: string,
  code: string,
  type: string
): Promise<boolean> {
  const emailCode = await db.emailCode.findFirst({
    where: { userId, code: emailCodeHash(userId, type, normalizeEmailCode(code)), type, used: false, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });

  if (!emailCode) return false;

  // Redeem exactly once: of several parallel requests with the same code only one flips `used`
  const redeemed = await db.emailCode.updateMany({ where: { id: emailCode.id, used: false }, data: { used: true } });
  return redeemed.count === 1;
}

// ─── Recovery Codes ───────────────────────────────────

export async function createRecoveryCodes(userId: string): Promise<string[]> {
  // Remove existing codes
  await db.recoveryCode.deleteMany({ where: { userId } });

  const codes = generateRecoveryCodes(10);
  const hashed = await Promise.all(
    codes.map(async (code) => ({
      userId,
      codeHash: await bcrypt.hash(code, 10),
    }))
  );

  await db.recoveryCode.createMany({ data: hashed });
  return codes;
}

export async function verifyRecoveryCode(
  userId: string,
  code: string
): Promise<boolean> {
  const codes = await db.recoveryCode.findMany({
    where: { userId, used: false },
  });

  for (const rc of codes) {
    if (await bcrypt.compare(code, rc.codeHash)) {
      // Single use, also against parallel requests with the same code
      const redeemed = await db.recoveryCode.updateMany({ where: { id: rc.id, used: false }, data: { used: true, usedAt: new Date() } });
      return redeemed.count === 1;
    }
  }

  return false;
}

// ─── Authorization Codes ──────────────────────────────

export async function createAuthCode(
  appId: string,
  userId: string,
  permissionLevel: string,
  redirectUri: string,
  state?: string,
  guestGrantId?: string
): Promise<string> {
  const code = generateToken(32);
  await db.authCode.create({
    data: {
      code,
      appId,
      userId,
      permissionLevel,
      redirectUri,
      state,
      guestGrantId,
      expiresAt: new Date(Date.now() + AUTH_CODE_TTL),
    },
  });
  return code;
}

export async function exchangeAuthCode(code: string, appTokenHash: string) {
  const authCode = await db.authCode.findUnique({
    where: { code },
    include: { app: true, guestGrant: { select: { expiresAt: true } } },
  });

  if (!authCode || authCode.used || authCode.expiresAt < new Date()) {
    return null;
  }

  // Guest access that ran out (ending it removes the code together with the grant)
  if (authCode.guestGrantId && (!authCode.guestGrant || authCode.guestGrant.expiresAt < new Date())) {
    return null;
  }

  // Verify the app token (and that the app is still enabled)
  if (!authCode.app.isActive || authCode.app.tokenHash !== appTokenHash) {
    return null;
  }

  // Redeem exactly once: of several parallel requests only one flips `used` from false to true
  const redeemed = await db.authCode.updateMany({ where: { id: authCode.id, used: false }, data: { used: true } });
  if (redeemed.count !== 1) return null;

  // Get user info
  const user = await db.user.findUnique({
    where: { id: authCode.userId },
    select: { id: true, username: true, email: true, avatarUpdatedAt: true, expiresAt: true },
  });
  // The account may be gone (or a guest account may have run out) since the code was issued
  if (!user || isExpired(user)) return null;

  // Permission may have been revoked since the code was issued
  const current = await db.userAppPermission.findUnique({
    where: { userId_appId: { userId: authCode.userId, appId: authCode.appId } },
    select: { permissionLevel: true },
  });
  const permission = effectivePermission(current?.permissionLevel, authCode.app.defaultPermission, user);

  await logAudit("APP_TOKEN_EXCHANGED", { permission }, authCode.userId, undefined, { appId: authCode.appId, appName: authCode.app.name, authVia: "APP_TOKEN", useSession: false });

  return {
    user_id: user.id,
    username: user.username,
    picture: getAvatarUrl(user),
    permission,
    // Guest logins: the app should end its own session no later than this
    ...(authCode.guestGrant ? { guest: true, expires_at: authCode.guestGrant.expiresAt.toISOString() } : {}),
  };
}

// ─── App Token ────────────────────────────────────────

export function hashAppToken(token: string): string {
  return sha256(token);
}

export function generateAppToken(): { token: string; hash: string; prefix: string } {
  const token = `sso_${generateToken(32)}`;
  const hash = sha256(token);
  const prefix = token.substring(0, 12); // "sso_" + 8 chars
  return { token, hash, prefix };
}

// ─── Passkeys (WebAuthn) ─────────────────────────────

const getOrigin = getWebAuthnOrigin;

async function getRpName(): Promise<string> {
  return (await getSiteSettings()).siteName;
}

export async function generatePasskeyRegistrationOptions(userId: string, username: string) {
  const existingPasskeys = await db.passkey.findMany({
    where: { userId },
    select: { credentialId: true, transports: true },
  });

  const options = await generateRegistrationOptions({
    rpName: await getRpName(),
    rpID: getRpId(),
    userName: username,
    attestationType: "none",
    excludeCredentials: existingPasskeys.map((p) => ({
      id: p.credentialId,
      transports: p.transports ? JSON.parse(p.transports) : undefined,
    })),
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
    },
  });

  return options;
}

export async function verifyPasskeyRegistration(
  userId: string,
  response: RegistrationResponseJSON,
  challenge: string
): Promise<VerifiedRegistrationResponse> {
  return verifyRegistrationResponse({
    response,
    expectedChallenge: challenge,
    expectedOrigin: getOrigin(),
    expectedRPID: getRpId(),
  });
}

export async function generatePasskeyAuthenticationOptions(userId?: string) {
  let allowCredentials: { id: string; transports?: AuthenticatorTransportFuture[] }[] | undefined;

  if (userId) {
    const passkeys = await db.passkey.findMany({
      where: { userId },
      select: { credentialId: true, transports: true },
    });
    // No passkeys: omit the list, exactly like for an unknown username
    if (passkeys.length > 0) {
      allowCredentials = passkeys.map((p) => ({
        id: p.credentialId,
        transports: p.transports ? JSON.parse(p.transports) : undefined,
      }));
    }
  }

  return generateAuthenticationOptions({
    rpID: getRpId(),
    allowCredentials,
    userVerification: "preferred",
  });
}

export type PasskeyAuthResult =
  | { ok: true; result: VerifiedAuthenticationResponse }
  | { ok: false; reason: "unknown_credential" | "wrong_owner" | "verification_failed" };

/**
 * Verifies a passkey assertion for the user the login session belongs to.
 * The credential must be one of THAT user's passkeys: a valid signature from someone else's passkey
 * proves nothing about the account being logged into.
 */
export async function verifyPasskeyAuthentication(
  response: AuthenticationResponseJSON,
  challenge: string,
  credentialId: string,
  expectedUserId: string
): Promise<PasskeyAuthResult> {
  const passkey = await db.passkey.findUnique({ where: { credentialId } });
  if (!passkey) return { ok: false, reason: "unknown_credential" };
  if (passkey.userId !== expectedUserId) return { ok: false, reason: "wrong_owner" };

  let result: VerifiedAuthenticationResponse;
  try {
    result = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: getOrigin(),
      expectedRPID: getRpId(),
      credential: {
        id: passkey.credentialId,
        publicKey: Buffer.from(passkey.publicKey, "base64url"),
        counter: passkey.counter,
        transports: passkey.transports ? JSON.parse(passkey.transports) : undefined,
      },
    });
  } catch {
    return { ok: false, reason: "verification_failed" };
  }

  if (!result.verified) return { ok: false, reason: "verification_failed" };

  await db.passkey.update({
    where: { credentialId },
    data: { counter: result.authenticationInfo.newCounter },
  });
  return { ok: true, result };
}

// ─── Audit Logging ────────────────────────────────────

// logAudit lives in ./audit (re-exported so existing imports keep working)
export { logAudit } from "./audit";

export async function logLogin(
  userId: string,
  ipAddress: string,
  userAgent: string | undefined,
  success: boolean,
  method: string,
  reason?: string,
  deviceHash?: string
) {
  await db.loginHistory.create({
    data: { userId, ipAddress, userAgent, success, method, reason, deviceHash },
  });

  // Failed attempts also go to the audit log (successful logins are logged by the caller
  // once the session exists).
  if (!success) {
    await logAudit(
      "LOGIN_FAILED",
      { method, reason },
      userId,
      ipAddress,
      { outcome: "FAILURE", authVia: method, userAgent, useSession: false }
    );
  }
}

/**
 * True if the user already logged in successfully from this IP + user agent in the last 30 days.
 * IP and user agent are encrypted, so they can't be matched in SQL: load the user's recent logins and compare.
 */
export async function hasRecentLogin(userId: string, ipAddress: string, userAgent?: string | null): Promise<boolean> {
  const recent = await db.loginHistory.findMany({
    where: { userId, success: true, createdAt: { gt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } },
    select: { ipAddress: true, userAgent: true },
    take: 1000,
  });
  return recent.some((r) => r.ipAddress === ipAddress && (r.userAgent ?? null) === (userAgent ?? null));
}
