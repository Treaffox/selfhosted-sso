import { NextResponse } from "next/server";
import crypto from "crypto";
import QRCode from "qrcode";
import { db } from "./db";
import { generateToken, sha256 } from "./crypto";
import { blindIndex } from "./data-crypto";
import { getPublicBaseUrl } from "./avatar";
import { checkAccountLock, createAuthCode, getLoginSession } from "./auth";
import { isFamiliarDevice } from "./device-cookie";
import { createOIDCAuthCode } from "./oidc";
import { completeLogin, resolveAppContext } from "./login-flow";
import { checkRateLimit, rateLimitDeviceRequestPerAccount } from "./rate-limit";
import { createGuestGrant } from "./guest-access";
import { setGuestCookie } from "./session";
import { logAudit } from "./audit";
import { safeReturnTo } from "./safe-redirect";
import { describeDevice } from "./device-info";
import { locateIp } from "./geoip";
import { N_, type Locale } from "./i18n/core";

/**
 * Sign-in approved on a second device (see DeviceLoginRequest in schema.prisma).
 *
 *  1. The waiting device creates a request (`createDeviceLoginRequest`) and shows QR code + 6-digit code.
 *  2. The account owner approves it on a device they are signed in to (link from the QR code, or the typed code).
 *  3. The waiting device polls; the first poll after approval finishes the login (`finishDeviceLogin`) exactly once.
 */

export type DeviceKind = "GUEST" | "DEVICE";

export const DEVICE_REQUEST_TTL_MS = 5 * 60 * 1000;
export const MAX_CODE_ATTEMPTS = 5;
export const GUEST_DURATIONS_HOURS = [1, 8, 24] as const;
export const DEFAULT_GUEST_HOURS = 8;

// ─── Context of the app the guest wants to use ────────

/** /oauth/authorize parameters, validated like the authorize endpoint does it. */
export interface OidcRequest {
  appId: string;
  redirectUri: string;
  scopes: string[];
  state?: string;
  nonce?: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
}

/** The OIDC authorize request a login was started from (`returnTo` of the login page), or null. */
export async function resolveOidcRequest(returnTo: unknown): Promise<OidcRequest | null> {
  if (typeof returnTo !== "string") return null;
  const origin = new URL(getPublicBaseUrl()).origin;
  const safe = safeReturnTo(returnTo, [origin]);
  if (!safe) return null;

  let url: URL;
  try {
    url = new URL(safe, origin);
  } catch {
    return null;
  }
  if (url.origin !== origin || url.pathname !== "/oauth/authorize") return null;

  const p = url.searchParams;
  const clientId = p.get("client_id");
  const redirectUri = p.get("redirect_uri");
  if (!clientId || !redirectUri || p.get("response_type") !== "code") return null;

  const app = await db.app.findFirst({ where: { OR: [{ clientId }, { id: clientId }], isActive: true, oidcEnabled: true } });
  if (!app) return null;

  const allowedUris: string[] = JSON.parse(app.redirectUris);
  if (!allowedUris.includes(redirectUri)) return null;

  const codeChallenge = p.get("code_challenge") ?? undefined;
  const codeChallengeMethod = codeChallenge ? (p.get("code_challenge_method") ?? "S256") : undefined;
  if (app.clientType === "public" && !codeChallenge) return null;
  if (codeChallenge && codeChallengeMethod !== "S256") return null;

  const scopes = (p.get("scope") ?? "openid").split(" ").filter(Boolean);
  if (!scopes.includes("openid")) scopes.unshift("openid");

  return {
    appId: app.id,
    redirectUri,
    scopes,
    state: p.get("state") ?? undefined,
    nonce: p.get("nonce") ?? undefined,
    codeChallenge,
    codeChallengeMethod,
  };
}

// ─── Create ───────────────────────────────────────────

export type CreateResult =
  | { ok: true; requestId: string; pollSecret: string; code: string; qrSvg: string; expiresAt: Date }
  | { ok: false; status: number; error: string };

/**
 * The 6-digit code of a request. Derived from the request id with a server key instead of being stored, so the
 * approval page can show it for comparison while a database leak alone doesn't reveal it.
 */
export function codeOf(requestId: string): string {
  const n = parseInt(blindIndex("device-code", requestId).slice(0, 12), 16);
  return String(n % 1_000_000).padStart(6, "0");
}

