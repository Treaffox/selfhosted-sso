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
import { DnsRecordsCard } from "@/components/admin/dns-records-card";
import { useI18n } from "@/components/i18n-provider";

interface AppDetail {
  id: string;
  name: string;
  tokenPrefix: string;
  permissionLevels: string[];
  defaultPermission: string;
  isActive: boolean;
  redirectUris: string[];
  createdAt: string;
  updatedAt: string;
  permissions: { id: string; permissionLevel: string; user: { id: string; username: string } }[];
  clientId?: string;
  clientSecretPrefix?: string;
  clientType: string;
  allowedScopes: string[];
  oidcEnabled: boolean;
}

interface UserOption {
  id: string;
  username: string;
}

export default function AppDetailPage() {
  const { t, tn, te } = useI18n();
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [app, setApp] = useState<AppDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [showRegenerate, setShowRegenerate] = useState(false);
  const [showOidcGenerate, setShowOidcGenerate] = useState(false);
  const [newToken, setNewToken] = useState("");
  const [newOidcCredentials, setNewOidcCredentials] = useState<{ clientId: string; clientSecret: string } | null>(null);
  const [newClientType, setNewClientType] = useState<"confidential" | "public">("confidential");
  const [editName, setEditName] = useState("");
  const [newUri, setNewUri] = useState("");
  const [allUsers, setAllUsers] = useState<UserOption[]>([]);
  const [addUserId, setAddUserId] = useState("");
  const [addPermLevel, setAddPermLevel] = useState("");
  const [newLevel, setNewLevel] = useState("");

  const fetchApp = async () => {
    const res = await fetch(`/api/admin/apps/${id}`);
    if (res.ok) {
      const data = await res.json();
      setApp(data);
      setEditName(data.name);
    }
    setLoading(false);
  };

  useEffect(() => { fetchApp(); }, [id]);

  useEffect(() => {
    fetch("/api/admin/users").then(r => r.ok ? r.json() : []).then((users: any[]) => {
      setAllUsers(users.map((u: any) => ({ id: u.id, username: u.username })));
    });
  }, []);

  const save = async (updates: Record<string, unknown>) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/apps/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(te(data.error)); return; }
      if (data.token) { setNewToken(data.token); setShowRegenerate(false); }
      if (data.clientId && data.clientSecret) {
        setNewOidcCredentials({ clientId: data.clientId, clientSecret: data.clientSecret });
        setShowOidcGenerate(false);
      }
      toast.success(t("Gespeichert"));
      fetchApp();
    } catch { toast.error(t("Fehler")); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => {
    const res = await fetch(`/api/admin/apps/${id}`, { method: "DELETE" });
    if (res.ok) router.push("/admin/apps");
  };

  if (loading) return <><PageTitle title={t("App-Details")} /><div className="loading-bar rounded" /></>;
  if (!app) return <p className="text-muted">{t("App nicht gefunden")}</p>;

  return (
    <div className="animate-slide-up space-y-6">
      <PageTitle title={app.name} />
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <button onClick={() => router.push("/admin/apps")} className="text-xs text-muted hover:text-foreground mb-2 flex items-center gap-1 transition-colors">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 2L4 6l4 4" /></svg>
            {t("Alle Apps")}
          </button>
          <h1 className="text-xl sm:text-2xl font-black">{app.name}</h1>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => save({ isActive: !app.isActive })} loading={saving}>
            {app.isActive ? t("Deaktivieren") : t("Aktivieren")}
          </Button>
          <Button variant="danger" onClick={() => setShowDelete(true)}>{t("Löschen")}</Button>
        </div>
      </div>


      {newToken && (
        <div className="bg-surface-lighter border border-foreground/20 rounded-lg p-4">
          <p className="text-xs text-muted mb-2 font-bold">{t("Neues App-Token (nur jetzt sichtbar!)")}</p>
          <code className="text-sm text-foreground break-all font-mono select-all">{newToken}</code>
        </div>
      )}

      {newOidcCredentials && (
        <div className="bg-surface-lighter border border-foreground/20 rounded-lg p-4 space-y-3">
          <p className="text-xs text-muted font-bold">{t("OIDC-Credentials (nur jetzt sichtbar!)")}</p>
          <div>
            <p className="text-xs text-muted mb-1">{t("Client ID")}</p>
            <code className="text-sm text-foreground break-all font-mono select-all">{newOidcCredentials.clientId}</code>
          </div>
          <div>
            <p className="text-xs text-muted mb-1">{t("Client Secret")}</p>
            <code className="text-sm text-foreground break-all font-mono select-all">{newOidcCredentials.clientSecret}</code>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardTitle>{t("Einstellungen")}</CardTitle>
          <div className="mt-4 space-y-4">
            <Input label={t("Name")} value={editName} onChange={(e) => setEditName(e.target.value)} />
            <Button size="sm" onClick={() => save({ name: editName })} loading={saving}>
              {t("Namen speichern")}
            </Button>

            <div>
              <p className="block text-xs text-muted mb-1.5 uppercase tracking-wider">{t("Redirect-URIs")}</p>
              <p className="text-xs text-muted/70 mb-2">
                {t("https://… (beliebiger Host), http://localhost… für lokale Entwicklung, oder ein Custom-URI-Scheme für native Apps (z.B. meineapp:/callback).")}
              </p>
              <div className="space-y-1.5 mb-2">
                {app.redirectUris.map((uri) => (
                  <div key={uri} className="flex items-center justify-between gap-2 bg-surface-lighter border border-border rounded-lg px-3 py-2">
                    <span className="font-mono text-xs truncate">{uri}</span>
                    <button
                      onClick={() => save({ redirectUris: app.redirectUris.filter((u) => u !== uri) })}
                      className="text-muted hover:text-foreground transition-colors shrink-0"
                      title={t("Entfernen")}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M6 6l12 12M18 6L6 18" /></svg>
                    </button>
                  </div>
                ))}
                {app.redirectUris.length === 0 && (
                  <p className="text-xs text-muted">{t("Keine Redirect-URI hinterlegt.")}</p>
                )}
              </div>
              <div className="flex gap-2 items-center">
                <Input
                  value={newUri}
                  onChange={(e) => setNewUri(e.target.value)}
                  placeholder={t("https://app.example.com/callback")}
                  className="flex-1"
                />
                <Button
                  disabled={!newUri || app.redirectUris.includes(newUri)}
                  onClick={() => {
                    save({ redirectUris: [...app.redirectUris, newUri] });
                    setNewUri("");
                  }}
                  loading={saving}
                >
                  {t("Hinzufügen")}
                </Button>
              </div>
            </div>
          </div>
        </Card>

        <Card>
          <CardTitle>{t("Token & Sicherheit")}</CardTitle>
          <div className="mt-4 space-y-3 text-sm">
            <div className="flex justify-between items-center gap-2">
              <span className="text-muted shrink-0">{t("App-ID")}</span>
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-mono text-xs truncate">{app.id}</span>
                <button
                  onClick={() => navigator.clipboard.writeText(app.id)}
                  className="text-xs text-muted hover:text-foreground transition-colors"
                  title={t("Kopieren")}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
                </button>
              </div>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">{t("Token-Prefix")}</span>
              <span className="font-mono">{app.tokenPrefix}...</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">{t("Status")}</span>
              <Badge variant={app.isActive ? "success" : "danger"}>
                {app.isActive ? t("Aktiv") : t("Inaktiv")}
              </Badge>
            </div>
            <Button size="sm" variant="danger" onClick={() => setShowRegenerate(true)}>
              {t("Token regenerieren")}
            </Button>
          </div>
        </Card>
      </div>

      <Card>
        <CardTitle>{t("OpenID Connect (OIDC)")}</CardTitle>
        <CardDescription>{t("Für externe Anwendungen wie Grafana oder Gitea.")}</CardDescription>
        <div className="mt-4 space-y-3 text-sm">
          {app.clientId ? (
            <>
              <div className="flex justify-between items-center gap-2">
                <span className="text-muted shrink-0">{t("Client ID")}</span>
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-mono text-xs truncate">{app.clientId}</span>
                  <button
                    onClick={() => navigator.clipboard.writeText(app.clientId!)}
                    className="text-xs text-muted hover:text-foreground transition-colors"
                    title={t("Kopieren")}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
                  </button>
                </div>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">{t("Client Secret")}</span>
                <span className="font-mono">{app.clientSecretPrefix}...</span>
              </div>
              <div className="flex justify-between items-center gap-2">
                <span className="text-muted shrink-0">{t("Client-Typ")}</span>
                <div className="flex gap-1.5">
                  <button
                    onClick={() => save({ clientType: "confidential" })}
                    className={`text-xs font-bold px-2.5 py-1 rounded-md border transition-colors ${
                      app.clientType === "confidential"
                        ? "bg-foreground text-background border-foreground"
                        : "border-border text-muted hover:text-foreground"
                    }`}
                  >
                    {t("Confidential")}
                  </button>
                  <button
                    onClick={() => save({ clientType: "public" })}
                    className={`text-xs font-bold px-2.5 py-1 rounded-md border transition-colors ${
                      app.clientType === "public"
                        ? "bg-foreground text-background border-foreground"
                        : "border-border text-muted hover:text-foreground"
                    }`}
                  >
                    {t("Public")}
                  </button>
                </div>
              </div>
              <p className="text-xs text-muted/70">
                {app.clientType === "public"
                  ? t("Für native/mobile Apps oder SPAs, die kein Client-Secret geheim halten können — PKCE ist Pflicht, kein Secret nötig.")
                  : t("Für Server-Anwendungen, die das Client-Secret sicher aufbewahren (z.B. auf eurer eigenen Infrastruktur).")}
              </p>
              <div className="flex justify-between items-center">
                <span className="text-muted">{t("Status")}</span>
                <Badge variant={app.oidcEnabled ? "success" : "danger"}>
                  {app.oidcEnabled ? t("Aktiv") : t("Deaktiviert")}
                </Badge>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => save({ oidcEnabled: !app.oidcEnabled })} loading={saving}>
                  {app.oidcEnabled ? t("OIDC deaktivieren") : t("OIDC aktivieren")}
                </Button>
                <Button size="sm" variant="danger" onClick={() => setShowOidcGenerate(true)}>
                  {t("Credentials neu generieren")}
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-muted text-xs">{t("Noch keine OIDC-Credentials konfiguriert.")}</p>
              <div>
                <p className="text-xs text-muted mb-1.5 uppercase tracking-wider">{t("Client-Typ")}</p>
                <div className="flex gap-1.5">
                  <button
                    onClick={() => setNewClientType("confidential")}
                    className={`text-xs font-bold px-2.5 py-1 rounded-md border transition-colors ${
                      newClientType === "confidential"
                        ? "bg-foreground text-background border-foreground"
                        : "border-border text-muted hover:text-foreground"
                    }`}
                  >
                    {t("Confidential")}
                  </button>
                  <button
                    onClick={() => setNewClientType("public")}
                    className={`text-xs font-bold px-2.5 py-1 rounded-md border transition-colors ${
                      newClientType === "public"
                        ? "bg-foreground text-background border-foreground"
                        : "border-border text-muted hover:text-foreground"
                    }`}
                  >
                    {t("Public")}
                  </button>
                </div>
                <p className="text-xs text-muted/70 mt-1.5">
                  {newClientType === "public"
                    ? t("Für native/mobile Apps oder SPAs — PKCE Pflicht, kein Secret.")
                    : t("Für Server-Anwendungen mit sicher aufbewahrtem Secret.")}
                </p>
              </div>
              <Button size="sm" onClick={() => save({ generateOidcCredentials: true, clientType: newClientType })} loading={saving}>
                {t("OIDC aktivieren")}
              </Button>
            </>
          )}
        </div>
      </Card>

      <DnsRecordsCard appId={id} />

      <Card>
        <CardTitle>{t("Berechtigungs-Level")}</CardTitle>
        <CardDescription>{t("ALLOW und DENY sind fest, weitere Level (z.B. ADMIN, SUPERUSER) kannst du frei anlegen.")}</CardDescription>
        <div className="mt-3 flex flex-wrap gap-2">
          {app.permissionLevels.map((level) => {
            const protectedLevel = level === "ALLOW" || level === "DENY" || level === app.defaultPermission;
            return (
              <Badge key={level} variant={level === "ALLOW" ? "success" : level === "DENY" ? "danger" : "default"}>
                <span className="inline-flex items-center gap-1.5">
                  {level}
                  {!protectedLevel && (
                    <button
                      onClick={() => save({ permissionLevels: app.permissionLevels.filter((l) => l !== level) })}
                      className="hover:text-foreground transition-colors"
                      title={t("Level entfernen")}
                    >
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M6 6l12 12M18 6L6 18" /></svg>
                    </button>
                  )}
                </span>
              </Badge>
            );
          })}
        </div>
        <div className="mt-4 flex gap-2 items-center">
          <Input
            value={newLevel}
            onChange={(e) => setNewLevel(e.target.value.toUpperCase())}
            placeholder={t("z.B. ADMIN")}
            className="flex-1"
          />
          <Button
            disabled={!newLevel || !/^[A-Z0-9_-]+$/.test(newLevel) || app.permissionLevels.includes(newLevel)}
            onClick={() => {
              save({ permissionLevels: [...app.permissionLevels, newLevel] });
              setNewLevel("");
            }}
            loading={saving}
          >
            {t("Hinzufügen")}
          </Button>
        </div>
        <div className="mt-6 pt-4 border-t border-border/50">
          <p className="text-xs text-muted mb-1.5 uppercase tracking-wider">{t("Standard-Level")}</p>
          <select
            className="w-full sm:w-48 bg-surface-lighter border border-border rounded-lg px-4 py-3 text-sm font-semibold text-foreground focus:outline-none focus:border-foreground"
            value={app.defaultPermission}
            disabled={saving}
            onChange={(e) => save({ defaultPermission: e.target.value })}
          >
            {app.permissionLevels.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
          <p className="text-xs text-muted/70 mt-1.5">
            {t("Gilt für alle Nutzer ohne eigene Zuweisung (auch für neu angelegte Nutzer).")}
            {app.defaultPermission !== "DENY" && t(" Achtung: Jeder SSO-Nutzer kann sich so in dieser App anmelden.")}
          </p>
        </div>
      </Card>

      <Card>
        <CardTitle>{t("Nutzer-Berechtigungen")}</CardTitle>
        <CardDescription>{t("Zugewiesene Berechtigungen pro Nutzer. Ohne Zuweisung gilt das Standard-Level ({defaultPermission}).", { defaultPermission: app.defaultPermission })}</CardDescription>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted uppercase tracking-wider border-b border-border">
                <th className="pb-2 pr-4">{t("Nutzer")}</th>
                <th className="pb-2 pr-4">{t("Berechtigung")}</th>
                <th className="pb-2">{t("Ändern")}</th>
              </tr>
            </thead>
            <tbody>
              {app.permissions.map((p) => (
                <tr key={p.id} className="border-b border-border/50 last:border-0">
                  <td className="py-2 pr-4 font-bold">{p.user.username}</td>
                  <td className="py-2 pr-4">
                    <Badge variant={p.permissionLevel === "ALLOW" ? "success" : p.permissionLevel === "DENY" ? "danger" : "default"}>
                      {p.permissionLevel}
                    </Badge>
                  </td>
                  <td className="py-2">
                    <div className="flex items-center gap-2">
                      <select
                        className="w-28 bg-surface-lighter border border-border rounded px-2 py-1 text-xs text-foreground"
                        value={p.permissionLevel}
                        onChange={(e) => save({ permissions: [{ userId: p.user.id, permissionLevel: e.target.value }] })}
                      >
                        {app.permissionLevels.map((l) => (
                          <option key={l} value={l}>{l}</option>
                        ))}
                      </select>
                      <button
                        onClick={() => save({ permissions: [{ userId: p.user.id, remove: true }] })}
                        disabled={saving}
                        className="text-xs font-bold text-muted hover:text-danger transition-colors disabled:opacity-40"
                        title={t("Zuweisung entfernen – danach gilt das Standard-Level ({level})", { level: app.defaultPermission })}
                      >
                        {t("Entfernen")}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {app.permissions.length === 0 && (
                <tr><td colSpan={3} className="py-4 text-center text-muted">{t("Keine Nutzer zugewiesen")}</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Add user permission */}
        {(() => {
          const assignedIds = new Set(app.permissions.map(p => p.user.id));
          const unassigned = allUsers.filter(u => !assignedIds.has(u.id));
          if (unassigned.length === 0) return null;
          return (
            <div className="mt-4 flex flex-col sm:flex-row gap-2 sm:items-center">
              <SearchSelect
                options={unassigned.map(u => ({ value: u.id, label: u.username }))}
                value={addUserId}
                onChange={(v) => setAddUserId(v)}
                placeholder={t("Nutzer wählen…")}
                className="flex-1"
              />
              <select
                className="w-full sm:w-36 shrink-0 bg-surface-lighter border border-border rounded-lg px-4 py-3 text-sm font-semibold text-foreground focus:outline-none focus:border-foreground"
                value={addPermLevel}
                onChange={(e) => setAddPermLevel(e.target.value)}
              >
                <option value="">{t("Level…")}</option>
                {app.permissionLevels.map(l => (
                  <option key={l} value={l}>{l}</option>
                ))}
              </select>
              <Button
                disabled={!addUserId || !addPermLevel}
                onClick={() => {
                  save({ permissions: [{ userId: addUserId, permissionLevel: addPermLevel }] });
                  setAddUserId("");
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

      {/* Regenerate Token modal */}
      <Modal open={showRegenerate} onClose={() => setShowRegenerate(false)} title={t("Token regenerieren?")}>
        <p className="text-sm text-muted mb-4">
          {t("Das aktuelle Token wird sofort ungültig. Alle Anwendungen, die dieses Token verwenden, werden nicht mehr funktionieren.")}
        </p>
        <div className="flex gap-3">
          <Button variant="secondary" className="flex-1" onClick={() => setShowRegenerate(false)}>{t("Abbrechen")}</Button>
          <Button variant="danger" className="flex-1" onClick={() => save({ regenerateToken: true })}>{t("Regenerieren")}</Button>
        </div>
      </Modal>

      {/* OIDC Regenerate modal */}
      <Modal open={showOidcGenerate} onClose={() => setShowOidcGenerate(false)} title={t("OIDC-Credentials neu generieren?")}>
        <p className="text-sm text-muted mb-4">
          {t("Die aktuellen OIDC-Credentials werden sofort ungültig. Alle Anwendungen, die diese Credentials verwenden, müssen neu konfiguriert werden.")}
        </p>
        <div className="flex gap-3">
          <Button variant="secondary" className="flex-1" onClick={() => setShowOidcGenerate(false)}>{t("Abbrechen")}</Button>
          <Button variant="danger" className="flex-1" onClick={() => save({ generateOidcCredentials: true, clientType: app.clientType })}>{t("Neu generieren")}</Button>
        </div>
      </Modal>

      {/* Delete modal */}
      <Modal open={showDelete} onClose={() => setShowDelete(false)} title={t("App löschen?")}>
        <p className="text-sm text-muted mb-4">
          {tn("{name} und alle zugehörigen Berechtigungen werden unwiderruflich gelöscht.", { name: <strong className="text-foreground">{app.name}</strong> })}
        </p>
        <div className="flex gap-3">
          <Button variant="secondary" className="flex-1" onClick={() => setShowDelete(false)}>{t("Abbrechen")}</Button>
          <Button variant="danger" className="flex-1" onClick={handleDelete}>{t("Löschen")}</Button>
        </div>
      </Modal>
    </div>
  );
}
