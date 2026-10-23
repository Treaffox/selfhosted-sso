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

interface AppItem {
  id: string;
  name: string;
  tokenPrefix: string;
  permissionLevels: string[];
  defaultPermission: string;
  isActive: boolean;
  redirectUris: string[];
  createdAt: string;
  _count: { permissions: number };
}

export default function AppsPage() {
  const { t, te } = useI18n();
  const router = useRouter();
  const [apps, setApps] = useState<AppItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newRedirectUri, setNewRedirectUri] = useState("");
  const [newLevels, setNewLevels] = useState("");
  const [newDefault, setNewDefault] = useState("DENY");
  const [creating, setCreating] = useState(false);
  const [createdToken, setCreatedToken] = useState("");
  const [createdAppId, setCreatedAppId] = useState("");
  const [tokenCopied, setTokenCopied] = useState(false);
  const [idCopied, setIdCopied] = useState(false);

  const fetchApps = async () => {
    const res = await fetch("/api/admin/apps");
    if (res.ok) setApps(await res.json());
    setLoading(false);
  };

  useEffect(() => { fetchApps(); }, []);

  // ALLOW and DENY are always present; the server adds them too
  const customLevels = newLevels
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  const levelOptions = Array.from(new Set(["ALLOW", "DENY", ...customLevels]));

  const handleCreate = async () => {
    setCreating(true);
    try {
      const levels = customLevels;

      const res = await fetch("/api/admin/apps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName,
          redirectUris: newRedirectUri.trim() ? [newRedirectUri.trim()] : [],
          permissionLevels: levels.length > 0 ? levels : undefined,
          defaultPermission: levelOptions.includes(newDefault) ? newDefault : "DENY",
        }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(te(data.error)); return; }

      setCreatedToken(data.token);
      setCreatedAppId(data.app.id);
      fetchApps();
    } catch { toast.error(t("Fehler")); }
    finally { setCreating(false); }
  };

  const resetCreate = () => {
    setShowCreate(false);
    setCreatedToken("");
    setCreatedAppId("");
    setTokenCopied(false);
    setIdCopied(false);
    setNewName("");
    setNewRedirectUri("");
    setNewLevels("");
    setNewDefault("DENY");
  };

  return (
    <div className="animate-slide-up">
      <PageTitle title={t("Apps")} />
      <div className="flex items-center justify-between mb-6 sm:mb-8">
        <h1 className="text-xl sm:text-2xl font-black">{t("Apps")}</h1>
        <Button onClick={() => setShowCreate(true)}>{t("App anlegen")}</Button>
      </div>

      {loading ? (
        <div className="loading-bar rounded" />
      ) : (
        <div className="grid gap-4">
          {apps.map((app) => (
            <Card
              key={app.id}
              className="hover:border-border-light transition-colors cursor-pointer"
              onClick={() => router.push(`/admin/apps/${app.id}`)}
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-extrabold text-base">{app.name}</h3>
                    {!app.isActive && <Badge variant="danger">{t("Inaktiv")}</Badge>}
                  </div>
                  <p className="text-xs text-muted mt-1 font-mono">{t("ID: {id}", { id: app.id })}</p>
                  <p className="text-xs text-muted mt-0.5 font-mono">{app.tokenPrefix}...</p>
                </div>
                <div className="text-right text-sm">
                  <p className="text-muted">{t("{permissions} Nutzer", { permissions: app._count.permissions })}</p>
                  <div className="flex flex-wrap gap-1 mt-1 justify-end">
                    {app.permissionLevels.map((l) => (
                      <Badge key={l} variant={l === "ALLOW" ? "success" : l === "DENY" ? "danger" : "default"}>
                        {l}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
            </Card>
          ))}
          {apps.length === 0 && (
            <p className="text-muted text-center py-8">{t("Noch keine Apps registriert")}</p>
          )}
        </div>
      )}

      {/* Create App Modal */}
      <Modal open={showCreate} onClose={resetCreate} title={createdToken ? t("App erstellt!") : t("App anlegen")}>
        {createdToken ? (
          <div className="space-y-4">
            <div className="bg-surface-lighter border border-border rounded-lg p-4">
              <p className="text-xs text-muted mb-2 font-bold">{t("App-ID")}</p>
              <div className="flex items-center gap-2">
                <code className="text-sm text-foreground break-all font-mono select-all flex-1">{createdAppId}</code>
                <button
                  onClick={() => { navigator.clipboard.writeText(createdAppId); setIdCopied(true); setTimeout(() => setIdCopied(false), 2000); }}
                  className="shrink-0 text-xs font-bold px-3 py-1.5 rounded-md bg-surface-lighter border border-border hover:border-border-light transition-colors"
                >
                  {idCopied ? "✓" : t("Kopieren")}
                </button>
              </div>
            </div>
            <div className="bg-surface-lighter border border-border rounded-lg p-4">
              <p className="text-xs text-muted mb-2 font-bold">
                {t("App-Token (nur jetzt sichtbar – kopiere ihn sofort!)")}
              </p>
              <div className="flex items-center gap-2">
                <code className="text-sm text-foreground break-all font-mono select-all flex-1">{createdToken}</code>
                <button
                  onClick={() => { navigator.clipboard.writeText(createdToken); setTokenCopied(true); setTimeout(() => setTokenCopied(false), 2000); }}
                  className="shrink-0 text-xs font-bold px-3 py-1.5 rounded-md bg-surface-lighter border border-border hover:border-border-light transition-colors"
                >
                  {tokenCopied ? "✓" : t("Kopieren")}
                </button>
              </div>
            </div>
            <p className="text-xs text-danger font-bold">
              {t("⚠ Dieses Token wird nur einmalig angezeigt und kann nicht erneut abgerufen werden.")}
            </p>
            <Button className="w-full" onClick={resetCreate}>{t("Verstanden")}</Button>
          </div>
        ) : (
          <div className="space-y-4">
            <Input
              label={t("App-Name")}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t("Meine Anwendung")}
              autoFocus
            />
            <Input
              label={t("Redirect-URI (optional)")}
              value={newRedirectUri}
              onChange={(e) => setNewRedirectUri(e.target.value)}
              placeholder={t("https://app.example.com/callback")}
            />
            <Input
              label={t("Custom Berechtigungs-Level (kommagetrennt, optional)")}
              value={newLevels}
              onChange={(e) => setNewLevels(e.target.value)}
              placeholder={t("ALLOW, DENY, ADMIN, READ-ONLY")}
            />
            <p className="text-xs text-muted">{t("ALLOW und DENY werden immer automatisch hinzugefügt.")}</p>
            <div>
              <p className="text-xs text-muted mb-1.5 uppercase tracking-wider">{t("Standard-Level")}</p>
              <select
                className="w-full bg-surface-lighter border border-border rounded-lg px-4 py-3 text-sm font-semibold text-foreground focus:outline-none focus:border-foreground"
                value={levelOptions.includes(newDefault) ? newDefault : "DENY"}
                onChange={(e) => setNewDefault(e.target.value)}
              >
                {levelOptions.map((l) => (
                  <option key={l} value={l}>{l}</option>
                ))}
              </select>
              <p className="text-xs text-muted/70 mt-1.5">{t("Gilt für alle Nutzer ohne eigene Zuweisung. Mit DENY braucht jeder Nutzer eine explizite Freigabe.")}</p>
            </div>
            <Button onClick={handleCreate} loading={creating} className="w-full">
              {t("App erstellen")}
            </Button>
          </div>
        )}
      </Modal>
    </div>
  );
}
