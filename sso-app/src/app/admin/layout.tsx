import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { DeviceRequestPrompt } from "@/components/device/device-request-prompt";
import { getBrandView } from "@/lib/site-settings";
import { getSecuritySettings } from "@/lib/security-settings";

export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/auth/login");
  if (!session.user.isMaster) redirect("/settings");

  // Force password change check
  if (session.user.forcePasswordChange) {
    redirect("/settings/security?changePassword=1");
  }

  // Force MFA setup if user has no MFA methods (unless the admin made MFA optional)
  const hasMfa = session.user.totpVerified ||
    (await db.passkey.count({ where: { userId: session.user.id } })) > 0;
  if (!hasMfa && (await getSecuritySettings()).requireMfa) {
    redirect("/settings/security?setupMfa=1");
  }

  const brand = await getBrandView();

  return (
    <div className="min-h-screen flex flex-col">
      <Header brand={brand} user={{ username: session.user.username, isMaster: true }} />
      <main className="flex-1 max-w-5xl mx-auto w-full px-4 sm:px-6 py-6 sm:py-8">
        {children}
      </main>
      <Footer brand={brand} />
      <DeviceRequestPrompt />
    </div>
  );
}
