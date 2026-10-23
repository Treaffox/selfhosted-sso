import { NextResponse, type NextRequest } from "next/server";
import { exchangeOIDCCode } from "@/lib/oidc";
import { rateLimitApi } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/ip";
import { logAudit } from "@/lib/audit";

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const rl = rateLimitApi(ip);
  if (!rl.allowed) {
    await logAudit("RATE_LIMITED", { scope: "oauth-token", retryAfterSec: Math.ceil((rl.resetAt - Date.now()) / 1000) }, undefined, ip, { outcome: "DENIED", useSession: false });
    return NextResponse.json(
      { error: "rate_limit_exceeded" },
      { status: 429 }
    );
  }

  let body: Record<string, string> = {};

  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const text = await request.text();
    const params = new URLSearchParams(text);
    params.forEach((value, key) => {
      body[key] = value;
    });
  } else if (contentType.includes("application/json")) {
    try {
      const parsed = await request.json();
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
      body = parsed;
    } catch {
      return NextResponse.json({ error: "invalid_request", error_description: "Invalid JSON body" }, { status: 400 });
    }
  } else {
    return NextResponse.json(
      { error: "invalid_request", error_description: "Unsupported content type" },
      { status: 400 }
    );
  }

  // Every parameter must be a string (JSON bodies could carry arrays/objects)
  const asString = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
  const grantType = asString(body.grant_type);
  const code = asString(body.code);
  const redirectUri = asString(body.redirect_uri);
  const codeVerifier = asString(body.code_verifier);

  let clientId = asString(body.client_id);
  let clientSecret = asString(body.client_secret);

  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Basic ")) {
    const base64 = authHeader.slice(6);
    const decoded = Buffer.from(base64, "base64").toString("utf8");
    const sep = decoded.indexOf(":"); // the secret may itself contain ":"
    if (sep > 0) {
      clientId = decoded.slice(0, sep);
      clientSecret = decoded.slice(sep + 1) || clientSecret;
    }
  }

  if (grantType !== "authorization_code") {
    return NextResponse.json(
      { error: "unsupported_grant_type" },
      { status: 400 }
    );
  }

  if (!code || !clientId || !redirectUri) {
    return NextResponse.json(
      { error: "invalid_request", error_description: "Missing required parameters" },
      { status: 400 }
    );
  }

  const tokens = await exchangeOIDCCode(
    code,
    clientId,
    clientSecret,
    redirectUri,
    codeVerifier
  );

  if (!tokens) {
    await logAudit("OIDC_TOKEN_FAILED", { clientId, reason: "invalid_grant" }, undefined, ip, { outcome: "FAILURE", useSession: false });
    return NextResponse.json(
      { error: "invalid_grant", error_description: "Invalid or expired code" },
      { status: 400 }
    );
  }

  return NextResponse.json(tokens, {
    headers: {
      "Cache-Control": "no-store",
      "Pragma": "no-cache",
    },
  });
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}
