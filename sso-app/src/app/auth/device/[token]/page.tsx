import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import {
  codeOf,
  DEFAULT_GUEST_HOURS,
  describeRequest,
  findRequestByToken,
  GUEST_DURATIONS_HOURS,
  isOpen,
} from "@/lib/device-login";
import { AuthShell } from "@/components/layout/auth-shell";
import { Button } from "@/components/ui/button";
import { ClockIcon, ShieldCheckIcon, TriangleAlertIcon } from "@/components/ui/icons";
import { ApproveForm } from "./approve-form";
import { getLocale, getT } from "@/lib/i18n/server";
import { getBrandView } from "@/lib/site-settings";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t("Anmeldung freigeben") };
}
export const dynamic = "force-dynamic";

function Notice({ icon, title, children }: { icon: React.ReactNode; title: string; children?: React.ReactNode }) {
  return (
    <div>
      <div className="text-muted mb-3">{icon}</div>
      <h1 className="text-lg font-extrabold mb-1">{title}</h1>
      {children && <div className="text-sm text-muted">{children}</div>}
    </div>
  );
}

/** Target of the QR code: the account owner confirms the request of another device here. */
export default async function DeviceApprovePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { t } = await getT();
  const brand = await getBrandView();

  const session = await getSession();
  if (!session) redirect(`/auth/login?returnTo=${encodeURIComponent(`/auth/device/${token}`)}`);

  const request = await findRequestByToken(token);
  if (!request || !request.userId || !isOpen(request)) {
    return (
      <AuthShell brand={brand}>
        <Notice icon={<ClockIcon size={24} />} title={t("Anfrage nicht mehr gültig")}>
          {t("Sie ist abgelaufen oder wurde schon bearbeitet. Starte die Anmeldung auf dem anderen Gerät neu.")}
        </Notice>
      </AuthShell>
    );
  }

  if (request.userId !== session.user.id) {
    return (
      <AuthShell brand={brand}>
        <Notice icon={<TriangleAlertIcon size={24} />} title={t("Anderes Konto")}>
          <p>{t("Diese Anfrage gehört zu einem anderen Konto. Du bist als {username} angemeldet.", { username: session.user.username })}</p>
          <form action="/api/auth/logout" method="post" className="mt-4">
            <Button type="submit" variant="secondary" className="w-full">
              {t("Abmelden")}
            </Button>
          </form>
        </Notice>
      </AuthShell>
    );
  }

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { isMaster: true, forcePasswordChange: true, guestLoginEnabled: true, deviceLoginEnabled: true },
  });
  const guest = request.kind === "GUEST";
  const blocked =
    !user ? t("Konto nicht gefunden.")
    : user.forcePasswordChange ? t("Ändere zuerst dein Passwort.")
    : guest && (user.isMaster || !user.guestLoginEnabled) ? t("Gast-Anmeldung ist für dein Konto ausgeschaltet.")
    : !guest && !user.deviceLoginEnabled ? t("Anmeldung über ein anderes Gerät ist für dein Konto ausgeschaltet.")
    : null;
  if (blocked) {
    return (
      <AuthShell brand={brand}>
        <Notice icon={<ShieldCheckIcon size={24} />} title={t("Nicht möglich")}>
          <p>{blocked}</p>
          <Link href="/settings/security" className="inline-block mt-3 text-foreground hover:underline">
            {t("Zu den Einstellungen")}
          </Link>
        </Notice>
      </AuthShell>
    );
  }

  const info = await describeRequest(request, await getLocale());

  return (
    <AuthShell brand={brand}>
      <ApproveForm
        token={token}
        kind={info.kind}
        appName={info.appName}
        device={info.device}
        ip={info.ip}
        location={info.location}
        createdAt={info.createdAt}
        code={codeOf(request.id)}
        durations={GUEST_DURATIONS_HOURS}
        defaultDuration={DEFAULT_GUEST_HOURS}
      />
    </AuthShell>
  );
}
