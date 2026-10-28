/** Email-safe HTML templates using table-based layout for maximum compatibility. */

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const MONO = "'SFMono-Regular', Consolas, 'Courier New', monospace";

/** Escape user-controlled values (username, user agent, ...) before putting them into HTML. */
export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface MailBrand {
  siteName: string;
  tagline: string;
  orgName: string;
  /** Absolute PNG URL of the logo, or null (then the site name is shown as text). */
  logoUrl: string | null;
  headerColor: string;
  /** Readable text color on headerColor. */
  headerTextColor: string;
  footerLinks: { label: string; url: string }[];
}

/** Black or white text, whichever reads better on the given #rrggbb background. */
export function readableOn(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? "#111111" : "#ffffff";
}

/** Only http(s) links may end up in href attributes. */
function safeUrl(url: unknown): string {
  const s = String(url ?? "");
  return /^https?:\/\//i.test(s) ? escapeHtml(s) : "#";
}

// ─── Building blocks ──────────────────────────────────

function heading(text: string): string {
  return `<h1 class="text-dark" style="margin: 0 0 8px; font-size: 18px; line-height: 26px; font-weight: 700; color: #111111; font-family: ${FONT};">${escapeHtml(text)}</h1>`;
}

/** `html` must already be escaped / trusted markup. */
function paragraph(html: string, opts: { muted?: boolean; center?: boolean; mb?: number; mt?: number } = {}): string {
  const cls = opts.muted ? "text-muted" : "text-body";
  const color = opts.muted ? "#767676" : "#555555";
  return `<p class="${cls}" style="margin: ${opts.mt ?? 0}px 0 ${opts.mb ?? 16}px; font-size: ${opts.muted ? 13 : 14}px; line-height: ${opts.muted ? 20 : 22}px; color: ${color};${opts.center ? " text-align: center;" : ""} font-family: ${FONT};">${html}</p>`;
}

function codeBlock(code: unknown): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr><td align="center" style="padding: 8px 0 20px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" class="code-bg" style="background-color: #f8f8f8; border: 1px solid #e5e5e5; border-radius: 8px;">
<tr><td style="padding: 16px 32px;">
<span class="text-code" style="font-family: ${MONO}; font-size: 32px; line-height: 40px; font-weight: 700; letter-spacing: 6px; color: #000000;">${escapeHtml(code)}</span>
</td></tr>
</table>
</td></tr>
</table>`;
}

function infoTable(rows: [label: string, value: unknown, mono?: boolean][]): string {
  const body = rows
    .map(
      ([label, value, mono]) => `<tr>
<th scope="row" class="text-label" align="left" style="padding: 4px 12px 4px 0; font-size: 13px; line-height: 20px; color: #6b6b6b; font-weight: 400; width: 120px; vertical-align: top; font-family: ${FONT};">${escapeHtml(label)}</th>
<td class="text-value" style="padding: 4px 0; font-size: 13px; line-height: 20px; color: #333333; font-weight: 600; word-break: break-word;${mono ? ` font-family: ${MONO};` : ` font-family: ${FONT};`}">${escapeHtml(value)}</td>
</tr>`
    )
    .join("\n");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="info-bg" style="background-color: #f8f8f8; border-radius: 6px;">
<tr><td style="padding: 16px 20px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
${body}
</table>
</td></tr>
</table>`;
}

