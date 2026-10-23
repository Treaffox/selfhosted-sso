import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { checkRateLimit } from "@/lib/rate-limit";
import { CloudflareError, getZoneName, isCloudflareConfigured } from "@/lib/cloudflare";

/** POST: ask Cloudflare for the zone with the saved credentials (master only). */
export async function POST() {
  const session = await getSession();
  if (!session?.user.isMaster) {
    return NextResponse.json({ error: "Zugriff verweigert" }, { status: 403 });
  }
  const rl = checkRateLimit(`cftest:${session.user.id}`, 10, 60_000);
  if (!rl.allowed) return NextResponse.json({ error: "Zu viele Versuche. Bitte warte kurz." }, { status: 429 });

  if (!(await isCloudflareConfigured())) return NextResponse.json({ error: "Cloudflare ist nicht konfiguriert" }, { status: 400 });
  try {
    return NextResponse.json({ success: true, zoneName: await getZoneName() });
  } catch (e) {
    return NextResponse.json({ error: e instanceof CloudflareError ? e.message : "Fehler" }, { status: e instanceof CloudflareError ? e.status : 500 });
  }
}
