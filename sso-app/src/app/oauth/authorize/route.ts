import { effectivePermission } from "@/lib/guest-account";
import { needsMfaSetup } from "@/lib/mfa-policy";
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { createOIDCAuthCode } from "@/lib/oidc";
import { logAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/ip";
import { getPublicBaseUrl } from "@/lib/avatar";
import { N_ } from "@/lib/i18n/core";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const params = url.searchParams;

  const clientId = params.get("client_id");
  const redirectUri = params.get("redirect_uri");
  const responseType = params.get("response_type");
  const scope = params.get("scope") ?? "openid";
  const state = params.get("state");
  const nonce = params.get("nonce");
  const codeChallenge = params.get("code_challenge");
  const codeChallengeMethod = params.get("code_challenge_method") ?? "S256";

  if (!clientId || !redirectUri || responseType !== "code") {
    return NextResponse.json(
      { error: "invalid_request", error_description: "Missing required parameters" },
      { status: 400 }
    );
  }

  const app = await db.app.findFirst({
    where: {
      OR: [{ clientId }, { id: clientId }],
      isActive: true,
    },
  });

  if (!app) {
    return NextResponse.json(
      { error: "invalid_client", error_description: "Unknown client" },
      { status: 400 }
    );
  }

  if (!app.oidcEnabled) {
    return NextResponse.json(
      { error: "invalid_client", error_description: "OIDC is disabled for this client" },
      { status: 400 }
    );
  }

  const allowedUris: string[] = JSON.parse(app.redirectUris);
  if (!allowedUris.includes(redirectUri)) {
    return NextResponse.json(
      { error: "invalid_request", error_description: "Invalid redirect_uri" },
      { status: 400 }
    );
  }

  // Public clients have no client_secret, so PKCE is the only proof-of-possession
  // mechanism protecting the authorization code — it must not be optional for them.
  if (app.clientType === "public" && !codeChallenge) {
    return NextResponse.json(
      { error: "invalid_request", error_description: "code_challenge is required for public clients" },
      { status: 400 }
    );
  }

  // Only S256: "plain" sends the secret in the clear and defeats the purpose of PKCE
  if (codeChallenge && codeChallengeMethod !== "S256") {
    return NextResponse.json(
      { error: "invalid_request", error_description: "Only code_challenge_method=S256 is supported" },
      { status: 400 }
    );
  }

  const scopes = scope.split(" ").filter(Boolean);
  if (!scopes.includes("openid")) {
    scopes.unshift("openid");
  }

  const session = await getSession();

  if (!session) {
    // Build the external URL from the configured public base URL, not from request headers
    const base = getPublicBaseUrl();
    const externalUrl = `${base}${url.pathname}${url.search}`;

    const loginUrl = new URL("/auth/login", base);
    loginUrl.searchParams.set("returnTo", externalUrl);
    return NextResponse.redirect(loginUrl);
  }

  // Same rule as everywhere else: a temporary password has to be changed before any app is reachable
  if (session.user.forcePasswordChange) {
    await logAudit("APP_ACCESS_DENIED", { protocol: "oidc", reason: N_("Passwortänderung erforderlich"), path: url.pathname }, session.userId, getClientIp(request), { appId: app.id, outcome: "DENIED", authVia: "EXISTING_SESSION" });
    return NextResponse.redirect(new URL("/settings/security?changePassword=1", getPublicBaseUrl()));
  }

  // A password-only account (no authenticator, e-mail or passkey) has to set up a second factor first
  if (await needsMfaSetup(session.user)) {
    await logAudit("APP_ACCESS_DENIED", { protocol: "oidc", reason: N_("Zweiter Faktor erforderlich"), path: url.pathname }, session.userId, getClientIp(request), { appId: app.id, outcome: "DENIED", authVia: "EXISTING_SESSION" });
    return NextResponse.redirect(new URL("/settings/security?setupMfa=1", getPublicBaseUrl()));
  }

  const permission = await db.userAppPermission.findUnique({
    where: { userId_appId: { userId: session.userId, appId: app.id } },
  });
  const permissionLevel = effectivePermission(permission?.permissionLevel, app.defaultPermission, session.user);
  const ip = getClientIp(request);
  if (permissionLevel === "DENY") {
    await logAudit("APP_ACCESS_DENIED", { protocol: "oidc", reason: N_("Berechtigung DENY"), path: url.pathname }, session.userId, ip, { appId: app.id, outcome: "DENIED", authVia: "EXISTING_SESSION" });
    const errorUrl = new URL(redirectUri);
    errorUrl.searchParams.set("error", "access_denied");
    errorUrl.searchParams.set("error_description", "User does not have permission");
    if (state) errorUrl.searchParams.set("state", state);
    return NextResponse.redirect(errorUrl);
  }

  const code = await createOIDCAuthCode(
    app.id,
    session.userId,
    redirectUri,
    scopes,
    codeChallenge ?? undefined,
    codeChallenge ? codeChallengeMethod : undefined,
    state ?? undefined,
    nonce ?? undefined
  );

  const callbackUrl = new URL(redirectUri);
  callbackUrl.searchParams.set("code", code);
  if (state) callbackUrl.searchParams.set("state", state);

  await logAudit(
    "APP_LOGIN",
    { protocol: "oidc", via: "EXISTING_SESSION", scopes, redirect: callbackUrl.origin + callbackUrl.pathname, permission: permissionLevel },
    session.userId,
    ip,
    { appId: app.id, authVia: "EXISTING_SESSION" }
  );

  return NextResponse.redirect(callbackUrl);
}
