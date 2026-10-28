import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/server";
import { describeRequest, findOpenRequestOf, GUEST_DURATIONS_HOURS, DEFAULT_GUEST_HOURS } from "@/lib/device-login";

/** GET: the open request of the signed-in account (what the prompt on SSO pages shows), or null. */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Nicht authentifiziert" }, { status: 401 });

  const open = await findOpenRequestOf(session.user.id);
  return NextResponse.json({
    request: open ? await describeRequest(open, await getLocale()) : null,
    durations: GUEST_DURATIONS_HOURS,
    defaultDuration: DEFAULT_GUEST_HOURS,
  });
}
