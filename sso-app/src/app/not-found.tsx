import type { Metadata } from "next";
import Link from "next/link";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { getSession } from "@/lib/session";
import { getBrandView } from "@/lib/site-settings";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t("Seite nicht gefunden") };
}

export default async function NotFound() {
  const [{ t }, brand, session] = await Promise.all([getT(), getBrandView(), getSession()]);

  return (
    <div className="min-h-screen flex flex-col">
      <Header brand={brand} user={session ? { username: session.user.username, isMaster: session.user.isMaster } : null} />
      <main className="flex-1 flex items-center justify-center px-4 py-16">
        <div className="text-center max-w-md">
          <p className="text-7xl sm:text-8xl font-black tracking-tight text-foreground">404</p>
          <h1 className="text-xl sm:text-2xl font-extrabold mt-4">{t("Seite nicht gefunden")}</h1>
          <p className="text-sm text-muted mt-2">{t("Die Seite existiert nicht oder wurde verschoben.")}</p>
          <Link
            href="/"
            className="inline-flex items-center justify-center font-bold text-sm px-5 py-2.5 rounded-lg mt-8 bg-accent text-accent-foreground hover:opacity-90 transition-opacity"
          >
            {t("Zur Startseite")}
          </Link>
        </div>
      </main>
      <Footer brand={brand} />
    </div>
  );
}
