import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { logAudit } from "@/lib/auth";
import { getClientIp } from "@/lib/ip";
import { requireReauth } from "@/lib/reauth";
import { getSecuritySettings, saveSecuritySettings } from "@/lib/security-settings";

/** GET: security policy (master only). */
export async function GET() {
  const session = await getSession();
  if (!session?.user.isMaster) {
    return NextResponse.json({ error: "Zugriff verweigert" }, { status: 403 });
  }
  return NextResponse.json({ settings: await getSecuritySettings() });
}

/** PUT: change the security policy. Needs the admin's password again, because it can weaken the login. */
export async function PUT(request: Request) {
  const session = await getSession();
  if (!session?.user.isMaster) {
    return NextResponse.json({ error: "Zugriff verweigert" }, { status: 403 });
  }
  const ip = getClientIp(request);

  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
    }
    const denied = await requireReauth(session.user.id, body?.password, "settings-security", ip);
    if (denied) return denied;

    const result = await saveSecuritySettings(body);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

    await logAudit("SETTINGS_SECURITY_UPDATED", { requireMfa: result.value.requireMfa }, session.user.id, ip);
    return NextResponse.json({ success: true, settings: result.value });
  } catch (error) {
    if (error instanceof SyntaxError) return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
    console.error("[SECURITY SETTINGS ERROR]", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Fehler" }, { status: 500 });
  }
}