/** Is this account allowed to be the target of the given kind of request at all? */
async function eligibleUser(userId: string, kind: DeviceKind, ip: string, userAgent: string | undefined) {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, isMaster: true, guestLoginEnabled: true, deviceLoginEnabled: true, forcePasswordChange: true, expiresAt: true },
  });
  if (!user) return null;
  // Guest accounts neither get asked nor approve: no guest sign-in, no sign-in on another device
  if (user.expiresAt) return null;
  if (kind === "GUEST" && (user.isMaster || !user.guestLoginEnabled)) return null;
  if (kind === "DEVICE" && !user.deviceLoginEnabled) return null;
  if (user.forcePasswordChange) return null;
  // The same rule as for a password login: a locked account is refused (unless the owner's familiar device asks)
  const lock = await checkAccountLock(userId);
  if (lock.locked && !(await isFamiliarDevice(userId))) return null;
  return user;
}

/**
 * Creates a request for the login in progress (`loginToken`). For an unknown, opted-out or otherwise ineligible account
 * a decoy is created that looks the same but can never be approved, so the answer doesn't reveal which accounts exist.
 */
export async function createDeviceLoginRequest(input: {
  loginToken: string;
  kind: DeviceKind;
  returnTo?: unknown;
  ip: string;
  userAgent?: string;
}): Promise<CreateResult> {
  const { loginToken, kind, ip, userAgent } = input;
  const loginSession = await getLoginSession(loginToken);
  if (!loginSession) return { ok: false, status: 400, error: "Ungültige Sitzung" };

  // Guests always belong to one app: the legacy app flow or the OIDC authorize request
  let appId: string | undefined;
  let redirectUri: string | undefined;
  let state: string | undefined;
  let oidc: OidcRequest | null = null;

  if (loginSession.appId) {
    const ctx = await resolveAppContext(loginSession.appId, loginSession.redirectUri ?? undefined);
    if (ctx?.redirectUri) {
      appId = ctx.appId;
      redirectUri = ctx.redirectUri;
      state = loginSession.state ?? undefined;
    }
  }
  if (!appId) {
    oidc = await resolveOidcRequest(input.returnTo);
    if (oidc) appId = oidc.appId;
  }
  if (kind === "GUEST" && !appId) {
    return { ok: false, status: 400, error: "Gast-Anmeldung ist nur für Apps verfügbar" };
  }

  let userId: string | null = null;
  if (loginSession.userId) {
    const user = await eligibleUser(loginSession.userId, kind, ip, userAgent);
    // A flood of requests for one account is answered with decoys too, never with an error
    if (user && rateLimitDeviceRequestPerAccount(user.id).allowed) userId = user.id;
  }

  const token = generateToken(32);
  const pollSecret = generateToken(32);
  const expiresAt = new Date(Date.now() + DEVICE_REQUEST_TTL_MS);

  if (userId) {
    // One open request per account: a new one replaces the old one
    await db.deviceLoginRequest.deleteMany({ where: { userId, status: { in: ["PENDING", "APPROVED"] } } });
  }

  const request = await db.deviceLoginRequest.create({
    data: {
      kind,
      userId,
      tokenHash: sha256(token),
      pollHash: sha256(pollSecret),
      loginSessionId: loginSession.id,
      appId,
      // Decoys still look the same to the requester but carry nothing worth keeping
      redirectUri: userId ? redirectUri : undefined,
      state: userId ? state : undefined,
      oidcRequest: userId && oidc ? JSON.stringify(oidc) : undefined,
      ipAddress: ip,
      userAgent: userAgent ?? null,
      expiresAt,
    },
  });

  if (userId) {
    await logAudit("DEVICE_LOGIN_REQUESTED", { kind, appId }, userId, ip, { userAgent, appId, useSession: false });
  }

  const link = `${getPublicBaseUrl()}/auth/device/${token}`;
  const qrSvg = await QRCode.toString(link, { type: "svg", margin: 1, errorCorrectionLevel: "M" });

  return { ok: true, requestId: request.id, pollSecret, code: codeOf(request.id), qrSvg, expiresAt };
}

// ─── Look up (approving side) ─────────────────────────

/** Is the request still open for an approval? */
export const isOpen = (r: { status: string; expiresAt: Date }) => r.status === "PENDING" && r.expiresAt > new Date();

export function findRequestByToken(rawToken: string) {
  if (!/^[0-9a-f]{64}$/.test(rawToken)) return Promise.resolve(null);
  return db.deviceLoginRequest.findUnique({ where: { tokenHash: sha256(rawToken) } });
}

