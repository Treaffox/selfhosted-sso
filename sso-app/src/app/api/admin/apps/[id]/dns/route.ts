import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { logAudit } from "@/lib/auth";
import { getClientIp } from "@/lib/ip";
import { getSiteSettings } from "@/lib/site-settings";
import { dnsRecordSchema } from "@/lib/validation";
import {
  CloudflareError,
  createRecord,
  findExisting,
  getZoneName,
  isCloudflareConfigured,
  resolveRecordName,
  validateContent,
} from "@/lib/cloudflare";

/** GET: DNS records managed for this app (master only). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user.isMaster) {
    return NextResponse.json({ error: "Zugriff verweigert" }, { status: 403 });
  }
  const { id } = await params;

  const records = await db.appDnsRecord.findMany({ where: { appId: id }, orderBy: { createdAt: "asc" } });
  if (!(await isCloudflareConfigured())) {
    return NextResponse.json({ configured: false, zoneName: null, records });
  }
  try {
    return NextResponse.json({ configured: true, zoneName: await getZoneName(), records });
  } catch (e) {
    const message = e instanceof CloudflareError ? e.message : "Fehler";
    return NextResponse.json({ configured: true, zoneName: null, records, error: message });
  }
}

/** POST: Create a DNS record in Cloudflare and attach it to this app (master only). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user.isMaster) {
    return NextResponse.json({ error: "Zugriff verweigert" }, { status: 403 });
  }
  if (!(await isCloudflareConfigured())) {
    return NextResponse.json({ error: "Cloudflare ist nicht konfiguriert" }, { status: 503 });
  }
  const { id } = await params;

  try {
    const app = await db.app.findUnique({ where: { id }, select: { name: true } });
    if (!app) return NextResponse.json({ error: "App nicht gefunden" }, { status: 404 });

    const parsed = dnsRecordSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    const input = parsed.data;

    const zoneName = await getZoneName();
    const name = resolveRecordName(input.name, zoneName);
    if (!name) return NextResponse.json({ error: `Ungültiger Name (Zone: ${zoneName})` }, { status: 400 });

    const contentError = validateContent(input.type, input.content);
    if (contentError) return NextResponse.json({ error: contentError }, { status: 400 });
    if (input.type === "MX" && input.priority === undefined) {
      return NextResponse.json({ error: "MX benötigt eine Priorität" }, { status: 400 });
    }
    const canProxy = ["A", "AAAA", "CNAME"].includes(input.type);
    if (input.proxied && !canProxy) {
      return NextResponse.json({ error: "Proxy nur bei A, AAAA und CNAME möglich" }, { status: 400 });
    }

    // Don't silently add to / shadow records that already serve this name.
    if (["A", "AAAA", "CNAME"].includes(input.type)) {
      const clashes = (
        await Promise.all((["A", "AAAA", "CNAME"] as const).map((t) => findExisting(name, t)))
      ).flat();
      if (clashes.length > 0) {
        return NextResponse.json({ error: `${name} hat bereits einen ${clashes[0].type}-Eintrag in Cloudflare` }, { status: 409 });
      }
    }

    const created = await createRecord({
      ...input,
      name,
      content: input.type === "CNAME" || input.type === "MX" ? input.content.replace(/\.$/, "") : input.content,
      comment: `${(await getSiteSettings()).siteName} · App: ${app.name}`.slice(0, 100),
    });

    const record = await db.appDnsRecord.create({
      data: {
        appId: id,
        cfRecordId: created.id,
        type: created.type,
        name: created.name,
        content: created.content,
        ttl: created.ttl,
        proxied: !!created.proxied,
        priority: created.priority ?? null,
      },
    });

    await logAudit("APP_DNS_RECORD_CREATED", { appId: id, type: record.type, name: record.name, content: record.content }, session.user.id, getClientIp(request));
    return NextResponse.json({ success: true, record });
  } catch (e) {
    if (e instanceof CloudflareError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("[CREATE DNS RECORD ERROR]", e);
    return NextResponse.json({ error: "Fehler" }, { status: 500 });
  }
}
