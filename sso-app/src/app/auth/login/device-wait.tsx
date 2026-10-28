"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/components/i18n-provider";
import { N_ } from "@/lib/i18n/core";
import { ArrowLeftIcon, CheckIcon, ClockIcon, RefreshIcon, TriangleAlertIcon } from "@/components/ui/icons";

export type DeviceKind = "GUEST" | "DEVICE";

interface Active {
  requestId: string;
  pollSecret: string;
  code: string;
  qrSvg: string;
  expiresAt: number;
}

type View =
  | { phase: "creating" }
  | ({ phase: "waiting" } & Active)
  | { phase: "done" }
  | { phase: "ended"; reason: "expired" | "denied" }
  /** `message` is the German text from the server (or ours); it is translated when shown */
  | { phase: "error"; message: string };

const POLL_MS = 2000;
/** the redirect normally replaces this page at once; if it is still here after this, another app took the navigation */
const REDIRECT_HINT_MS = 6000;

const formatCode = (code: string) => `${code.slice(0, 3)} ${code.slice(3)}`;
const formatRemaining = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/**
 * The device that wants to sign in: shows QR code and code, then waits until the account owner approved on another
 * device. A guest only gets access to the app, "other device" gets a normal SSO session.
 */
export function DeviceWait({
  loginToken,
  kind,
  username,
  returnTo,
  onDone,
  onBack,
}: {
  loginToken: string;
  kind: DeviceKind;
  username: string;
  returnTo: string | null;
  onDone: (redirect: string) => void;
  onBack: () => void;
}) {
  const { t, te } = useI18n();
  const [view, setView] = useState<View>({ phase: "creating" });
  const [now, setNow] = useState(() => Date.now());
  const [redirectStalled, setRedirectStalled] = useState(false);

  const generation = useRef(0); // discards answers of requests that were replaced meanwhile
  const active = useRef<Pick<Active, "requestId" | "pollSecret"> | null>(null);
  const polling = useRef(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  const cancel = useCallback((r: Pick<Active, "requestId" | "pollSecret"> | null) => {
    if (!r) return;
    fetch("/api/auth/device/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(r),
      keepalive: true,
    }).catch(() => {});
  }, []);

  const start = useCallback(async () => {
    const mine = ++generation.current;
    cancel(active.current);
    active.current = null;
    setView({ phase: "creating" });
    try {
      const res = await fetch("/api/auth/device/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loginToken, kind, returnTo }),
      });
      const data = await res.json();
      if (mine !== generation.current) {
        if (res.ok) cancel({ requestId: data.requestId, pollSecret: data.pollSecret });
        return;
      }
      if (!res.ok) {
        setView({ phase: "error", message: data.error ?? N_("Ein Fehler ist aufgetreten") });
        return;
      }
      active.current = { requestId: data.requestId, pollSecret: data.pollSecret };
      setView({
        phase: "waiting",
        requestId: data.requestId,
        pollSecret: data.pollSecret,
        code: data.code,
        qrSvg: data.qrSvg,
        // the server tells how long is left: the clock of this device may be off
        expiresAt: Date.now() + data.expiresInSec * 1000,
      });
    } catch {
      if (mine === generation.current) setView({ phase: "error", message: N_("Verbindungsfehler") });
    }
  }, [loginToken, kind, returnTo, cancel]);

  useEffect(() => {
    start();
    return () => {
      generation.current++;
      cancel(active.current);
      active.current = null;
    };
  }, [start, cancel]);

  const requestId = view.phase === "waiting" ? view.requestId : null;
  const pollSecret = view.phase === "waiting" ? view.pollSecret : null;

  // Ask whether the owner approved
  useEffect(() => {
    if (!requestId || !pollSecret) return;
    const timer = setInterval(async () => {
      if (polling.current) return;
      polling.current = true;
      try {
        const res = await fetch("/api/auth/device/status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ requestId, pollSecret }),
        });
        if (res.status === 429) return;
        const data = await res.json();
        if (data.success && typeof data.redirect === "string") {
          active.current = null; // used up, nothing left to cancel
          clearInterval(timer);
          setView({ phase: "done" });
          onDoneRef.current(data.redirect);
        } else if (data.status === "expired") {
          active.current = null;
          setView({ phase: "ended", reason: "expired" });
        } else if (data.status === "denied") {
          active.current = null;
          setView({ phase: "ended", reason: "denied" });
        } else if (data.status === "failed") {
          active.current = null;
          setView({ phase: "error", message: data.error ?? N_("Anmeldung fehlgeschlagen") });
        }
      } catch {
        // network hiccup: the next tick tries again
      } finally {
        polling.current = false;
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [requestId, pollSecret]);

  // Approved: when the browser hands the redirect to an installed app, this page stays open: say so instead of waiting on
  useEffect(() => {
    if (view.phase !== "done") return;
    const timer = setTimeout(() => setRedirectStalled(true), REDIRECT_HINT_MS);
    return () => clearTimeout(timer);
  }, [view.phase]);

  // Countdown
  useEffect(() => {
    if (view.phase !== "waiting") return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [view.phase]);

  const goBack = () => {
    generation.current++;
    cancel(active.current);
    active.current = null;
    onBack();
  };

  const title = kind === "GUEST" ? t("Gast-Anmeldung") : t("Mit anderem Gerät anmelden");
  const intro =
    kind === "GUEST"
      ? t("Bestätige den Zugang auf einem Gerät, auf dem {username} angemeldet ist. Der Gast erhält nur Zugriff auf diese App.", { username })
      : t("Bestätige die Anmeldung auf einem Gerät, auf dem {username} angemeldet ist.", { username });

  return (
    <div>
      {view.phase !== "done" && (
        <button
          onClick={goBack}
          className="text-xs text-muted hover:text-foreground mb-4 flex items-center gap-1 transition-colors"
        >
          <ArrowLeftIcon size={12} />
          {t("Zurück")}
        </button>
      )}
      <h1 className="text-lg font-extrabold mb-1">{view.phase === "done" ? t("Freigegeben") : title}</h1>
      {view.phase !== "done" && <p className="text-sm text-muted mb-6">{intro}</p>}

      {view.phase === "done" && (
        <div>
          <div className="flex items-center gap-2 text-sm text-muted mb-1">
            <span className="text-success"><CheckIcon size={16} /></span>
            {t("Du wirst weitergeleitet.")}
          </div>
          {redirectStalled && (
            <p className="text-xs text-muted mt-3">
              {t("Falls sich die App in einem anderen Fenster geöffnet hat, geht es dort weiter. Ist nichts passiert, starte die Anmeldung in der App neu.")}
            </p>
          )}
        </div>
      )}

      {view.phase === "creating" && <div className="loading-bar rounded" />}

      {view.phase === "error" && (
        <div>
          <div className="flex items-start gap-2 bg-danger/10 border border-danger/20 rounded-lg p-3 mb-4">
            <TriangleAlertIcon size={16} className="text-danger mt-0.5 shrink-0" />
            <p className="text-xs font-bold text-danger">{te(view.message)}</p>
          </div>
          <Button variant="secondary" className="w-full" onClick={start}>
            <RefreshIcon size={16} />
            {t("Erneut versuchen")}
          </Button>
        </div>
      )}

      {view.phase === "ended" && (
        <div>
          <p className="text-sm font-bold mb-4">
            {view.reason === "expired" ? t("Die Anfrage ist abgelaufen.") : t("Die Anfrage wurde abgelehnt.")}
          </p>
          <Button variant="secondary" className="w-full" onClick={start}>
            <RefreshIcon size={16} />
            {t("Neuen Code erzeugen")}
          </Button>
        </div>
      )}

      {view.phase === "waiting" && (
        <div>
          <div
            className="bg-white p-3 rounded-lg mx-auto w-44 h-44 [&>svg]:w-full [&>svg]:h-full"
            role="img"
            aria-label={t("QR-Code zur Freigabe")}
            // generated on the server from our own approval link
            dangerouslySetInnerHTML={{ __html: view.qrSvg }}
          />
          <p className="text-xs text-muted text-center mt-3">{t("QR-Code mit dem Handy scannen und bestätigen")}</p>

          <div className="flex items-center gap-3 my-5">
            <div className="h-px flex-1 bg-border" />
            <span className="text-xs text-muted uppercase tracking-wider">{t("oder")}</span>
            <div className="h-px flex-1 bg-border" />
          </div>

          <p className="text-xs text-muted text-center mb-2">
            {t("Auf {host} angemeldet diesen Code eingeben", { host: typeof window !== "undefined" ? window.location.host : t("dem SSO") })}
          </p>
          <p
            className="text-center text-3xl font-black tabular-nums tracking-[0.15em] select-all"
            aria-label={t("Code {code}", { code: view.code.split("").join(" ") })}
          >
            {formatCode(view.code)}
          </p>

          <div className="flex items-center justify-between mt-6 pt-4 border-t border-border text-xs text-muted">
            <span className="flex items-center gap-2">
              <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              {t("Warte auf Bestätigung")}
            </span>
            <span className="flex items-center gap-1 tabular-nums">
              <ClockIcon size={13} />
              {formatRemaining(view.expiresAt - now)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
