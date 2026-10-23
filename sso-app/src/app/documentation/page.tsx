import type { Metadata } from "next";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { getAppUrl } from "@/lib/config";
import { getBrandView } from "@/lib/site-settings";
import { getT } from "@/lib/i18n/server";
import { DocsDe } from "./content-de";
import { DocsEn } from "./content-en";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { locale } = await getT();
  return locale === "de"
    ? { title: "SSO-Integration", description: "Öffentliche Dokumentation: Wie Anwendungen sich per OpenID Connect, App-Token-Austausch oder Reverse-Proxy anmelden." }
    : { title: "SSO integration", description: "Public documentation: how applications sign in via OpenID Connect, the app token flow or a reverse proxy." };
}

export default async function DocumentationPage() {
  const [brand, { locale }] = await Promise.all([getBrandView(), getT()]);
  const appUrl = getAppUrl();
  const ssoHost = new URL(appUrl).host;
  const props = {
    brand,
    appUrl,
    ssoHost,
    cookieDomain: process.env.COOKIE_DOMAIN?.trim() || ssoHost,
    appExample: `https://app.${ssoHost.split(".").slice(-2).join(".")}`,
  };
  return (
    <div className="min-h-screen flex flex-col">
      <Header brand={brand} />
      <main className="flex-1 w-full">{locale === "de" ? <DocsDe {...props} /> : <DocsEn {...props} />}</main>
      <Footer brand={brand} />
    </div>
  );
}
