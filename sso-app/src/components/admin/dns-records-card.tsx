"use client";

import Link from "next/link";
import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { toast } from "sonner";
import { useI18n } from "@/components/i18n-provider";

interface DnsRecord {
  id: string;
  type: string;
  name: string;
  content: string;
  ttl: number;
  proxied: boolean;
  priority: number | null;
}

const TYPES = ["CNAME", "A", "AAAA", "TXT", "MX"];
const TTLS: [number, string][] = [[1, "Auto"], [60, "1 Min"], [300, "5 Min"], [3600, "1 Std"], [86400, "1 Tag"]];
const selectClass =
  "w-full bg-surface-light border border-border text-foreground px-4 py-3 rounded-lg text-sm font-semibold focus:outline-none focus:border-foreground";

const emptyForm = { type: "CNAME", name: "", content: "", ttl: 1, proxied: false, priority: "" };

export function DnsRecordsCard({ appId }: { appId: string }) {
  const { t, tn, te } = useI18n();
  const [state, setState] = useState<{ configured: boolean; zoneName: string | null; records: DnsRecord[]; error?: string } | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<DnsRecord | null>(null);
  const [editForm, setEditForm] = useState(emptyForm);
  const [deleting, setDeleting] = useState<DnsRecord | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/apps/${appId}/dns`);
    if (res.ok) setState(await res.json());
  }, [appId]);

  useEffect(() => { load(); }, [load]);

  const canProxy = (type: string) => ["A", "AAAA", "CNAME"].includes(type);

  const body = (f: typeof emptyForm, withNameType: boolean) => ({
    ...(withNameType ? { type: f.type, name: f.name } : {}),
    content: f.content,
    ttl: f.ttl,
    proxied: canProxy(f.type) && f.proxied,
    ...(f.type === "MX" && f.priority !== "" ? { priority: Number(f.priority) } : {}),
  });

  const request = async (url: string, method: string, payload: unknown, okMessage: string) => {
    setSaving(true);
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
    const data = await res.json();
    setSaving(false);
    if (res.ok) {
      toast.success(okMessage);
      await load();
      return true;
    }
    toast.error(te(data.error, "Fehler"));
    return false;
  };

  const create = async () => {
    if (await request(`/api/admin/apps/${appId}/dns`, "POST", body(form, true), t("DNS-Eintrag angelegt"))) {
      setForm(emptyForm);
    }
  };

  const openEdit = (r: DnsRecord) => {
    setEditing(r);
    setEditForm({ type: r.type, name: r.name, content: r.content, ttl: r.ttl, proxied: r.proxied, priority: r.priority?.toString() ?? "" });
  };

  const saveEdit = async () => {
    if (editing && (await request(`/api/admin/apps/${appId}/dns/${editing.id}`, "PATCH", body(editForm, false), "Gespeichert"))) {
      setEditing(null);
    }
  };

  const confirmDelete = async () => {
    if (deleting && (await request(`/api/admin/apps/${appId}/dns/${deleting.id}`, "DELETE", undefined, t("DNS-Eintrag gelöscht")))) {
      setDeleting(null);
    }
  };

  if (!state) return null;

  if (!state.configured) {
    return (
      <Card>
        <CardTitle>{t("DNS-Einträge")}</CardTitle>
        <CardDescription>
          {tn("Cloudflare ist nicht verbunden (optional). Trage unter {link} API-Token und Zonen-ID ein, um DNS-Einträge hier zu verwalten.", {
            link: (
              <Link href="/admin/settings/cloudflare" className="underline underline-offset-2 hover:text-foreground">
                {t("System → Cloudflare")}
              </Link>
            ),
          })}
        </CardDescription>
      </Card>
    );
  }

  const fields = (f: typeof emptyForm, set: (f: typeof emptyForm) => void, locked: boolean) => (
    <div className="grid gap-3 sm:grid-cols-2">
      <div>
        <label className="block text-xs text-muted mb-1.5 uppercase tracking-wider">{t("Typ")}</label>
        <select className={selectClass} value={f.type} disabled={locked} onChange={(e) => set({ ...f, type: e.target.value, proxied: false })}>
          {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      <Input
        label={`Name${state.zoneName ? ` (… .${state.zoneName})` : ""}`}
        value={f.name}
        disabled={locked}
        onChange={(e) => set({ ...f, name: e.target.value })}
        placeholder={`app oder @`}
      />
      <div className={f.type === "MX" ? "" : "sm:col-span-2"}>
        <Input
          label={f.type === "TXT" ? "Inhalt" : f.type === "A" || f.type === "AAAA" ? "IP-Adresse" : "Ziel"}
          value={f.content}
          onChange={(e) => set({ ...f, content: e.target.value })}
          placeholder={f.type === "A" ? "203.0.113.10" : f.type === "TXT" ? "v=spf1 …" : "ziel.example.com"}
        />
      </div>
      {f.type === "MX" && (
        <Input label={t("Priorität")} type="number" min={0} value={f.priority} onChange={(e) => set({ ...f, priority: e.target.value })} placeholder="10" />
      )}
      <div>
        <label className="block text-xs text-muted mb-1.5 uppercase tracking-wider">TTL</label>
        <select className={selectClass} value={f.ttl} onChange={(e) => set({ ...f, ttl: Number(e.target.value) })}>
          {TTLS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
      {canProxy(f.type) && (
        <label className="flex items-center gap-2 text-sm font-semibold sm:self-end sm:pb-3">
          <input type="checkbox" checked={f.proxied} onChange={(e) => set({ ...f, proxied: e.target.checked })} />
          {t("Über Cloudflare proxyen")}
        </label>
      )}
    </div>
  );

  return (
    <Card>
      <CardTitle>{t("DNS-Einträge")}</CardTitle>
      <CardDescription>
        {tn("Einträge in der Cloudflare-Zone {zone}, die zu dieser App gehören.", { zone: <span className="font-mono">{state.zoneName ?? "…"}</span> })}
      </CardDescription>
      {state.error && <p className="mt-2 text-sm text-danger font-bold">{te(state.error)}</p>}

      <div className="mt-4 space-y-2">
        {state.records.length === 0 && <p className="text-sm text-muted">{t("Noch keine Einträge.")}</p>}
        {state.records.map((r) => (
          <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 border border-border rounded-lg px-3 py-2">
            <div className="min-w-0 flex items-center gap-2">
              <Badge variant="default">{r.type}</Badge>
              <div className="min-w-0">
                <p className="text-sm font-bold truncate">{r.name}</p>
                <p className="text-xs text-muted font-mono truncate">
                  {r.priority !== null && `${r.priority} `}{r.content}
                  {r.proxied && t(" · Proxy")}
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => openEdit(r)}>{t("Bearbeiten")}</Button>
              <Button size="sm" variant="danger" onClick={() => setDeleting(r)}>{t("Löschen")}</Button>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-5 pt-4 border-t border-border space-y-3">
        {fields(form, setForm, false)}
        <Button size="sm" onClick={create} loading={saving} disabled={!form.name || !form.content}>
          {t("Eintrag anlegen")}
        </Button>
      </div>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={t("DNS-Eintrag bearbeiten")}>
        <p className="text-xs text-muted mb-3">{t("Typ und Name sind fest – zum Ändern Eintrag löschen und neu anlegen.")}</p>
        {fields(editForm, setEditForm, true)}
        <div className="mt-4 flex gap-2">
          <Button onClick={saveEdit} loading={saving} disabled={!editForm.content}>{t("Speichern")}</Button>
          <Button variant="secondary" onClick={() => setEditing(null)}>{t("Abbrechen")}</Button>
        </div>
      </Modal>

      <Modal open={!!deleting} onClose={() => setDeleting(null)} title={t("DNS-Eintrag löschen")}>
        <p className="text-sm">
          {tn("{record} wird auch in Cloudflare gelöscht und ist sofort nicht mehr auflösbar.", { record: <span className="font-bold">{deleting?.type} {deleting?.name}</span> })}
        </p>
        <div className="mt-4 flex gap-2">
          <Button variant="danger" onClick={confirmDelete} loading={saving}>{t("Endgültig löschen")}</Button>
          <Button variant="secondary" onClick={() => setDeleting(null)}>{t("Abbrechen")}</Button>
        </div>
      </Modal>
    </Card>
  );
}
