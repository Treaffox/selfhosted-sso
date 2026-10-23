"use client";

import { useState, useEffect } from "react";
import { Card, CardTitle } from "@/components/ui/card";
import { PageTitle } from "@/components/ui/page-title";
import Link from "next/link";
import { useI18n } from "@/components/i18n-provider";
import { dateLocale } from "@/lib/i18n/core";

export default function AdminDashboard() {
  const { t, locale } = useI18n();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<string[]>([]);

  const fetchData = async () => {
    const [res, status] = await Promise.all([fetch("/api/admin/dashboard"), fetch("/api/admin/settings/status")]);
    if (res.ok) setData(await res.json());
    if (status.ok) {
      const { checklist } = await status.json();
      setOpen(
        [!checklist.server && t("Server-Adresse (HTTPS)"), !checklist.branding && t("Name und Logo"), !checklist.mail && t("E-Mail-Versand")].filter(Boolean) as string[]
      );
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, []);

  if (loading) return <><PageTitle title={t("Dashboard")} /><div className="loading-bar rounded" /></>;
  if (!data) return null;

  const { userCount, appCount, sessionCount, recentLogins } = data;

  return (
    <div className="animate-slide-up">
      <PageTitle title={t("Dashboard")} />
      <h1 className="text-xl sm:text-2xl font-black mb-6 sm:mb-8">{t("Dashboard")}</h1>

      {open.length > 0 && (
        <Link href="/admin/settings">
          <Card className="mb-6 sm:mb-8 border-warning/30 hover:border-warning/60 transition-colors cursor-pointer">
            <p className="text-sm font-extrabold">{t("Einrichtung abschließen")}</p>
            <p className="text-sm text-muted mt-1">{t("Noch offen: {items}. Hier geht es zur Übersicht →", { items: open.join(", ") })}</p>
          </Card>
        </Link>
      )}

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6 sm:mb-8">
        <Link href="/admin/users">
          <Card className="hover:border-border-light transition-colors cursor-pointer">
            <p className="text-3xl font-black">{userCount}</p>
            <p className="text-sm text-muted mt-1">{t("Nutzer")}</p>
          </Card>
        </Link>
        <Link href="/admin/apps">
          <Card className="hover:border-border-light transition-colors cursor-pointer">
            <p className="text-3xl font-black">{appCount}</p>
            <p className="text-sm text-muted mt-1">{t("Apps")}</p>
          </Card>
        </Link>
        <Card>
          <p className="text-3xl font-black">{sessionCount}</p>
          <p className="text-sm text-muted mt-1">{t("Aktive Sitzungen")}</p>
        </Card>
      </div>

      {/* Recent Logins */}
      <Card>
        <CardTitle>{t("Letzte Anmeldungen")}</CardTitle>
        <div className="mt-4 overflow-x-auto max-h-80 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface-light">
              <tr className="text-left text-xs text-muted uppercase tracking-wider border-b border-border">
                <th className="pb-2 pr-4">{t("Nutzer")}</th>
                <th className="pb-2 pr-4 hidden sm:table-cell">IP</th>
                <th className="pb-2 pr-4 hidden md:table-cell">{t("Methode")}</th>
                <th className="pb-2 pr-4">{t("Status")}</th>
                <th className="pb-2">{t("Zeit")}</th>
              </tr>
            </thead>
            <tbody>
              {recentLogins.map((login: any) => (
                <tr key={login.id} className="border-b border-border/50 last:border-0">
                  <td className="py-2.5 pr-4 font-bold">{login.user.username}</td>
                  <td className="py-2.5 pr-4 text-muted font-mono text-xs hidden sm:table-cell">{login.ipAddress}</td>
                  <td className="py-2.5 pr-4 text-muted hidden md:table-cell">{login.method}</td>
                  <td className="py-2.5 pr-4">
                    {login.success ? (
                      <span className="text-success text-xs font-bold">{t("Erfolg")}</span>
                    ) : (
                      <span className="text-danger text-xs font-bold">{t("Fehler")}</span>
                    )}
                  </td>
                  <td className="py-2.5 text-muted text-xs">
                    {new Date(login.createdAt).toLocaleString(dateLocale(locale), { dateStyle: "short", timeStyle: "short" })}
                  </td>
                </tr>
              ))}
              {recentLogins.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-4 text-center text-muted">
                    {t("Noch keine Anmeldungen")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
