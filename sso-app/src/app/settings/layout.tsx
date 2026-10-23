import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { getBrandView } from "@/lib/site-settings";

export const dynamic = "force-dynamic";

export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/auth/login");

  const brand = await getBrandView();

  return (
    <div className="min-h-screen flex flex-col">
      <Header brand={brand} user={{ username: session.user.username, isMaster: session.user.isMaster }} />
      <main className="flex-1 max-w-3xl mx-auto w-full px-4 sm:px-6 py-6 sm:py-8">
        {children}
      </main>
      <Footer brand={brand} />
    </div>
  );
}
