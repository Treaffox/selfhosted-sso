import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { buildAuditWhere, FilterError, MEMORY_SCAN_MAX } from "@/lib/audit-query";
import { AUDIT_ACTIONS, AUDIT_CATEGORIES, renderAuditMessage } from "@/lib/audit";
import { getT } from "@/lib/i18n/server";

const MAX_LIMIT = 500;

/** GET: Values for the filter UI (master only). */
export async function GET() {
  const session = await getSession();
  if (!session?.user.isMaster) {
    return NextResponse.json({ error: "Zugriff verweigert" }, { status: 403 });
  }
  return NextResponse.json({ actions: AUDIT_ACTIONS, categories: AUDIT_CATEGORIES, outcomes: ["SUCCESS", "FAILURE", "DENIED"] });
}

/**
 * POST: Query the audit log (master only).
 * Body: { filters?: [{field, op, value}], mode?: "and" | "or", from?, to?, order?: "asc" | "desc", limit?, offset? }
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session?.user.isMaster) {
    return NextResponse.json({ error: "Zugriff verweigert" }, { status: 403 });
  }

  try {
    const { t } = await getT();
    const body = await request.json().catch(() => ({}));
    // Sentences are stored in German; show them in the admin's language
    const localized = <R extends { action: string; actorName: string | null; appName: string | null; appId: string | null; details: unknown; message: string | null }>(rows: R[]) =>
      rows.map((r) => ({ ...r, message: renderAuditMessage(r, t) }));
    const { where, memoryFilter } = buildAuditWhere(body.filters, body.mode, body.from, body.to);
    const limit = Math.min(Math.max(parseInt(body.limit, 10) || 100, 1), MAX_LIMIT);
    const offset = Math.max(parseInt(body.offset, 10) || 0, 0);
    const dir = body.order === "asc" ? "asc" : "desc";

    const orderBy = [{ createdAt: dir }, { id: dir }] as const;

    if (memoryFilter) {
      // Filter on encrypted columns: scan the newest rows (decrypted by the db client) and filter in memory
      const scanned = await db.auditLog.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: MEMORY_SCAN_MAX });
      const matches = scanned.filter((r) => memoryFilter(r as unknown as Record<string, unknown>));
      if (dir === "asc") matches.reverse();
      return NextResponse.json({
        total: matches.length,
        limit,
        offset,
        rows: localized(matches.slice(offset, offset + limit)),
        scanLimited: scanned.length === MEMORY_SCAN_MAX,
      });
    }

    const [total, rows] = await Promise.all([
      db.auditLog.count({ where }),
      db.auditLog.findMany({ where, orderBy: [...orderBy], take: limit, skip: offset }),
    ]);

    return NextResponse.json({ total, limit, offset, rows: localized(rows) });
  } catch (error) {
    if (error instanceof FilterError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("[AUDIT QUERY ERROR]", error);
    return NextResponse.json({ error: "Abfrage fehlgeschlagen" }, { status: 500 });
  }
}
