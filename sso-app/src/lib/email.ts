import { renderEmailTemplate, readableOn, type MailBrand } from "./email-templates";
import { deliverMail } from "./mail";
import { getAssetInfos, getSiteSettings, absoluteUrl } from "./site-settings";
import { getAppUrl } from "./config";
import { N_, dateLocale, isLocale, makeT, type Locale, type TFunction } from "./i18n/core";
import { getLocale, messagesFor } from "./i18n/server";

/** Branding for the mail layout: name, colors, footer links and the absolute URL of the PNG logo. */
export async function getMailBrand(): Promise<MailBrand> {
  const [site, assets] = await Promise.all([getSiteSettings(), getAssetInfos()]);
  const hasLogo = !!(assets.logo || assets.logoLight);
  const onLight = readableOn(site.mailHeaderColor) !== "#ffffff";
  const version = Math.max(assets.logo?.updatedAt ?? 0, assets.logoLight?.updatedAt ?? 0);
  return {
    siteName: site.siteName,
    tagline: site.tagline,
    orgName: site.orgName,
    logoUrl: hasLogo ? absoluteUrl(`/api/branding/mail-logo?bg=${onLight ? "light" : "dark"}&v=${version}`) : null,
    headerColor: site.mailHeaderColor,
    headerTextColor: readableOn(site.mailHeaderColor),
    footerLinks: site.footerLinks.map((l) => ({ label: l.label, url: l.url.startsWith("/") ? absoluteUrl(l.url) : l.url })),
  };
}

const METHOD_LABELS: Record<string, string> = {
  PASSKEY: N_("Passkey"),
  PASSWORD_TOTP: N_("Passwort + Authenticator-App"),
  PASSWORD_EMAIL: N_("Passwort + E-Mail-Code"),
  PASSWORD_IP_WHITELIST: N_("Passwort (vertraute IP)"),
  PASSWORD_TRUSTED_DEVICE: N_("Passwort (vertrauenswürdiges Gerät)"),
  RECOVERY_CODE: N_("Wiederherstellungscode"),
};

/** "Chrome auf Windows" instead of the raw user agent string. */
function describeDevice(userAgent: string, t: TFunction): string {
  const browser =
    /Edg\//.test(userAgent) ? "Edge"
    : /OPR\/|Opera/.test(userAgent) ? "Opera"
    : /Firefox\//.test(userAgent) ? "Firefox"
    : /Chrome\/|CriOS/.test(userAgent) ? "Chrome"
    : /Safari\//.test(userAgent) ? "Safari"
    : null;
  const os =
    /Windows/.test(userAgent) ? "Windows"
    : /Android/.test(userAgent) ? "Android"
    : /iPhone|iPad|iPod/.test(userAgent) ? "iOS"
    : /Mac OS X|Macintosh/.test(userAgent) ? "macOS"
    : /Linux/.test(userAgent) ? "Linux"
    : null;
  if (browser && os) return t("{browser} auf {os}", { browser, os });
  return browser ?? os ?? t("Unbekanntes Gerät");
}

/**
 * Language of a mail: the recipient's own setting, else the language of the current request (the person who
 * triggered it, e.g. the one signing in or the admin creating the account), else English.
 */
async function mailI18n(recipientLocale?: string | null): Promise<{ t: TFunction; locale: Locale }> {
  const locale: Locale = isLocale(recipientLocale) ? recipientLocale : await getLocale();
  return { t: makeT(locale, messagesFor(locale)).t, locale };
}

// ─── Email Senders ────────────────────────────────────

export async function sendVerificationCodeEmail(to: string, username: string, code: string, recipientLocale?: string | null): Promise<boolean> {
  const [brand, { t, locale }] = await Promise.all([getMailBrand(), mailI18n(recipientLocale)]);
  return deliverMail({
    to,
    subject: t("{code} – Dein {site} Bestätigungscode", { code, site: brand.siteName }),
    html: renderEmailTemplate("verification-code", { username, code, expiresMinutes: 10 }, brand, t, locale),
    text: t("Hallo {username},\n\ndein Bestätigungscode lautet: {code}\n\nEr ist 10 Minuten gültig. Teile ihn mit niemandem.\nDu hast dich nicht angemeldet? Dann ignoriere diese E-Mail und ändere dein Passwort.", { username, code }),
  });
}

