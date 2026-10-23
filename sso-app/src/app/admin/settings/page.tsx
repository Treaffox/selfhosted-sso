"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageTitle } from "@/components/ui/page-title";
import { useI18n } from "@/components/i18n-provider";

interface Status {
  checklist: { server: boolean; branding: boolean; mail: boolean; cloudflare: boolean };
  server: { appUrl: string; https: boolean; rpId: string; cookieDomain: string | null; oidcIssuer: string };
}

const Code = ({ children }: { children: React.ReactNode }) => <code className="font-mono">{children}</code>;

export default function SystemOverviewPage() {
  const { t, tn } = useI18n();
  const [status, setStatus] = useState<Status | null>(null);

  useEffect(() => {
    fetch("/api/admin/settings/status").then(async (res) => res.ok && setStatus(await res.json()));
  }, []);

  if (!status) return <><PageTitle title={t("System")} /><div className="loading-bar rounded" /></>;
  const { checklist, server } = status;

  const steps = [
    { done: checklist.server, title: t("Öffentliche Adresse (HTTPS)"), text: t("APP_URL in der .env zeigt auf eine öffentliche https://-Adresse. Nur dann funktionieren Passkeys und sichere Cookies."), href: null, action: "" },
    { done: checklist.branding, title: t("Name, Logo und Favicon"), text: t("Wie der Dienst heißt und aussieht – auf der Anmeldeseite, im Header und in E-Mails."), href: "/admin/settings/appearance", action: t("Erscheinungsbild einrichten") },
    { done: checklist.mail, title: t("E-Mail-Versand"), text: t("Ohne Versand kommen keine Bestätigungscodes, Willkommens- und Anmeldemails an."), href: "/admin/settings/mail", action: t("E-Mail einrichten") },
    { done: checklist.cloudflare, title: t("Cloudflare (optional)"), text: t("Nur nötig, wenn du DNS-Einträge für Apps direkt hier verwalten willst."), href: "/admin/settings/cloudflare", action: t("Cloudflare verbinden"), optional: true },
  ];

  return (
    <div className="space-y-6">
      <PageTitle title={t("System")} />

      <Card>
        <CardTitle>{t("Einrichtung")}</CardTitle>
        <p className="text-sm text-muted mt-1 mb-4">{t("Alles außer der Server-Adresse stellst du hier im Browser ein. Die Reihenfolge ist eine Empfehlung.")}</p>
        <ul className="divide-y divide-border">
          {steps.map((step) => (
            <li key={step.title} className="py-3 flex items-start gap-3">
              <span className={`mt-0.5 shrink-0 w-5 h-5 rounded-full border flex items-center justify-center text-xs ${step.done ? "bg-success/15 border-success/40 text-success" : "border-border text-muted"}`} aria-hidden>
                {step.done ? "✓" : ""}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold flex flex-wrap items-center gap-2">
                  {step.title}
                  {step.optional && <Badge>{t("optional")}</Badge>}
                </p>
                <p className="text-xs text-muted mt-0.5">{step.text}</p>
                {!step.done && step.href && (
                  <Link href={step.href} className="inline-block text-xs font-bold mt-1.5 underline underline-offset-2 hover:text-muted">
                    {step.action} →
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <CardTitle>{t("Server (aus der .env)")}</CardTitle>
        <p className="text-sm text-muted mt-1 mb-4">
          {tn("Diese Werte bestimmen, unter welcher Adresse der SSO erreichbar ist. Sie ändern sich nur in der Datei {env} auf dem Server, danach {cmd}. Eine falsche Adresse sperrt alle Passkeys aus, ändere sie deshalb nicht im laufenden Betrieb.", {
            env: <Code>.env</Code>,
            cmd: <Code>docker compose up -d</Code>,
          })}
        </p>
        <dl className="grid grid-cols-1 sm:grid-cols-[200px_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted">{t("Öffentliche Adresse")}</dt>
          <dd className="font-mono break-all">{server.appUrl} <span className="text-muted">(APP_URL)</span></dd>
          <dt className="text-muted">{t("OIDC-Issuer")}</dt>
          <dd className="font-mono break-all">{server.oidcIssuer}</dd>
          <dt className="text-muted">{t("Passkey-Domain")}</dt>
          <dd className="font-mono">{server.rpId} <span className="text-muted">{t("(WEBAUTHN_RP_ID, optional)")}</span></dd>
          <dt className="text-muted">{t("Cookie-Domain")}</dt>
          <dd className="font-mono">{server.cookieDomain ?? t("nur diese Adresse")} <span className="text-muted">{t("(COOKIE_DOMAIN, optional)")}</span></dd>
          <dt className="text-muted">{t("Verbindung")}</dt>
          <dd>{server.https ? <Badge variant="success">HTTPS</Badge> : <Badge variant="warning">{t("HTTP – nur zum Testen geeignet")}</Badge>}</dd>
        </dl>
        <p className="text-xs text-muted mt-4">
          {tn("{cookie} (z. B. {example}) brauchst du nur, wenn Apps hinter dem nginx-{authRequest} auf Subdomains die SSO-Anmeldung teilen sollen. Für reines OpenID Connect bleibt es leer.", {
            cookie: <Code>COOKIE_DOMAIN</Code>,
            example: <Code>.example.com</Code>,
            authRequest: <Code>auth_request</Code>,
          })}
        </p>
      </Card>
    </div>
  );
}
