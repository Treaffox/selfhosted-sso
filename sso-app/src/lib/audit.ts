import { createHash } from "crypto";
import { cookies, headers } from "next/headers";
import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { clientIpFromHeaders } from "./client-ip";
import { tokenLookupKeys } from "./token-store";
import { N_, dateLocale, makeT, type Locale } from "./i18n/core";
import { sessionCookieName } from "./config";

// ─── Types ────────────────────────────────────────────

export type AuditOutcome = "SUCCESS" | "FAILURE" | "DENIED";

export interface AuditExtra {
  outcome?: AuditOutcome;
  /** How the actor authenticated: PASSWORD, PASSKEY, EXISTING_SESSION, ... */
  authVia?: string;
  appId?: string;
  appName?: string;
  targetType?: string;
  targetId?: string;
  targetLabel?: string;
  /** Overrides the generated sentence. */
  message?: string;
  actorName?: string;
  /** Overrides what the request context says (e.g. for requests from outside a route handler). */
  userAgent?: string;
  requestPath?: string;
  requestMethod?: string;
  /** false: never derive the actor from the session cookie (failed logins, unknown users). */
  useSession?: boolean;
}

interface Ctx {
  actor: string;
  app: string;
  d: Record<string, unknown>;
  t: (key: string, params?: Record<string, string | number>) => string;
  locale: Locale;
}

interface EventDef {
  category: "AUTH" | "SESSION" | "PROFILE" | "SECURITY" | "APP" | "OIDC" | "ADMIN";
  text: (c: Ctx) => string;
  target?: (d: Record<string, unknown>) => { type: string; id?: string; label?: string };
}

// ─── Event catalog ────────────────────────────────────
// One entry per action: category + a sentence. The sentence is stored in German when the event is written and
// rendered again in the viewer's language when the log is displayed (renderAuditMessage). IP, time and request
// path are stored in their own columns; the viewer composes them into the full sentence.

type T = (key: string, params?: Record<string, string | number>) => string;

const METHOD_LABELS: Record<string, string> = {
  PASSWORD: N_("Passwort"),
  PASSWORD_TOTP: N_("Passwort + Authenticator"),
  PASSWORD_EMAIL: N_("Passwort + E-Mail-Code"),
  PASSWORD_NO_MFA: N_("Passwort"),
  PASSWORD_IP_WHITELIST: N_("Passwort (vertraute IP)"),
  PASSKEY: N_("Passkey"),
  RECOVERY_CODE: N_("Wiederherstellungscode"),
  TRUSTED_DEVICE: N_("vertrautes Gerät"),
  DEVICE_APPROVED: N_("Freigabe auf einem anderen Gerät"),
};

const REASON_LABELS: Record<string, string> = {
  invalid_password: N_("falsches Passwort"),
  invalid_mfa_code: N_("falscher MFA-Code"),
  unknown_user: N_("unbekannter Benutzer"),
  invalid_credentials: N_("ungültige Anmeldedaten"),
  account_locked: N_("Konto gesperrt"),
  passkey_verification_failed: N_("Passkey ungültig"),
  passkey_wrong_owner: N_("Passkey gehört nicht zu diesem Konto"),
  too_many_attempts: N_("zu viele Versuche"),
};

const untilLabel = (v: unknown, locale: Locale) => {
  const date = new Date(str(v));
  return Number.isNaN(date.getTime())
    ? str(v)
    : date.toLocaleString(dateLocale(locale), { timeZone: "Europe/Berlin", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
};
const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));
const label = (map: Record<string, string>, v: unknown, t: T) => (map[str(v)] ? t(map[str(v)]) : str(v));

