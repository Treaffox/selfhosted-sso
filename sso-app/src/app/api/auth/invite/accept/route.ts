import { NextResponse } from "next/server";
import { acceptInvite } from "@/lib/invite";
import { passwordSchema } from "@/lib/validation";
import { getClientIp } from "@/lib/ip";
import { checkRateLimit } from "@/lib/rate-limit";

/**
 * Invited person chooses a password.
 * POST /api/auth/invite/accept  Body: { token, password }
 */
export async function POST(request: Request) {
  const ip = getClientIp(request);
  const rl = checkRateLimit(`invite:${ip}`, 10, 15 * 60 * 1000);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Zu viele Versuche. Bitte warte.", retryAfter: Math.ceil((rl.resetAt - Date.now()) / 1000) }, { status: 429 });
  }

  const body = await request.json().catch(() => null);
  const token = typeof body?.token === "string" ? body.token.slice(0, 128) : "";
  const parsed = passwordSchema.safeParse(body?.password);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const accepted = await acceptInvite(token, parsed.data, ip);
  if (!accepted) {
    return NextResponse.json({ error: "Der Einladungslink ist abgelaufen oder wurde schon benutzt" }, { status: 410 });
  }
  return NextResponse.json({ success: true });
}
