import * as jose from "jose";
import crypto from "crypto";
import { db } from "./db";
import { generateToken, sha256 } from "./crypto";
import { getAvatarUrl } from "./avatar";
import { logAudit } from "./audit";
import { getAppUrl } from "./config";

const ACCESS_TOKEN_TTL = 3600; // 1 hour
const ID_TOKEN_TTL = 3600; // 1 hour
const REFRESH_TOKEN_TTL = 30 * 24 * 3600; // 30 days

let cachedKeyPair: { privateKey: jose.KeyLike; publicKey: jose.KeyLike; jwk: jose.JWK } | null = null;

const getIssuer = getAppUrl;

async function getKeyPair() {
  if (cachedKeyPair) return cachedKeyPair;

  let privateKey: jose.KeyLike;
  let publicKey: jose.KeyLike;

  const pem = process.env.OIDC_PRIVATE_KEY_PEM?.replace(/\\n/g, "\n");
  if (pem) {
    // Persistent key: ID tokens stay verifiable across restarts and the JWKS doesn't rotate
    privateKey = await jose.importPKCS8(pem, "RS256", { extractable: true });
    const publicKeyObject = crypto.createPublicKey(crypto.createPrivateKey(pem));
    publicKey = await jose.importSPKI(publicKeyObject.export({ type: "spki", format: "pem" }).toString(), "RS256", { extractable: true });
  } else {
    // Fallback: an ephemeral key per process start. Set OIDC_PRIVATE_KEY_PEM (PKCS#8) to make it stable.
    console.warn("[OIDC] OIDC_PRIVATE_KEY_PEM nicht gesetzt: Signing-Key wird bei jedem Start neu erzeugt");
    ({ publicKey, privateKey } = await jose.generateKeyPair("RS256", { modulusLength: 2048, extractable: true }));
  }

  const jwk = await jose.exportJWK(publicKey);
  jwk.kid = crypto.createHash("sha256").update(JSON.stringify(jwk)).digest("hex").slice(0, 16);
  jwk.use = "sig";
  jwk.alg = "RS256";

  cachedKeyPair = { privateKey, publicKey, jwk };
  return cachedKeyPair;
}

export async function getJWKS(): Promise<{ keys: jose.JWK[] }> {
  const { jwk } = await getKeyPair();
  return { keys: [jwk] };
}

/** The user's level for an app: the explicit assignment, otherwise the app's default. */
async function resolvePermission(userId: string, app: { id: string; defaultPermission: string }): Promise<string> {
  const permission = await db.userAppPermission.findUnique({
    where: { userId_appId: { userId, appId: app.id } },
    select: { permissionLevel: true },
  });
  return permission?.permissionLevel ?? app.defaultPermission;
}

/** Guest access an issued token belongs to: the token never outlives it. */
export interface GuestLimit {
  id: string;
  expiresAt: Date;
}

/** Lifetime in seconds: the regular one, shortened to the remaining time of a guest grant. */
function ttlFor(regular: number, guest?: GuestLimit): number {
  if (!guest) return regular;
  return Math.max(1, Math.min(regular, Math.floor((guest.expiresAt.getTime() - Date.now()) / 1000)));
}

export async function generateIdToken(
  userId: string,
  clientId: string,
  scopes: string[],
  nonce?: string,
  permission?: string,
  guest?: GuestLimit
): Promise<string> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, username: true, email: true, avatarUpdatedAt: true },
  });
  if (!user) throw new Error("User not found");

  const { privateKey, jwk } = await getKeyPair();
  const issuer = getIssuer();
  const now = Math.floor(Date.now() / 1000);

  const claims: jose.JWTPayload = {
    iss: issuer,
    sub: user.id,
    aud: clientId,
    exp: now + ttlFor(ID_TOKEN_TTL, guest),
    iat: now,
    auth_time: now,
  };

  if (nonce) claims.nonce = nonce;
  // App-specific level (ALLOW, ADMIN, ...): only meaningful for this client, so no scope needed
  if (permission) claims.permission = permission;
  // Guest login (see /settings/sessions): limited to this app, ends with exp
  if (guest) claims.guest = true;
  if (scopes.includes("profile")) {
    claims.preferred_username = user.username;
    const picture = getAvatarUrl(user);
    if (picture) claims.picture = picture;
  }
  if (scopes.includes("email") && user.email) {
    claims.email = user.email;
    claims.email_verified = true;
  }

  return new jose.SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: jwk.kid })
    .sign(privateKey);
}