const EVENTS: Record<string, EventDef> = {
  // Authentication
  USER_LOGIN: {
    category: "AUTH",
    text: ({ actor, d, t }) => t("{actor} hat sich per {method} angemeldet", { actor, method: label(METHOD_LABELS, d.method, t) }),
  },
  LOGIN_FAILED: {
    category: "AUTH",
    text: ({ actor, d, t }) =>
      t("Anmeldung für {actor} per {method} fehlgeschlagen ({reason})", { actor, method: label(METHOD_LABELS, d.method, t), reason: label(REASON_LABELS, d.reason, t) }),
  },
  LOGOUT: { category: "SESSION", text: ({ actor, t }) => t("{actor} hat sich abgemeldet", { actor }) },
  SESSION_REVOKED: {
    category: "SESSION",
    text: ({ actor, t }) => t("{actor} hat eine andere Sitzung beendet", { actor }),
    target: (d) => ({ type: "SESSION", id: str(d.sessionId) || undefined }),
  },

  // Sign-in approved on another device / guest access
  DEVICE_LOGIN_REQUESTED: {
    category: "AUTH",
    text: ({ actor, app, d, t }) =>
      d.kind === "GUEST"
        ? t("Für das Konto von {actor} wurde ein Gast-Zugang für {app} angefragt", { actor, app })
        : t("Für das Konto von {actor} wurde eine Anmeldung über ein anderes Gerät angefragt", { actor }),
  },
  DEVICE_LOGIN_APPROVED: {
    category: "AUTH",
    text: ({ actor, app, d, t }) => {
      const how = d.via === "CODE" ? t("per Code") : t("per QR-Code");
      return d.kind === "GUEST"
        ? t("{actor} hat einen Gast-Zugang für {app} freigegeben ({how}, {hours} Std.)", { actor, app, how, hours: str(d.durationHours) })
        : t("{actor} hat die Anmeldung auf einem anderen Gerät freigegeben ({how})", { actor, how });
    },
  },
  DEVICE_LOGIN_DENIED: {
    category: "AUTH",
    text: ({ actor, d, t }) =>
      d.reason === "too_many_attempts"
        ? t("Freigabe für {actor} nach zu vielen falschen Codes beendet", { actor })
        : t("{actor} hat eine Anfrage für ein anderes Gerät abgelehnt", { actor }),
  },
  DEVICE_LOGIN_EXPIRED: {
    category: "AUTH",
    text: ({ actor, t }) => t("Die Anfrage für ein anderes Gerät von {actor} ist abgelaufen", { actor }),
  },
  GUEST_LOGIN: {
    category: "APP",
    text: ({ actor, app, d, t, locale }) => t("Ein Gast hat sich über das Konto von {actor} bei {app} angemeldet (bis {until})", { actor, app, until: untilLabel(d.until, locale) }),
  },
  GUEST_ACCESS_REVOKED: {
    category: "SESSION",
    text: ({ actor, app, d, t }) => (d.all ? t("{actor} hat alle Gast-Zugänge beendet", { actor }) : t("{actor} hat einen Gast-Zugang für {app} beendet", { actor, app })),
  },

  // Apps (token exchange flow + OIDC)
  APP_LOGIN: {
    category: "APP",
    text: ({ actor, app, d, t }) => {
      const via =
        d.via === "EXISTING_SESSION" ? t("mit bereits bestehender SSO-Session")
        : d.via === "GUEST" ? t("als Gast")
        : t("per {method}", { method: label(METHOD_LABELS, d.method, t) });
      const proto = d.protocol === "oidc" ? "OIDC" : t("App-Token-Flow");
      const text = t("{actor} meldet sich bei {app} an ({proto}, {via})", { actor, app, proto, via });
      return d.redirect ? `${text} ${t("(Rücksprung {url})", { url: str(d.redirect) })}` : text;
    },
  },
  APP_ACCESS: {
    category: "APP",
    text: ({ actor, app, d, t }) => (d.path ? t("{actor} greift auf {app} zu ({path})", { actor, app, path: str(d.path) }) : t("{actor} greift auf {app} zu", { actor, app })),
  },
  APP_ACCESS_DENIED: {
    category: "APP",
    text: ({ actor, app, d, t }) =>
      t("{actor} wurde der Zugriff auf {app} verweigert", { actor, app }) + (d.reason ? ` (${t(str(d.reason))})` : "") + (d.path ? ` – ${str(d.path)}` : ""),
  },
  APP_TOKEN_EXCHANGED: {
    category: "APP",
    text: ({ actor, app, t }) => t("{app} hat den Login-Code für {actor} eingelöst", { app, actor }),
  },
  APP_TOKEN_EXCHANGE_FAILED: {
    category: "APP",
    text: ({ app, d, t }) => t("Code-Einlösung für {app} fehlgeschlagen ({reason})", { app, reason: d.reason ? t(str(d.reason)) : t("ungültiger Code oder App-Token") }),
  },
  OIDC_TOKEN_ISSUED: {
    category: "OIDC",
    text: ({ actor, app, t }) => t("{app} hat Tokens für {actor} abgeholt", { app, actor }),
  },
  OIDC_TOKEN_FAILED: {
    category: "OIDC",
    text: ({ app, d, t }) =>
      t("Token-Abruf für {app} fehlgeschlagen ({reason})", { app: app || str(d.clientId) || t("unbekannte App"), reason: d.reason ? t(str(d.reason)) : t("ungültige Anfrage") }),
  },
  OIDC_USERINFO: {
    category: "OIDC",
    text: ({ actor, app, t }) => t("{app} hat die Nutzerdaten von {actor} abgerufen", { app, actor }),
  },

  // Profile & security
  PROFILE_UPDATED: { category: "PROFILE", text: ({ actor, t }) => t("{actor} hat das Profil aktualisiert", { actor }) },
  AVATAR_UPDATED: { category: "PROFILE", text: ({ actor, t }) => t("{actor} hat das Profilbild aktualisiert", { actor }) },
  AVATAR_DELETED: { category: "PROFILE", text: ({ actor, t }) => t("{actor} hat das Profilbild entfernt", { actor }) },
  PASSWORD_CHANGED: { category: "SECURITY", text: ({ actor, t }) => t("{actor} hat das Passwort geändert", { actor }) },
  DEVICE_LOGIN_SETTINGS_UPDATED: {
    category: "PROFILE",
    text: ({ actor, d, t }) => {
      const parts: string[] = [];
      if (typeof d.guestLoginEnabled === "boolean") parts.push(d.guestLoginEnabled ? t("Gast-Anmeldung erlaubt") : t("Gast-Anmeldung ausgeschaltet"));
      if (typeof d.deviceLoginEnabled === "boolean") parts.push(d.deviceLoginEnabled ? t("Anmeldung über anderes Gerät erlaubt") : t("Anmeldung über anderes Gerät ausgeschaltet"));
      return `${actor}: ${parts.join(", ") || t("Einstellungen geändert")}`;
    },
  },
  SESSION_DURATION_UPDATED: {
    category: "PROFILE",
    text: ({ actor, d, t }) => t("{actor} hat die Sitzungsdauer auf {hours} Stunden gesetzt", { actor, hours: str(d.sessionDurationHours) || t("Standard") }),
  },
  TOTP_ENABLED: { category: "SECURITY", text: ({ actor, t }) => t("{actor} hat den Authenticator (TOTP) aktiviert", { actor }) },
  RECOVERY_CODES_GENERATED: { category: "SECURITY", text: ({ actor, t }) => t("{actor} hat neue Wiederherstellungscodes erzeugt", { actor }) },
  PASSKEY_ADDED: {
    category: "SECURITY",
    text: ({ actor, d, t }) => t("{actor} hat einen Passkey hinzugefügt", { actor }) + (d.deviceName ? ` (${str(d.deviceName)})` : ""),
  },
  PASSKEY_DELETED: {
    category: "SECURITY",
    text: ({ actor, t }) => t("{actor} hat einen Passkey gelöscht", { actor }),
    target: (d) => ({ type: "PASSKEY", id: str(d.passkeyId) || undefined }),
  },
  EMAIL_CHANGED: {
    category: "SECURITY",
    text: ({ actor, d, t }) => (d.removed ? t("{actor} hat die E-Mail-Adresse entfernt", { actor }) : t("{actor} hat eine neue E-Mail-Adresse bestätigt", { actor })),
  },
  EMAIL_CHANGE_REQUESTED: { category: "SECURITY", text: ({ actor, t }) => t("{actor} hat eine Änderung der E-Mail-Adresse angefordert", { actor }) },
  TRUSTED_DEVICE_REVOKED: { category: "SECURITY", text: ({ actor, t }) => t("{actor} hat ein vertrautes Gerät entfernt", { actor }) },
  REAUTH_FAILED: {
    category: "SECURITY",
    text: ({ actor, d, t }) => t("Passwort-Bestätigung für {actor} fehlgeschlagen", { actor }) + (d.scope ? ` (${str(d.scope)})` : ""),
  },
  RATE_LIMITED: {
    category: "SECURITY",
    text: ({ d, t }) =>
      t("Rate-Limit ausgelöst ({scope})", { scope: str(d.scope) || t("unbekannt") }) + (d.retryAfterSec ? `, ${t("erneut in {seconds} s", { seconds: str(d.retryAfterSec) })}` : ""),
  },

  // Administration
  USER_CREATED: {
    category: "ADMIN",
    text: ({ actor, d, t }) => t("{actor} hat den Nutzer {username} angelegt", { actor, username: str(d.username) }),
    target: (d) => ({ type: "USER", label: str(d.username) || undefined }),
  },
  USER_UPDATED: {
    category: "ADMIN",
    text: ({ actor, d, t }) => t("{actor} hat einen Nutzer geändert ({fields})", { actor, fields: Array.isArray(d.fields) ? d.fields.join(", ") : t("Felder") }),
    target: (d) => ({ type: "USER", id: str(d.userId) || undefined }),
  },
  USER_DELETED: {
    category: "ADMIN",
    text: ({ actor, t }) => t("{actor} hat einen Nutzer gelöscht", { actor }),
    target: (d) => ({ type: "USER", id: str(d.userId) || undefined }),
  },
  APP_CREATED: {
    category: "ADMIN",
    text: ({ actor, d, t }) => t("{actor} hat die App {name} angelegt", { actor, name: str(d.name) }),
    target: (d) => ({ type: "APP", id: str(d.appId) || undefined, label: str(d.name) || undefined }),
  },
  APP_UPDATED: { category: "ADMIN", text: ({ actor, app, t }) => t("{actor} hat die App {app} geändert", { actor, app }), target: appTarget },
  APP_DELETED: { category: "ADMIN", text: ({ actor, d, t }) => t("{actor} hat eine App gelöscht ({appId})", { actor, appId: str(d.appId) }), target: appTarget },
  APP_TOKEN_REGENERATED: { category: "ADMIN", text: ({ actor, app, t }) => t("{actor} hat den App-Token von {app} neu erzeugt", { actor, app }), target: appTarget },
  APP_OIDC_CREDENTIALS_GENERATED: {
    category: "ADMIN",
    text: ({ actor, app, t }) => t("{actor} hat OIDC-Zugangsdaten für {app} erzeugt", { actor, app }),
    target: appTarget,
  },
  APP_DNS_RECORD_CREATED: {
    category: "ADMIN",
    text: ({ actor, app, d, t }) => t("{actor} hat den DNS-Eintrag {type} {name} für {app} angelegt", { actor, type: str(d.type), name: str(d.name), app }),
    target: dnsTarget,
  },
  APP_DNS_RECORD_UPDATED: {
    category: "ADMIN",
    text: ({ actor, app, d, t }) => t("{actor} hat den DNS-Eintrag {type} {name} von {app} geändert", { actor, type: str(d.type), name: str(d.name), app }),
    target: dnsTarget,
  },
  APP_DNS_RECORD_DELETED: {
    category: "ADMIN",
    text: ({ actor, app, d, t }) => t("{actor} hat den DNS-Eintrag {type} {name} von {app} gelöscht", { actor, type: str(d.type), name: str(d.name), app }),
    target: dnsTarget,
  },
  SETTINGS_SITE_UPDATED: { category: "ADMIN", text: ({ actor, t }) => t("{actor} hat Name, Footer-Links oder Mail-Design geändert", { actor }) },
  BRANDING_ASSET_UPDATED: {
    category: "ADMIN",
    text: ({ actor, d, t }) =>
      d.removed
        ? t("{actor} hat {what} (Branding) entfernt", { actor, what: d.label ? t(str(d.label)) : t("ein Bild") })
        : t("{actor} hat {what} (Branding) hochgeladen", { actor, what: d.label ? t(str(d.label)) : t("ein Bild") }),
  },
  SETTINGS_MAIL_UPDATED: {
    category: "ADMIN",
    text: ({ actor, d, t }) => t("{actor} hat die E-Mail-Einstellungen geändert", { actor }) + (d.primary ? ` (${t("Haupt-Anbieter: {provider}", { provider: str(d.primary) })})` : ""),
  },
  MAIL_TEST_SENT: {
    category: "ADMIN",
    text: ({ actor, d, t }) => {
      const fallback = str(d.channel) === "fallback";
      if (d.ok) return fallback ? t("{actor} hat eine Testmail über den Ersatz-Anbieter versendet", { actor }) : t("{actor} hat eine Testmail über den Haupt-Anbieter versendet", { actor });
      return fallback ? t("{actor} hat eine Testmail über den Ersatz-Anbieter versucht (fehlgeschlagen)", { actor }) : t("{actor} hat eine Testmail über den Haupt-Anbieter versucht (fehlgeschlagen)", { actor });
    },
  },
  SETTINGS_SECURITY_UPDATED: {
    category: "ADMIN",
    text: ({ actor, d, t }) => (d.requireMfa ? t("{actor} hat MFA auf verpflichtend gestellt", { actor }) : t("{actor} hat MFA auf optional gestellt", { actor })),
  },
  SETTINGS_GEOIP_UPDATED: {
    category: "ADMIN",
    text: ({ actor, d, t }) => (d.removed ? t("{actor} hat die MaxMind-Anbindung (GeoIP) entfernt", { actor }) : t("{actor} hat die MaxMind-Anbindung (GeoIP) geändert", { actor })),
  },
  SETTINGS_CLOUDFLARE_UPDATED: {
    category: "ADMIN",
    text: ({ actor, d, t }) => (d.removed ? t("{actor} hat die Cloudflare-Anbindung entfernt", { actor }) : t("{actor} hat die Cloudflare-Anbindung geändert", { actor })),
  },
};

