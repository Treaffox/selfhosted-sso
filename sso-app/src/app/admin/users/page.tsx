"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { PageTitle } from "@/components/ui/page-title";
import { toast } from "sonner";
import { useI18n } from "@/components/i18n-provider";
import { dateLocale } from "@/lib/i18n/core";
import { GUEST_ACCOUNT_DEFAULT_MINUTES } from "@/lib/guest-account-duration";
import { GuestDuration } from "./guest-duration";

interface User {
  id: string;
  username: string;
  email: string | null;
  isMaster: boolean;
  forcePasswordChange: boolean;
  expiresAt: string | null;
  totpVerified: boolean;
  createdAt: string;
  _count: { passkeys: number; sessions: number };
  permissions: { permissionLevel: string; app: { id: string; name: string } }[];
}

export default function UsersPage() {
  const { t, te, locale } = useI18n();
  const router = useRouter();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [creating, setCreating] = useState(false);
  const [newGuest, setNewGuest] = useState(false);
  const [newGuestMinutes, setNewGuestMinutes] = useState<number | null>(GUEST_ACCOUNT_DEFAULT_MINUTES);
  const [invite, setInvite] = useState<{ url: string; username: string; mailed: boolean; until: string } | null>(null);

  const fetchUsers = async () => {
    const res = await fetch("/api/admin/users");
    if (res.ok) setUsers(await res.json());
    setLoading(false);
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const filteredUsers = users.filter((user) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      user.username.toLowerCase().includes(q) ||
      user.id.toLowerCase().includes(q) ||
      (user.email ?? "").toLowerCase().includes(q)
    );
  });

  const handleCreate = async () => {
    setCreating(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: newUsername,
          password: newPassword || undefined,
          email: newEmail || undefined,
          guestMinutes: newGuest ? newGuestMinutes : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(te(data.error));
        return;
      }
      setShowCreate(false);
      setInvite({ url: data.inviteUrl, username: newUsername, mailed: !!data.mailed, until: new Date(data.inviteExpiresAt).toLocaleString(dateLocale(locale), { dateStyle: "medium", timeStyle: "short" }) });
      setNewGuest(false);
      setNewUsername("");
      setNewPassword("");
      setNewEmail("");
      fetchUsers();
    } catch {
      toast.error(t("Fehler beim Erstellen"));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="animate-slide-up">
      <PageTitle title={t("Nutzer")} />
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6 sm:mb-8">
        <h1 className="text-xl sm:text-2xl font-black">{t("Nutzer")}</h1>
        <Button onClick={() => setShowCreate(true)}>{t("Nutzer anlegen")}</Button>
      </div>

      <div className="mb-4">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("Suche nach Benutzername, ID oder E-Mail…")}
        />
      </div>

      {loading ? (
        <div className="loading-bar rounded" />
      ) : (
        <Card className="p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted uppercase tracking-wider border-b border-border bg-surface-lighter/50">
                  <th className="px-4 sm:px-5 py-3">{t("Benutzername")}</th>
                  <th className="px-4 sm:px-5 py-3 hidden lg:table-cell">ID</th>
                  <th className="px-4 sm:px-5 py-3 hidden md:table-cell">{t("E-Mail")}</th>
                  <th className="px-4 sm:px-5 py-3">{t("Sicherheit")}</th>
                  <th className="px-4 sm:px-5 py-3 hidden lg:table-cell">{t("Berechtigungen")}</th>
                  <th className="px-4 sm:px-5 py-3 hidden sm:table-cell">{t("Erstellt")}</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 sm:px-5 py-6 text-center text-muted">
                      {t("Keine Nutzer gefunden")}
                    </td>
                  </tr>
                )}
                {filteredUsers.map((user) => (
                  <tr
                    key={user.id}
                    className="border-b border-border/50 last:border-0 hover:bg-surface-lighter/30 cursor-pointer transition-colors"
                    onClick={() => router.push(`/admin/users/${user.id}`)}
                  >
                    <td className="px-4 sm:px-5 py-3 font-bold">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span>{user.username}</span>
                        {user.isMaster && <Badge variant="warning">{t("Master")}</Badge>}
                        {user.forcePasswordChange && <Badge variant="danger">{t("PW ändern")}</Badge>}
                        {user.expiresAt && (new Date(user.expiresAt).getTime() <= Date.now()
                          ? <Badge variant="danger">{t("Abgelaufen")}</Badge>
                          : <Badge variant="warning">{t("Gast bis {date}", { date: new Date(user.expiresAt).toLocaleString(dateLocale(locale), { dateStyle: "medium", timeStyle: "short" }) })}</Badge>)}
                      </div>
                    </td>
                    <td className="px-4 sm:px-5 py-3 text-muted font-mono text-xs hidden lg:table-cell">{user.id}</td>
                    <td className="px-4 sm:px-5 py-3 text-muted hidden md:table-cell">{user.email ?? "–"}</td>
                    <td className="px-4 sm:px-5 py-3">
                      <div className="flex gap-1">
                        {user.totpVerified && <Badge variant="success">TOTP</Badge>}
                        {user._count.passkeys > 0 && (
                          <Badge variant="success">{t("{passkeys} Passkey(s)", { passkeys: user._count.passkeys })}</Badge>
                        )}
                        {!user.totpVerified && user._count.passkeys === 0 && (
                          <Badge variant="danger">{t("Kein MFA")}</Badge>
                        )}
                      </div>
                    </td>
                    <td className="px-4 sm:px-5 py-3 hidden lg:table-cell">
                      <div className="flex flex-wrap gap-1 max-w-xs">
                        {user.permissions.length === 0 && <span className="text-muted text-xs">–</span>}
                        {user.permissions.slice(0, 3).map((p) => (
                          <Badge
                            key={p.app.id}
                            variant={
                              p.permissionLevel === "ALLOW"
                                ? "success"
                                : p.permissionLevel === "DENY"
                                ? "danger"
                                : "default"
                            }
                            className="max-w-[9rem] truncate"
                          >
                            {p.app.name}: {p.permissionLevel}
                          </Badge>
                        ))}
                        {user.permissions.length > 3 && (
                          <span title={user.permissions.slice(3).map((p) => `${p.app.name}: ${p.permissionLevel}`).join(", ")}>
                            <Badge variant="default">+{user.permissions.length - 3}</Badge>
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 sm:px-5 py-3 text-muted text-xs hidden sm:table-cell">
                      {new Date(user.createdAt).toLocaleDateString(dateLocale(locale))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Create User Modal */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title={t("Nutzer anlegen")}>
        <div className="space-y-4">
          <Input
            label={t("Benutzername")}
            value={newUsername}
            onChange={(e) => setNewUsername(e.target.value)}
            placeholder={t("benutzername")}
            autoFocus
          />
          <Input
            label={t("Passwort (optional)")}
            type="text"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder={t("Leer lassen: die Person wählt es über den Einladungslink")}
          />
          <Input
            label={t("E-Mail (optional)")}
            type="email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            placeholder={t("nutzer@example.com")}
          />
          <label className="flex items-start gap-2 cursor-pointer">
            <input type="checkbox" checked={newGuest} onChange={(e) => setNewGuest(e.target.checked)} className="w-4 h-4 mt-0.5 accent-foreground" />
            <span className="text-xs text-muted">
              {t("Gastkonto: nur Passwort, nie MFA, kein Zugriff auf Apps außer den freigegebenen, wird nach Ablauf gelöscht")}
            </span>
          </label>
          {newGuest && (
            <div>
              <label className="block text-xs text-muted uppercase tracking-wider mb-1.5">{t("Gültig für")}</label>
              <GuestDuration onChange={setNewGuestMinutes} />
            </div>
          )}
          <Button onClick={handleCreate} loading={creating} disabled={newGuest && newGuestMinutes === null} className="w-full">
            {t("Nutzer erstellen")}
          </Button>
        </div>
      </Modal>

      {/* Invitation link */}
      <Modal open={!!invite} onClose={() => setInvite(null)} title={t("Einladungslink")}>
        {invite && (
          <div className="space-y-4">
            <p className="text-sm text-muted">
              {invite.mailed
                ? t("Der Link wurde per E-Mail an {username} gesendet. Er ist bis {date} gültig und funktioniert nur einmal.", { username: invite.username, date: invite.until })
                : t("Gib {username} diesen Link weiter. Er ist bis {date} gültig und funktioniert nur einmal. Per E-Mail wurde nichts gesendet.", { username: invite.username, date: invite.until })}
            </p>
            <Input label={t("Link")} readOnly value={invite.url} onFocus={(e) => e.currentTarget.select()} />
            <Button
              className="w-full"
              onClick={() => navigator.clipboard.writeText(invite.url).then(() => toast.success(t("Kopiert"))).catch(() => {})}
            >
              {t("Link kopieren")}
            </Button>
          </div>
        )}
      </Modal>
    </div>
  );
}
