"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/components/i18n-provider";

export function InviteForm({ token, username }: { token: string; username: string }) {
  const { t, te } = useI18n();
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const submit = async () => {
    setError("");
    if (password !== repeat) {
      setError(t("Die Passwörter stimmen nicht überein"));
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/invite/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) setDone(true);
      else setError(te(data.error, "Ein Fehler ist aufgetreten"));
    } catch {
      setError(t("Verbindungsfehler"));
    } finally {
      setLoading(false);
    }
  };

  if (done) {
    return (
      <div>
        <h1 className="text-lg font-extrabold mb-1">{t("Passwort gesetzt")}</h1>
        <p className="text-sm text-muted mb-4">{t("Du kannst dich jetzt mit deinem Benutzernamen und dem neuen Passwort anmelden.")}</p>
        <Link href="/auth/login">
          <Button className="w-full">{t("Zur Anmeldung")}</Button>
        </Link>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-lg font-extrabold mb-1">{t("Konto einrichten")}</h1>
      <p className="text-sm text-muted mb-6">{t("Willkommen, {username}. Wähle ein Passwort für dein Konto.", { username })}</p>
      {error && <p className="text-danger text-xs mb-4 font-semibold">{error}</p>}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="space-y-4"
      >
        <Input label={t("Neues Passwort")} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
        <Input label={t("Passwort wiederholen")} type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} />
        <Button type="submit" className="w-full" loading={loading} disabled={!password || !repeat}>
          {t("Passwort speichern")}
        </Button>
      </form>
    </div>
  );
}