/** The open request of an account, if any (there is at most one). */
export function findOpenRequestOf(userId: string) {
  return db.deviceLoginRequest.findFirst({
    where: { userId, status: "PENDING", expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
}

/** The code typed by the owner against the open request. Wrong codes count; too many end the request. */
export async function checkTypedCode(request: { id: string }, typed: string): Promise<"ok" | "wrong" | "locked"> {
  const given = Buffer.from(typed.padEnd(6, "x").slice(0, 6));
  const expected = Buffer.from(codeOf(request.id));
  if (/^\d{6}$/.test(typed) && crypto.timingSafeEqual(given, expected)) return "ok";

  const updated = await db.deviceLoginRequest.update({ where: { id: request.id }, data: { failedAttempts: { increment: 1 } } });
  if (updated.failedAttempts >= MAX_CODE_ATTEMPTS) {
    await db.deviceLoginRequest.updateMany({ where: { id: request.id, status: "PENDING" }, data: { status: "DENIED" } });
    return "locked";
  }
  return "wrong";
}

export function rateLimitCodeGuess(userId: string) {
  return checkRateLimit(`devcode:${userId}`, 15, 15 * 60 * 1000);
}

// ─── Finish (waiting device) ──────────────────────────

const fail = (status: number, error: string) => NextResponse.json({ status: "failed", error }, { status });

/**
 * Called by the waiting device once its request was approved. Runs exactly once (APPROVED → CONSUMED).
 * Returns the response of the login ending: `{ success, redirect }`.
 */
export async function finishDeviceLogin(
  request: NonNullable<Awaited<ReturnType<typeof findRequestByToken>>>,
  ip: string,
  userAgent: string | undefined
): Promise<NextResponse> {
  const claimed = await db.deviceLoginRequest.updateMany({ where: { id: request.id, status: "APPROVED" }, data: { status: "CONSUMED" } });
  if (claimed.count !== 1 || !request.userId) return NextResponse.json({ status: "pending" });

  const user = await db.user.findUnique({
    where: { id: request.userId },
    select: {
      id: true,
      username: true,
      email: true,
      isMaster: true,
      forcePasswordChange: true,
      sessionDurationHours: true,
      guestLoginEnabled: true,
      deviceLoginEnabled: true,
    },
  });
  if (!user) return fail(400, "Konto nicht gefunden");

  // Things may have changed between approval and pick-up (a few seconds, but never trust it blindly)
  const lock = await checkAccountLock(user.id);
  if (lock.locked && !(await isFamiliarDevice(user.id))) return fail(423, "Konto gesperrt. Versuche es später erneut.");

  const loginSession = request.loginSessionId ? await db.loginSession.findUnique({ where: { id: request.loginSessionId } }) : null;

  if (request.kind === "DEVICE") {
    if (!user.deviceLoginEnabled) return fail(403, "Anmeldung über ein anderes Gerät ist für dieses Konto ausgeschaltet");
    // Legacy app flow: completeLogin hands the app its code. In the OIDC flow the waiting device returns to
    // /oauth/authorize itself (now with a session), so completeLogin must not see an app context there.
    const legacy = !request.oidcRequest && !!request.redirectUri;
    return completeLogin(
      {
        token: loginSession?.token ?? "",
        appId: legacy ? request.appId : null,
        redirectUri: legacy ? request.redirectUri : null,
        state: legacy ? request.state : null,
      },
      user,
      ip,
      userAgent,
      "DEVICE_APPROVED"
    );
  }

  if (user.isMaster || !user.guestLoginEnabled) return fail(403, "Gast-Anmeldung ist für dieses Konto nicht möglich");
  if (user.forcePasswordChange) return fail(403, "Das Passwort muss zuerst geändert werden");
  if (loginSession) await db.loginSession.delete({ where: { id: loginSession.id } }).catch(() => {});
  return finishGuestLogin(request, user, ip, userAgent);
}

async function finishGuestLogin(
  request: { appId: string | null; redirectUri: string | null; state: string | null; oidcRequest: string | null; durationHours: number | null },
  user: { id: string },
  ip: string,
  userAgent: string | undefined
): Promise<NextResponse> {
  const oidc: OidcRequest | null = request.oidcRequest ? JSON.parse(request.oidcRequest) : null;
  const appId = oidc?.appId ?? request.appId;
  if (!appId) return fail(400, "App nicht gefunden");

  const app = await db.app.findUnique({ where: { id: appId } });
  if (!app || !app.isActive) return fail(400, "App nicht verfügbar");

  // The redirect target is checked again; what is stored was valid when the request was made, not necessarily now
  let redirectUri: string;
  if (oidc) {
    const allowed: string[] = JSON.parse(app.redirectUris);
    if (!app.oidcEnabled || !allowed.includes(oidc.redirectUri)) return fail(400, "Rücksprung-Adresse nicht erlaubt");
    redirectUri = oidc.redirectUri;
  } else {
    const ctx = await resolveAppContext(app.id, request.redirectUri ?? undefined);
    if (!ctx?.redirectUri) return fail(400, "Rücksprung-Adresse nicht erlaubt");
    redirectUri = ctx.redirectUri;
  }
  const state = oidc ? oidc.state : request.state ?? undefined;

  const permission = await db.userAppPermission.findUnique({
    where: { userId_appId: { userId: user.id, appId: app.id } },
    select: { permissionLevel: true },
  });
  const permissionLevel = permission?.permissionLevel ?? app.defaultPermission;

  if (permissionLevel === "DENY") {
    const errorUrl = new URL(redirectUri);
    errorUrl.searchParams.set("error", "access_denied");
    errorUrl.searchParams.set("error_description", "User does not have permission");
    if (state) errorUrl.searchParams.set("state", state);
    await logAudit("APP_ACCESS_DENIED", { protocol: oidc ? "oidc" : "app-token", reason: N_("Berechtigung DENY"), path: "/api/auth/device/status" }, user.id, ip, {
      appId: app.id,
      outcome: "DENIED",
      authVia: "GUEST",
      userAgent,
      useSession: false,
    });
    return NextResponse.json({ success: true, redirect: errorUrl.toString() });
  }

  // Apps behind nginx auth_request (legacy flow) check a cookie on every request; OIDC apps only use the tokens
  const { grant, cookieToken } = await createGuestGrant({
    userId: user.id,
    appId: app.id,
    hours: request.durationHours ?? DEFAULT_GUEST_HOURS,
    ip,
    userAgent,
    withCookie: !oidc,
  });

  const code = oidc
    ? await createOIDCAuthCode(app.id, user.id, redirectUri, oidc.scopes, oidc.codeChallenge, oidc.codeChallengeMethod, state, oidc.nonce, grant.id)
    : await createAuthCode(app.id, user.id, permissionLevel, redirectUri, state, grant.id);
  if (cookieToken) await setGuestCookie(cookieToken, grant.expiresAt);

  const redirectUrl = new URL(redirectUri);
  redirectUrl.searchParams.set("code", code);
  if (state) redirectUrl.searchParams.set("state", state);

  await logAudit("GUEST_LOGIN", { until: grant.expiresAt.toISOString(), protocol: oidc ? "oidc" : "app-token" }, user.id, ip, {
    appId: app.id,
    authVia: "GUEST",
    userAgent,
    useSession: false,
    targetType: "GUEST_GRANT",
    targetId: grant.id,
  });
  await logAudit(
    "APP_LOGIN",
    {
      protocol: oidc ? "oidc" : "app-token",
      via: "GUEST",
      redirect: redirectUrl.origin + redirectUrl.pathname,
      permission: permissionLevel,
    },
    user.id,
    ip,
    { appId: app.id, authVia: "GUEST", userAgent, useSession: false }
  );

  return NextResponse.json({ success: true, redirect: redirectUrl.toString() });
}

// ─── Display (approving side) ─────────────────────────

/** What the owner sees about a request before approving it. */
export async function describeRequest(
  r: {
    id: string;
    kind: string;
    appId: string | null;
    ipAddress: string;
    userAgent: string | null;
    createdAt: Date;
    expiresAt: Date;
  },
  locale: Locale
) {
  const app = r.appId ? await db.app.findUnique({ where: { id: r.appId }, select: { name: true } }) : null;
  return {
    id: r.id,
    kind: r.kind as DeviceKind,
    appName: app?.name ?? null,
    device: describeDevice(r.userAgent),
    ip: r.ipAddress,
    location: await locateIp(r.ipAddress, locale),
    createdAt: r.createdAt.toISOString(),
    expiresInSec: Math.max(0, Math.floor((r.expiresAt.getTime() - Date.now()) / 1000)),
  };
}
