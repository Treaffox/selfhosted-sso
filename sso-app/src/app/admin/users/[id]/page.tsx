"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { SearchSelect } from "@/components/ui/search-select";
import { PageTitle } from "@/components/ui/page-title";
import { toast } from "sonner";
import { useI18n } from "@/components/i18n-provider";
import { dateLocale } from "@/lib/i18n/core";

interface UserDetail {
  id: string;
  username: string;
  email: string | null;
  isMaster: boolean;
  forcePasswordChange: boolean;
  totpVerified: boolean;
  failedAttempts: number;
  lockedUntil: string | null;
  createdAt: string;
  updatedAt: string;
  _count: { passkeys: number; recoveryCodes: number; sessions: number; trustedDevices: number };
  permissions: { id: string; permissionLevel: string; app: { id: string; name: string; permissionLevels: string; defaultPermission: string } }[];
  ipRules: { id: string; ipAddress: string; type: string; addedBy: string; createdAt: string }[];
  loginHistory: { id: string; ipAddress: string; success: boolean; method: string; reason: string | null; createdAt: string }[];
}

interface AppOption {
  id: string;
  name: string;
  permissionLevels: string[];
}

export default function UserDetailPage() {
  const { t, tn, te, locale } = useI18n();
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [user, setUser] = useState<UserDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Edit state
  const [newPassword, setNewPassword] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [allApps, setAllApps] = useState<AppOption[]>([]);
  const [addAppId, setAddAppId] = useState("");
  const [addPermLevel, setAddPermLevel] = useState("");

  const fetchUser = async () => {
    const res = await fetch(`/api/admin/users/${id}`);
    if (res.ok) setUser(await res.json());
    setLoading(false);
  };

  useEffect(() => { fetchUser(); }, [id]);

  useEffect(() => {
    fetch("/api/admin/apps")
      .then(r => r.ok ? r.json() : [])
      .then((apps: any[]) => {
        setAllApps(apps.map((a: any) => ({ id: a.id, name: a.name, permissionLevels: a.permissionLevels })));
      })
      .catch(() => {});
  }, []);

  const save = async (updates: Record<string, unknown>) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(te(data.error)); return; }
      toast.success(t("Gespeichert"));
      fetchUser();
    } catch { toast.error(t("Fehler")); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => {
    const res = await fetch(`/api/admin/users/${id}`, { method: "DELETE" });
    if (res.ok) router.push("/admin/users");
  };

  if (loading) return <><PageTitle title={t("Nutzerdetails")} /><div className="loading-bar rounded" /></>;
  if (!user) return <p className="text-muted">{t("Nutzer nicht gefunden")}</p>;

  return (
    <div className="animate-slide-up space-y-6">
      <PageTitle title={user.username} />
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <button onClick={() => router.push("/admin/users")} className="text-xs text-muted hover:text-foreground mb-2 flex items-center gap-1 transition-colors">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 2L4 6l4 4" /></svg>
            {t("Alle Nutzer")}
          </button>
          <h1 className="text-xl sm:text-2xl font-black">{user.username}</h1>
        </div>
        <div className="flex gap-2">
          {user.lockedUntil && (
            <Button variant="secondary" onClick={() => save({ unlock: true })} loading={saving}>
              {t("Entsperren")}
            </Button>
          )}
          {!user.isMaster && (
            <Button variant="danger" onClick={() => setShowDeleteConfirm(true)}>{t("Löschen")}</Button>
          )}
        </div>
      </div>


      {/* Info */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardTitle>{t("Profil")}</CardTitle>
          <div className="mt-4 space-y-3 text-sm">
            <div className="flex justify-between gap-2"><span className="text-muted shrink-0">ID</span><span className="font-mono text-xs truncate">{user.id}</span></div>
            <div className="flex justify-between"><span className="text-muted">{t("E-Mail")}</span><span>{user.email ?? "–"}</span></div>
            <div className="flex justify-between"><span className="text-muted">{t("Erstellt")}</span><span>{new Date(user.createdAt).toLocaleDateString(dateLocale(locale))}</span></div>
            <div className="flex justify-between"><span className="text-muted">{t("Sitzungen")}</span><span>{user._count.sessions}</span></div>
            <div className="flex justify-between">
              <span className="text-muted">{t("Status")}</span>
              <div className="flex gap-1">
                {user.lockedUntil && <Badge variant="danger">{t("Gesperrt")}</Badge>}
                {user.forcePasswordChange && <Badge variant="warning">{t("PW ändern")}</Badge>}
                {user.totpVerified && <Badge variant="success">TOTP</Badge>}
                {user._count.passkeys > 0 && <Badge variant="success">{t("Passkey")}</Badge>}
              </div>
            </div>
          </div>
        </Card>

        <Card>
          <CardTitle>{t("Aktionen")}</CardTitle>
          <div className="mt-4 space-y-3">
            <div>
              <Input
                label={t("Neues Passwort setzen")}
                type="text"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder={t("Neues Passwort")}
              />
              <Button size="sm" className="mt-2" onClick={() => { save({ password: newPassword }); setNewPassword(""); }} loading={saving} disabled={!newPassword}>
                {t("Passwort ändern")}
              </Button>
            </div>
            <div>
              <Input
                label={t("E-Mail ändern")}
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder={user.email ?? "nutzer@example.com"}
              />
              <Button size="sm" className="mt-2" onClick={() => { save({ email: newEmail }); setNewEmail(""); }} loading={saving}>
                {t("E-Mail speichern")}
              </Button>
            </div>
          </div>
        </Card>
      </div>

      {/* Permissions */}
      <Card>
        <CardTitle>{t("App-Berechtigungen")}</CardTitle>
        <CardDescription>{t("Eigene Zuweisungen pro App. Ohne Zuweisung gilt das Standard-Level der jeweiligen App.")}</CardDescription>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted uppercase tracking-wider border-b border-border">
                <th className="pb-2 pr-4">{t("App")}</th>
                <th className="pb-2 pr-4">{t("Berechtigung")}</th>
                <th className="pb-2">{t("Ändern")}</th>
              </tr>
            </thead>
            <tbody>
              {user.permissions.map((p) => {
                const levels: string[] = (() => { try { return JSON.parse(p.app.permissionLevels); } catch { return ["ALLOW", "DENY"]; } })();
                return (
                  <tr key={p.id} className="border-b border-border/50 last:border-0">
                    <td className="py-2.5 pr-4 font-bold">{p.app.name}</td>
                    <td className="py-2.5 pr-4">
                      <Badge variant={p.permissionLevel === "ALLOW" ? "success" : p.permissionLevel === "DENY" ? "danger" : "default"}>
                        {p.permissionLevel}
                      </Badge>
                    </td>
                    <td className="py-2.5">
                      <div className="flex items-center gap-2">
                        <select
                          className="w-28 bg-surface-lighter border border-border rounded px-2 py-1 text-xs text-foreground"
                          value={p.permissionLevel}
                          onChange={(e) => save({ permissions: [{ appId: p.app.id, permissionLevel: e.target.value }] })}
                        >
                          {levels.map((l: string) => (
                            <option key={l} value={l}>{l}</option>
                          ))}
                        </select>
                        <button
                          onClick={() => save({ permissions: [{ appId: p.app.id, remove: true }] })}
                          disabled={saving}
                          className="text-xs font-bold text-muted hover:text-danger transition-colors disabled:opacity-40"
                          title={t("Zuweisung entfernen – danach gilt das Standard-Level der App ({level})", { level: p.app.defaultPermission })}
                        >
                          {t("Entfernen")}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {user.permissions.length === 0 && (
                <tr><td colSpan={3} className="py-4 text-center text-muted">{t("Keine App-Berechtigungen")}</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Add app permission */}
        {(() => {
          const assignedAppIds = new Set(user.permissions.map(p => p.app.id));
          const unassigned = allApps.filter(a => !assignedAppIds.has(a.id));
          const selectedApp = allApps.find(a => a.id === addAppId);
          if (allApps.length === 0) return null;
          if (unassigned.length === 0) {
            return <p className="mt-4 text-xs text-muted">{t("Bereits allen Apps zugewiesen.")}</p>;
          }
          return (
            <div className="mt-4 flex flex-col sm:flex-row gap-2 sm:items-center">
              <SearchSelect
                options={unassigned.map(a => ({ value: a.id, label: a.name }))}
                value={addAppId}
                onChange={(v) => { setAddAppId(v); setAddPermLevel(""); }}
                placeholder={t("App wählen…")}
                className="flex-1"
              />
              <select
                className="w-full sm:w-36 shrink-0 bg-surface-lighter border border-border rounded-lg px-4 py-3 text-sm font-semibold text-foreground focus:outline-none focus:border-foreground"
                value={addPermLevel}
                onChange={(e) => setAddPermLevel(e.target.value)}
              >
                <option value="">{t("Level…")}</option>
                {(selectedApp?.permissionLevels ?? []).map((l: string) => (
                  <option key={l} value={l}>{l}</option>
                ))}
              </select>
              <Button
                disabled={!addAppId || !addPermLevel}
                onClick={() => {
                  save({ permissions: [{ appId: addAppId, permissionLevel: addPermLevel }] });
                  setAddAppId("");
                  setAddPermLevel("");
                }}
                loading={saving}
              >
                {t("Zuweisen")}
              </Button>
            </div>
          );
        })()}
      </Card>

      {/* Login History */}
      <Card>
        <CardTitle>{t("Login-Verlauf")}</CardTitle>
        <div className="mt-4 overflow-x-auto max-h-80 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface-light">
              <tr className="text-left text-xs text-muted uppercase tracking-wider border-b border-border">
                <th className="pb-2 pr-4">{t("Zeit")}</th>
                <th className="pb-2 pr-4 hidden sm:table-cell">IP</th>
                <th className="pb-2 pr-4">{t("Methode")}</th>
                <th className="pb-2 pr-4">{t("Status")}</th>
                <th className="pb-2 hidden md:table-cell">{t("Grund")}</th>
              </tr>
            </thead>
            <tbody>
              {user.loginHistory.map((h) => (
                <tr key={h.id} className="border-b border-border/50 last:border-0">
                  <td className="py-2 pr-4 text-xs text-muted">{new Date(h.createdAt).toLocaleString(dateLocale(locale), { dateStyle: "short", timeStyle: "short" })}</td>
                  <td className="py-2 pr-4 font-mono text-xs hidden sm:table-cell">{h.ipAddress}</td>
                  <td className="py-2 pr-4 text-xs">{h.method}</td>
                  <td className="py-2 pr-4">{h.success ? <span className="text-success text-xs font-bold">OK</span> : <span className="text-danger text-xs font-bold">{t("Fehler")}</span>}</td>
                  <td className="py-2 text-xs text-muted hidden md:table-cell">{h.reason ?? "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Delete Confirmation */}
      <Modal open={showDeleteConfirm} onClose={() => setShowDeleteConfirm(false)} title={t("Nutzer löschen?")}>
        <p className="text-sm text-muted mb-4">
          {tn("Möchtest du {name} wirklich löschen? Alle Daten werden unwiderruflich gelöscht.", { name: <strong className="text-foreground">{user.username}</strong> })}
        </p>
        <div className="flex gap-3">
          <Button variant="secondary" className="flex-1" onClick={() => setShowDeleteConfirm(false)}>{t("Abbrechen")}</Button>
          <Button variant="danger" className="flex-1" onClick={handleDelete}>{t("Löschen")}</Button>
        </div>
      </Modal>
    </div>
  );
}
