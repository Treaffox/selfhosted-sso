import { NextResponse, type NextRequest } from "next/server";
import { validateAccessToken } from "@/lib/oidc";
import { getAvatarUrl } from "@/lib/avatar";
import { logAudit } from "@/lib/audit";

async function handleUserInfo(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json(
      { error: "invalid_token", error_description: "Missing or invalid Authorization header" },
      { status: 401, headers: { "WWW-Authenticate": "Bearer" } }
    );
  }

  const token = authHeader.slice(7);
  const tokenData = await validateAccessToken(token);

  if (!tokenData) {
    return NextResponse.json(
      { error: "invalid_token", error_description: "Token is invalid or expired" },
      { status: 401, headers: { "WWW-Authenticate": 'Bearer error="invalid_token"' } }
    );
  }

  const { user, scopes, app, permission, guest } = tokenData;
  await logAudit("OIDC_USERINFO", { scopes }, user.id, undefined, { appId: app.id, appName: app.name, useSession: false });
  const claims: Record<string, unknown> = {
    sub: user.id,
    permission,
  };
  if (guest) claims.guest = true;

  if (scopes.includes("profile")) {
    claims.preferred_username = user.username;
    claims.name = user.username;
    const picture = getAvatarUrl(user);
    if (picture) claims.picture = picture;
  }

  if (scopes.includes("email") && user.email) {
    claims.email = user.email;
    claims.email_verified = true;
  }

  return NextResponse.json(claims, {
    headers: {
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

export async function GET(request: NextRequest) {
  return handleUserInfo(request);
}

export async function POST(request: NextRequest) {
  return handleUserInfo(request);
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization",
    },
  });
}
