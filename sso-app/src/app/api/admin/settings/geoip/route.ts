import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { logAudit } from "@/lib/auth";
import { getClientIp } from "@/lib/ip";
import { requireReauth } from "@/lib/reauth";
import { clearMaxmindConfig, downloadGeoipDatabase, getGeoipStatus, saveMaxmindConfig } from "@/lib/geoip-update";

/** GET: MaxMind account (without the key) and the state of the downloaded database (master only). */
export async function GET() {
  const session = await getSession();
  if (!session?.user.isMaster) {
    return NextResponse.json({ error: "Zugriff verweigert" }, { status: 403 });
  }
  return NextResponse.json(await getGeoipStatus());
}

/** PUT: save account ID + license key (empty key keeps the stored one) and fetch the database right away. Needs the admin's password again. */
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
    const denied = await requireReauth(session.user.id, body?.password, "settings-geoip", ip);
    if (denied) return denied;

    const result = await saveMaxmindConfig({
      accountId: String(body.accountId ?? ""),
      licenseKey: typeof body.licenseKey === "string" ? body.licenseKey : undefined,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    await logAudit("SETTINGS_GEOIP_UPDATED", {}, session.user.id, ip);

    // Saved either way; whether MaxMind accepts the account shows right here
    const download = await downloadGeoipDatabase();
    return NextResponse.json({ success: true, download: download.ok ? { ok: true } : { ok: false, error: download.error } });
  } catch (error) {
    if (error instanceof SyntaxError) return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
    console.error("[GEOIP SETTINGS ERROR]", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Fehler" }, { status: 500 });
  }
}

/** DELETE: remove the MaxMind account and the downloaded database. Locations are no longer shown. */
export async function DELETE(request: Request) {
  const session = await getSession();
  if (!session?.user.isMaster) {
    return NextResponse.json({ error: "Zugriff verweigert" }, { status: 403 });
  }
  const ip = getClientIp(request);
  const body = await request.json().catch(() => null);
  const denied = await requireReauth(session.user.id, body?.password, "settings-geoip", ip);
  if (denied) return denied;

  await clearMaxmindConfig();
  await logAudit("SETTINGS_GEOIP_UPDATED", { removed: true }, session.user.id, ip);
  return NextResponse.json({ success: true });
}
