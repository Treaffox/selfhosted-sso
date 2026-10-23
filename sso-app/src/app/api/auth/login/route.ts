import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  createLoginSession,
  getLoginSession,
  updateLoginSession,
  verifyPassword,
  recordFailedAttempt,
  verifyTotp,
  verifyEmailCode,
  verifyRecoveryCode,
  logLogin,
  logAudit,
  checkAccountLock,
  hasRecentLogin,
} from "@/lib/auth";
import { checkIpStatus, getClientIp } from "@/lib/ip";
import { getSecuritySettings } from "@/lib/security-settings";
import { rateLimitLogin } from "@/lib/rate-limit";
import { findTrustedDevice, getTrustedDeviceTokenFromRequest } from "@/lib/session";
import { usernameSchema, totpCodeSchema, emailCodeSchema, recoveryCodeSchema } from "@/lib/validation";
import { burnPasswordCheck, completeLogin, guardCredentialAttempt, resolveAppContext } from "@/lib/login-flow";

const MAX_STATE_LENGTH = 512;

export async function POST(request: NextRequest) {
  try {
    let body: Record<string, unknown>;
    try {
      const parsed = await request.json();
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
      body = parsed as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
    }

    const { step } = body;
    const ip = getClientIp(request);
    const userAgent = request.headers.get("user-agent") ?? undefined;

    // Rate limit (per client IP; credential attempts are additionally limited per account)
    const rl = rateLimitLogin(ip);
    if (!rl.allowed) {
      const retryAfter = Math.ceil((rl.resetAt - Date.now()) / 1000);
      await logAudit("RATE_LIMITED", { scope: "login", retryAfterSec: retryAfter }, undefined, ip, { outcome: "DENIED", useSession: false });
      return NextResponse.json(
        { error: "Zu viele Anmeldeversuche. Bitte warte.", retryAfter },
        { status: 429 }
      );
    }

    switch (step) {
      case "username":
        return await handleUsername(body, ip, userAgent);
      case "password":
        return await handlePassword(body, ip, userAgent, request);
      case "mfa":
        return await handleMfa(body, ip, userAgent);
      default:
        return NextResponse.json({ error: "Ungültiger Schritt" }, { status: 400 });
    }
  } catch (error) {
    console.error("[LOGIN ERROR]", error instanceof Error ? error.message : "unbekannter Fehler");
    return NextResponse.json({ error: "Interner Fehler" }, { status: 500 });
  }
}

const str = (v: unknown, max = 256): string | undefined => (typeof v === "string" && v.length <= max ? v : undefined);

// ─── Step 1: Username ─────────────────────────────────

async function handleUsername(body: Record<string, unknown>, ip: string, userAgent: string | undefined) {
  const parsed = usernameSchema.safeParse(body.username);
  if (!parsed.success) {
    return NextResponse.json({ error: "Ungültiger Benutzername" }, { status: 400 });
  }

  const user = await db.user.findUnique({
    where: { username: parsed.data },
    select: {
      id: true,
      username: true,
      passkeys: { select: { id: true } },
    },
  });

  // App context only survives if the app exists and the redirect_uri is registered for it
  const appCtx = await resolveAppContext(body.appId, body.redirectUri);
  const sessionOptions = {
    appId: appCtx?.appId,
    redirectUri: appCtx?.redirectUri ?? undefined,
    state: str(body.state, MAX_STATE_LENGTH),
  };

  if (!user) {
    const { token } = await createLoginSession(ip, sessionOptions);
    return NextResponse.json({
      loginToken: token,
      nextStep: "password",
      hasPasskeys: false,
    });
  }

  // A locked account is only refused for unfamiliar IPs (so strangers can't keep the owner out)
  const lockStatus = await checkAccountLock(user.id);
  if (lockStatus.locked && !(await hasRecentLogin(user.id, ip, userAgent))) {
    return NextResponse.json(
      { error: "Konto gesperrt. Versuche es später erneut.", lockedUntil: lockStatus.until },
      { status: 423 }
    );
  }

  const ipStatus = await checkIpStatus(user.id, ip);

  const { token } = await createLoginSession(ip, sessionOptions);
  await updateLoginSession(token, {
    userId: user.id,
    step: "PASSWORD",
    ipStatus,
  });

  return NextResponse.json({
    loginToken: token,
    nextStep: user.passkeys.length > 0 ? "method_select" : "password",
    hasPasskeys: user.passkeys.length > 0,
  });
}

// ─── Step 2: Password ─────────────────────────────────

const GENERIC_LOGIN_ERROR = "Benutzername oder Passwort falsch";

