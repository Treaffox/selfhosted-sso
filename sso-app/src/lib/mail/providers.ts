import { createTransport } from "nodemailer";
import {
  AUTOMATED_HEADERS,
  type FieldDef,
  type MailMessage,
  type MailSender,
  type ProviderConfig,
  type ProviderDef,
} from "./types";
import { N_ } from "../i18n/core";

/** Connections that hang instead of failing fast must not block the login screen for nodemailer's 2 min default. */
const TIMEOUT_MS = 10_000;

// ─── SMTP ─────────────────────────────────────────────

interface SmtpOptions {
  host: string;
  port: number;
  security: "starttls" | "ssl" | "none";
  user?: string;
  pass?: string;
  allowInvalidCert?: boolean;
}

async function sendSmtp(o: SmtpOptions, from: MailSender, m: MailMessage): Promise<void> {
  const transport = createTransport({
    host: o.host,
    port: o.port,
    secure: o.security === "ssl",
    requireTLS: o.security === "starttls",
    ignoreTLS: o.security === "none",
    auth: o.user ? { user: o.user, pass: o.pass ?? "" } : undefined,
    // Login codes and SMTP credentials travel over this connection: verify the certificate unless the admin opts out.
    tls: { rejectUnauthorized: !o.allowInvalidCert },
    connectionTimeout: TIMEOUT_MS,
    greetingTimeout: TIMEOUT_MS,
    socketTimeout: TIMEOUT_MS,
  });
  try {
    await transport.sendMail({
      from: { name: from.name, address: from.address },
      replyTo: from.replyTo || undefined,
      to: m.to,
      subject: m.subject,
      html: m.html,
      text: m.text,
      headers: AUTOMATED_HEADERS,
    });
  } finally {
    transport.close();
  }
}

const userField = (over: Partial<FieldDef> = {}): FieldDef => ({ key: "user", label: N_("Benutzername"), type: "text", ...over });
const passField = (over: Partial<FieldDef> = {}): FieldDef => ({ key: "pass", label: N_("Passwort"), type: "password", ...over });

const genericSmtp: ProviderDef = {
  id: "smtp",
  label: N_("Beliebiger SMTP-Server"),
  group: "smtp",
  summary:
    N_("Für Postfix, Exchange, den Mailserver deines Hosters oder ein Relay im internen Netz. Die Zugangsdaten stehen in der Dokumentation deines Mailservers oder Hosters."),
  fields: [
    { key: "host", label: N_("Server"), type: "text", required: true, placeholder: N_("mail.example.com") },
    { key: "port", label: N_("Port"), type: "number", required: true, default: "587", help: N_("587 (STARTTLS), 465 (SSL/TLS) oder 25 (meist unverschlüsselt)") },
    {
      key: "security",
      label: N_("Verschlüsselung"),
      type: "select",
      required: true,
      default: "starttls",
      options: [
        { value: "starttls", label: N_("STARTTLS (Port 587)") },
        { value: "ssl", label: N_("SSL/TLS (Port 465)") },
        { value: "none", label: N_("Keine (nur für interne Relays)") },
      ],
    },
    userField({ label: N_("Benutzername"), help: N_("Leer lassen, wenn der Server ohne Anmeldung annimmt (z. B. internes Relay).") }),
    passField(),
    { key: "allowInvalidCert", label: N_("Zertifikatsfehler ignorieren"), type: "checkbox", help: N_("Nur für interne Server mit selbst signiertem Zertifikat. Die Verbindung ist dann nicht mehr gegen Mitlesen geschützt.") },
  ],
  send: (c, from, m) =>
    sendSmtp(
      {
        host: c.host,
        port: parseInt(c.port || "587", 10),
        security: (c.security as SmtpOptions["security"]) || "starttls",
        user: c.user || undefined,
        pass: c.pass || undefined,
        allowInvalidCert: c.allowInvalidCert === "true",
      },
      from,
      m
    ),
};

/** An SMTP service with fixed host/port: the admin only enters the credentials. */
function smtpPreset(p: {
  id: string;
  label: string;
  summary: string;
  docsUrl?: string;
  host: string | ((c: ProviderConfig) => string);
  port: number;
  security: "starttls" | "ssl";
  extra?: FieldDef[];
  user: FieldDef | { fixed: string };
  pass: FieldDef;
}): ProviderDef {
  const fixedUser = "fixed" in p.user ? p.user.fixed : null;
  return {
    id: p.id,
    label: p.label,
    group: "smtp-service",
    summary: p.summary,
    docsUrl: p.docsUrl,
    fields: [...(p.extra ?? []), ...(fixedUser === null ? [p.user as FieldDef] : []), p.pass],
    send: (c, from, m) =>
      sendSmtp(
        {
          host: typeof p.host === "function" ? p.host(c) : p.host,
          port: p.port,
          security: p.security,
          user: fixedUser ?? c.user,
          pass: c.pass,
        },
        from,
        m
      ),
  };
}

