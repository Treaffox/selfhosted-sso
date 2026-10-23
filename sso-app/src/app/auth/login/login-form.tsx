"use client";

import { useState, useRef, useEffect, useCallback, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Footer } from "@/components/layout/footer";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { LanguageToggle } from "@/components/ui/language-toggle";
import { BrandLogo } from "@/components/ui/brand-logo";
import type { BrandView } from "@/lib/site-settings";
import { useI18n } from "@/components/i18n-provider";

type Step = "username" | "method_select" | "password" | "mfa";

interface LoginState {
  loginToken: string;
  hasPasskeys: boolean;
  mfaMethods: string[];
}

export function LoginForm({ returnTo, brand }: { returnTo: string | null; brand: BrandView }) {
  return (
    <Suspense>
      <LoginPageContent returnTo={returnTo} brand={brand} />
    </Suspense>
  );
}

function LoginPageContent({ returnTo, brand }: { returnTo: string | null; brand: BrandView }) {
  const { t, te } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [step, setStep] = useState<Step>("username");
  const [state, setState] = useState<LoginState>({
    loginToken: "",
    hasPasskeys: false,
    mfaMethods: [],
  });

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [mfaMethod, setMfaMethod] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [emailCode, setEmailCode] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [trustDevice, setTrustDevice] = useState(false);

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [emailMasked, setEmailMasked] = useState("");

  const [direction, setDirection] = useState<"forward" | "back">("forward");

  const usernameRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const mfaRef = useRef<HTMLInputElement>(null);

  // OAuth/OIDC params
  const appId = searchParams.get("app_id");
  const redirectUri = searchParams.get("redirect_uri");
  const stateParam = searchParams.get("state");

  useEffect(() => {
    usernameRef.current?.focus();
  }, []);

  useEffect(() => {
    if (step === "password") passwordRef.current?.focus();
    if (step === "mfa") mfaRef.current?.focus();
  }, [step]);

  const api = useCallback(
    async (url: string, body: Record<string, unknown>) => {
      setError("");
      setLoading(true);
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(te(data.error, "Ein Fehler ist aufgetreten"));
          return null;
        }
        return data;
      } catch {
        setError(t("Verbindungsfehler"));
        return null;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const goToStep = (next: Step) => {
    setDirection("forward");
    setStep(next);
  };

  // Redirect after successful login. `returnTo` was validated on the server (same origin only).
  const handleLoginRedirect = (serverRedirect: string) => {
    // If server forces a specific page (password change, MFA setup), honor it
    if (serverRedirect.startsWith("/settings/security")) {
      router.push(serverRedirect);
      return;
    }
    // Never navigate to script-like URLs, whatever the server sent
    if (/^\s*(javascript|data|vbscript|file|blob):/i.test(serverRedirect)) {
      router.push("/settings");
      return;
    }
    // App logins: the server hands back the app's callback URL (validated against its registered URIs)
    if (/^https?:\/\//i.test(serverRedirect) || /^[a-z][a-z0-9+.-]*:/i.test(serverRedirect)) {
      window.location.assign(serverRedirect);
      return;
    }
    // Same-origin return target (e.g. the OIDC authorize request that sent the user here)
    if (returnTo) {
      window.location.assign(returnTo);
      return;
    }
    router.push(serverRedirect);
  };

  const goBack = (prev: Step) => {
    setDirection("back");
    setError("");
    setStep(prev);
  };

  // ─── Step Handlers ──────────────────────────────────

  const handleUsername = async () => {
    if (!username.trim()) return;
    const data = await api("/api/auth/login", {
      step: "username",
      username: username.trim(),
      appId,
      redirectUri,
      state: stateParam,
    });
    if (!data) return;

    setState((s) => ({
      ...s,
      loginToken: data.loginToken,
      hasPasskeys: data.hasPasskeys,
    }));

    if (data.nextStep === "method_select") {
      goToStep("method_select");
    } else {
      goToStep("password");
    }
  };

  const handlePassword = async () => {
    if (!password) return;
    const data = await api("/api/auth/login", {
      step: "password",
      loginToken: state.loginToken,
      password,
    });
    if (!data) return;

    if (data.success) {
      handleLoginRedirect(data.redirect);
      return;
    }

    if (data.nextStep === "mfa") {
      setState((s) => ({ ...s, mfaMethods: data.mfaMethods }));
      if (data.mfaMethods.length === 1) {
        setMfaMethod(data.mfaMethods[0]);
      }
      goToStep("mfa");
      // Auto-send email code when email is the only MFA method
      if (data.mfaMethods.includes("email") && data.mfaMethods.length === 1) {
        sendEmailCode();
      }
    }
  };

  const handlePasskey = async () => {
    const optionsData = await api("/api/auth/passkey/authenticate/options", {
      loginToken: state.loginToken,
    });
    if (!optionsData) return;

    try {
      // Dynamic import for passkey browser API
      const { startAuthentication } = await import("@simplewebauthn/browser");
      const credential = await startAuthentication({ optionsJSON: optionsData });
      const verifyData = await api("/api/auth/passkey/authenticate/verify", {
        loginToken: state.loginToken,
        credential,
      });
      if (verifyData?.success) {
        handleLoginRedirect(verifyData.redirect);
      }
    } catch (err) {
      setError(t("Passkey-Authentifizierung abgebrochen oder fehlgeschlagen"));
    }
  };

  const sendEmailCode = async (type = "LOGIN_MFA") => {
    const data = await api("/api/auth/email-code/send", {
      loginToken: state.loginToken,
      type,
    });
    if (data) {
      setEmailSent(true);
      setEmailMasked(data.email);
    }
  };

  const handleMfa = async () => {
    if (!mfaCode) return;
    const data = await api("/api/auth/login", {
      step: "mfa",
      loginToken: state.loginToken,
      method: mfaMethod,
      code: mfaCode,
      trustDevice,
    });
    if (data?.success) {
      handleLoginRedirect(data.redirect);
    }
  };

  // ─── Render ─────────────────────────────────────────

  const animClass =
    direction === "forward" ? "animate-slide-in-right" : "animate-slide-in-right";

  return (
    <div className="min-h-screen flex flex-col">
      <div className="fixed top-4 right-4 z-10 flex items-center gap-2">
        <LanguageToggle />
        <ThemeToggle />
      </div>
      <div className="flex-1 flex flex-col items-center px-4 pt-[max(2rem,12vh)] pb-12">
        <div className="w-full max-w-sm">
          {/* Logo */}
          <div className="text-center mb-10">
            <div className="flex justify-center mb-3">
              <BrandLogo brand={brand} className="h-8" />
            </div>
            {brand.tagline && (
              <p className="text-xs text-muted uppercase tracking-[0.2em] font-bold">
                {brand.tagline}
              </p>
            )}
          </div>

          {/* Form Container */}
          <div className="bg-surface-light border border-border rounded-xl p-6 overflow-hidden">
            {loading && <div className="loading-bar mb-4 -mx-6 -mt-6 rounded-t-xl" />}

            {/* Step: Username */}
            {step === "username" && (
              <div key="username" className={animClass}>
                <h1 className="text-lg font-extrabold mb-1">{t("Anmelden")}</h1>
                <p className="text-sm text-muted mb-6">
                  {t("Gib deinen Benutzernamen ein um fortzufahren")}
                </p>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleUsername();
                  }}
                >
                  <Input
                    ref={usernameRef}
                    label={t("Benutzername")}
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder={t("benutzername")}
                    autoComplete="username"
                    autoFocus
                    error={error}
                  />
                  <Button type="submit" className="w-full mt-4" loading={loading}>
                    {t("Weiter")}
                  </Button>
                </form>
              </div>
            )}

            {/* Step: Method Select */}
            {step === "method_select" && (
              <div key="method_select" className={animClass}>
                <button
                  onClick={() => goBack("username")}
                  className="text-xs text-muted hover:text-foreground mb-4 flex items-center gap-1 transition-colors"
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M8 2L4 6l4 4" />
                  </svg>
                  {t("Zurück")}
                </button>
                <h1 className="text-lg font-extrabold mb-1">
                  {t("Hallo, {username}", { username })}
                </h1>
                <p className="text-sm text-muted mb-6">
                  {t("Wähle deine Anmeldemethode")}
                </p>
                {error && <p className="text-danger text-xs mb-4 font-semibold">{error}</p>}
                <div className="space-y-3">
                  <Button
                      variant="secondary"
                      className="w-full justify-start gap-3 py-4"
                      onClick={handlePasskey}
                      loading={loading}
                    >
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M2 18v3c0 .6.4 1 1 1h4v-3h3v-3h2l1.4-1.4a6.5 6.5 0 1 0-4-4Z" />
                        <circle cx="16.5" cy="7.5" r=".5" />
                      </svg>
                      {t("Passkey verwenden")}
                    </Button>
                  <Button
                    variant="secondary"
                    className="w-full justify-start gap-3 py-4"
                    onClick={() => goToStep("password")}
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                    {t("Passwort eingeben")}
                  </Button>
                </div>
              </div>
            )}

            {/* Step: Password */}
            {step === "password" && (
              <div key="password" className={animClass}>
                <button
                  onClick={() => goBack(state.hasPasskeys ? "method_select" : "username")}
                  className="text-xs text-muted hover:text-foreground mb-4 flex items-center gap-1 transition-colors"
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M8 2L4 6l4 4" />
                  </svg>
                  {t("Zurück")}
                </button>
                <h1 className="text-lg font-extrabold mb-1">{t("Passwort")}</h1>
                <p className="text-sm text-muted mb-6">
                  {t("Gib dein Passwort ein, {username}", { username })}
                </p>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    handlePassword();
                  }}
                >
                  <Input
                    ref={passwordRef}
                    label={t("Passwort")}
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    autoComplete="current-password"
                    autoFocus
                    error={error}
                  />
                  <Button type="submit" className="w-full mt-4" loading={loading}>
                    {t("Anmelden")}
                  </Button>
                </form>
              </div>
            )}

            {/* Step: MFA */}
            {step === "mfa" && (
              <div key="mfa" className={animClass}>
                <button
                  onClick={() => goBack("password")}
                  className="text-xs text-muted hover:text-foreground mb-4 flex items-center gap-1 transition-colors"
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M8 2L4 6l4 4" />
                  </svg>
                  {t("Zurück")}
                </button>
                <h1 className="text-lg font-extrabold mb-1">
                  {t("Zwei-Faktor-Authentifizierung")}
                </h1>
                <p className="text-sm text-muted mb-6">
                  {t("Wähle eine Methode und gib den Code ein")}
                </p>

                {/* MFA Method Selector */}
                {state.mfaMethods.length > 1 && (
                  <div className="flex gap-2 mb-4">
                    {state.mfaMethods.includes("totp") && (
                      <button
                        onClick={() => { setMfaMethod("totp"); setMfaCode(""); }}
                        className={`flex-1 text-xs font-bold py-2 px-3 rounded-lg border transition-colors ${
                          mfaMethod === "totp"
                            ? "border-foreground text-foreground bg-surface-lighter"
                            : "border-border text-muted hover:text-foreground"
                        }`}
                      >
                        {t("Authenticator")}
                      </button>
                    )}
                    {state.mfaMethods.includes("email") && (
                      <button
                        onClick={() => {
                          setMfaMethod("email");
                          setMfaCode("");
                          if (!emailSent) sendEmailCode();
                        }}
                        className={`flex-1 text-xs font-bold py-2 px-3 rounded-lg border transition-colors ${
                          mfaMethod === "email"
                            ? "border-foreground text-foreground bg-surface-lighter"
                            : "border-border text-muted hover:text-foreground"
                        }`}
                      >
                        {t("E-Mail-Code")}
                      </button>
                    )}
                  </div>
                )}

                {error && <p className="text-danger text-xs mb-4 font-semibold">{error}</p>}

                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleMfa();
                  }}
                >
                  {mfaMethod === "email" && emailSent && (
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-xs text-muted">
                        {t("Code gesendet an {emailMasked}", { emailMasked })}
                      </p>
                      <button
                        type="button"
                        onClick={() => sendEmailCode()}
                        className="text-xs text-muted hover:text-foreground transition-colors"
                        disabled={loading}
                      >
                        {t("Erneut senden")}
                      </button>
                    </div>
                  )}
                  <Input
                    ref={mfaRef}
                    label={
                      mfaMethod === "totp" ? "Authenticator-Code"
                        : mfaMethod === "recovery" ? "Wiederherstellungscode"
                        : "E-Mail-Code"
                    }
                    value={mfaCode}
                    onChange={(e) => {
                      if (mfaMethod === "recovery") {
                        setMfaCode(e.target.value);
                      } else {
                        setMfaCode(e.target.value.replace(/\D/g, "").slice(0, 6));
                      }
                    }}
                    placeholder={mfaMethod === "recovery" ? "XXXX-XXXX-XXXX" : "000000"}
                    inputMode={mfaMethod === "recovery" ? "text" : "numeric"}
                    maxLength={mfaMethod === "recovery" ? 50 : 6}
                    autoComplete={mfaMethod === "recovery" ? "off" : "one-time-code"}
                    autoFocus
                  />

                  <label className="flex items-center gap-2 mt-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={trustDevice}
                      onChange={(e) => setTrustDevice(e.target.checked)}
                      className="w-4 h-4 accent-foreground"
                    />
                    <span className="text-xs text-muted">
                      {t("Dieses Gerät 30 Tage merken")}
                    </span>
                  </label>

                  <Button type="submit" className="w-full mt-4" loading={loading}>
                    {t("Bestätigen")}
                  </Button>

                  {mfaMethod === "recovery" ? (
                    <button
                      type="button"
                      onClick={() => {
                        setMfaMethod(state.mfaMethods.length === 1 ? state.mfaMethods[0] : "");
                        setMfaCode("");
                      }}
                      className="text-xs text-muted hover:text-foreground transition-colors mt-3 block mx-auto"
                    >
                      {t("Zurück zur Code-Eingabe")}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => { setMfaMethod("recovery"); setMfaCode(""); }}
                      className="text-xs text-muted hover:text-foreground transition-colors mt-3 block mx-auto"
                    >
                      {t("Wiederherstellungscode verwenden")}
                    </button>
                  )}
                </form>
              </div>
            )}
          </div>
        </div>
      </div>
      <Footer brand={brand} />
    </div>
  );
}