async function handlePassword(
  body: Record<string, unknown>,
  ip: string,
  userAgent: string | undefined,
  request: NextRequest
) {
  const loginToken = str(body.loginToken, 128);
  const password = str(body.password, 256);
  if (!loginToken || password === undefined) {
    return NextResponse.json({ error: GENERIC_LOGIN_ERROR }, { status: 401 });
  }

  const loginSession = await getLoginSession(loginToken);
  if (!loginSession?.userId) {
    // Unknown user – same cost and same answer as a wrong password
    await burnPasswordCheck(password);
    await logAudit("LOGIN_FAILED", { method: "PASSWORD", reason: "unknown_user" }, undefined, ip, { outcome: "FAILURE", authVia: "PASSWORD", userAgent, useSession: false });
    return NextResponse.json({ error: GENERIC_LOGIN_ERROR }, { status: 401 });
  }

  const blocked = await guardCredentialAttempt(loginSession.userId, ip, userAgent);
  if (blocked) return blocked;

  const user = await db.user.findUnique({
    where: { id: loginSession.userId },
    select: {
      id: true,
      username: true,
      email: true,
      passwordHash: true,
      isMaster: true,
      forcePasswordChange: true,
      totpSecret: true,
      totpVerified: true,
      sessionDurationHours: true,
    },
  });

  if (!user) {
    await burnPasswordCheck(password);
    await logAudit("LOGIN_FAILED", { method: "PASSWORD", reason: "unknown_user" }, undefined, ip, { outcome: "FAILURE", authVia: "PASSWORD", userAgent, useSession: false });
    return NextResponse.json({ error: GENERIC_LOGIN_ERROR }, { status: 401 });
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    await recordFailedAttempt(user.id);
    await logLogin(user.id, ip, userAgent, false, "PASSWORD", "invalid_password");
    return NextResponse.json({ error: GENERIC_LOGIN_ERROR }, { status: 401 });
  }

  // Password correct – check if MFA required
  const ipStatus = loginSession.ipStatus;

  // IP whitelisted → skip MFA
  if (ipStatus === "WHITELISTED") {
    return await completeLogin(loginSession, user, ip, userAgent, "PASSWORD_IP_WHITELIST");
  }

  // Check trusted device → skip MFA
  if (await findTrustedDevice(getTrustedDeviceTokenFromRequest(request), user.id)) {
    return await completeLogin(loginSession, user, ip, userAgent, "PASSWORD_TRUSTED_DEVICE");
  }

  // Normal flow → require single MFA
  // MFA optional (Admin → System → Sicherheit): only accounts that enabled an authenticator app get asked.
  const { requireMfa } = await getSecuritySettings();
  const mfaMethods: string[] = [];
  if (user.totpVerified) mfaMethods.push("totp");
  if (user.email && (requireMfa || user.totpVerified)) mfaMethods.push("email");

  if (mfaMethods.length === 0) {
    // No MFA methods set up – allow login (and, when MFA is mandatory, force the setup afterwards)
    return await completeLogin(loginSession, user, ip, userAgent, "PASSWORD_NO_MFA");
  }

  await updateLoginSession(loginSession.token, { step: "MFA" });

  return NextResponse.json({
    loginToken: loginSession.token,
    nextStep: "mfa",
    mfaMethods,
  });
}

// ─── Step 3a: MFA ─────────────────────────────────────

async function handleMfa(body: Record<string, unknown>, ip: string, userAgent: string | undefined) {
  const loginToken = str(body.loginToken, 128);
  const loginSession = loginToken ? await getLoginSession(loginToken) : null;
  if (!loginSession?.userId || loginSession.step !== "MFA") {
    return NextResponse.json({ error: "Ungültige Sitzung" }, { status: 400 });
  }

  const blocked = await guardCredentialAttempt(loginSession.userId, ip, userAgent);
  if (blocked) return blocked;

  const user = await db.user.findUnique({
    where: { id: loginSession.userId },
    select: { id: true, username: true, email: true, isMaster: true, forcePasswordChange: true, totpSecret: true, totpVerified: true, sessionDurationHours: true },
  });
  if (!user) return NextResponse.json({ error: "Nutzer nicht gefunden" }, { status: 400 });

  const code = str(body.code, 64);
  let verified = false;
  let method = "UNKNOWN";

  if (body.method === "totp" && user.totpSecret && user.totpVerified) {
    const parsed = totpCodeSchema.safeParse(code);
    if (!parsed.success) {
      return NextResponse.json({ error: "Ungültiger Code" }, { status: 400 });
    }
    verified = verifyTotp(parsed.data, user.totpSecret, user.id);
    method = "PASSWORD_TOTP";
  } else if (body.method === "email" && user.email) {
    const parsed = emailCodeSchema.safeParse(code);
    if (!parsed.success) {
      return NextResponse.json({ error: "Ungültiger Code" }, { status: 400 });
    }
    verified = await verifyEmailCode(user.id, parsed.data, "LOGIN_MFA");
    method = "PASSWORD_EMAIL";
  } else if (body.method === "recovery") {
    const parsed = recoveryCodeSchema.safeParse(code?.trim().toUpperCase());
    if (!parsed.success) {
      return NextResponse.json({ error: "Ungültiger Code" }, { status: 400 });
    }
    verified = await verifyRecoveryCode(user.id, parsed.data);
    method = "RECOVERY_CODE";
  } else {
    return NextResponse.json({ error: "Ungültige MFA-Methode" }, { status: 400 });
  }

  if (!verified) {
    await recordFailedAttempt(user.id);
    await logLogin(user.id, ip, userAgent, false, method, "invalid_mfa_code");
    return NextResponse.json({ error: "Ungültiger Code" }, { status: 401 });
  }

  return await completeLogin(loginSession, user, ip, userAgent, method, body.trustDevice === true);
}
