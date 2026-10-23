import { getAppUrl } from "./config";

export const AVATAR_MAX_BYTES = 512 * 1024;

export const getPublicBaseUrl = getAppUrl;

/** Absolute, cache-busted URL of a user's profile picture, or null if none is set. */
export function getAvatarUrl(user: { id: string; avatarUpdatedAt: Date | null }): string | null {
  if (!user.avatarUpdatedAt) return null;
  return `${getPublicBaseUrl()}/api/avatar/${user.id}?v=${user.avatarUpdatedAt.getTime()}`;
}

/** Detects the image type from magic bytes (never trusts the client's Content-Type). */
export function detectImageMime(buf: Buffer): "image/png" | "image/jpeg" | "image/webp" | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}