function appTarget(d: Record<string, unknown>) {
  return { type: "APP", id: str(d.appId) || undefined };
}
function dnsTarget(d: Record<string, unknown>) {
  return { type: "DNS_RECORD", label: `${str(d.type)} ${str(d.name)}`.trim() || undefined };
}

export const AUDIT_ACTIONS = Object.keys(EVENTS);
export const AUDIT_CATEGORIES = ["AUTH", "SESSION", "PROFILE", "SECURITY", "APP", "OIDC", "ADMIN"] as const;

// ─── Request context ──────────────────────────────────

interface RequestContext {
  userAgent?: string;
  path?: string;
  method?: string;
  ip?: string;
  sessionToken?: string;
}

/** Reads what the middleware/headers know about the current request. Empty outside a request. */
async function requestContext(): Promise<RequestContext> {
  try {
    const h = await headers();
    const jar = await cookies();
    return {
      userAgent: h.get("user-agent")?.slice(0, 300) || undefined,
      path: h.get("x-audit-path") || undefined,
      method: h.get("x-audit-method") || undefined,
      ip: clientIpFromHeaders((name) => h.get(name)),
      sessionToken: jar.get(sessionCookieName())?.value,
    };
  } catch {
    return {};
  }
}

/** Short, non-reversible reference to a session (never the token itself). */
export function sessionRefOf(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, 12);
}

