"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ClockIcon, MonitorSmartphoneIcon, UserRoundIcon } from "@/components/ui/icons";
import { DurationPicker } from "./duration-picker";
import { useI18n } from "@/components/i18n-provider";

interface OpenRequest {
  id: string;
  kind: "GUEST" | "DEVICE";
  appName: string | null;
  device: string;
  ip: string;
  location: string | null;
  /** seconds left when the server answered */
  expiresInSec: number;
}

const POLL_MS = 4000;

const formatRemaining = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/**
 * Shown on every SSO page while signed in: another device asked to be signed in with this account (or for guest
 * access to an app). Typing the code displayed on that device approves it.
 */
export function DeviceRequestPrompt() {
  const { t, te } = useI18n();
  const [request, setRequest] = useState<OpenRequest | null>(null);
  const [deadline, setDeadline] = useState(0);
  const [durations, setDurations] = useState<number[]>([1, 8, 24]);
  const [hours, setHours] = useState(8);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState<"approve" | "deny" | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const refresh = useCallback(async () => {
    if (document.visibilityState !== "visible") return;
    try {
      const res = await fetch("/api/device/pending", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setDurations(data.durations ?? [1, 8, 24]);
      if (data.request) setDeadline(Date.now() + data.request.expiresInSec * 1000);
      setRequest((prev) => {
        const next: OpenRequest | null = data.request ?? null;
        if (prev?.id !== next?.id) {
          // a different request: start with empty fields
          setCode("");
          setPassword("");
          setError("");
          if (next) setHours(data.defaultDuration ?? 8);
        }
        return next;
      });
    } catch {
      // offline or restarting: try again on the next tick
    }
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, POLL_MS);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [refresh]);

  useEffect(() => {
    if (!request) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [request]);

  if (!request) return null;

  const guest = request.kind === "GUEST";
  const remaining = deadline - now;
  const ready = code.length === 6 && (guest || password.length > 0);

  const post = async (url: string, body: Record<string, unknown>) => {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { ok: res.ok, data: await res.json().catch(() => ({})) };
  };

  const approve = async () => {
    setError("");
    setLoading("approve");
    try {
      const { ok, data } = await post("/api/device/approve", { code, durationHours: guest ? hours : undefined, password: guest ? undefined : password });
      if (ok) {
        toast.success(guest ? t("Gast-Zugang freigegeben") : t("Anmeldung freigegeben"));
        setRequest(null);
      } else {
        setError(te(data.error, "Ein Fehler ist aufgetreten"));
        setCode("");
        // The request is gone (too many wrong codes, expired): don't keep the prompt around
        if (requestIsGone(data.error)) refresh();
      }
    } catch {
      setError(t("Verbindungsfehler"));
    } finally {
      setLoading(null);
    }
  };

  const deny = async () => {
    setError("");
    setLoading("deny");
    try {
      const { ok, data } = await post("/api/device/deny", { id: request.id });
      if (ok) setRequest(null);
      else setError(te(data.error, "Ein Fehler ist aufgetreten"));
    } catch {
      setError(t("Verbindungsfehler"));
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="fixed inset-x-0 top-3 z-50 flex justify-center px-4 pointer-events-none">
      <div
        role="alertdialog"
        aria-label={t("Anmeldeversuch")}
        className="pointer-events-auto w-full max-w-md bg-surface-light border border-border-light rounded-xl p-4 shadow-2xl"
      >
        <div className="flex items-start gap-3">
          <div className="text-foreground mt-0.5">{guest ? <UserRoundIcon size={20} /> : <MonitorSmartphoneIcon size={20} />}</div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-extrabold">{t("Anmeldeversuch")}</p>
              <span className="flex items-center gap-1 text-xs text-muted tabular-nums">
                <ClockIcon size={13} />
                {formatRemaining(remaining)}
              </span>
            </div>
            <p className="text-sm font-bold mt-0.5">
              {guest ? t("Gast-Zugang für {app}", { app: request.appName ?? t("eine App") }) : t("Anmeldung auf einem anderen Gerät")}
            </p>
            <p className="text-xs text-muted mt-0.5 break-words">
              {t(request.device)} · {request.ip}
              {request.location ? ` · ${request.location}` : ""}
            </p>
          </div>
        </div>

        <form
          className="mt-4 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (ready) approve();
          }}
        >
          <Input
            label={t("Code vom anderen Gerät")}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="000000"
            inputMode="numeric"
            autoComplete="off"
            maxLength={6}
            className="tabular-nums tracking-[0.2em]"
          />
          {guest ? (
            <DurationPicker options={durations} value={hours} onChange={setHours} />
          ) : (
            <Input
              label={t("Passwort zur Bestätigung")}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          )}
          {error && <p className="text-danger text-xs font-semibold">{error}</p>}
          <div className="grid grid-cols-2 gap-3">
            <Button type="button" variant="secondary" onClick={deny} loading={loading === "deny"} disabled={loading !== null}>
              {t("Ablehnen")}
            </Button>
            <Button type="submit" loading={loading === "approve"} disabled={!ready || loading !== null}>
              {t("Freigeben")}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

/** Error texts after which there is nothing left to approve. */
function requestIsGone(message: unknown): boolean {
  return typeof message === "string" && /beendet|abgelaufen|keine offene/i.test(message);
}
