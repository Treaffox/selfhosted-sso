import { cache } from "react";
import { cookies, headers } from "next/headers";
import { clientIpFromHeaders } from "../client-ip";
import { getSession } from "../session";
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale, makeT, type Locale, type Messages, type TErrorFunction, type TFunction, type TNodesFunction } from "./core";
import { countryOf, GERMAN_SPEAKING } from "./geo";
import { en } from "./en";

/** First (= preferred) language of the Accept-Language header, e.g. "de-CH,de;q=0.9,en;q=0.8" → "de". */
function preferredLanguage(header: string | null): string | null {
  const first = header?.split(",")[0]?.trim().split(";")[0]?.toLowerCase();
  return first ? first.split("-")[0] : null;
}

/**
 * Language for this request:
 *  1. the language the signed-in user picked in the settings,
 *  2. the language picked on the sign-in page (cookie),
 *  3. German if the browser/OS language is German OR the IP address is in Germany, Austria or Switzerland,
 *  4. English.
 */
export const getLocale = cache(async (): Promise<Locale> => {
  try {
    const session = await getSession();
    const stored = (session?.user as { locale?: string | null } | undefined)?.locale;
    if (isLocale(stored)) return stored;

    const picked = (await cookies()).get(LOCALE_COOKIE)?.value;
    if (isLocale(picked)) return picked;

    const h = await headers();
    if (preferredLanguage(h.get("accept-language")) === "de") return "de";
    const country = countryOf(clientIpFromHeaders((name) => h.get(name)));
    if (country && GERMAN_SPEAKING.has(country)) return "de";
  } catch {
    // outside of a request (scripts) → default
  }
  return DEFAULT_LOCALE;
});

export const messagesFor = (locale: Locale): Messages => (locale === "de" ? {} : en);

export function tFor(locale: Locale): { t: TFunction; tn: TNodesFunction; te: TErrorFunction } {
  return makeT(locale, messagesFor(locale));
}

/** `const { t, locale } = await getT();` for server components and route handlers. */
export async function getT() {
  const locale = await getLocale();
  return { locale, ...tFor(locale) };
}
