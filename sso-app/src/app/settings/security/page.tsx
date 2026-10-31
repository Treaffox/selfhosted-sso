"use client";

import { useState, useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { Switch } from "@/components/ui/switch";
import { PageTitle } from "@/components/ui/page-title";
import { usePasswordPrompt } from "@/components/ui/password-prompt";
import { toast } from "sonner";
import { startRegistration } from "@simplewebauthn/browser";
import { useI18n } from "@/components/i18n-provider";
import { dateLocale } from "@/lib/i18n/core";

export default function SecurityPage() {
  const { t, te, locale } = useI18n();
  const searchParams = useSearchParams();
  const mustChangePassword = searchParams.get("changePassword") === "1";
  const mustSetupMfa = searchParams.get("setupMfa") === "1";

  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const { askPassword, passwordPrompt } = usePasswordPrompt();

  // Password
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [removeFactors, setRemoveFactors] = useState(true);

  // TOTP
  const [totpSetup, setTotpSetup] = useState<{ qrDataUrl: string; uri: string; secret: string } | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [totpSaving, setTotpSaving] = useState(false);

  // Passkeys
  const [passkeyName, setPasskeyName] = useState("");
  const [passkeyRegistering, setPasskeyRegistering] = useState(false);

  // Recovery Codes
  const [showRecoveryCodes, setShowRecoveryCodes] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [recoveryLoading, setRecoveryLoading] = useState(false);

  // Session duration
  const [sessionDuration, setSessionDuration] = useState("default");
  const [sessionDurationSaving, setSessionDurationSaving] = useState(false);

  const fetchProfile = async () => {
    const res = await fetch("/api/settings/profile");
    if (res.ok) {
      const data = await res.json();
      setProfile(data);
      setSessionDuration(data.sessionDurationHours ? String(data.sessionDurationHours) : "default");
    }
    setLoading(false);
  };

  useEffect(() => { fetchProfile(); }, []);

  const isGuest = !!profile?.expiresAt;
  const hasSecondFactor = !!profile?.totpVerified || (profile?.passkeys?.length ?? 0) > 0;

  // --- Password Change ---
  const changePassword = async () => {
    if (newPassword !== confirmPassword) {
      toast.error(t("Passwörter stimmen nicht überein"));
      return;
    }
    setPasswordSaving(true);
    const res = await fetch("/api/settings/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword, removeSecondFactors: hasSecondFactor && removeFactors }),
    });
    const data = await res.json();
    res.ok ? toast.success(t("Passwort geändert. Alle anderen Sitzungen wurden beendet.")) : toast.error(te(data.error));
    if (res.ok) {
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
      if (hasSecondFactor && removeFactors) fetchProfile();
    }
    setPasswordSaving(false);
  };

  // --- TOTP Setup ---
  const initTotp = async () => {
    const password = await askPassword(t("Authenticator einrichten"));
    if (!password) return;
    setTotpSaving(true);
    const res = await fetch("/api/auth/totp/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: password }),
    });
    if (res.ok) {
      const data = await res.json();
      setTotpSetup(data);
    } else {
      const data = await res.json().catch(() => ({}));
      toast.error(te(data.error, "Fehler beim Einrichten"));
    }
    setTotpSaving(false);
  };

  const verifyTotp = async () => {
    setTotpSaving(true);
    const res = await fetch("/api/auth/totp/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: totpCode }),
    });
    const data = await res.json();
    if (res.ok) {
      toast.success(t("TOTP aktiviert"));
      setTotpSetup(null);
      setTotpCode("");
      fetchProfile();
    } else {
      toast.error(te(data.error, "Ungültiger Code"));
    }
    setTotpSaving(false);
  };

  // --- Passkey Registration ---
  const registerPasskey = async () => {
    if (!passkeyName.trim()) { toast.error(t("Name erforderlich")); return; }
    const password = await askPassword(t("Passkey hinzufügen"));
    if (!password) return;
    setPasskeyRegistering(true);
    try {
      const optRes = await fetch("/api/auth/passkey/register/options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: password }),
      });
      if (!optRes.ok) {
        const err = await optRes.json().catch(() => ({}));
        throw new Error(te(err.error, "Optionen konnten nicht geladen werden"));
      }
      const options = await optRes.json();

      const credential = await startRegistration({ optionsJSON: options });

      const verRes = await fetch("/api/auth/passkey/register/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credential, deviceName: passkeyName.trim() }),
      });
      if (verRes.ok) {
        toast.success(t("Passkey registriert"));
        setPasskeyName("");
        fetchProfile();
      } else {
        const data = await verRes.json();
        toast.error(te(data.error, "Registrierung fehlgeschlagen"));
      }
    } catch (e: any) {
      toast.error(e.message || t("Registrierung abgebrochen"));
    }
    setPasskeyRegistering(false);
  };

  const deletePasskey = async (id: string) => {
    const password = await askPassword(t("Passkey entfernen"));
    if (!password) return;
    const res = await fetch(`/api/settings/profile`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deletePasskey: id, currentPassword: password }),
    });
    if (res.ok) fetchProfile();
    else toast.error(te((await res.json().catch(() => ({}))).error, "Fehler"));
  };

  // --- Session Duration ---
  const saveSessionDuration = async () => {
    setSessionDurationSaving(true);
    const res = await fetch("/api/settings/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionDurationHours: sessionDuration === "default" ? null : parseInt(sessionDuration, 10),
      }),
    });
    const data = await res.json();
    res.ok ? toast.success(t("Gespeichert")) : toast.error(te(data.error));
    setSessionDurationSaving(false);
  };

  // --- Approval-based sign-in (guest / other device) ---
  const [deviceLoginSaving, setDeviceLoginSaving] = useState<string | null>(null);
  const setDeviceLogin = async (field: "guestLoginEnabled" | "deviceLoginEnabled", value: boolean) => {
    setDeviceLoginSaving(field);
    const res = await fetch("/api/settings/device-login", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: value }),
    });
    if (res.ok) setProfile((p: any) => ({ ...p, [field]: value }));
    else toast.error(te((await res.json().catch(() => ({}))).error, "Fehler"));
    setDeviceLoginSaving(null);
  };

  // --- Recovery Codes ---
  const generateRecoveryCodes = async () => {
    const password = await askPassword(t("Wiederherstellungscodes erzeugen"));
    if (!password) return;
    setRecoveryLoading(true);
    const res = await fetch("/api/settings/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ generateRecoveryCodes: true, currentPassword: password }),
    });
    if (res.ok) {
      const data = await res.json();
      setRecoveryCodes(data.recoveryCodes || []);
      setShowRecoveryCodes(true);
      fetchProfile();
    } else {
      toast.error(te((await res.json().catch(() => ({}))).error, "Fehler"));
    }
    setRecoveryLoading(false);
  };

  if (loading) return <><PageTitle title={t("Sicherheit")} /><div className="loading-bar rounded" /></>;
  if (!profile) return null;

  return (
    <div className="animate-slide-up space-y-6">
      {passwordPrompt}
      <PageTitle title={t("Sicherheit")} />
      <h1 className="text-xl sm:text-2xl font-black">{t("Sicherheit")}</h1>

      {mustChangePassword && (
        <div className="bg-warning/10 border border-warning/30 rounded-xl p-4">
          <p className="text-sm font-bold text-warning">{t("Passwortänderung erforderlich")}</p>
          <p className="text-xs text-warning/70 mt-1">
            {t("Dein Konto verwendet noch ein temporäres Passwort. Bitte ändere es, bevor du fortfährst.")}
          </p>
        </div>
      )}

      {mustSetupMfa && (
        <div className="bg-warning/10 border border-warning/30 rounded-xl p-4">
          <p className="text-sm font-bold text-warning">{t("Zwei-Faktor-Authentifizierung erforderlich")}</p>
          <p className="text-xs text-warning/70 mt-1">
            {t("Für den Zugriff auf externe Anwendungen muss eine MFA-Methode eingerichtet sein. Richte TOTP oder einen Passkey ein, um fortzufahren.")}
          </p>
        </div>
      )}

      {/* Password */}
      <Card>
        <CardTitle>{t("Passwort ändern")}</CardTitle>
        <div className="mt-4 space-y-3">
          <Input
            label={t("Aktuelles Passwort")}
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
          />
          <Input
            label={t("Neues Passwort")}
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
          <Input
            label={t("Passwort bestätigen")}
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
          {hasSecondFactor && (
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={removeFactors}
                onChange={(e) => setRemoveFactors(e.target.checked)}
                className="w-4 h-4 mt-0.5 accent-foreground"
              />
              <span className="text-xs text-muted">
                {t("Passkeys, Authenticator und Wiederherstellungscodes entfernen (empfohlen, falls jemand anderes Zugriff auf dein Konto hatte). Du richtest sie danach neu ein.")}
              </span>
            </label>
          )}
          <Button onClick={changePassword} loading={passwordSaving}>{t("Passwort ändern")}</Button>
        </div>
      </Card>

      {!isGuest && (
      <>
      {/* TOTP */}
      <Card>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>{t("Google Authenticator (TOTP)")}</CardTitle>
            <CardDescription>{t("Zweiter Faktor per Authenticator-App")}</CardDescription>
          </div>
          <Badge variant={profile.totpVerified ? "success" : "danger"}>
            {profile.totpVerified ? t("Aktiv") : t("Inaktiv")}
          </Badge>
        </div>

        {!totpSetup ? (
          <div className="mt-4">
            <Button
              onClick={initTotp}
              loading={totpSaving}
              variant={profile.totpVerified ? "secondary" : "primary"}
            >
              {profile.totpVerified ? t("Neu einrichten") : t("TOTP einrichten")}
            </Button>
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            <div className="flex flex-col items-center gap-4 p-4 bg-foreground/5 rounded-lg">
              <img
                src={totpSetup.qrDataUrl}
                alt={t("TOTP QR-Code")}
                className="w-48 h-48 rounded"
              />
              <div className="text-center">
                <p className="text-xs text-muted mb-1">{t("Manueller Schlüssel:")}</p>
                <code className="text-xs bg-foreground/10 px-2 py-1 rounded font-mono select-all">
                  {totpSetup.secret}
                </code>
              </div>
            </div>
            <p className="text-sm text-muted">
              {t("Scanne den QR-Code mit deiner Authenticator-App und gib den angezeigten Code ein.")}
            </p>
            <div className="flex flex-col sm:flex-row gap-2">
              <Input
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value)}
                placeholder={t("6-stelliger Code")}
                className="flex-1"
              />
              <Button onClick={verifyTotp} loading={totpSaving}>{t("Bestätigen")}</Button>
            </div>
            <Button variant="ghost" size="sm" onClick={() => { setTotpSetup(null); setTotpCode(""); }}>
              {t("Abbrechen")}
            </Button>
          </div>
        )}
      </Card>

      {/* Passkeys */}
      <Card>
        <CardTitle>{t("Passkeys")}</CardTitle>
        <CardDescription>{t("Sichere Anmeldung ohne Passwort per biometrischem Sensor oder Hardware-Key")}</CardDescription>

        {profile.passkeys?.length > 0 && (
          <div className="mt-4 space-y-2">
            {profile.passkeys.map((pk: any) => (
              <div key={pk.id} className="flex items-center justify-between p-3 bg-foreground/5 rounded-lg">
                <div>
                  <p className="text-sm font-bold">{pk.deviceName}</p>
                  <p className="text-xs text-muted">
                    {t("Registriert am {date}", { date: new Date(pk.createdAt).toLocaleDateString(dateLocale(locale)) })}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => deletePasskey(pk.id)}
                >
                  {t("Entfernen")}
                </Button>
              </div>
            ))}
          </div>
        )}

        <div className="mt-4 space-y-2">
          <div className="flex flex-col sm:flex-row gap-2">
            <Input
              value={passkeyName}
              onChange={(e) => setPasskeyName(e.target.value)}
              placeholder={t("Gerätename (z.B. MacBook, iPhone)")}
              className="flex-1"
            />
            <Button onClick={registerPasskey} loading={passkeyRegistering}>
              {t("Registrieren")}
            </Button>
          </div>
        </div>
      </Card>

      </>
      )}

      {/* Session Duration */}
      <Card>
        <CardTitle>{t("Sitzungsdauer")}</CardTitle>
        <CardDescription>
          {t("Wie lange du nach der Anmeldung angemeldet bleibst, bevor du dich erneut anmelden musst")}
        </CardDescription>
        <div className="mt-4 flex flex-col sm:flex-row gap-2">
          <select
            className="flex-1 bg-surface-lighter border border-border rounded-lg px-3 py-2.5 text-sm font-semibold text-foreground focus:outline-none focus:border-foreground"
            value={sessionDuration}
            onChange={(e) => setSessionDuration(e.target.value)}
          >
            <option value="1">{t("1 Stunde")}</option>
            <option value="8">{t("8 Stunden")}</option>
            <option value="24">{t("24 Stunden")}</option>
            <option value="72">{t("3 Tage")}</option>
            <option value="168">{t("7 Tage")}</option>
            <option value="720">{t("30 Tage")}</option>
            <option value="default">{t("Serverstandard")}</option>
          </select>
          <Button onClick={saveSessionDuration} loading={sessionDurationSaving}>
            {t("Speichern")}
          </Button>
        </div>
        <p className="text-xs text-muted mt-3">
          {t("Die neue Dauer gilt sofort für deine aktuelle Sitzung sowie für zukünftige Anmeldungen.")}
        </p>
      </Card>

      {!isGuest && (
      <>
      {/* Approval-based sign-in */}
      <Card>
        <CardTitle>{t("Anmeldung mit Freigabe")}</CardTitle>
        <CardDescription>
          {t("Du bestätigst jede Anfrage selbst, per QR-Code oder indem du den angezeigten Code eingibst.")}
        </CardDescription>
        <div className="mt-4 divide-y divide-border">
          {!profile.isMaster && (
            <div className="flex items-center justify-between gap-4 py-3 first:pt-0">
              <div>
                <p className="text-sm font-bold">{t("Gast-Anmeldung erlauben")}</p>
                <p className="text-xs text-muted mt-0.5">
                  {t("Andere können für kurze Zeit Zugriff auf eine einzelne App anfragen, ohne dein Konto zu sehen.")}
                </p>
              </div>
              <Switch
                label={t("Gast-Anmeldung erlauben")}
                checked={profile.guestLoginEnabled}
                disabled={deviceLoginSaving === "guestLoginEnabled"}
                onChange={(v) => setDeviceLogin("guestLoginEnabled", v)}
              />
            </div>
          )}
          <div className="flex items-center justify-between gap-4 py-3 last:pb-0">
            <div>
              <p className="text-sm font-bold">{t("Anmeldung auf anderem Gerät erlauben")}</p>
              <p className="text-xs text-muted mt-0.5">
                {t("Du kannst ein Gerät anmelden, indem du es auf einem bereits angemeldeten Gerät freigibst.")}
              </p>
            </div>
            <Switch
              label={t("Anmeldung auf anderem Gerät erlauben")}
              checked={profile.deviceLoginEnabled}
              disabled={deviceLoginSaving === "deviceLoginEnabled"}
              onChange={(v) => setDeviceLogin("deviceLoginEnabled", v)}
            />
          </div>
        </div>
      </Card>

      {/* Recovery Codes */}
      <Card>
        <CardTitle>{t("Wiederherstellungscodes")}</CardTitle>
        <CardDescription>
          {t("Einmal-Codes für den Notfall, wenn du keinen Zugriff auf deine MFA-Methoden hast")}
        </CardDescription>
        <div className="mt-4 flex items-center justify-between">
          <p className="text-sm text-muted">
            {profile._count.recoveryCodes > 0
              ? t("{count} Codes verfügbar", { count: profile._count.recoveryCodes })
              : t("Keine Codes generiert")}
          </p>
          <Button
            variant="secondary"
            onClick={generateRecoveryCodes}
            loading={recoveryLoading}
          >
            {profile._count.recoveryCodes > 0 ? t("Neu generieren") : t("Generieren")}
          </Button>
        </div>

        <Modal open={showRecoveryCodes} onClose={() => { setShowRecoveryCodes(false); setRecoveryCodes([]); }}>
          <h2 className="text-lg font-black mb-2">{t("Wiederherstellungscodes")}</h2>
          <p className="text-sm text-muted mb-4">
            {t("Speichere diese Codes sicher ab. Jeder Code kann nur einmal verwendet werden. Diese Codes werden nicht erneut angezeigt.")}
          </p>
          <div className="grid grid-cols-2 gap-2 p-4 bg-foreground/5 rounded-lg">
            {recoveryCodes.map((code, i) => (
              <code key={i} className="text-sm font-mono text-center py-1">{code}</code>
            ))}
          </div>
          <Button
            className="mt-4 w-full"
            onClick={() => {
              navigator.clipboard.writeText(recoveryCodes.join("\n"));
            }}
            variant="secondary"
          >
            {t("Alle kopieren")}
          </Button>
          <Button
            className="mt-2 w-full"
            onClick={() => { setShowRecoveryCodes(false); setRecoveryCodes([]); }}
          >
            {t("Verstanden")}
          </Button>
        </Modal>
      </Card>
      </>
      )}
    </div>
  );
}
