import { db } from "./db";
import { blindIndex } from "./data-crypto";
import { clientIpFromHeaders } from "./client-ip";

/** IPs are stored encrypted; rules are looked up through a keyed hash. */
export const ipHashOf = (ipAddress: string) => blindIndex("ip", ipAddress);

export type IpStatus = "UNKNOWN" | "WHITELISTED";

/** Check the IP status for a user. */
export async function checkIpStatus(
  userId: string,
  ipAddress: string
): Promise<IpStatus> {
  const rule = await db.userIpRule.findUnique({
    where: { userId_ipHash: { userId, ipHash: ipHashOf(ipAddress) } },
  });

  if (!rule) return "UNKNOWN";
  if (rule.type === "WHITELIST") return "WHITELISTED";
  return "UNKNOWN";
}

/** Add or update an IP rule for a user. */
export async function setIpRule(
  userId: string,
  ipAddress: string,
  type: "WHITELIST",
  addedBy: "USER" | "ADMIN" = "USER"
) {
  return db.userIpRule.upsert({
    where: { userId_ipHash: { userId, ipHash: ipHashOf(ipAddress) } },
    create: { userId, ipAddress, ipHash: ipHashOf(ipAddress), type, addedBy },
    update: { type, addedBy },
  });
}

/** Remove an IP rule. */
export async function removeIpRule(userId: string, ipAddress: string) {
  return db.userIpRule
    .delete({ where: { userId_ipHash: { userId, ipHash: ipHashOf(ipAddress) } } })
    .catch(() => null);
}

/** Get all IP rules for a user. */
export async function getUserIpRules(userId: string) {
  return db.userIpRule.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
}

/** Extract the client IP from the proxy headers (see lib/client-ip.ts for the trust model). */
export function getClientIp(request: Request): string {
  return clientIpFromHeaders((name) => request.headers.get(name)) ?? "127.0.0.1";
}
