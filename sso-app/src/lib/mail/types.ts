import { N_ } from "../i18n/core";

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export interface MailSender {
  name: string;
  address: string;
  replyTo?: string;
}

/** All values are strings (checkboxes: "true" / "false"). */
export type ProviderConfig = Record<string, string>;

export interface FieldDef {
  key: string;
  label: string;
  /** "password" = secret: stored sealed, never sent back to the browser. */
  type: "text" | "password" | "number" | "select" | "checkbox";
  required?: boolean;
  placeholder?: string;
  help?: string;
  options?: { value: string; label: string }[];
  default?: string;
}

export interface ProviderDef {
  id: string;
  label: string;
  group: "smtp" | "smtp-service" | "api";
  /** One or two sentences telling the admin what this is and what to have at hand. */
  summary: string;
  docsUrl?: string;
  fields: FieldDef[];
  send(config: ProviderConfig, from: MailSender, message: MailMessage): Promise<void>;
}

export const GROUP_LABELS: Record<ProviderDef["group"], string> = {
  smtp: N_("Eigener Mailserver"),
  "smtp-service": N_("Anbieter per SMTP"),
  api: N_("Anbieter per API"),
};

/** Marks the mails as automatic transactional messages (no auto-replies, no vacation responders). */
export const AUTOMATED_HEADERS: Record<string, string> = {
  "Auto-Submitted": "auto-generated",
  "X-Auto-Response-Suppress": "All",
};
