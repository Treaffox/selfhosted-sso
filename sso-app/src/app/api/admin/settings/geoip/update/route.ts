import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { checkRateLimit } from "@/lib/rate-limit";
import { downloadGeoipDatabase, getMaxmindConfig } from "@/lib/geoip-update";

/** POST: download the database again with the saved account (master only). */
export async function POST() {
  const session = await getSession();
  if (!session?.user.isMaster) {
    return NextResponse.json({ error: "Zugriff verweigert" }, { status: 403 });
  }
  const rl = checkRateLimit(`geoip-update:${session.user.id}`, 3, 10 * 60_000);
  if (!rl.allowed) return NextResponse.json({ error: "Zu viele Versuche. Bitte warte kurz." }, { status: 429 });

  if (!(await getMaxmindConfig())) return NextResponse.json({ error: "MaxMind ist nicht eingerichtet" }, { status: 400 });
  const result = await downloadGeoipDatabase();
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 });
  return NextResponse.json({ success: true, builtAt: result.builtAt.toISOString() });
}