// ─── Writer ───────────────────────────────────────────

/**
 * Writes one audit entry. Never throws: a failing audit write must not break the request.
 *
 * Actor, session reference, user agent and request path are filled in from the
 * current request automatically; `extra` only needs what the call site knows better.
 */
export async function logAudit(
  action: string,
  details?: Record<string, unknown>,
  userId?: string,
  ipAddress?: string,
  extra: AuditExtra = {}
): Promise<void> {
  try {
    const rc = await requestContext();
    const def = EVENTS[action];
    const d = details ?? {};

    // Actor: explicit user, else the session in use (unless the caller says that's misleading)
    let actorId = userId;
    if (!actorId && extra.useSession !== false && rc.sessionToken) {
      const s = await db.session.findFirst({ where: { token: { in: tokenLookupKeys(rc.sessionToken) } }, select: { userId: true } });
      actorId = s?.userId;
    }
    let actorName = extra.actorName;
    if (!actorName && actorId) {
      const u = await db.user.findUnique({ where: { id: actorId }, select: { username: true } });
      actorName = u?.username;
    }
    actorName ??= str(d.username) || undefined;

    let appName = extra.appName;
    const appId = extra.appId ?? (typeof d.appId === "string" ? d.appId : undefined);
    if (!appName && appId) {
      const a = await db.app.findUnique({ where: { id: appId }, select: { name: true } });
      appName = a?.name;
    }

    const t = def?.target?.(d);
    const message =
      extra.message ??
      (def ? def.text({ actor: actorName ?? "Unbekannt", app: appName ?? (appId ? `App ${appId}` : "einer App"), d, t: makeT("de", {}).t, locale: "de" }) : `${actorName ?? "Unbekannt"}: ${action}`);

    await db.auditLog.create({
      data: {
        action,
        category: def?.category ?? "GENERAL",
        outcome: extra.outcome ?? "SUCCESS",
        message,
        userId: actorId,
        actorName,
        sessionRef: extra.useSession !== false && rc.sessionToken ? sessionRefOf(rc.sessionToken) : undefined,
        authVia: extra.authVia,
        appId,
        appName,
        targetType: extra.targetType ?? t?.type,
        targetId: extra.targetId ?? t?.id,
        targetLabel: extra.targetLabel ?? t?.label,
        ipAddress: ipAddress ?? rc.ip,
        userAgent: extra.userAgent ?? rc.userAgent,
        requestMethod: extra.requestMethod ?? rc.method,
        requestPath: (extra.requestPath ?? rc.path)?.slice(0, 500),
        details: details ? (details as Prisma.InputJsonObject) : undefined,
      },
    });
  } catch (error) {
    console.error("[AUDIT] Schreiben fehlgeschlagen:", action, error instanceof Error ? error.message : error);
  }
}

/**
 * The sentence of a stored entry in the viewer's language (falls back to the stored German sentence for
 * unknown actions). Actor and app names come from the entry's own columns.
 */
export function renderAuditMessage(
  row: { action: string; actorName: string | null; appName: string | null; appId: string | null; details: unknown; message: string | null },
  t: (key: string, params?: Record<string, string | number>) => string,
  locale: Locale
): string | null {
  const def = EVENTS[row.action];
  if (!def) return row.message;
  const d = row.details && typeof row.details === "object" ? (row.details as Record<string, unknown>) : {};
  return def.text({
    actor: row.actorName || str(d.username) || t("Unbekannt"),
    app: row.appName ?? (row.appId ? t("App {appId}", { appId: row.appId }) : t("einer App")),
    d,
    t,
    locale,
  });
}