// ─── HTTP APIs ────────────────────────────────────────

async function postApi(label: string, url: string, init: { headers: Record<string, string>; body: string }): Promise<void> {
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers: init.headers, body: init.body, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new Error(`${label}: API nicht erreichbar`);
  }
  if (!res.ok) {
    const body = (await res.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 300);
    throw new Error(`${label}: HTTP ${res.status}${body ? ` – ${body}` : ""}`);
  }
}

const json = (headers: Record<string, string>) => ({ "content-type": "application/json", accept: "application/json", ...headers });
const formatFrom = (f: MailSender) => `${f.name.replace(/[<>"\r\n]/g, "")} <${f.address}>`;

const apiKeyField = (over: Partial<FieldDef> = {}): FieldDef => ({ key: "apiKey", label: N_("API-Schlüssel"), type: "password", required: true, ...over });

const brevo: ProviderDef = {
  id: "brevo",
  label: N_("Brevo (ehemals Sendinblue)"),
  group: "api",
  summary: N_("Transaktionsmails über die Brevo-API. Der Absender muss in Brevo als Absender oder Domain verifiziert sein."),
  docsUrl: "https://app.brevo.com/settings/keys/api",
  fields: [apiKeyField({ help: N_("Brevo → Profil → SMTP & API → API-Schlüssel") })],
  send: (c, from, m) =>
    postApi("Brevo", "https://api.brevo.com/v3/smtp/email", {
      headers: json({ "api-key": c.apiKey }),
      body: JSON.stringify({
        sender: { name: from.name, email: from.address },
        replyTo: from.replyTo ? { email: from.replyTo } : undefined,
        to: [{ email: m.to }],
        subject: m.subject,
        htmlContent: m.html,
        textContent: m.text,
        headers: AUTOMATED_HEADERS,
      }),
    }),
};

const resend: ProviderDef = {
  id: "resend",
  label: N_("Resend"),
  group: "api",
  summary: N_("Transaktionsmails über die Resend-API. Die Absender-Domain muss in Resend verifiziert sein."),
  docsUrl: "https://resend.com/api-keys",
  fields: [apiKeyField({ placeholder: N_("re_…"), help: N_("Resend → API Keys → Create API Key (Berechtigung „Sending access“)") })],
  send: (c, from, m) =>
    postApi("Resend", "https://api.resend.com/emails", {
      headers: json({ authorization: `Bearer ${c.apiKey}` }),
      body: JSON.stringify({
        from: formatFrom(from),
        reply_to: from.replyTo || undefined,
        to: [m.to],
        subject: m.subject,
        html: m.html,
        text: m.text,
        headers: AUTOMATED_HEADERS,
      }),
    }),
};

const sendgrid: ProviderDef = {
  id: "sendgrid",
  label: N_("SendGrid"),
  group: "api",
  summary: N_("Transaktionsmails über die SendGrid-API. Absender bzw. Domain müssen in SendGrid verifiziert sein."),
  docsUrl: "https://app.sendgrid.com/settings/api_keys",
  fields: [
    apiKeyField({ placeholder: N_("SG.…"), help: N_("SendGrid → Settings → API Keys (Berechtigung „Mail Send“)") }),
    {
      key: "region",
      label: N_("Datenregion"),
      type: "select",
      required: true,
      default: "global",
      options: [
        { value: "global", label: N_("Global (api.sendgrid.com)") },
        { value: "eu", label: N_("EU (api.eu.sendgrid.com)") },
      ],
    },
  ],
  send: (c, from, m) =>
    postApi("SendGrid", c.region === "eu" ? "https://api.eu.sendgrid.com/v3/mail/send" : "https://api.sendgrid.com/v3/mail/send", {
      headers: json({ authorization: `Bearer ${c.apiKey}` }),
      body: JSON.stringify({
        personalizations: [{ to: [{ email: m.to }] }],
        from: { email: from.address, name: from.name },
        reply_to: from.replyTo ? { email: from.replyTo } : undefined,
        subject: m.subject,
        // SendGrid requires text/plain before text/html
        content: [...(m.text ? [{ type: "text/plain", value: m.text }] : []), { type: "text/html", value: m.html }],
        headers: AUTOMATED_HEADERS,
      }),
    }),
};

