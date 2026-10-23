import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/session";
import { logAudit } from "@/lib/auth";
import { getClientIp } from "@/lib/ip";
import { checkRateLimit } from "@/lib/rate-limit";
import { buildTestMail } from "@/lib/email";
import { testChannel } from "@/lib/mail";

const schema = z.object({
  channel: z.enum(["primary", "fallback"]),
  to: z.string().trim().email("Empfänger-Adresse ist ungültig").max(200),
});

/** POST: send a test mail through one saved provider and report the real result (master only). */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session?.user.isMaster) {
    return NextResponse.json({ error: "Zugriff verweigert" }, { status: 403 });
  }

  const rl = checkRateLimit(`mailtest:${session.user.id}`, 6, 60_000);
  if (!rl.allowed) return NextResponse.json({ error: "Zu viele Testmails. Bitte warte kurz." }, { status: 429 });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });

  const result = await testChannel(parsed.data.channel, await buildTestMail(parsed.data.to));
  await logAudit("MAIL_TEST_SENT", { channel: parsed.data.channel, ok: result.ok }, session.user.id, getClientIp(request), { outcome: result.ok ? "SUCCESS" : "FAILURE" });
  return NextResponse.json(result.ok ? { success: true } : { error: result.error }, { status: result.ok ? 200 : 502 });
}
