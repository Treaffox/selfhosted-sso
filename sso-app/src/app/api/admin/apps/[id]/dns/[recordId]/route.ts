import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { logAudit } from "@/lib/auth";
import { getClientIp } from "@/lib/ip";
import { dnsRecordSchema } from "@/lib/validation";
import { CloudflareError, deleteRecord, isCloudflareConfigured, updateRecord, validateContent, type DnsType } from "@/lib/cloudflare";

type Ctx = { params: Promise<{ id: string; recordId: string }> };

// Only records tracked for this very app can be touched – never arbitrary zone records.
async function loadRecord({ id, recordId }: { id: string; recordId: string }) {
  return db.appDnsRecord.findFirst({ where: { id: recordId, appId: id } });
}

/** PATCH: Update content/TTL/proxy/priority of a tracked record (type and name are fixed). */
export async function PATCH(request: Request, { params }: Ctx) {
  const session = await getSession();
  if (!session?.user.isMaster) {
    return NextResponse.json({ error: "Zugriff verweigert" }, { status: 403 });
  }
  if (!(await isCloudflareConfigured())) {
    return NextResponse.json({ error: "Cloudflare ist nicht konfiguriert" }, { status: 503 });
  }

  try {
    const record = await loadRecord(await params);
    if (!record) return NextResponse.json({ error: "Eintrag nicht gefunden" }, { status: 404 });

    const parsed = dnsRecordSchema
      .pick({ content: true, ttl: true, proxied: true, priority: true })
      .safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    const input = parsed.data;

    const contentError = validateContent(record.type as DnsType, input.content);
    if (contentError) return NextResponse.json({ error: contentError }, { status: 400 });
    if (input.proxied && !["A", "AAAA", "CNAME"].includes(record.type)) {
      return NextResponse.json({ error: "Proxy nur bei A, AAAA und CNAME möglich" }, { status: 400 });
    }

    const content = record.type === "CNAME" || record.type === "MX" ? input.content.replace(/\.$/, "") : input.content;
    const updated = await updateRecord(record.cfRecordId, {
      content,
      ttl: input.ttl,
      proxied: input.proxied,
      priority: record.type === "MX" ? input.priority : undefined,
    });

    const saved = await db.appDnsRecord.update({
      where: { id: record.id },
      data: { content: updated.content, ttl: updated.ttl, proxied: !!updated.proxied, priority: updated.priority ?? null },
    });

    await logAudit("APP_DNS_RECORD_UPDATED", { appId: record.appId, type: record.type, name: record.name, content: saved.content }, session.user.id, getClientIp(request));
    return NextResponse.json({ success: true, record: saved });
  } catch (e) {
    if (e instanceof CloudflareError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("[UPDATE DNS RECORD ERROR]", e);
    return NextResponse.json({ error: "Fehler" }, { status: 500 });
  }
}

/** DELETE: Remove a tracked record from Cloudflare and from the app. */
export async function DELETE(request: Request, { params }: Ctx) {
  const session = await getSession();
  if (!session?.user.isMaster) {
    return NextResponse.json({ error: "Zugriff verweigert" }, { status: 403 });
  }
  if (!(await isCloudflareConfigured())) {
    return NextResponse.json({ error: "Cloudflare ist nicht konfiguriert" }, { status: 503 });
  }

  try {
    const record = await loadRecord(await params);
    if (!record) return NextResponse.json({ error: "Eintrag nicht gefunden" }, { status: 404 });

    await deleteRecord(record.cfRecordId);
    await db.appDnsRecord.delete({ where: { id: record.id } });

    await logAudit("APP_DNS_RECORD_DELETED", { appId: record.appId, type: record.type, name: record.name }, session.user.id, getClientIp(request));
    return NextResponse.json({ success: true });
  } catch (e) {
    if (e instanceof CloudflareError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("[DELETE DNS RECORD ERROR]", e);
    return NextResponse.json({ error: "Fehler" }, { status: 500 });
  }
}