function button(href: string, label: string, fallbackText: string): string {
  const url = safeUrl(href);
  const text = escapeHtml(label);
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 24px auto 0;">
<tr><td class="btn-bg" align="center" style="background-color: #000000; border-radius: 6px;">
<!--[if mso]>
<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="${url}" style="height:44px;v-text-anchor:middle;width:200px;" arcsize="14%" fill="t" stroke="f">
<v:fill type="tile" color="#000000"/>
<center style="color:#ffffff;font-family:'Segoe UI',sans-serif;font-size:14px;font-weight:600;">${text}</center>
</v:roundrect>
<![endif]-->
<!--[if !mso]><!-->
<a class="btn-text" href="${url}" target="_blank" style="display: inline-block; padding: 12px 32px; font-size: 14px; font-weight: 600; color: #ffffff; text-decoration: none; font-family: ${FONT};">${text}</a>
<!--<![endif]-->
</td></tr>
</table>
<p class="text-muted" style="margin: 12px 0 0; font-size: 12px; line-height: 18px; color: #767676; text-align: center; word-break: break-all; font-family: ${FONT};">
  ${escapeHtml(fallbackText)}<br><a href="${url}" style="color: #767676;">${url}</a>
</p>`;
}

// ─── Layout ───────────────────────────────────────────

function baseTemplate(content: string, preheader: string, brand: MailBrand, t: T, locale: string): string {
  const year = new Date().getFullYear();
  return `<!DOCTYPE html>
<html lang="${locale}" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no, date=no, address=no, email=no">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<title>${escapeHtml(brand.siteName)}</title>
<!--[if mso]>
<noscript><xml><o:OfficeDocumentSettings><o:AllowPNG/><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
<style>
  body, table, td, th, p, a, span, div, h1 { font-family: 'Segoe UI', Arial, sans-serif !important; }
</style>
<![endif]-->
<style>
  :root { color-scheme: light only; }
  body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
  table, td { mso-table-lspace: 0; mso-table-rspace: 0; }
  body { margin: 0 !important; padding: 0 !important; width: 100% !important; -webkit-font-smoothing: antialiased; }
  img { border: 0; height: auto; line-height: 100%; outline: none; text-decoration: none; -ms-interpolation-mode: bicubic; }
  @media only screen and (max-width: 520px) {
    .px { padding-left: 24px !important; padding-right: 24px !important; }
  }
  [data-ogsc] body, [data-ogsb] body { background-color: #f2f2f2 !important; }
  [data-ogsc] .email-container, [data-ogsb] .email-container { background-color: #ffffff !important; }
  [data-ogsc] .header-bg, [data-ogsb] .header-bg { background-color: ${brand.headerColor} !important; }
  [data-ogsc] .info-bg, [data-ogsb] .info-bg { background-color: #f8f8f8 !important; }
  [data-ogsc] .code-bg, [data-ogsb] .code-bg { background-color: #f8f8f8 !important; }
  [data-ogsc] .text-dark, [data-ogsb] .text-dark { color: #111111 !important; }
  [data-ogsc] .text-body, [data-ogsb] .text-body { color: #555555 !important; }
  [data-ogsc] .text-muted, [data-ogsb] .text-muted { color: #767676 !important; }
  [data-ogsc] .text-label, [data-ogsb] .text-label { color: #6b6b6b !important; }
  [data-ogsc] .text-value, [data-ogsb] .text-value { color: #333333 !important; }
  [data-ogsc] .text-code, [data-ogsb] .text-code { color: #000000 !important; }
  [data-ogsc] .btn-bg, [data-ogsb] .btn-bg { background-color: #000000 !important; }
  [data-ogsc] .btn-text, [data-ogsb] .btn-text { color: #ffffff !important; }
  u + .body { background-color: #f2f2f2 !important; }
</style>
</head>
<body class="body" style="margin: 0; padding: 0; background-color: #f2f2f2; font-family: ${FONT}; -webkit-font-smoothing: antialiased;">

<!-- Preheader (Vorschautext im Posteingang) -->
<div style="display: none; max-height: 0; overflow: hidden; mso-hide: all; font-size: 1px; line-height: 1px; color: #f2f2f2; opacity: 0;">
${escapeHtml(preheader)}&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;
</div>

<div role="article" aria-roledescription="email" lang="${locale}">
<!--[if mso]>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f2f2f2;"><tr><td align="center">
<table role="presentation" width="480" cellpadding="0" cellspacing="0" border="0"><tr><td>
<![endif]-->

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f2f2f2;">
<tr><td align="center" style="padding: 40px 16px;">

<!-- Container -->
<table role="presentation" class="email-container" width="480" cellpadding="0" cellspacing="0" border="0" style="max-width: 480px; width: 100%; background-color: #ffffff; border-radius: 8px; overflow: hidden;">

<!-- Logo Header -->
<tr>
<td class="header-bg px" align="center" bgcolor="${brand.headerColor}" style="padding: 32px 40px 28px; background-color: ${brand.headerColor};">
${
  brand.logoUrl
    ? `<img src="${safeUrl(brand.logoUrl)}" alt="${escapeHtml(brand.siteName)}" width="140" style="display: block; width: 140px; height: auto; margin: 0 auto;">`
    : `<p style="margin: 0; font-size: 22px; line-height: 28px; font-weight: 800; color: ${brand.headerTextColor}; text-align: center; font-family: ${FONT};">${escapeHtml(brand.siteName)}</p>`
}
${
  brand.tagline
    ? `<p style="margin: 12px 0 0; font-size: 11px; line-height: 14px; font-weight: 700; letter-spacing: 3px; text-transform: uppercase; color: ${brand.headerTextColor}; opacity: 0.7; text-align: center; font-family: ${FONT};">${escapeHtml(brand.tagline)}</p>`
    : ""
}
</td>
</tr>

<!-- Content -->
<tr>
<td class="px" style="padding: 32px 40px 24px; background-color: #ffffff;">
${content}
</td>
</tr>

<!-- Footer -->
<tr>
<td class="px" style="padding: 20px 40px 24px; border-top: 1px solid #eeeeee; background-color: #ffffff;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr><td class="text-muted" style="font-size: 11px; line-height: 18px; color: #767676; text-align: center; font-family: ${FONT};">
${t("Diese E-Mail wurde automatisch von {site} versendet. Bitte antworte nicht darauf.", { site: escapeHtml(brand.siteName) })}<br>
${brand.orgName ? `&copy; ${year} ${escapeHtml(brand.orgName)}<br>\n` : ""}${brand.footerLinks
  .slice(0, 6)
  .filter((l) => /^https?:\/\//i.test(l.url))
  .map((l) => `<a href="${safeUrl(l.url)}" style="color: #767676; text-decoration: underline;">${escapeHtml(l.label)}</a>`)
  .join(" &middot;\n")}
</td></tr>
</table>
</td>
</tr>

</table>
<!-- /Container -->

</td></tr>
</table>

<!--[if mso]>
</td></tr></table></td></tr></table>
<![endif]-->
</div>

</body>
</html>`;
}

// ─── Templates ────────────────────────────────────────

type Data = Record<string, unknown>;
type T = (key: string, params?: Record<string, string | number>) => string;

interface Template {
  preheader: (data: Data, brand: MailBrand, t: T) => string;
  body: (data: Data, brand: MailBrand, t: T) => string;
}

/** Translated markup: the placeholders must already be escaped HTML (the translations themselves are ours). */
const hello = (d: Data, t: T) => t("Hallo {name}", { name: `<strong>${escapeHtml(d.username)}</strong>` });
const e = escapeHtml;

const templates: Record<string, Template> = {
  "verification-code": {
    preheader: (d, _b, t) => t("Dein Bestätigungscode: {code}. Gültig für {minutes} Minuten.", { code: String(d.code), minutes: String(d.expiresMinutes) }),
    body: (d, _b, t) =>
      heading(t("Bestätigungscode")) +
      paragraph(t("{hello}, verwende diesen Code, um deine Anmeldung abzuschließen:", { hello: hello(d, t) }), { mb: 8 }) +
      codeBlock(d.code) +
      paragraph(t("Gültig für {minutes} Minuten. Teile diesen Code mit niemandem. Wir fragen dich nie per E-Mail oder Telefon danach.", { minutes: e(d.expiresMinutes) }), { muted: true, center: true, mb: 8 }) +
      paragraph(t("Du hast dich nicht angemeldet? Dann ignoriere diese E-Mail und ändere zur Sicherheit dein Passwort."), { muted: true, center: true, mb: 0 }),
  },

  "email-change": {
    preheader: (d, _b, t) => t("Dein Code zur Bestätigung der neuen E-Mail-Adresse: {code}. Gültig für {minutes} Minuten.", { code: String(d.code), minutes: String(d.expiresMinutes) }),
    body: (d, b, t) =>
      heading(t("Neue E-Mail-Adresse bestätigen")) +
      paragraph(t("{hello}, für dein {site} Konto wurde diese Adresse als neue E-Mail-Adresse angegeben. Gib diesen Code ein, um sie zu bestätigen:", { hello: hello(d, t), site: e(b.siteName) }), { mb: 8 }) +
      codeBlock(d.code) +
      paragraph(t("Gültig für {minutes} Minuten. Teile diesen Code mit niemandem.", { minutes: e(d.expiresMinutes) }), { muted: true, center: true, mb: 8 }) +
      paragraph(t("Du hast das nicht angefordert? Dann ignoriere diese E-Mail, es wird nichts geändert."), { muted: true, center: true, mb: 0 }),
  },

  "login-notification": {
    preheader: (_d, b, t) => t("Neue Anmeldung bei deinem {site} Konto. Falls du das nicht warst, ändere sofort dein Passwort.", { site: b.siteName }),
    body: (d, b, t) =>
      heading(t("Neue Anmeldung erkannt")) +
      paragraph(t("{hello}, es wurde eine neue Anmeldung bei deinem {site} Konto registriert:", { hello: hello(d, t), site: e(b.siteName) })) +
      infoTable([
        [t("IP-Adresse"), d.ipAddress],
        [t("Gerät"), d.device],
        [t("Methode"), d.method],
        [t("Zeitpunkt"), d.timestamp],
      ]) +
      paragraph(t("Falls du das nicht warst, ändere sofort dein Passwort und überprüfe deine Sicherheitseinstellungen."), { muted: true, mt: 16, mb: 0 }) +
      (d.settingsUrl ? button(String(d.settingsUrl), t("Sicherheitseinstellungen"), t("Button funktioniert nicht? Öffne diesen Link:")) : ""),
  },

  "guest-access": {
    preheader: (d, _b, t) => t("Gast-Zugang für {app} freigegeben. Falls du das nicht warst, beende ihn sofort.", { app: String(d.appName) }),
    body: (d, _b, t) =>
      heading(t("Gast-Zugang freigegeben")) +
      paragraph(t("{hello}, du hast einem Gast Zugriff auf eine App gegeben:", { hello: hello(d, t) })) +
      infoTable([
        [t("App"), d.appName],
        [t("Gültig bis"), d.until],
        [t("Gerät"), d.device],
        [t("IP-Adresse"), d.ipAddress],
        ...(d.location ? ([[t("Standort (ca.)"), d.location]] as [string, string][]) : []),
      ]) +
      paragraph(t("Der Gast hat nur Zugriff auf diese App, nicht auf dein SSO-Konto. Falls du das nicht warst, beende den Zugang sofort unter Sitzungen."), { muted: true, mt: 16, mb: 0 }) +
      (d.sessionsUrl ? button(String(d.sessionsUrl), t("Sitzungen öffnen"), t("Button funktioniert nicht? Öffne diesen Link:")) : ""),
  },

  "welcome": {
    preheader: (_d, b, t) => t("Dein {site} Konto wurde erstellt. Melde dich an und ändere dein Passwort.", { site: b.siteName }),
    body: (d, b, t) =>
      heading(t("Willkommen bei {site}", { site: b.siteName })) +
      paragraph(t("{hello}, dein SSO-Konto wurde erstellt. Melde dich an und ändere dein Passwort:", { hello: hello(d, t) })) +
      infoTable([
        [t("Benutzername"), d.username],
        [t("Initialpasswort"), d.initialPassword, true],
      ]) +
      button(String(d.ssoUrl), t("Jetzt anmelden"), t("Button funktioniert nicht? Öffne diesen Link:")) +
      paragraph(t("Bitte ändere dein Passwort nach der ersten Anmeldung und lösche diese E-Mail anschließend."), { muted: true, center: true, mt: 16, mb: 0 }),
  },

  "test": {
    preheader: (_d, b, t) => t("Testmail von {site}: Der Mailversand funktioniert.", { site: b.siteName }),
    body: (_d, b, t) =>
      heading(t("Der Mailversand funktioniert")) +
      paragraph(t("Diese Testmail wurde von {site} versendet. So sehen E-Mails mit deinem Logo und deinen Footer-Links aus.", { site: e(b.siteName) }), { mb: 8 }) +
      paragraph(t("Du musst nichts weiter tun."), { muted: true, mb: 0 }),
  },

  "password-reset": {
    preheader: (d, _b, t) => t("Dein Code zum Zurücksetzen des Passworts: {code}. Gültig für {minutes} Minuten.", { code: String(d.code), minutes: String(d.expiresMinutes) }),
    body: (d, _b, t) =>
      heading(t("Passwort zurücksetzen")) +
      paragraph(t("{hello}, verwende diesen Code, um dein Passwort zurückzusetzen:", { hello: hello(d, t) }), { mb: 8 }) +
      codeBlock(d.code) +
      paragraph(t("Gültig für {minutes} Minuten. Teile diesen Code mit niemandem.", { minutes: e(d.expiresMinutes) }), { muted: true, center: true, mb: 8 }) +
      paragraph(t("Du hast keinen Reset angefordert? Dann ignoriere diese E-Mail, dein Passwort bleibt unverändert."), { muted: true, center: true, mb: 0 }),
  },
};

/** Render an email template by name. */
export function renderEmailTemplate(name: string, data: Data, brand: MailBrand, t: T, locale: string): string {
  const template = templates[name];
  if (!template) throw new Error(`Unknown email template: ${name}`);
  return baseTemplate(template.body(data, brand, t), template.preheader(data, brand, t), brand, t, locale);
}