export async function generateAccessToken(
  userId: string,
  clientId: string,
  scopes: string[],
  guest?: GuestLimit
): Promise<{ token: string; expiresIn: number }> {
  const token = generateToken(32);
  const expiresIn = ttlFor(ACCESS_TOKEN_TTL, guest);

  await db.oAuthAccessToken.create({
    data: {
      token: sha256(token),
      appId: await getAppIdByClientId(clientId),
      userId,
      scopes: JSON.stringify(scopes),
      guestGrantId: guest?.id,
      expiresAt: new Date(Date.now() + expiresIn * 1000),
    },
  });

  return { token, expiresIn };
}

async function getAppIdByClientId(clientId: string): Promise<string> {
  const app = await db.app.findFirst({
    where: { OR: [{ clientId }, { id: clientId }] },
    select: { id: true },
  });
  if (!app) throw new Error("App not found");
  return app.id;
}

export async function validateAccessToken(token: string) {
  const tokenHash = sha256(token);
  const accessToken = await db.oAuthAccessToken.findUnique({
    where: { token: tokenHash },
    include: {
      user: { select: { id: true, username: true, email: true, avatarUpdatedAt: true } },
      app: true,
      guestGrant: { select: { id: true, expiresAt: true } },
    },
  });

  if (!accessToken || accessToken.expiresAt < new Date()) {
    if (accessToken) {
      await db.oAuthAccessToken.delete({ where: { id: accessToken.id } }).catch(() => {});
    }
    return null;
  }

  if (!accessToken.app.oidcEnabled || !accessToken.app.isActive) {
    // OIDC / the app was disabled after this (still short-lived) token was issued.
    return null;
  }

  // Guest access ended (ending it deletes the token as well; this covers a grant that merely ran out)
  if (accessToken.guestGrantId && (!accessToken.guestGrant || accessToken.guestGrant.expiresAt < new Date())) {
    return null;
  }

  // Access revoked since the token was issued
  const permission = await resolvePermission(accessToken.userId, accessToken.app);
  if (permission === "DENY") {
    return null;
  }

  return {
    user: accessToken.user,
    app: accessToken.app,
    scopes: JSON.parse(accessToken.scopes) as string[],
    permission,
    guest: !!accessToken.guestGrant,
  };
}

export function verifyPKCE(codeVerifier: string, codeChallenge: string, method: string): boolean {
  // Only S256 is supported ("plain" offers no protection and is rejected at /oauth/authorize)
  if (method === "S256") {
    const hash = crypto.createHash("sha256").update(codeVerifier).digest();
    const computed = Buffer.from(hash.toString("base64url"));
    const given = Buffer.from(codeChallenge);
    return computed.length === given.length && crypto.timingSafeEqual(computed, given);
  }
  return false;
}

export function generateClientCredentials(): { clientId: string; clientSecret: string; secretHash: string; secretPrefix: string } {
  const clientId = `sso_${generateToken(16)}`;
  const clientSecret = `ssos_${generateToken(32)}`;
  const secretHash = sha256(clientSecret);
  const secretPrefix = clientSecret.slice(0, 14);
  return { clientId, clientSecret, secretHash, secretPrefix };
}

