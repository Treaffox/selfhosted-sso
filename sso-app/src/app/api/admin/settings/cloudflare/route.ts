import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { logAudit } from "@/lib/auth";
import { getClientIp } from "@/lib/ip";
import { requireReauth } from "@/lib/reauth";
import { clearCloudflareConfig, getCloudflareConfig, saveCloudflareConfig } from "@/lib/cloudflare";

/** GET: is Cloudflare connected, and for which zone? The token never leaves the server (master only). */
export async function GET() {
  const session = await getSession();
  if (!session?.user.isMaster) {
    return NextResponse.json({ error: "Zugriff verweigert" }, { status: 403 });
  }
  const config = await getCloudflareConfig();
  return NextResponse.json({ configured: !!config, zoneId: config?.zoneId ?? "" });
}

/** PUT: save token + zone id (empty token keeps the stored one). Needs the admin's password again. */
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
    const denied = await requireReauth(session.user.id, body?.password, "settings-cloudflare", ip);
    if (denied) return denied;

    const result = await saveCloudflareConfig({ token: typeof body.token === "string" ? body.token : undefined, zoneId: String(body.zoneId ?? "") });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

    await logAudit("SETTINGS_CLOUDFLARE_UPDATED", {}, session.user.id, ip);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof SyntaxError) return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
    console.error("[CLOUDFLARE SETTINGS ERROR]", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Fehler" }, { status: 500 });
  }
}

/** DELETE: disconnect Cloudflare. DNS records already created stay in Cloudflare and in the app list. */
export async function DELETE(request: Request) {
  const session = await getSession();
  if (!session?.user.isMaster) {
    return NextResponse.json({ error: "Zugriff verweigert" }, { status: 403 });
  }
  const ip = getClientIp(request);
  const body = await request.json().catch(() => null);
  const denied = await requireReauth(session.user.id, body?.password, "settings-cloudflare", ip);
  if (denied) return denied;

  await clearCloudflareConfig();
  await logAudit("SETTINGS_CLOUDFLARE_UPDATED", { removed: true }, session.user.id, ip);
  return NextResponse.json({ success: true });
}
