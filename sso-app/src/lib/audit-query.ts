import type { Prisma } from "@prisma/client";
import { ENCRYPTED_FIELDS } from "./db-encryption";

// Filter language for the audit log viewer. Same model as the API audit log:
// a list of { field, op, value } conditions combined with AND/OR.
// Columns and operators are a fixed whitelist; values only ever reach Prisma as parameters.

export const FILTER_MAX = 20;
const VALUE_MAX = 500;

/** Filterable text columns (UI key → Prisma column). */
export const TEXT_FIELDS = {
  message: "message",
  actor: "actorName",
  ip: "ipAddress",
  app: "appName",
  target: "targetLabel",
  path: "requestPath",
  user_agent: "userAgent",
  auth_via: "authVia",
  session: "sessionRef",
} as const;

/** Columns with a small set of values: operators is / is_not with a comma separated list. */
export const ENUM_FIELDS = { action: "action", category: "category", outcome: "outcome" } as const;

export const TEXT_OPS = [
  "contains", "not_contains", "equals", "not_equals",
  "starts_with", "not_starts_with", "ends_with", "not_ends_with",
  "is_empty", "not_empty",
] as const;

export class FilterError extends Error {}

type Where = Prisma.AuditLogWhereInput;

function tokens(value: string): string[] {
  return value.split(/[\s,;]+/).filter(Boolean).slice(0, FILTER_MAX);
}

/** Prisma passes % and _ through to LIKE/ILIKE – escape them so they match literally (backslash is Postgres' default escape). */
const escapeLike = (v: string) => v.replace(/[\\%_]/g, "\\$&");

function textCondition(column: string, op: string, rawValue: string): Where {
  const value = escapeLike(rawValue);
  const col = (cond: unknown) => ({ [column]: cond }) as Where;
  const ci = (kind: "contains" | "equals" | "startsWith" | "endsWith") =>
    col({ [kind]: value, mode: "insensitive" });
  // NOT (col ILIKE …) is NULL for NULL rows, so negations must include NULLs explicitly
  const negate = (positive: Where): Where => ({ OR: [col(null), { NOT: positive }] });

  if (op === "is_empty") return { OR: [col(null), col("")] };
  if (op === "not_empty") return { AND: [col({ not: null }), col({ not: "" })] };
  if (!rawValue) throw new FilterError("Wert fehlt");

  switch (op) {
    case "contains": return ci("contains");
    case "not_contains": return negate(ci("contains"));
    case "equals": return ci("equals");
    case "not_equals": return negate(ci("equals"));
    case "starts_with": return ci("startsWith");
    case "not_starts_with": return negate(ci("startsWith"));
    case "ends_with": return ci("endsWith");
    case "not_ends_with": return negate(ci("endsWith"));
  }
  throw new FilterError("Unbekannter Operator: " + op);
}

function enumCondition(column: string, op: string, value: string): Where {
  const list = tokens(value).map((t) => t.toUpperCase());
  if (!list.length || !list.every((t) => /^[A-Z0-9_]{1,64}$/.test(t))) throw new FilterError("Ungültiger Wert");
  if (op === "is") return { [column]: { in: list } } as Where;
  if (op === "is_not") return { [column]: { notIn: list } } as Where;
  throw new FilterError("Unbekannter Operator: " + op);
}

/** Max. rows scanned in memory when filtering on encrypted columns (newest first). */
export const MEMORY_SCAN_MAX = 20000;

type Row = Record<string, unknown>;
type Cond =
  | { kind: "enum"; column: string; op: string; value: string }
  | { kind: "text"; column: string; op: string; value: string };

/** Mirrors textCondition/enumCondition for rows that were decrypted in memory (SQL can't filter ciphertext). */
function matchesCond(row: Row, c: Cond): boolean {
  if (c.kind === "enum") {
    const list = tokens(c.value).map((t) => t.toUpperCase());
    return (c.op === "is") === list.includes(String(row[c.column] ?? ""));
  }
  const cell = String(row[c.column] ?? "").toLowerCase();
  const v = c.value.toLowerCase();
  switch (c.op) {
    case "is_empty": return cell === "";
    case "not_empty": return cell !== "";
    case "contains": return cell.includes(v);
    case "not_contains": return !cell.includes(v);
    case "equals": return cell === v;
    case "not_equals": return cell !== v;
    case "starts_with": return cell.startsWith(v);
    case "not_starts_with": return !cell.startsWith(v);
    case "ends_with": return cell.endsWith(v);
    case "not_ends_with": return !cell.endsWith(v);
  }
  return false;
}

export interface AuditQuery {
  /** SQL part (always includes the date range). */
  where: Where;
  /** Set when filters touch encrypted columns: apply to decrypted rows after fetching `where`. */
  memoryFilter?: (row: Row) => boolean;
}

export function buildAuditWhere(filters: unknown, mode: unknown, from?: unknown, to?: unknown): AuditQuery {
  const and: Where[] = [];
  const parsed: Cond[] = [];

  if (filters != null) {
    if (!Array.isArray(filters)) throw new FilterError("filters muss ein Array sein");
    if (filters.length > FILTER_MAX) throw new FilterError(`Maximal ${FILTER_MAX} Bedingungen`);
    const conds: Where[] = filters.map((f) => {
      if (!f || typeof f !== "object") throw new FilterError("Ungültige Bedingung");
      const { field, op, value } = f as { field?: string; op?: string; value?: unknown };
      const v = value == null ? "" : String(value).slice(0, VALUE_MAX);
      if (field && field in ENUM_FIELDS) {
        const column = ENUM_FIELDS[field as keyof typeof ENUM_FIELDS];
        const where = enumCondition(column, String(op), v);
        parsed.push({ kind: "enum", column, op: String(op), value: v });
        return where;
      }
      if (field && field in TEXT_FIELDS) {
        const column = TEXT_FIELDS[field as keyof typeof TEXT_FIELDS];
        const where = textCondition(column, String(op), v);
        parsed.push({ kind: "text", column, op: String(op), value: v });
        return where;
      }
      throw new FilterError("Unbekanntes Feld: " + String(field).slice(0, 30));
    });

    const encrypted = new Set(ENCRYPTED_FIELDS.AuditLog);
    if (parsed.some((c) => encrypted.has(c.column))) {
      // Encrypted columns: evaluate the whole condition list on decrypted rows
      const test = (row: Row) => (mode === "or" ? parsed.some((c) => matchesCond(row, c)) : parsed.every((c) => matchesCond(row, c)));
      return { where: dateRange(from, to), memoryFilter: test };
    }
    if (conds.length) and.push(mode === "or" ? { OR: conds } : { AND: conds });
  }

  const range = dateRange(from, to);
  if (range.AND) and.push(range);
  return { where: and.length ? { AND: and } : {} };
}

function dateRange(from?: unknown, to?: unknown): Where {
  const range: { gte?: Date; lte?: Date } = {};
  const fromMs = Number(from);
  const toMs = Number(to);
  if (from !== "" && from != null && Number.isFinite(fromMs)) range.gte = new Date(fromMs);
  if (to !== "" && to != null && Number.isFinite(toMs)) range.lte = new Date(toMs);
  return range.gte || range.lte ? { AND: [{ createdAt: range }] } : {};
}