const mailgun: ProviderDef = {
  id: "mailgun",
  label: N_("Mailgun"),
  group: "api",
  summary: N_("Transaktionsmails über die Mailgun-API. Die Sende-Domain muss in Mailgun verifiziert sein."),
  docsUrl: "https://app.mailgun.com/settings/api_security",
  fields: [
    apiKeyField({ help: N_("Mailgun → Settings → API Security → Sending key") }),
    { key: "domain", label: N_("Sende-Domain"), type: "text", required: true, placeholder: N_("mg.example.com") },
    {
      key: "region",
      label: N_("Datenregion"),
      type: "select",
      required: true,
      default: "us",
      options: [
        { value: "us", label: N_("USA (api.mailgun.net)") },
        { value: "eu", label: N_("EU (api.eu.mailgun.net)") },
      ],
    },
  ],
  send: (c, from, m) => {
    const body = new URLSearchParams({ from: formatFrom(from), to: m.to, subject: m.subject, html: m.html });
    if (m.text) body.set("text", m.text);
    if (from.replyTo) body.set("h:Reply-To", from.replyTo);
    for (const [k, v] of Object.entries(AUTOMATED_HEADERS)) body.set(`h:${k}`, v);
    const host = c.region === "eu" ? "api.eu.mailgun.net" : "api.mailgun.net";
    return postApi("Mailgun", `https://${host}/v3/${encodeURIComponent(c.domain)}/messages`, {
      headers: { authorization: `Basic ${Buffer.from(`api:${c.apiKey}`).toString("base64")}`, "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
  },
};

const postmark: ProviderDef = {
  id: "postmark",
  label: N_("Postmark"),
  group: "api",
  summary: N_("Transaktionsmails über die Postmark-API. Die Absenderadresse muss als Sender Signature oder Domain bestätigt sein."),
  docsUrl: "https://account.postmarkapp.com/servers",
  fields: [apiKeyField({ label: N_("Server-API-Token"), help: N_("Postmark → Server → API Tokens") })],
  send: (c, from, m) =>
    postApi("Postmark", "https://api.postmarkapp.com/email", {
      headers: json({ "x-postmark-server-token": c.apiKey }),
      body: JSON.stringify({
        From: formatFrom(from),
        ReplyTo: from.replyTo || undefined,
        To: m.to,
        Subject: m.subject,
        HtmlBody: m.html,
        TextBody: m.text,
        MessageStream: "outbound",
        Headers: Object.entries(AUTOMATED_HEADERS).map(([Name, Value]) => ({ Name, Value })),
      }),
    }),
};

const mailtrapApi: ProviderDef = {
  id: "mailtrap",
  label: N_("Mailtrap (Email Sending)"),
  group: "api",
  summary: N_("Echter Versand über die Mailtrap-API. Die Absender-Domain muss in Mailtrap verifiziert sein. Zum reinen Testen ohne Zustellung nimm „Mailtrap Sandbox“."),
  docsUrl: "https://mailtrap.io/api-tokens",
  fields: [apiKeyField({ label: N_("API-Token"), help: N_("Mailtrap → Settings → API Tokens (Berechtigung für die Sende-Domain)") })],
  send: (c, from, m) =>
    postApi("Mailtrap", "https://send.api.mailtrap.io/api/send", {
      headers: json({ authorization: `Bearer ${c.apiKey}` }),
      body: JSON.stringify({
        from: { email: from.address, name: from.name },
        reply_to: from.replyTo ? { email: from.replyTo } : undefined,
        to: [{ email: m.to }],
        subject: m.subject,
        html: m.html,
        text: m.text,
        headers: AUTOMATED_HEADERS,
      }),
    }),
};

// ─── SMTP services ────────────────────────────────────

const gmail = smtpPreset({
  id: "gmail",
  label: N_("Google (Gmail / Workspace)"),
  summary: N_("Versand über ein Google-Konto. Braucht ein App-Passwort (dafür muss die Bestätigung in zwei Schritten aktiv sein). Google begrenzt die Zahl der Mails pro Tag."),
  docsUrl: "https://myaccount.google.com/apppasswords",
  host: "smtp.gmail.com",
  port: 587,
  security: "starttls",
  user: { key: "user", label: N_("Google-Adresse"), type: "text", required: true, placeholder: N_("name@gmail.com") },
  pass: passField({ label: N_("App-Passwort"), required: true, help: N_("16 Zeichen, nicht das normale Konto-Passwort") }),
});

const microsoft365 = smtpPreset({
  id: "microsoft365",
  label: N_("Microsoft 365 / Outlook"),
  summary:
    N_("Versand über ein Exchange-Online-Postfach. SMTP-Authentifizierung muss für das Postfach aktiviert sein; Microsoft schränkt Passwort-Anmeldung für SMTP zunehmend ein. Klappt es nicht, nimm einen anderen Anbieter oder einen Connector."),
  docsUrl: "https://learn.microsoft.com/exchange/mail-flow-best-practices/how-to-set-up-a-multifunction-device-or-application-to-send-email-using-microsoft-365-or-office-365",
  host: "smtp.office365.com",
  port: 587,
  security: "starttls",
  user: { key: "user", label: N_("Postfach-Adresse"), type: "text", required: true, placeholder: N_("sso@firma.de") },
  pass: passField({ required: true }),
});

const ses = smtpPreset({
  id: "ses",
  label: N_("Amazon SES"),
  summary: N_("Versand über Amazon SES per SMTP. Nutze die SMTP-Zugangsdaten aus der SES-Konsole, nicht deine IAM-Schlüssel. Absender bzw. Domain müssen in SES verifiziert sein."),
  docsUrl: "https://console.aws.amazon.com/ses/home#/smtp",
  host: (c) => `email-smtp.${c.region}.amazonaws.com`,
  port: 587,
  security: "starttls",
  extra: [{ key: "region", label: N_("AWS-Region"), type: "text", required: true, placeholder: N_("eu-central-1") }],
  user: { key: "user", label: N_("SMTP-Benutzername"), type: "text", required: true },
  pass: passField({ label: N_("SMTP-Passwort"), required: true }),
});

const mailjet = smtpPreset({
  id: "mailjet",
  label: N_("Mailjet"),
  summary: N_("Versand über Mailjet per SMTP. Der Absender muss in Mailjet verifiziert sein."),
  docsUrl: "https://app.mailjet.com/account/apikeys",
  host: "in-v3.mailjet.com",
  port: 587,
  security: "starttls",
  user: { key: "user", label: N_("API-Key"), type: "text", required: true },
  pass: passField({ label: N_("Secret-Key"), required: true }),
});

const smtp2go = smtpPreset({
  id: "smtp2go",
  label: N_("SMTP2GO"),
  summary: N_("Versand über SMTP2GO. Lege in SMTP2GO unter „SMTP Users“ einen Benutzer an."),
  docsUrl: "https://app.smtp2go.com/settings/users/",
  host: "mail.smtp2go.com",
  port: 587,
  security: "starttls",
  user: { key: "user", label: N_("SMTP-Benutzername"), type: "text", required: true },
  pass: passField({ required: true }),
});

const ionos = smtpPreset({
  id: "ionos",
  label: N_("IONOS"),
  summary: N_("Versand über ein IONOS-Postfach. Benutzername ist die volle E-Mail-Adresse."),
  host: "smtp.ionos.de",
  port: 587,
  security: "starttls",
  user: { key: "user", label: N_("E-Mail-Adresse"), type: "text", required: true },
  pass: passField({ required: true }),
});

const strato = smtpPreset({
  id: "strato",
  label: N_("Strato"),
  summary: N_("Versand über ein Strato-Postfach. Benutzername ist die volle E-Mail-Adresse."),
  host: "smtp.strato.de",
  port: 465,
  security: "ssl",
  user: { key: "user", label: N_("E-Mail-Adresse"), type: "text", required: true },
  pass: passField({ required: true }),
});

const mailtrapSandbox = smtpPreset({
  id: "mailtrap-sandbox",
  label: N_("Mailtrap Sandbox (nur Testen)"),
  summary: N_("Fängt alle Mails in einer Test-Inbox ab, nichts wird zugestellt. Ideal, um Aussehen und Ablauf zu prüfen, bevor echter Versand eingerichtet ist."),
  docsUrl: "https://mailtrap.io/inboxes",
  host: "sandbox.smtp.mailtrap.io",
  port: 2525,
  security: "starttls",
  user: { key: "user", label: N_("Benutzername"), type: "text", required: true, help: N_("Mailtrap → Inbox → SMTP Settings") },
  pass: passField({ required: true }),
});

export const PROVIDERS: ProviderDef[] = [
  genericSmtp,
  gmail,
  microsoft365,
  ses,
  mailjet,
  smtp2go,
  ionos,
  strato,
  mailtrapSandbox,
  brevo,
  resend,
  sendgrid,
  mailgun,
  postmark,
  mailtrapApi,
];

export function getProvider(id: string): ProviderDef | undefined {
  return PROVIDERS.find((p) => p.id === id);
}
