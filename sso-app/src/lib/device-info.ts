import { N_ } from "./i18n/core";

/**
 * "Chrome auf Windows" instead of the raw user agent string. Pure, usable on server and client. The result is a
 * German text that callers run through t() ("{browser} auf {os}" and "Unbekanntes Gerät" are in the dictionary).
 */
export function describeDevice(userAgent: string | null | undefined): string {
  if (!userAgent) return N_("Unbekanntes Gerät");
  const browser =
    /Edg\//.test(userAgent) ? "Edge"
    : /OPR\/|Opera/.test(userAgent) ? "Opera"
    : /Firefox\/|FxiOS/.test(userAgent) ? "Firefox"
    : /Chrome\/|CriOS/.test(userAgent) ? "Chrome"
    : /Safari\//.test(userAgent) ? "Safari"
    : null;
  const os =
    /Windows/.test(userAgent) ? "Windows"
    : /Android/.test(userAgent) ? "Android"
    : /iPhone|iPad|iPod/.test(userAgent) ? "iOS"
    : /Mac OS X|Macintosh/.test(userAgent) ? "macOS"
    : /Linux/.test(userAgent) ? "Linux"
    : null;
  if (browser && os) return N_(`${browser} auf ${os}`);
  return browser ?? os ?? N_("Unbekanntes Gerät");
}
