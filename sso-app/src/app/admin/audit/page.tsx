"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageTitle } from "@/components/ui/page-title";
import { toast } from "sonner";
import { useI18n } from "@/components/i18n-provider";
import { dateLocale, N_, type Locale } from "@/lib/i18n/core";

interface AuditRow {
  id: string;
  createdAt: string;
  action: string;
  category: string;
  outcome: "SUCCESS" | "FAILURE" | "DENIED";
  message: string | null;
  actorName: string | null;
  userId: string | null;
  sessionRef: string | null;
  authVia: string | null;
  appName: string | null;
  appId: string | null;
  targetType: string | null;
  targetLabel: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  requestMethod: string | null;
  requestPath: string | null;
  details: unknown;
}

interface Cond { field: string; op: string; value: string }

const FIELDS: Record<string, string> = {
  actor: N_("Nutzer"),
  app: N_("App"),
  action: N_("Aktion"),
  category: N_("Kategorie"),
  outcome: N_("Ergebnis"),
  ip: N_("IP"),
  user_agent: N_("User-Agent"),
  path: N_("Pfad"),
  message: N_("Beschreibung"),
  target: N_("Ziel"),
  auth_via: N_("Anmeldeweg"),
  session: N_("Session-Ref"),
};
const ENUM_FIELDS = ["action", "category", "outcome"];
const TEXT_OPS: [string, string][] = [
  ["contains", N_("enthält")], ["not_contains", N_("enthält nicht")], ["equals", N_("ist gleich")], ["not_equals", N_("ist nicht gleich")],
  ["starts_with", N_("beginnt mit")], ["not_starts_with", N_("beginnt nicht mit")], ["ends_with", N_("endet mit")], ["not_ends_with", N_("endet nicht mit")],
  ["is_empty", N_("ist leer")], ["not_empty", N_("ist nicht leer")],
];
const ENUM_OPS: [string, string][] = [["is", N_("ist")], ["is_not", N_("ist nicht")]];
const opsFor = (field: string) => (ENUM_FIELDS.includes(field) ? ENUM_OPS : TEXT_OPS);
const noValue = (c: Cond) => c.op === "is_empty" || c.op === "not_empty";
const isExclude = (c: Cond) => /^not_|^is_not$/.test(c.op);

const OUTCOME_VARIANT = { SUCCESS: "success", FAILURE: "danger", DENIED: "warning" } as const;
const OUTCOME_LABEL = { SUCCESS: N_("Erfolg"), FAILURE: N_("Fehlgeschlagen"), DENIED: N_("Verweigert") } as const;

const QUICK: { label: string; conds: Cond[] }[] = [
  { label: N_("Fehlschläge & Verweigerungen"), conds: [{ field: "outcome", op: "is", value: "FAILURE, DENIED" }] },
  { label: N_("Anmeldungen"), conds: [{ field: "action", op: "is", value: "USER_LOGIN, LOGIN_FAILED, APP_LOGIN" }] },
  { label: N_("Profil & Sicherheit"), conds: [{ field: "category", op: "is", value: "PROFILE, SECURITY" }] },
  { label: N_("Admin-Aktionen"), conds: [{ field: "category", op: "is", value: "ADMIN" }] },
];

const selectClass =
  "bg-surface-light border border-border text-foreground px-3 py-2 rounded-lg text-sm font-semibold focus:outline-none focus:border-foreground";

const fmtTime = (iso: string, locale: Locale) =>
  new Date(iso).toLocaleString(dateLocale(locale), { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });

const STORAGE_KEY = "audit-filters";