export async function sendEmailChangeCodeEmail(to: string, username: string, code: string, recipientLocale?: string | null): Promise<boolean> {
  const [brand, { t, locale }] = await Promise.all([getMailBrand(), mailI18n(recipientLocale)]);
  return deliverMail({
    to,
    subject: t("{code} – Neue E-Mail-Adresse bestätigen", { code }),
    html: renderEmailTemplate("email-change", { username, code, expiresMinutes: 10 }, brand, t, locale),
    text: t("Hallo {username},\n\nfür dein {site} Konto wurde diese Adresse als neue E-Mail-Adresse angegeben. Bestätigungscode: {code}\n\nEr ist 10 Minuten gültig. Du hast das nicht angefordert? Dann ignoriere diese E-Mail.", { username, site: brand.siteName, code }),
  });
}

export async function sendLoginNotificationEmail(
  to: string,
  username: string,
  ipAddress: string,
  userAgent: string,
  timestamp: Date,
  method?: string,
  recipientLocale?: string | null
): Promise<boolean> {
  const [brand, site, { t, locale }] = await Promise.all([getMailBrand(), getSiteSettings(), mailI18n(recipientLocale)]);
  const device = describeDevice(userAgent, t);
  const methodLabel = method ? (METHOD_LABELS[method] ? t(METHOD_LABELS[method]) : method) : t("Unbekannt");
  const when = timestamp.toLocaleString(dateLocale(locale), {
    timeZone: site.timeZone,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
  const settingsUrl = `${getAppUrl()}/settings`;
  return deliverMail({
    to,
    subject: t("Neue Anmeldung bei {site}", { site: brand.siteName }),
    html: renderEmailTemplate("login-notification", { username, ipAddress, device, method: methodLabel, timestamp: when, settingsUrl }, brand, t, locale),
    text: [
      t("Hallo {username},", { username }),
      "",
      t("es wurde eine neue Anmeldung bei deinem {site} Konto registriert:", { site: brand.siteName }),
      `${t("IP-Adresse")}: ${ipAddress}`,
      `${t("Gerät")}: ${device}`,
      `${t("Methode")}: ${methodLabel}`,
      `${t("Zeitpunkt")}: ${when}`,
      "",
      t("Falls du das nicht warst, ändere sofort dein Passwort und überprüfe deine Sicherheitseinstellungen:"),
      settingsUrl,
    ].join("\n"),
  });
}

export async function sendWelcomeEmail(to: string, username: string, initialPassword: string, recipientLocale?: string | null): Promise<boolean> {
  const [brand, { t, locale }] = await Promise.all([getMailBrand(), mailI18n(recipientLocale)]);
  const ssoUrl = getAppUrl();
  return deliverMail({
    to,
    subject: t("Willkommen bei {site}", { site: brand.siteName }),
    html: renderEmailTemplate("welcome", { username, initialPassword, ssoUrl }, brand, t, locale),
    text: t("Willkommen bei {site}, {username}!\n\nDein Konto wurde erstellt.\nBenutzername: {username}\nInitialpasswort: {password}\n\nMelde dich hier an: {url}\nBitte ändere dein Passwort nach der ersten Anmeldung und lösche diese E-Mail anschließend.", { site: brand.siteName, username, password: initialPassword, url: ssoUrl }),
  });
}

export async function sendPasswordResetEmail(to: string, username: string, code: string, recipientLocale?: string | null): Promise<boolean> {
  const [brand, { t, locale }] = await Promise.all([getMailBrand(), mailI18n(recipientLocale)]);
  return deliverMail({
    to,
    subject: t("{code} – Passwort zurücksetzen", { code }),
    html: renderEmailTemplate("password-reset", { username, code, expiresMinutes: 10 }, brand, t, locale),
    text: t("Hallo {username},\n\ndein Code zum Zurücksetzen des Passworts lautet: {code}\n\nEr ist 10 Minuten gültig. Teile ihn mit niemandem.\nDu hast keinen Reset angefordert? Dann ignoriere diese E-Mail.", { username, code }),
  });
}

/** Builds the test mail the admin triggers from the mail settings (in the admin's language). */
export async function buildTestMail(to: string) {
  const [brand, { t, locale }] = await Promise.all([getMailBrand(), mailI18n()]);
  return {
    to,
    subject: t("Testmail von {site}", { site: brand.siteName }),
    html: renderEmailTemplate("test", {}, brand, t, locale),
    text: t("Der Mailversand von {site} funktioniert.", { site: brand.siteName }),
  };
}
