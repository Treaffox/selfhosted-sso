import type { Metadata } from "next";
import Link from "next/link";
import { findInvite } from "@/lib/invite";
import { AuthShell } from "@/components/layout/auth-shell";
import { ClockIcon } from "@/components/ui/icons";
import { getT } from "@/lib/i18n/server";
import { getBrandView } from "@/lib/site-settings";
import { InviteForm } from "./invite-form";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t("Konto einrichten") };
}
export const dynamic = "force-dynamic";

/** Target of the invitation mail: the invited person chooses a password. */
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { t } = await getT();
  const invite = await findInvite(token);
  const brand = await getBrandView();

  if (!invite) {
    return (
      <AuthShell brand={brand}>
        <div>
          <div className="text-muted mb-3"><ClockIcon size={24} /></div>
          <h1 className="text-lg font-extrabold mb-1">{t("Einladung nicht mehr gültig")}</h1>
          <p className="text-sm text-muted">{t("Der Link ist abgelaufen oder wurde schon benutzt. Bitte den Administrator um eine neue Einladung.")}</p>
          <Link href="/auth/login" className="inline-block mt-3 text-sm text-foreground hover:underline">
            {t("Zur Anmeldung")}
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell brand={brand}>
      <InviteForm token={token} username={invite.user.username} />
    </AuthShell>
  );
}
