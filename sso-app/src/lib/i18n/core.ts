import { Fragment, createElement, type ReactNode } from "react";

/**
 * UI translations. The German text IS the key: `t("Anmelden")` returns it unchanged for German and looks the
 * English text up in lib/i18n/en for English. A missing English entry falls back to the German text (and
 * `npm run i18n:check` fails in CI), so a forgotten translation never breaks a page.
 *
 * Placeholders: `t("Hallo {name}", { name })`. Messages the server already filled in (API errors such as
 * "Ungültiger Name (Zone: example.com)") are matched against the placeholder keys, so the browser can translate them too.
 */

export const LOCALES = ["de", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_COOKIE = "sso_lang";
export const LOCALE_NAMES: Record<Locale, string> = { de: "Deutsch", en: "English" };

export const isLocale = (v: unknown): v is Locale => v === "de" || v === "en";

export type Messages = Record<string, string>;
export type Params = Record<string, string | number>;
export type NodeParams = Record<string, ReactNode>;
export type TFunction = (key: string, params?: Params) => string;
export type TNodesFunction = (key: string, params?: NodeParams) => ReactNode;
/** Translates an error message from an API response (`data.error`), or the fallback text when there is none. */
export type TErrorFunction = (error: unknown, fallback?: string) => string;

export const dateLocale = (locale: Locale) => (locale === "de" ? "de-DE" : "en-GB");

function interpolate(text: string, params?: Params): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name) => (name in params ? String(params[name]) : whole));
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

type Pattern = { re: RegExp; names: string[]; key: string };
const patternCache = new WeakMap<Messages, Pattern[]>();

function patternsOf(messages: Messages): Pattern[] {
  let patterns = patternCache.get(messages);
  if (!patterns) {
    patterns = Object.keys(messages)
      .filter((k) => /\{\w+\}/.test(k))
      .map((key) => {
        const names: string[] = [];
        const source = key
          .split(/(\{\w+\})/)
          .map((part) => {
            const m = part.match(/^\{(\w+)\}$/);
            if (m) {
              names.push(m[1]);
              return "(.+?)";
            }
            return escapeRe(part);
          })
          .join("");
        return { re: new RegExp(`^${source}$`), names, key };
      });
    patternCache.set(messages, patterns);
  }
  return patterns;
}

export function translate(locale: Locale, messages: Messages, key: string, params?: Params): string {
  if (locale === "de") return interpolate(key, params);
  const direct = messages[key];
  if (direct !== undefined) return interpolate(direct, params);
  if (!params) {
    for (const p of patternsOf(messages)) {
      const m = key.match(p.re);
      if (m) return interpolate(messages[p.key], Object.fromEntries(p.names.map((n, i) => [n, translate(locale, messages, m[i + 1])])));
    }
  }
  return interpolate(key, params);
}

/** Like translate, but the placeholders may be React nodes (links, <code>, <strong>) – for running text with markup. */
export function translateNodes(locale: Locale, messages: Messages, key: string, params: NodeParams = {}): ReactNode {
  const text = locale === "de" ? key : (messages[key] ?? key);
  return createElement(
    Fragment,
    null,
    ...text.split(/(\{\w+\})/).map((part, i) => {
      const m = part.match(/^\{(\w+)\}$/);
      return m && m[1] in params ? createElement(Fragment, { key: i }, params[m[1]]) : part;
    })
  );
}

export function makeT(locale: Locale, messages: Messages): { t: TFunction; tn: TNodesFunction; te: TErrorFunction } {
  const t: TFunction = (key, params) => translate(locale, messages, key, params);
  return {
    t,
    tn: (key, params) => translateNodes(locale, messages, key, params),
    te: (error, fallback = "Fehler") => t(typeof error === "string" && error ? error : fallback),
  };
}

/** Marks a German text for extraction without translating it yet (module-level constants); translate at render time with t(). */
export const N_ = (text: string): string => text;
