import { NextResponse } from "next/server";
import { getSession, refreshCurrentSessionMaxAge } from "@/lib/session";
import { db } from "@/lib/db";
import { emailSchema, sessionDurationHoursSchema } from "@/lib/validation";
import { logAudit, createRecoveryCodes, createEmailCode } from "@/lib/auth";
import { sendEmailChangeCodeEmail } from "@/lib/email";
import { encrypt } from "@/lib/crypto";
import { getClientIp } from "@/lib/ip";
import { requireReauth } from "@/lib/reauth";
import { rateLimitEmail } from "@/lib/rate-limit";
import { pendingEmailToken } from "@/lib/pending";
import { LOCALE_COOKIE, isLocale } from "@/lib/i18n/core";

const EMAIL_CHANGE_TTL_MS = 10 * 60 * 1000;

/** GET: Get user profile. */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Nicht authentifiziert" }, { status: 401 });
  }

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      username: true,
      email: true,
      isMaster: true,
      forcePasswordChange: true,
      totpVerified: true,
      mobileAppEnabled: true,
      sessionDurationHours: true,
      locale: true,
      avatarUpdatedAt: true,
      createdAt: true,
      _count: { select: { passkeys: true, recoveryCodes: true, trustedDevices: true } },
      passkeys: { select: { id: true, deviceName: true, createdAt: true } },
    },
  });

  return NextResponse.json(user);
}

/**
 * PATCH: Update the user profile. One action per request:
 *
 *  - `email` (+ `currentPassword`): a NEW address is only stored as pending and gets a code; it becomes the account's
 *    address after POST /api/settings/email/verify. Until then the old one stays active, so a hijacked session can't
 *    redirect codes and notifications to an address the attacker controls. `null`/"" removes the address.
 *  - `sessionDurationHours`
 *  - `locale` ("de" | "en" | null = automatic)
 *  - `deletePasskey` (+ `currentPassword`)
 *  - `generateRecoveryCodes` (+ `currentPassword`)
 */
export async function PATCH(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Nicht authentifiziert" }, { status: 401 });
  }
  const userId = session.user.id;
  const ip = getClientIp(request);

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
  }

  try {
    // ── E-Mail-Adresse ändern oder entfernen ───────────
    if (body.email !== undefined) {
      if (body.email !== null && typeof body.email !== "string") {
        return NextResponse.json({ error: "Ungültige E-Mail-Adresse" }, { status: 400 });
      }

      const reauth = await requireReauth(userId, body.currentPassword, "email-change", ip);
      if (reauth) return reauth;

      const requested = typeof body.email === "string" ? body.email.trim() : "";
      const token = pendingEmailToken(userId);

      if (!requested) {
        await db.user.update({ where: { id: userId }, data: { email: null } });
        await db.loginSession.deleteMany({ where: { token } });
        await logAudit("EMAIL_CHANGED", { removed: true }, userId, ip);
        return NextResponse.json({ success: true, email: null });
      }

      const parsed = emailSchema.safeParse(requested);
      if (!parsed.success || requested.length > 254) {
        return NextResponse.json({ error: parsed.success ? "Ungültige E-Mail-Adresse" : parsed.error.issues[0].message }, { status: 400 });
      }
      const newEmail = parsed.data;

      const current = await db.user.findUnique({ where: { id: userId }, select: { email: true } });
      if (current?.email && current.email.toLowerCase() === newEmail.toLowerCase()) {
        return NextResponse.json({ success: true, unchanged: true });
      }

      const rl = rateLimitEmail(userId);
      if (!rl.allowed) {
        return NextResponse.json(
          { error: "Zu viele Codes angefordert. Bitte warte kurz.", retryAfter: Math.ceil((rl.resetAt - Date.now()) / 1000) },
          { status: 429 }
        );
      }

      // Keep the new address (encrypted) as pending; a newer request replaces an unfinished one
      const code = await createEmailCode(userId, "EMAIL_CHANGE");
      await db.loginSession.deleteMany({ where: { token } });
      await db.loginSession.create({
        data: {
          token,
          userId,
          step: "EMAIL_CHANGE",
          ipAddress: ip,
          challenge: encrypt(newEmail),
          expiresAt: new Date(Date.now() + EMAIL_CHANGE_TTL_MS),
        },
      });

      const sent = await sendEmailChangeCodeEmail(newEmail, session.user.username, code, session.user.locale);
      if (!sent) {
        await db.loginSession.deleteMany({ where: { token } });
        return NextResponse.json(
          { error: "Der Bestätigungscode konnte nicht gesendet werden. Bitte prüfe die Adresse oder versuche es später erneut." },
          { status: 502 }
        );
      }

      await logAudit("EMAIL_CHANGE_REQUESTED", {}, userId, ip);
      return NextResponse.json({ success: true, pending: true });
    }

    // ── Language ───────────────────────────────────────
    if (body.locale !== undefined) {
      if (body.locale !== null && !isLocale(body.locale)) return NextResponse.json({ error: "Ungültige Sprache" }, { status: 400 });
      await db.user.update({ where: { id: userId }, data: { locale: body.locale } });
      const response = NextResponse.json({ success: true });
      // The sign-in page (before login) remembers the choice too
      if (body.locale) response.cookies.set(LOCALE_COOKIE, body.locale, { path: "/", maxAge: 365 * 24 * 3600, sameSite: "lax" });
      else response.cookies.delete(LOCALE_COOKIE);
      return response;
    }

    // ── Session-/Cookie-Dauer ──────────────────────────
    if (body.sessionDurationHours !== undefined) {
      if (body.sessionDurationHours === null) {
        await db.user.update({ where: { id: userId }, data: { sessionDurationHours: null } });
      } else {
        const r = sessionDurationHoursSchema.safeParse(body.sessionDurationHours);
        if (!r.success) return NextResponse.json({ error: r.error.issues[0].message }, { status: 400 });
        await db.user.update({ where: { id: userId }, data: { sessionDurationHours: r.data } });
        await refreshCurrentSessionMaxAge(r.data);
      }
      await logAudit("SESSION_DURATION_UPDATED", { sessionDurationHours: body.sessionDurationHours }, userId, ip);
      return NextResponse.json({ success: true });
    }

    // ── Passkey löschen ────────────────────────────────
    if (body.deletePasskey !== undefined) {
      if (typeof body.deletePasskey !== "string" || !body.deletePasskey) {
        return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
      }
      const reauth = await requireReauth(userId, body.currentPassword, "passkey-delete", ip);
      if (reauth) return reauth;

      const passkey = await db.passkey.findFirst({ where: { id: body.deletePasskey, userId } });
      if (!passkey) {
        return NextResponse.json({ error: "Passkey nicht gefunden" }, { status: 404 });
      }
      await db.passkey.delete({ where: { id: passkey.id } });
      await logAudit("PASSKEY_DELETED", { passkeyId: passkey.id }, userId, ip);
      return NextResponse.json({ success: true });
    }

    // ── Neue Wiederherstellungscodes ───────────────────
    if (body.generateRecoveryCodes) {
      const reauth = await requireReauth(userId, body.currentPassword, "recovery-codes", ip);
      if (reauth) return reauth;

      const codes = await createRecoveryCodes(userId);
      await logAudit("RECOVERY_CODES_GENERATED", {}, userId, ip);
      return NextResponse.json({ success: true, recoveryCodes: codes });
    }

    return NextResponse.json({ error: "Keine Änderung angegeben" }, { status: 400 });
  } catch {
    return NextResponse.json({ error: "Fehler" }, { status: 500 });
  }
}
