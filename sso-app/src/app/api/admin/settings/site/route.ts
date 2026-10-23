import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { logAudit } from "@/lib/auth";
import { getClientIp } from "@/lib/ip";
import { getAssetInfos, getSiteSettings, saveSiteSettings } from "@/lib/site-settings";

/** GET: general settings + which images are uploaded (master only). */
export async function GET() {
  const session = await getSession();
  if (!session?.user.isMaster) {
    return NextResponse.json({ error: "Zugriff verweigert" }, { status: 403 });
  }
  const [site, assets] = await Promise.all([getSiteSettings(), getAssetInfos()]);
  return NextResponse.json({ site, assets });
}

/** PUT: name, tagline, footer links, mail header color, time zone (master only). */
export async function PUT(request: Request) {
  const session = await getSession();
  if (!session?.user.isMaster) {
    return NextResponse.json({ error: "Zugriff verweigert" }, { status: 403 });
  }

  try {
    const result = await saveSiteSettings(await request.json());
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    await logAudit("SETTINGS_SITE_UPDATED", {}, session.user.id, getClientIp(request));
    return NextResponse.json({ success: true, site: result.value });
  } catch (error) {
    console.error("[SITE SETTINGS ERROR]", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Fehler" }, { status: 500 });
  }
}
