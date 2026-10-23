import { isIP } from "net";
import { deleteSetting, openSecret, readSetting, sealSecret, writeSetting } from "./settings";

const API = "https://api.cloudflare.com/client/v4";

export const DNS_TYPES = ["A", "AAAA", "CNAME", "TXT", "MX"] as const;
export type DnsType = (typeof DNS_TYPES)[number];

export class CloudflareError extends Error {
  constructor(message: string, public status = 502) {
    super(message);
  }
}

// ─── Configuration (Admin → System → Cloudflare) ──────

export interface CloudflareConfig {
  token: string;
  zoneId: string;
}

interface StoredCloudflare {
  token: string; // sealed
  zoneId: string;
}

export async function getCloudflareConfig(): Promise<CloudflareConfig | null> {
  const stored = await readSetting<StoredCloudflare>("cloudflare");
  const token = openSecret(stored?.token);
  if (!stored?.zoneId || !token) return null;
  return { token, zoneId: stored.zoneId };
}

export async function isCloudflareConfigured(): Promise<boolean> {
  return (await getCloudflareConfig()) !== null;
}

/** Empty token = keep the stored one. */
export async function saveCloudflareConfig(input: { token?: string; zoneId: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const zoneId = input.zoneId.trim();
  if (!/^[a-f0-9]{32}$/i.test(zoneId)) return { ok: false, error: "Die Zonen-ID besteht aus 32 Zeichen (0-9, a-f)" };
  const existing = await getCloudflareConfig();
  const token = input.token?.trim() || existing?.token;
  if (!token) return { ok: false, error: "API-Token fehlt" };
  if (token.length > 200 || /\s/.test(token)) return { ok: false, error: "API-Token ist ungültig" };
  await writeSetting("cloudflare", { token: sealSecret(token), zoneId } satisfies StoredCloudflare);
  cachedZoneName = null;
  return { ok: true };
}

export async function clearCloudflareConfig(): Promise<void> {
  await deleteSetting("cloudflare");
  cachedZoneName = null;
}

interface CfResponse<T> {
  success: boolean;
  result: T;
  errors?: { code: number; message: string }[];
}

async function cf<T>(method: string, path: string, body?: unknown): Promise<T> {
  const config = await getCloudflareConfig();
  if (!config) throw new CloudflareError("Cloudflare ist nicht konfiguriert", 503);
  const { token, zoneId: zone } = config;

  let res: Response;
  try {
    res = await fetch(`${API}/zones/${zone}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new CloudflareError("Cloudflare nicht erreichbar");
  }

  const data = (await res.json().catch(() => null)) as CfResponse<T> | null;
  if (!res.ok || !data?.success) {
    const msg = data?.errors?.[0]?.message ?? `HTTP ${res.status}`;
    console.error("[CLOUDFLARE ERROR]", method, path.split("?")[0], res.status, msg);
    // Never forward auth details; 4xx from CF are mostly validation messages the admin needs to see.
    throw new CloudflareError(`Cloudflare: ${msg}`, res.status === 404 ? 404 : 502);
  }
  return data.result;
}

let cachedZoneName: { zone: string; name: string } | null = null;

export async function getZoneName(): Promise<string> {
  const zone = (await getCloudflareConfig())?.zoneId;
  if (!zone) throw new CloudflareError("Cloudflare ist nicht konfiguriert", 503);
  if (cachedZoneName?.zone === zone) return cachedZoneName.name;
  const result = await cf<{ name: string }>("GET", "");
  cachedZoneName = { zone, name: result.name };
  return result.name;
}

/** "@" → zone apex, relative labels get the zone appended, FQDNs must belong to the zone. */
export function resolveRecordName(input: string, zoneName: string): string | null {
  const name = input.trim().toLowerCase().replace(/\.$/, "");
  if (name === "@" || name === zoneName) return zoneName;
  const fqdn = name.endsWith(`.${zoneName}`) ? name : `${name}.${zoneName}`;
  return /^(\*\.)?([a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9_])?\.)+[a-z0-9-]+$/.test(fqdn) && fqdn.length <= 253 ? fqdn : null;
}

const HOSTNAME = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]+$/i;

export function validateContent(type: DnsType, content: string): string | null {
  switch (type) {
    case "A": return isIP(content) === 4 ? null : "Ungültige IPv4-Adresse";
    case "AAAA": return isIP(content) === 6 ? null : "Ungültige IPv6-Adresse";
    case "CNAME":
    case "MX": return HOSTNAME.test(content.replace(/\.$/, "")) ? null : "Ungültiger Hostname";
    case "TXT": return content.length > 0 && content.length <= 2000 ? null : "TXT-Inhalt muss 1–2000 Zeichen lang sein";
  }
}

export interface CfRecord {
  id: string;
  type: string;
  name: string;
  content: string;
  ttl: number;
  proxied?: boolean;
  priority?: number;
}

export interface RecordInput {
  type: DnsType;
  name: string;
  content: string;
  ttl: number;
  proxied: boolean;
  priority?: number | null;
  comment?: string;
}

function payload(r: Partial<RecordInput>) {
  const out: Record<string, unknown> = {};
  if (r.type !== undefined) out.type = r.type;
  if (r.name !== undefined) out.name = r.name;
  if (r.content !== undefined) out.content = r.content;
  if (r.ttl !== undefined) out.ttl = r.ttl;
  if (r.proxied !== undefined) out.proxied = r.proxied;
  if (r.priority != null) out.priority = r.priority;
  if (r.comment !== undefined) out.comment = r.comment;
  return out;
}

/** Records with this exact name and type that already exist in the zone. */
export async function findExisting(name: string, type: DnsType): Promise<CfRecord[]> {
  return cf<CfRecord[]>("GET", `/dns_records?name=${encodeURIComponent(name)}&type=${type}`);
}

export const createRecord = (r: RecordInput) => cf<CfRecord>("POST", "/dns_records", payload(r));

export const updateRecord = (id: string, r: Partial<RecordInput>) =>
  cf<CfRecord>("PATCH", `/dns_records/${encodeURIComponent(id)}`, payload(r));

export async function deleteRecord(id: string): Promise<void> {
  try {
    await cf("DELETE", `/dns_records/${encodeURIComponent(id)}`);
  } catch (e) {
    // Already gone on the Cloudflare side → nothing left to delete.
    if (e instanceof CloudflareError && e.status === 404) return;
    throw e;
  }
}
