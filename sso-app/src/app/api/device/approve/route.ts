import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { getClientIp } from "@/lib/ip";
import { logAudit } from "@/lib/audit";
import { requireReauth } from "@/lib/reauth";
import { rateLimitDeviceApprove } from "@/lib/rate-limit";
import { sendGuestAccessEmail } from "@/lib/email";
import { getT } from "@/lib/i18n/server";
import {
  checkTypedCode,
  findOpenRequestOf,
  findRequestByToken,
  GUEST_DURATIONS_HOURS,
  isOpen,
  MAX_CODE_ATTEMPTS,
  rateLimitCodeGuess,
} from "@/lib/device-login";

const err = (status: number, error: string, extra?: Record<string, unknown>) => NextResponse.json({ error, ...extra }, { status });

/**
 * POST: the account owner approves a request, either via the link from the QR code (`token`) or by typing the code
 * shown on the other device (`code`). Guest access needs a duration; signing in a device needs the password again.
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return err(401, "Nicht authentifiziert");
  const userId = session.user.id;
  const ip = getClientIp(request);

  if (!rateLimitDeviceApprove(userId).allowed) return err(429, "Zu viele Versuche. Bitte warte kurz.");

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return err(400, "Ungültige Anfrage");
  const token = typeof body.token === "string" ? body.token : "";
  const code = typeof body.code === "string" ? body.code.replace(/\s/g, "") : "";
  const via = token ? "QR" : "CODE";

  // Find the request
  let r;
  if (via === "QR") {
    r = await findRequestByToken(token);
    if (!r || !r.userId) return err(404, "Die Anfrage ist nicht mehr gültig");
    if (r.userId !== userId) return err(403, "Diese Anfrage gehört zu einem anderen Konto");
  } else {
    if (!code) return err(400, "Bitte gib den Code ein");
    if (!rateLimitCodeGuess(userId).allowed) return err(429, "Zu viele Versuche. Bitte warte kurz.");
    r = await findOpenRequestOf(userId);
    if (!r) return err(404, "Es gibt keine offene Anfrage");

    const result = await checkTypedCode(r, code);
    if (result === "locked") {
      await logAudit("DEVICE_LOGIN_DENIED", { kind: r.kind, reason: "too_many_attempts" }, userId, ip, { outcome: "DENIED" });
      return err(400, "Zu viele falsche Codes. Die Anfrage wurde beendet.");
    }
    if (result === "wrong") {
      return err(400, "Der Code stimmt nicht überein", { attemptsLeft: Math.max(0, MAX_CODE_ATTEMPTS - (r.failedAttempts + 1)) });
    }
  }
  if (!isOpen(r)) return err(410, "Die Anfrage ist abgelaufen");

  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, username: true, email: true, isMaster: true, forcePasswordChange: true, guestLoginEnabled: true, deviceLoginEnabled: true, locale: true, expiresAt: true },
  });
  if (!user) return err(401, "Nicht authentifiziert");
  if (user.forcePasswordChange) return err(403, "Ändere zuerst dein Passwort");
  if (user.expiresAt) return err(403, "Für Gastkonten nicht verfügbar");

  let durationHours: number | undefined;

  if (r.kind === "GUEST") {
    if (user.isMaster || !user.guestLoginEnabled) return err(403, "Gast-Anmeldung ist für dieses Konto ausgeschaltet");
    durationHours = Number(body.durationHours);
    if (!(GUEST_DURATIONS_HOURS as readonly number[]).includes(durationHours)) return err(400, "Bitte wähle eine Dauer");

    const app = r.appId ? await db.app.findUnique({ where: { id: r.appId } }) : null;
    if (!app || !app.isActive) return err(400, "Die App ist nicht verfügbar");
    const permission = await db.userAppPermission.findUnique({
      where: { userId_appId: { userId, appId: app.id } },
      select: { permissionLevel: true },
    });
    if ((permission?.permissionLevel ?? app.defaultPermission) === "DENY") {
      return err(403, `Du hast selbst keinen Zugriff auf ${app.name}`);
    }
  } else {
    if (!user.deviceLoginEnabled) return err(403, "Anmeldung über ein anderes Gerät ist für dieses Konto ausgeschaltet");
    // A full session for another device: the password again, like for other sensitive changes
    const reauth = await requireReauth(userId, body.password, "device-login", ip);
    if (reauth) return reauth;
  }

  const approved = await db.deviceLoginRequest.updateMany({
    where: { id: r.id, status: "PENDING", expiresAt: { gt: new Date() } },
    data: { status: "APPROVED", approvedAt: new Date(), durationHours: durationHours ?? null },
  });
  if (approved.count !== 1) return err(410, "Die Anfrage ist nicht mehr gültig");

  await logAudit("DEVICE_LOGIN_APPROVED", { kind: r.kind, via, durationHours }, userId, ip, { appId: r.appId ?? undefined, authVia: "EXISTING_SESSION" });

  if (r.kind === "GUEST" && user.email && durationHours) {
    const app = r.appId ? await db.app.findUnique({ where: { id: r.appId }, select: { name: true } }) : null;
    sendGuestAccessEmail(user.email, user.username, app?.name ?? (await getT()).t("einer App"), new Date(Date.now() + durationHours * 3600_000), r.ipAddress, r.userAgent, user.locale)
      .then((ok) => { if (!ok) console.error("[GUEST NOTIFY] E-Mail konnte nicht gesendet werden"); })
      .catch(() => console.error("[GUEST NOTIFY] E-Mail-Versand fehlgeschlagen"));
  }

  return NextResponse.json({ success: true });
}