export default function AuditPage() {
  const { t, te, locale } = useI18n();
  const [conds, setConds] = useState<Cond[]>([]);
  const [mode, setMode] = useState<"and" | "or">("and");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [limit, setLimit] = useState(100);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [offset, setOffset] = useState(0);
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [auto, setAuto] = useState(false);
  const [options, setOptions] = useState<{ actions: string[]; categories: string[]; outcomes: string[] }>({ actions: [], categories: [], outcomes: [] });
  const [ready, setReady] = useState(false);

  const payload = useCallback(
    (off: number) => ({
      filters: conds
        .filter((c) => noValue(c) || c.value.trim() !== "")
        .map((c) => ({ field: c.field, op: c.op, value: noValue(c) ? "" : c.value.trim() })),
      mode,
      order,
      limit,
      offset: off,
      from: from ? new Date(from).getTime() : "",
      to: to ? new Date(to).getTime() : "",
    }),
    [conds, mode, order, limit, from, to]
  );

  const load = useCallback(
    async (off = offset) => {
      setError("");
      const res = await fetch("/api/admin/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload(off)),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(te(data.error, "Fehler"));
      } else {
        setRows(data.rows);
        setTotal(data.total);
      }
      setLoading(false);
    },
    [payload, offset]
  );

  // restore filters once, then first load
  useEffect(() => {
    try {
      const st = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "null");
      if (st) {
        if (Array.isArray(st.conds)) setConds(st.conds.filter((c: Cond) => c && FIELDS[c.field]));
        if (st.mode === "or") setMode("or");
        if (st.order === "asc") setOrder("asc");
      }
    } catch {}
    setReady(true);
    fetch("/api/admin/audit").then((r) => (r.ok ? r.json() : null)).then((o) => o && setOptions(o));
  }, []);

  // first load only after the restored filters are in state (same render as `ready`)
  useEffect(() => {
    if (ready) load(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  useEffect(() => {
    if (!auto) return;
    const t = setInterval(() => load(), 10000);
    return () => clearInterval(t);
  }, [auto, load]);

  const apply = (off = 0) => {
    setOffset(off);
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ conds, mode, order })); } catch {}
    load(off);
  };

  const updateCond = (i: number, patch: Partial<Cond>) => setConds((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  // ⊕ / ⊖ on a value: add a condition and re-query right away
  const addFilter = (field: string, value: string | null, op: "equals" | "not_equals" | "is" | "is_not") => {
    if (!value) return;
    const next = [...conds, { field, op, value }];
    setConds(next);
    if (op.startsWith("not") || op === "is_not") setMode("and");
    setOffset(0);
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ conds: next, mode, order })); } catch {}
    fetch("/api/admin/audit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload(0), mode: op.startsWith("not") || op === "is_not" ? "and" : mode, filters: next.filter((c) => noValue(c) || c.value.trim() !== "") }),
    })
      .then((r) => r.json())
      .then((d) => { if (d.rows) { setRows(d.rows); setTotal(d.total); } else toast.error(te(d.error, "Fehler")); });
  };

  const reset = () => {
    setConds([]); setMode("and"); setOrder("desc"); setFrom(""); setTo(""); setOffset(0);
    try { sessionStorage.removeItem(STORAGE_KEY); } catch {}
    fetch("/api/admin/audit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ limit, offset: 0 }) })
      .then((r) => r.json()).then((d) => { setRows(d.rows ?? []); setTotal(d.total ?? 0); });
  };

  const detail = (label: string, value: string | null | undefined, field?: string, enumField = false) => (
    <div className="flex items-start gap-2 py-1 border-b border-border/50 last:border-0">
      <span className="w-32 shrink-0 text-xs text-muted uppercase tracking-wider pt-0.5">{t(label)}</span>
      <span className="font-mono text-xs break-all flex-1">{value || "–"}</span>
      {field && value && (
        <span className="shrink-0 flex gap-1">
          <button title={t("Nur diesen Wert anzeigen")} className="text-muted hover:text-success px-1" onClick={() => addFilter(field, value, enumField ? "is" : "equals")}>⊕</button>
          <button title={t("Diesen Wert ausschließen")} className="text-muted hover:text-danger px-1" onClick={() => addFilter(field, value, enumField ? "is_not" : "not_equals")}>⊖</button>
        </span>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      <PageTitle title={t("Audit-Log")} />
      <h1 className="text-xl sm:text-2xl font-black">{t("Audit-Log")}</h1>

      <Card>
        <div className="flex flex-wrap gap-2 mb-4">
          {QUICK.map((q) => (
            <Button key={q.label} size="sm" variant="secondary" onClick={() => { setConds(q.conds); setMode("and"); setOffset(0); }}>
              {t(q.label)}
            </Button>
          ))}
        </div>

        <div className="space-y-2">
          {conds.map((c, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <select className={selectClass} value={c.field} onChange={(e) => updateCond(i, { field: e.target.value, op: opsFor(e.target.value)[0][0], value: "" })}>
                {Object.entries(FIELDS).map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}
              </select>
              <select className={`${selectClass} ${isExclude(c) ? "text-danger" : ""}`} value={c.op} onChange={(e) => updateCond(i, { op: e.target.value })}>
                {opsFor(c.field).map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}
              </select>
              {!noValue(c) && (
                <div className="flex-1 min-w-[200px]">
                  <Input
                    value={c.value}
                    list={ENUM_FIELDS.includes(c.field) ? `opts-${c.field}` : undefined}
                    placeholder={ENUM_FIELDS.includes(c.field) ? t("z. B. USER_LOGIN, APP_LOGIN") : c.field === "user_agent" ? t("z. B. Better Stack") : t("Wert")}
                    onChange={(e) => updateCond(i, { value: e.target.value })}
                    onKeyDown={(e) => e.key === "Enter" && apply()}
                  />
                </div>
              )}
              <Button size="sm" variant="ghost" onClick={() => setConds((cs) => cs.filter((_, j) => j !== i))} title={t("Bedingung entfernen")}>✕</Button>
            </div>
          ))}
        </div>
        <datalist id="opts-action">{options.actions.map((a) => <option key={a} value={a} />)}</datalist>
        <datalist id="opts-category">{options.categories.map((a) => <option key={a} value={a} />)}</datalist>
        <datalist id="opts-outcome">{options.outcomes.map((a) => <option key={a} value={a} />)}</datalist>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button size="sm" variant="secondary" onClick={() => setConds([...conds, { field: "actor", op: "contains", value: "" }])}>{t("+ Bedingung")}</Button>
          {conds.length > 1 && (
            <select className={selectClass} value={mode} onChange={(e) => setMode(e.target.value as "and" | "or")}>
              <option value="and">{t("Alle müssen zutreffen (UND)")}</option>
              <option value="or">{t("Mindestens eine (ODER)")}</option>
            </select>
          )}
        </div>

        <div className="mt-4 pt-4 border-t border-border grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Input label={t("Von")} type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} />
          <Input label={t("Bis")} type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} />
          <div>
            <label className="block text-xs text-muted mb-1.5 uppercase tracking-wider">{t("Sortierung")}</label>
            <select className={`${selectClass} w-full py-3`} value={order} onChange={(e) => setOrder(e.target.value as "asc" | "desc")}>
              <option value="desc">{t("Neueste zuerst")}</option>
              <option value="asc">{t("Älteste zuerst")}</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-muted mb-1.5 uppercase tracking-wider">{t("Pro Seite")}</label>
            <select className={`${selectClass} w-full py-3`} value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
              {[50, 100, 250, 500].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button size="sm" onClick={() => apply()}>{t("Filtern")}</Button>
          <Button size="sm" variant="secondary" onClick={reset}>{t("Zurücksetzen")}</Button>
          <label className="flex items-center gap-2 text-sm font-semibold ml-auto">
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> {t("Auto-Refresh (10 s)")}
          </label>
        </div>
        {error && <p className="mt-3 text-sm font-bold text-danger">{error}</p>}
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="text-muted font-bold">
          {total ? t("{from}–{to} von {total} Einträgen", { from: offset + 1, to: offset + rows.length, total }) : t("Keine Einträge")}
        </span>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" disabled={offset <= 0} onClick={() => apply(Math.max(0, offset - limit))}>{t("‹ Zurück")}</Button>
          <Button size="sm" variant="secondary" disabled={offset + limit >= total} onClick={() => apply(offset + limit)}>{t("Weiter ›")}</Button>
        </div>
      </div>

      {loading ? (
        <div className="loading-bar rounded" />
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.id} className="border border-border rounded-lg bg-surface">
              <button className="w-full text-left px-4 py-3 flex flex-wrap items-center gap-x-3 gap-y-1" onClick={() => setOpen(open === r.id ? null : r.id)}>
                <span className="text-xs text-muted font-mono shrink-0">{fmtTime(r.createdAt, locale)}</span>
                <Badge variant={OUTCOME_VARIANT[r.outcome]}>{t(OUTCOME_LABEL[r.outcome])}</Badge>
                <span className="text-sm font-bold flex-1 min-w-[220px]">
                  {r.message ?? r.action}
                  {r.ipAddress && <span className="text-muted font-semibold"> {t("· IP {ipAddress}", { ipAddress: r.ipAddress })}</span>}
                  {r.requestPath && <span className="text-muted font-mono font-semibold text-xs"> · {r.requestPath}</span>}
                </span>
                <Badge>{r.category}</Badge>
              </button>

              {open === r.id && (
                <div className="px-4 pb-4 pt-1 border-t border-border">
                  {detail(N_("Aktion"), r.action, "action", true)}
                  {detail(N_("Kategorie"), r.category, "category", true)}
                  {detail(N_("Ergebnis"), r.outcome, "outcome", true)}
                  {detail(N_("Nutzer"), r.actorName, "actor")}
                  {detail(N_("Nutzer-ID"), r.userId)}
                  {detail(N_("App"), r.appName, "app")}
                  {detail(N_("Ziel"), r.targetLabel ? `${r.targetType ?? ""} ${r.targetLabel}`.trim() : r.targetType, "target")}
                  {detail(N_("Anmeldeweg"), r.authVia, "auth_via")}
                  {detail(N_("Session-Ref"), r.sessionRef, "session")}
                  {detail(N_("IP"), r.ipAddress, "ip")}
                  {detail(N_("Anfrage"), r.requestMethod || r.requestPath ? `${r.requestMethod ?? ""} ${r.requestPath ?? ""}`.trim() : null)}
                  {detail(N_("Pfad"), r.requestPath, "path")}
                  {detail(N_("User-Agent"), r.userAgent, "user_agent")}
                  <div className="pt-2">
                    <span className="text-xs text-muted uppercase tracking-wider">{t("Details")}</span>
                    <pre className="mt-1 text-xs font-mono bg-surface-light border border-border rounded-lg p-3 overflow-x-auto">
                      {r.details ? JSON.stringify(r.details, null, 2) : "–"}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