export async function createOIDCAuthCode(
  appId: string,
  userId: string,
  redirectUri: string,
  scopes: string[],
  codeChallenge?: string,
  codeChallengeMethod?: string,
  state?: string,
  nonce?: string,
  guestGrantId?: string
): Promise<string> {
  const code = generateToken(32);

  const app = await db.app.findUnique({ where: { id: appId } });
  if (!app) throw new Error("App not found");

  const permissionLevel = await resolvePermission(userId, app);

  await db.authCode.create({
    data: {
      code,
      appId,
      userId,
      permissionLevel,
      redirectUri,
      state,
      scopes: JSON.stringify(scopes),
      codeChallenge,
      codeChallengeMethod,
      nonce,
      guestGrantId,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    },
  });

  return code;
}

export async function exchangeOIDCCode(
  code: string,
  clientId: string,
  clientSecret: string | undefined,
  redirectUri: string,
  codeVerifier?: string
): Promise<{
  access_token: string;
  token_type: string;
  expires_in: number;
  id_token: string;
  scope: string;
} | null> {
  const authCode = await db.authCode.findUnique({
    where: { code },
    include: { app: true, guestGrant: { select: { id: true, expiresAt: true } } },
  });

  if (!authCode || authCode.used || authCode.expiresAt < new Date()) return null;
  if (authCode.guestGrantId && (!authCode.guestGrant || authCode.guestGrant.expiresAt < new Date())) return null;

  const app = authCode.app;
  if (!app.isActive || !app.oidcEnabled) return null;

  const appClientId = app.clientId ?? app.id;
  if (appClientId !== clientId) return null;
  if (authCode.redirectUri !== redirectUri) return null;

  if (app.clientType === "confidential") {
    if (!clientSecret || !app.clientSecret) return null;
    const given = Buffer.from(sha256(clientSecret));
    const stored = Buffer.from(app.clientSecret);
    if (given.length !== stored.length || !crypto.timingSafeEqual(given, stored)) return null;
  }

  // Public clients have no secret: PKCE is their only proof of possession
  if (app.clientType === "public" && !authCode.codeChallenge) return null;

  if (authCode.codeChallenge && authCode.codeChallengeMethod) {
    if (!codeVerifier) return null;
    if (!verifyPKCE(codeVerifier, authCode.codeChallenge, authCode.codeChallengeMethod)) return null;
  }

  // The level may have been changed or revoked since the code was issued: the token carries the current one
  const permission = await resolvePermission(authCode.userId, app);
  if (permission === "DENY") return null;

  // Redeem exactly once: of several parallel requests only one flips `used` from false to true
  const redeemed = await db.authCode.updateMany({ where: { id: authCode.id, used: false }, data: { used: true } });
  if (redeemed.count !== 1) return null;

  const scopes = authCode.scopes ? JSON.parse(authCode.scopes) as string[] : ["openid"];
  const guest = authCode.guestGrant ?? undefined;
  const { token: accessToken, expiresIn } = await generateAccessToken(authCode.userId, clientId, scopes, guest);
  const idToken = await generateIdToken(authCode.userId, clientId, scopes, authCode.nonce ?? undefined, permission, guest);

  await logAudit("OIDC_TOKEN_ISSUED", { scopes, permission, ...(guest ? { guest: true } : {}) }, authCode.userId, undefined, { appId: app.id, appName: app.name, authVia: "OIDC_CODE", useSession: false });

  return {
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: expiresIn,
    id_token: idToken,
    scope: scopes.join(" "),
  };
}

export function getOIDCConfiguration() {
  const issuer = getIssuer();
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    userinfo_endpoint: `${issuer}/oauth/userinfo`,
    jwks_uri: `${issuer}/.well-known/jwks.json`,
    registration_endpoint: undefined,
    scopes_supported: ["openid", "profile", "email"],
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code"],
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["RS256"],
    token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic", "none"],
    claims_supported: ["sub", "iss", "aud", "exp", "iat", "auth_time", "nonce", "preferred_username", "picture", "email", "email_verified", "permission", "guest"],
    code_challenge_methods_supported: ["S256"],
  };
}
