import { NextResponse, type NextRequest } from "next/server";
import { getLoginSession, updateLoginSession, generatePasskeyAuthenticationOptions } from "@/lib/auth";
import { getClientIp } from "@/lib/ip";
import { rateLimitLogin } from "@/lib/rate-limit";

/**
 * Get passkey authentication options (challenge).
 *
 * POST /api/auth/passkey/authenticate/options
 * Body: { loginToken: string }
 */
export async function POST(request: NextRequest) {
  try {
    const rl = rateLimitLogin(getClientIp(request));
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Zu viele Anmeldeversuche. Bitte warte.", retryAfter: Math.ceil((rl.resetAt - Date.now()) / 1000) },
        { status: 429 }
      );
    }

    const body = await request.json().catch(() => null);
    const loginToken = typeof body?.loginToken === "string" ? body.loginToken.slice(0, 128) : null;

    const loginSession = loginToken ? await getLoginSession(loginToken) : null;
    if (!loginSession) {
      return NextResponse.json({ error: "Ungültige Sitzung" }, { status: 400 });
    }

    // A session of an unknown username gets options too (without a credential list), so asking for options
    // doesn't reveal whether the username exists. The verify step then fails like a wrong passkey.
    const options = await generatePasskeyAuthenticationOptions(loginSession.userId ?? undefined);

    // Store challenge in login session (single use, see verify)
    await updateLoginSession(loginSession.token, {
      step: "PASSKEY",
      challenge: options.challenge,
    });

    return NextResponse.json(options);
  } catch (error) {
    console.error("[PASSKEY AUTH OPTIONS ERROR]", error instanceof Error ? error.message : "unbekannter Fehler");
    return NextResponse.json({ error: "Fehler" }, { status: 500 });
  }
}
