"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { makeT, type Locale, type Messages, type TErrorFunction, type TFunction, type TNodesFunction } from "@/lib/i18n/core";

interface I18n {
  locale: Locale;
  t: TFunction;
  tn: TNodesFunction;
  te: TErrorFunction;
}

const fallback = makeT("de", {});
const Context = createContext<I18n>({ locale: "de", ...fallback });

/** `messages` is only passed for non-German locales (German needs no dictionary: the source text is German). */
export function I18nProvider({ locale, messages, children }: { locale: Locale; messages: Messages; children: ReactNode }) {
  const value = useMemo(() => ({ locale, ...makeT(locale, messages) }), [locale, messages]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export const useI18n = () => useContext(Context);
export const useT = () => useContext(Context).t;
export const useLocale = () => useContext(Context).locale;
