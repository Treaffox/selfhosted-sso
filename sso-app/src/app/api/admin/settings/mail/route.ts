import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { logAudit } from "@/lib/auth";
import { getClientIp } from "@/lib/ip";
import { requireReauth } from "@/lib/reauth";
import { getSiteSettings } from "@/lib/site-settings";
import { GROUP_LABELS, type FieldDef } from "@/lib/mail/types";
import { getT } from "@/lib/i18n/server";
import { PROVIDERS } from "@/lib/mail/providers";
import { getMailSettingsView, saveMailSettings } from "@/lib/mail/settings";

/** GET: saved mail setup (secrets masked) + the provider catalog the form is built from (master only). */
export async function GET() {
  const session = await getSession();
  if (!session?.user.isMaster) {
    return NextResponse.json({ error: "Zugriff verweigert" }, { status: 403 });
  }
  const [settings, site, { t }] = await Promise.all([getMailSettingsView(), getSiteSettings(), getT()]);
  const tField = (f: FieldDef): FieldDef => ({
    ...f,
    label: t(f.label),
    help: f.help && t(f.help),
    placeholder: f.placeholder && t(f.placeholder),
    options: f.options?.map((o) => ({ ...o, label: t(o.label) })),
  });
  return NextResponse.json({
    settings,
    defaultFromName: site.siteName,
    adminEmail: session.user.email ?? "",
    groups: Object.fromEntries(Object.entries(GROUP_LABELS).map(([k, v]) => [k, t(v)])),
    providers: PROVIDERS.map(({ send: _send, ...def }) => ({ ...def, label: t(def.label), summary: t(def.summary), fields: def.fields.map(tField) })),
  });
}

/** PUT: save the mail setup. Needs the admin's password again, because mail setup decides where login codes go. */
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
    const denied = await requireReauth(session.user.id, body?.password, "settings-mail", ip);
    if (denied) return denied;

    const result = await saveMailSettings(body);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

    await logAudit("SETTINGS_MAIL_UPDATED", { primary: body.primary?.provider ?? null, fallback: body.fallback?.provider ?? null, changed: result.changed }, session.user.id, ip);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof SyntaxError) return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
    console.error("[MAIL SETTINGS ERROR]", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Fehler" }, { status: 500 });
  }
}
