import { renderEmailTemplate, readableOn, type MailBrand } from "./email-templates";
import { deliverMail } from "./mail";
import { getAssetInfos, getSiteSettings, absoluteUrl } from "./site-settings";
import { getAppUrl } from "./config";
import { describeDevice } from "./device-info";
import { formatEmailCode } from "./crypto";
import { locateIp } from "./geoip";
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
  PASSWORD_GUEST_ACCOUNT: N_("Passwort"),
  PASSWORD_TRUSTED_DEVICE: N_("Passwort (vertrauenswürdiges Gerät)"),
  RECOVERY_CODE: N_("Wiederherstellungscode"),
};

/**
 * Language of a mail: the recipient's own setting, else the language of the current request (the person who
 * triggered it, e.g. the one signing in or the admin creating the account), else English.
 */
async function mailI18n(recipientLocale?: string | null): Promise<{ t: TFunction; locale: Locale }> {
  const locale: Locale = isLocale(recipientLocale) ? recipientLocale : await getLocale();
  return { t: makeT(locale, messagesFor(locale)).t, locale };
}

// ─── Email Senders ────────────────────────────────────

export async function sendVerificationCodeEmail(to: string, username: string, rawCode: string, recipientLocale?: string | null): Promise<boolean> {
  const code = formatEmailCode(rawCode);
  const [brand, { t, locale }] = await Promise.all([getMailBrand(), mailI18n(recipientLocale)]);
  return deliverMail({
    to,
    subject: t("{code} – Dein {site} Bestätigungscode", { code, site: brand.siteName }),
    html: renderEmailTemplate("verification-code", { username, code, expiresMinutes: 10 }, brand, t, locale),
    text: t("Hallo {username},\n\ndein Bestätigungscode lautet: {code}\n\nEr ist 10 Minuten gültig. Teile ihn mit niemandem.\nDu hast dich nicht angemeldet? Dann ignoriere diese E-Mail und ändere dein Passwort.", { username, code }),
  });
}

export async function sendEmailChangeCodeEmail(to: string, username: string, rawCode: string, recipientLocale?: string | null): Promise<boolean> {
  const code = formatEmailCode(rawCode);
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
  const device = t(describeDevice(userAgent));
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

/** Tells the account owner that a guest was given access to an app (shown with the guest device's place, if known). */
export async function sendGuestAccessEmail(
  to: string,
  username: string,
  appName: string,
  until: Date,
  ipAddress: string,
  userAgent: string | null | undefined,
  recipientLocale?: string | null
): Promise<boolean> {
  const [brand, site, { t, locale }] = await Promise.all([getMailBrand(), getSiteSettings(), mailI18n(recipientLocale)]);
  const device = t(describeDevice(userAgent));
  const location = await locateIp(ipAddress, locale);
  const untilText = until.toLocaleString(dateLocale(locale), {
    timeZone: site.timeZone,
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
  const sessionsUrl = `${getAppUrl()}/settings/sessions`;
  return deliverMail({
    to,
    subject: t("Gast-Zugang für {app} freigegeben", { app: appName }),
    html: renderEmailTemplate("guest-access", { username, appName, until: untilText, device, ipAddress, location, sessionsUrl }, brand, t, locale),
    text: [
      t("Hallo {username},", { username }),
      "",
      t("du hast einem Gast Zugriff auf eine App gegeben:"),
      `${t("App")}: ${appName}`,
      `${t("Gültig bis")}: ${untilText}`,
      `${t("Gerät")}: ${device}`,
      `${t("IP-Adresse")}: ${ipAddress}`,
      ...(location ? [`${t("Standort (ca.)")}: ${location}`] : []),
      "",
      t("Der Gast hat nur Zugriff auf diese App, nicht auf dein SSO-Konto. Falls du das nicht warst, beende den Zugang sofort:"),
      sessionsUrl,
    ].join("\n"),
  });
}

export async function sendWelcomeEmail(
  to: string,
  username: string,
  inviteUrl: string,
  inviteExpires: Date,
  accountUntil: Date | null,
  recipientLocale?: string | null
): Promise<boolean> {
  const [brand, site, { t, locale }] = await Promise.all([getMailBrand(), getSiteSettings(), mailI18n(recipientLocale)]);
  const fmt = (d: Date) =>
    d.toLocaleString(dateLocale(locale), { timeZone: site.timeZone, day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" });
  const inviteUntil = fmt(inviteExpires);
  const guestUntil = accountUntil ? fmt(accountUntil) : null;
  return deliverMail({
    to,
    subject: t("Willkommen bei {site}", { site: brand.siteName }),
    html: renderEmailTemplate("welcome", { username, inviteUrl, inviteUntil, guestUntil }, brand, t, locale),
    text: [
      t("Willkommen bei {site}, {username}!", { site: brand.siteName, username }),
      "",
      t("Dein SSO-Konto wurde erstellt. Lege hier dein Passwort fest:"),
      inviteUrl,
      "",
      t("Der Link ist bis {until} gültig und funktioniert nur einmal. Teile ihn mit niemandem.", { until: inviteUntil }),
      ...(guestUntil ? ["", t("Dein Gastzugang gilt bis {until}. Danach wird das Konto gelöscht.", { until: guestUntil })] : []),
    ].join("\n"),
  });
}

export async function sendPasswordResetEmail(to: string, username: string, rawCode: string, recipientLocale?: string | null): Promise<boolean> {
  const code = formatEmailCode(rawCode);
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
