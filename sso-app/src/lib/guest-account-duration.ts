/** Lifetime of a guest account in minutes. Pure helpers, also used by the admin pages (client). */
const DAY = 24 * 60;

/** Ten years: any whole number of minutes up to this is allowed, the cap only keeps the date arithmetic sane. */
export const GUEST_ACCOUNT_MAX_MINUTES = 3650 * DAY;

/** Quick choices in the admin pages (1 hour … 90 days); every other amount can be typed in. */
export const GUEST_ACCOUNT_PRESETS = [60, DAY, 3 * DAY, 7 * DAY, 14 * DAY, 30 * DAY, 90 * DAY] as const;
export const GUEST_ACCOUNT_DEFAULT_MINUTES = 7 * DAY;

/** Parses a lifetime in minutes (number or numeric string); null unless it is a whole number from 1 minute to ten years. */
export function parseGuestMinutes(value: unknown): number | null {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= GUEST_ACCOUNT_MAX_MINUTES ? n : null;
}
