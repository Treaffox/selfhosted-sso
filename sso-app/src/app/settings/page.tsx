"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { PageTitle } from "@/components/ui/page-title";
import { usePasswordPrompt } from "@/components/ui/password-prompt";
import { toast } from "sonner";
import Link from "next/link";
import { useI18n } from "@/components/i18n-provider";
import { dateLocale } from "@/lib/i18n/core";

interface UserProfile {
  id: string;
  username: string;
  email: string | null;
  isMaster: boolean;
  forcePasswordChange: boolean;
  totpVerified: boolean;
  mobileAppEnabled: boolean;
  avatarUpdatedAt: string | null;
  locale: string | null;
  createdAt: string;
  _count: { passkeys: number; recoveryCodes: number; trustedDevices: number };
  passkeys: { id: string; deviceName: string; createdAt: string }[];
}

export default function SettingsPage() {
  const { t, tn, te, locale } = useI18n();
  const router = useRouter();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [emailCode, setEmailCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const { askPassword, passwordPrompt } = usePasswordPrompt();
  const [avatarBusy, setAvatarBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const fetchProfile = async () => {
    const res = await fetch("/api/settings/profile");
    if (res.ok) {
      const data = await res.json();
      setProfile(data);
      setEmail(data.email ?? "");
    }
    setLoading(false);
  };

  useEffect(() => { fetchProfile(); }, []);

  // A new address only becomes active after the code sent to it was entered; removing one needs no code.
  const updateEmail = async () => {
    const wanted = email.trim();
    if (wanted === (profile?.email ?? "")) {
      toast.info(t("Keine Änderung"));
      return;
    }
    const password = await askPassword(wanted ? t("E-Mail-Adresse ändern") : t("E-Mail-Adresse entfernen"));
    if (password === null) return;

    setSaving(true);
    const res = await fetch("/api/settings/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: wanted || null, currentPassword: password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(te(data.error, "Fehler"));
    } else if (data.pending) {
      setPendingEmail(wanted);
      setEmailCode("");
      toast.success(t("Bestätigungscode gesendet"));
    } else {
      setPendingEmail(null);
      toast.success(wanted ? "Gespeichert" : "E-Mail-Adresse entfernt");
      await fetchProfile();
    }
    setSaving(false);
  };

  const verifyEmail = async () => {
    setVerifying(true);
    const res = await fetch("/api/settings/email/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: emailCode.trim() }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      toast.success(t("E-Mail-Adresse bestätigt"));
      setPendingEmail(null);
      setEmailCode("");
      await fetchProfile();
    } else {
      toast.error(te(data.error, "Fehler"));
    }
    setVerifying(false);
  };

  const cancelEmailChange = () => {
    setPendingEmail(null);
    setEmailCode("");
    setEmail(profile?.email ?? "");
  };

  // Downscale to 256x256 (center-crop) in the browser, so uploads stay small.
  // Uses a data: URL (not blob:), because the CSP only allows img-src 'self' and data:.
  const resizeImage = (file: File) =>
    new Promise<Blob>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const size = 256;
          const side = Math.min(img.width, img.height);
          const canvas = document.createElement("canvas");
          canvas.width = canvas.height = size;
          canvas.getContext("2d")!.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
          canvas.toBlob((b) => (b ? resolve(b) : reject()), "image/webp", 0.85);
        };
        img.onerror = () => reject();
        img.src = reader.result as string;
      };
      reader.readAsDataURL(file);
    });

  const uploadAvatar = async (file: File) => {
    setAvatarBusy(true);
    try {
      const blob = await resizeImage(file);
      const res = await fetch("/api/settings/avatar", { method: "PUT", body: blob });
      const data = await res.json();
      if (res.ok) { toast.success(t("Profilbild gespeichert")); await fetchProfile(); }
      else toast.error(te(data.error));
    } catch {
      toast.error(t("Bild konnte nicht verarbeitet werden"));
    }
    setAvatarBusy(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  const removeAvatar = async () => {
    setAvatarBusy(true);
    const res = await fetch("/api/settings/avatar", { method: "DELETE" });
    if (res.ok) { toast.success(t("Profilbild entfernt")); await fetchProfile(); }
    else toast.error(t("Fehler"));
    setAvatarBusy(false);
  };

  if (loading) return <><PageTitle title={t("Einstellungen")} /><div className="loading-bar rounded" /></>;
  if (!profile) return null;

  return (
    <div className="animate-slide-up space-y-6">
      <PageTitle title={t("Einstellungen")} />
      {passwordPrompt}
      <h1 className="text-xl sm:text-2xl font-black">{t("Einstellungen")}</h1>

      {profile.forcePasswordChange && (
        <div className="bg-danger/10 border border-danger/20 rounded-lg p-4">
          <p className="text-sm font-bold text-danger">
            {t("Du musst dein Passwort ändern, bevor du fortfahren kannst.")}
          </p>
          <Link href="/settings/security">
            <Button size="sm" className="mt-2">{t("Passwort ändern")}</Button>
          </Link>
        </div>
      )}

      {/* Language */}
      <Card>
        <CardTitle>{t("Sprache")}</CardTitle>
        <CardDescription>{t("Sprache der Oberfläche und der E-Mails an dich")}</CardDescription>
        <div className="mt-4 max-w-xs">
          <Select
            value={profile.locale ?? "auto"}
            onChange={async (e) => {
              const value = e.target.value === "auto" ? null : e.target.value;
              const res = await fetch("/api/settings/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ locale: value }) });
              if (res.ok) router.refresh();
              else toast.error(te((await res.json().catch(() => ({}))).error));
            }}
            hint={t("„Automatisch“ richtet sich nach der Sprache deines Browsers und deinem Standort (Deutsch in Deutschland, Österreich und der Schweiz, sonst Englisch).")}
          >
            <option value="auto">{t("Automatisch")}</option>
            <option value="de">Deutsch</option>
            <option value="en">English</option>
          </Select>
        </div>
      </Card>

      {/* Profile */}
      <Card>
        <CardTitle>{t("Profil")}</CardTitle>
        <div className="mt-4 flex items-center gap-4">
          {profile.avatarUpdatedAt ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/avatar/${profile.id}?v=${new Date(profile.avatarUpdatedAt).getTime()}`}
              alt={t("Profilbild")}
              className="w-16 h-16 rounded-full object-cover border border-border"
            />
          ) : (
            <div className="w-16 h-16 rounded-full border border-border flex items-center justify-center text-xl font-black text-muted">
              {profile.username.charAt(0).toUpperCase()}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && uploadAvatar(e.target.files[0])}
            />
            <Button size="sm" variant="secondary" loading={avatarBusy} onClick={() => fileRef.current?.click()}>
              {profile.avatarUpdatedAt ? t("Ändern") : t("Profilbild hochladen")}
            </Button>
            {profile.avatarUpdatedAt && (
              <Button size="sm" variant="secondary" disabled={avatarBusy} onClick={removeAvatar}>{t("Entfernen")}</Button>
            )}
          </div>
        </div>
        <div className="mt-4 space-y-3 text-sm">
          <div className="flex justify-between items-center">
            <span className="text-muted">{t("Benutzername")}</span>
            <span className="font-bold">{profile.username}</span>
          </div>
          <div className="flex justify-between items-center gap-2">
            <span className="text-muted shrink-0">{t("Nutzer-ID")}</span>
            <span className="font-mono text-xs truncate select-all">{profile.id}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-muted">{t("Rolle")}</span>
            <Badge variant={profile.isMaster ? "warning" : "default"}>
              {profile.isMaster ? t("Master") : t("Normaler Nutzer")}
            </Badge>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-muted">{t("Mitglied seit")}</span>
            <span>{new Date(profile.createdAt).toLocaleDateString(dateLocale(locale))}</span>
          </div>
        </div>
        <div className="mt-5 pt-4 border-t border-border">
          <Input
            label={t("E-Mail")}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t("deine@email.de")}
            disabled={pendingEmail !== null}
          />
          {pendingEmail === null ? (
            <>
              <p className="mt-2 text-xs text-muted">
                {t("Eine neue Adresse gilt erst, nachdem du den Code bestätigt hast, den wir an sie senden. Bis dahin bleibt die bisherige aktiv.")}
              </p>
              <Button size="sm" className="mt-3" onClick={updateEmail} loading={saving}>
                {email.trim() ? t("Bestätigungscode senden") : t("E-Mail-Adresse entfernen")}
              </Button>
            </>
          ) : (
            <div className="mt-3 space-y-3">
              <p className="text-xs text-muted">
                {tn("Wir haben einen 6-stelligen Code an {email} gesendet. Er ist 10 Minuten gültig.", {
                  email: <span className="font-bold text-foreground">{pendingEmail}</span>,
                })}
              </p>
              <Input
                label={t("Bestätigungscode")}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={emailCode}
                onChange={(e) => setEmailCode(e.target.value.replace(/\D/g, ""))}
                placeholder="123456"
              />
              <div className="flex gap-2">
                <Button size="sm" onClick={verifyEmail} loading={verifying} disabled={emailCode.length !== 6}>
                  {t("Bestätigen")}
                </Button>
                <Button size="sm" variant="secondary" onClick={cancelEmailChange}>
                  {t("Abbrechen")}
                </Button>
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* Security Overview */}
      <Card>
        <CardTitle>{t("Sicherheit")}</CardTitle>
        <CardDescription>{t("Übersicht deiner Sicherheitseinstellungen")}</CardDescription>
        <div className="mt-4 space-y-4">
          <div className="flex items-center justify-between py-2">
            <div>
              <p className="text-sm font-bold">{t("Passwort")}</p>
              <p className="text-xs text-muted">{t("Dein Anmeldepasswort")}</p>
            </div>
            <Link href="/settings/security">
              <Button size="sm" variant="secondary">{t("Ändern")}</Button>
            </Link>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 py-2 border-t border-border">
            <div>
              <p className="text-sm font-bold">{t("Google Authenticator (TOTP)")}</p>
              <p className="text-xs text-muted">
                {profile.totpVerified ? t("Eingerichtet und aktiv") : t("Nicht eingerichtet")}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={profile.totpVerified ? "success" : "danger"}>
                {profile.totpVerified ? t("Aktiv") : t("Inaktiv")}
              </Badge>
              <Link href="/settings/security">
                <Button size="sm" variant="secondary">
                  {profile.totpVerified ? t("Verwalten") : t("Einrichten")}
                </Button>
              </Link>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 py-2 border-t border-border">
            <div>
              <p className="text-sm font-bold">{t("Passkeys")}</p>
              <p className="text-xs text-muted">
                {profile._count.passkeys > 0
                  ? `${profile._count.passkeys} Passkey(s) registriert`
                  : t("Keine Passkeys registriert")}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={profile._count.passkeys > 0 ? "success" : "danger"}>
                {profile._count.passkeys}
              </Badge>
              <Link href="/settings/security">
                <Button size="sm" variant="secondary">{t("Verwalten")}</Button>
              </Link>
            </div>
          </div>

          <div className="flex items-center justify-between py-2 border-t border-border">
            <div>
              <p className="text-sm font-bold">{t("Wiederherstellungscodes")}</p>
              <p className="text-xs text-muted">
                {profile._count.recoveryCodes > 0
                  ? t("{count} Codes verfügbar", { count: profile._count.recoveryCodes })
                  : t("Keine Codes generiert")}
              </p>
            </div>
            <Link href="/settings/security">
              <Button size="sm" variant="secondary">{t("Verwalten")}</Button>
            </Link>
          </div>

          <div className="flex items-center justify-between py-2 border-t border-border">
            <div>
              <p className="text-sm font-bold">{t("Aktive Sitzungen")}</p>
              <p className="text-xs text-muted">{t("Angemeldete Geräte verwalten")}</p>
            </div>
            <Link href="/settings/sessions">
              <Button size="sm" variant="secondary">{t("Anzeigen")}</Button>
            </Link>
          </div>
        </div>
      </Card>
    </div>
  );
}
