"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageTitle } from "@/components/ui/page-title";
import { useI18n } from "@/components/i18n-provider";
import { dateLocale } from "@/lib/i18n/core";

interface SessionInfo {
  id: string;
  ipAddress: string;
  userAgent: string | null;
  createdAt: string;
  expiresAt: string;
  isCurrent: boolean;
}

interface GuestGrantInfo {
  id: string;
  ipAddress: string;
  userAgent: string | null;
  createdAt: string;
  expiresAt: string;
  app: { id: string; name: string };
}

interface TrustedDeviceInfo {
  id: string;
  deviceName: string | null;
  ipAddress: string;
  userAgent: string | null;
  createdAt: string;
  expiresAt: string;
  isCurrent: boolean;
}

export default function SessionsPage() {
  const { t, locale } = useI18n();
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [trustedDevices, setTrustedDevices] = useState<TrustedDeviceInfo[]>([]);
  const [guestGrants, setGuestGrants] = useState<GuestGrantInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [revoking, setRevoking] = useState<string | null>(null);

  const fetchSessions = async () => {
    const res = await fetch("/api/settings/sessions");
    if (res.ok) {
      const data = await res.json();
      setSessions(data.sessions ?? []);
      setTrustedDevices(data.trustedDevices ?? []);
      setGuestGrants(data.guestGrants ?? []);
    }
    setLoading(false);
  };

  useEffect(() => { fetchSessions(); }, []);

  const revokeSession = async (id: string) => {
    setRevoking(id);
    const res = await fetch("/api/settings/sessions", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: id }),
    });
    if (res.ok) {
      setSessions((prev) => prev.filter((s) => s.id !== id));
    }
    setRevoking(null);
  };

  const revokeAll = async () => {
    setRevoking("all");
    for (const session of sessions) {
      if (!session.isCurrent) {
        await fetch("/api/settings/sessions", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: session.id }),
        });
      }
    }
    fetchSessions();
    setRevoking(null);
  };

  const revokeTrustedDevice = async (id: string) => {
    setRevoking(`td:${id}`);
    const res = await fetch("/api/settings/sessions", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trustedDeviceId: id }),
    });
    if (res.ok) {
      setTrustedDevices((prev) => (id === "all" ? [] : prev.filter((d) => d.id !== id)));
    }
    setRevoking(null);
  };

  const revokeGuest = async (id: string) => {
    setRevoking(`guest:${id}`);
    const res = await fetch("/api/settings/sessions", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guestGrantId: id }),
    });
    if (res.ok) {
      setGuestGrants((prev) => (id === "all" ? [] : prev.filter((g) => g.id !== id)));
    }
    setRevoking(null);
  };

  const parseBrowser = (ua: string | null): string => {
    if (!ua) return t("Unbekannt");
    if (ua.includes("Firefox")) return "Firefox";
    if (ua.includes("Edg")) return "Edge";
    if (ua.includes("Chrome")) return "Chrome";
    if (ua.includes("Safari")) return "Safari";
    if (ua.includes("curl")) return "curl";
    return t("Unbekannt");
  };

  const parseOS = (ua: string | null): string => {
    if (!ua) return "";
    if (ua.includes("Windows")) return "Windows";
    if (ua.includes("Mac OS")) return "macOS";
    if (ua.includes("Linux")) return "Linux";
    if (ua.includes("Android")) return "Android";
    if (ua.includes("iPhone") || ua.includes("iPad")) return "iOS";
    return "";
  };

  if (loading) return <><PageTitle title={t("Aktive Sitzungen")} /><div className="loading-bar rounded" /></>;

  const otherSessions = sessions.filter((s) => !s.isCurrent);

  return (
    <div className="animate-slide-up space-y-6">
      <PageTitle title={t("Aktive Sitzungen")} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl sm:text-2xl font-black">{t("Aktive Sitzungen")}</h1>
        {otherSessions.length > 0 && (
          <Button
            variant="danger"
            size="sm"
            onClick={revokeAll}
            loading={revoking === "all"}
          >
            {t("Alle anderen abmelden")}
          </Button>
        )}
      </div>

      {sessions.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">{t("Keine aktiven Sitzungen gefunden.")}</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {sessions.map((session) => (
            <Card key={session.id}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="text-sm font-bold">
                      {parseBrowser(session.userAgent)}
                      {parseOS(session.userAgent) && t(" auf {os}", { os: parseOS(session.userAgent) })}
                    </p>
                    {session.isCurrent && (
                      <Badge variant="success">{t("Aktuell")}</Badge>
                    )}
                  </div>
                  <div className="space-y-1 text-xs text-muted">
                    <p>{t("IP: {ipAddress}", { ipAddress: session.ipAddress })}</p>
                    <p>
                      {t("Angemeldet: {date}", { date: new Date(session.createdAt).toLocaleString(dateLocale(locale)) })}
                    </p>
                    <p>
                      {t("Läuft ab: {date}", { date: new Date(session.expiresAt).toLocaleString(dateLocale(locale)) })}
                    </p>
                  </div>
                </div>
                {!session.isCurrent && (
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => revokeSession(session.id)}
                    loading={revoking === session.id}
                  >
                    {t("Abmelden")}
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>{t("Vertraute Geräte")}</CardTitle>
            <CardDescription>
              {t("Auf diesen Geräten wird nach dem Passwort keine zweite Bestätigung verlangt.")}
            </CardDescription>
          </div>
          {trustedDevices.length > 0 && (
            <Button
              variant="danger"
              size="sm"
              onClick={() => revokeTrustedDevice("all")}
              loading={revoking === "td:all"}
            >
              {t("Alle entfernen")}
            </Button>
          )}
        </div>
        {trustedDevices.length === 0 ? (
          <p className="text-sm text-muted mt-4">{t("Keine vertrauten Geräte.")}</p>
        ) : (
          <div className="mt-4 space-y-2">
            {trustedDevices.map((device) => (
              <div key={device.id} className="flex items-start justify-between gap-4 p-3 bg-foreground/5 rounded-lg">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="text-sm font-bold">
                      {parseBrowser(device.userAgent)}
                      {parseOS(device.userAgent) && t(" auf {os}", { os: parseOS(device.userAgent) })}
                    </p>
                    {device.isCurrent && <Badge variant="success">{t("Dieses Gerät")}</Badge>}
                  </div>
                  <p className="text-xs text-muted">
                    {t("Hinzugefügt: {added} · gültig bis {until}", {
                      added: new Date(device.createdAt).toLocaleString(dateLocale(locale)),
                      until: new Date(device.expiresAt).toLocaleDateString(dateLocale(locale)),
                    })}
                  </p>
                </div>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => revokeTrustedDevice(device.id)}
                  loading={revoking === `td:${device.id}`}
                >
                  {t("Entfernen")}
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {guestGrants.length > 0 && (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>{t("Gast-Zugänge")}</CardTitle>
              <CardDescription>
                {t("Diese Geräte haben nur Zugriff auf die genannte App, nicht auf dein Konto.")}
              </CardDescription>
            </div>
            {guestGrants.length > 1 && (
              <Button variant="danger" size="sm" onClick={() => revokeGuest("all")} loading={revoking === "guest:all"}>
                {t("Alle beenden")}
              </Button>
            )}
          </div>
          <div className="mt-4 space-y-2">
            {guestGrants.map((grant) => (
              <div key={grant.id} className="flex items-start justify-between gap-4 p-3 bg-foreground/5 rounded-lg">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold mb-1">
                    {grant.app.name}
                    <span className="font-semibold text-muted">
                      {" · "}
                      {parseBrowser(grant.userAgent)}
                      {parseOS(grant.userAgent) && t(" auf {os}", { os: parseOS(grant.userAgent) })}
                    </span>
                  </p>
                  <p className="text-xs text-muted">
                    {t("IP: {ipAddress} · bis {date}", { ipAddress: grant.ipAddress, date: new Date(grant.expiresAt).toLocaleString(dateLocale(locale)) })}
                  </p>
                </div>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => revokeGuest(grant.id)}
                  loading={revoking === `guest:${grant.id}`}
                >
                  {t("Beenden")}
                </Button>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card>
        <CardTitle>{t("Sicherheitshinweis")}</CardTitle>
        <CardDescription>
          {t("Wenn du eine Sitzung nicht erkennst, melde sie sofort ab und ändere dein Passwort.")}
        </CardDescription>
      </Card>
    </div>
  );
}
