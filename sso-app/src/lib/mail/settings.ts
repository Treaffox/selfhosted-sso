import { z } from "zod";
import { openSecret, readSetting, sealSecret, writeSetting } from "../settings";
import { getProvider } from "./providers";
import type { FieldDef, ProviderConfig } from "./types";

export interface MailChannel {
  provider: string;
  /** Secrets already decrypted. Server side only. */
  config: ProviderConfig;
}

export interface MailSettings {
  fromName: string;
  fromAddress: string;
  replyTo: string;
  primary: MailChannel | null;
  fallback: MailChannel | null;
}

/** What is stored: like MailSettings, but secret values are sealed. */
type StoredChannel = { provider: string; config: ProviderConfig };
type Stored = Omit<MailSettings, "primary" | "fallback"> & { primary: StoredChannel | null; fallback: StoredChannel | null };

const KEY = "mail";
const isSecret = (f: FieldDef) => f.type === "password";

function open(channel: StoredChannel | null): MailChannel | null {
  if (!channel) return null;
  const def = getProvider(channel.provider);
  if (!def) return null;
  const config: ProviderConfig = { ...channel.config };
  for (const f of def.fields.filter(isSecret)) {
    const plain = openSecret(config[f.key]);
    if (plain === undefined) delete config[f.key];
    else config[f.key] = plain;
  }
  return { provider: channel.provider, config };
}

export async function getMailSettings(): Promise<MailSettings> {
  const stored = await readSetting<Stored>(KEY);
  return {
    fromName: stored?.fromName ?? "",
    fromAddress: stored?.fromAddress ?? "",
    replyTo: stored?.replyTo ?? "",
    primary: open(stored?.primary ?? null),
    fallback: open(stored?.fallback ?? null),
  };
}

export const isMailConfigured = (s: MailSettings) => !!s.fromAddress && (!!s.primary || !!s.fallback);

/** Safe to send to the browser: secrets are replaced by the list of fields that have one. */
export interface MailChannelView {
  provider: string;
  config: ProviderConfig;
  secretsSet: string[];
}
export interface MailSettingsView extends Omit<MailSettings, "primary" | "fallback"> {
  primary: MailChannelView | null;
  fallback: MailChannelView | null;
}

function toView(channel: MailChannel | null): MailChannelView | null {
  if (!channel) return null;
  const def = getProvider(channel.provider)!;
  const secretKeys = def.fields.filter(isSecret).map((f) => f.key);
  const config = Object.fromEntries(Object.entries(channel.config).filter(([k]) => !secretKeys.includes(k)));
  return { provider: channel.provider, config, secretsSet: secretKeys.filter((k) => !!channel.config[k]) };
}

export async function getMailSettingsView(): Promise<MailSettingsView> {
  const s = await getMailSettings();
  return { ...s, primary: toView(s.primary), fallback: toView(s.fallback) };
}

// ─── Saving ───────────────────────────────────────────

const HOST_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$|^\[?[0-9a-f:.]+\]?$/i;

const channelInput = z
  .object({ provider: z.string().max(40), config: z.record(z.string(), z.string().max(500)).default({}) })
  .nullable();

const inputSchema = z.object({
  fromName: z.string().trim().max(80),
  fromAddress: z.string().trim().email("Absenderadresse ist ungültig").max(200),
  replyTo: z.union([z.literal(""), z.string().trim().email("Antwortadresse ist ungültig").max(200)]).default(""),
  primary: channelInput,
  fallback: channelInput,
});

function buildChannel(input: z.infer<typeof channelInput>, previous: MailChannel | null, channelLabel: string): { value: StoredChannel | null } | { error: string } {
  if (!input) return { value: null };
  const def = getProvider(input.provider);
  if (!def) return { error: `${channelLabel}: Unbekannter Anbieter` };
  const config: ProviderConfig = {};
  for (const f of def.fields) {
    const fieldLabel = f.label;
    let value = (input.config[f.key] ?? "").trim();
    if (isSecret(f)) {
      // Empty = keep what is stored (only for the same provider; secrets of another provider never carry over)
      if (!value && previous?.provider === def.id) value = previous.config[f.key] ?? "";
    } else if (!value && f.default !== undefined && f.type !== "checkbox") {
      value = f.default;
    }
    if (f.type === "checkbox") value = value === "true" ? "true" : "false";
    if (f.required && !value) return { error: `${channelLabel}: „${fieldLabel}“ fehlt` };
    if (value) {
      if (f.type === "select" && !f.options?.some((o) => o.value === value)) return { error: `${channelLabel}: „${fieldLabel}“ hat einen ungültigen Wert` };
      if (f.type === "number" && !(/^\d+$/.test(value) && +value >= 1 && +value <= 65535)) return { error: `${channelLabel}: „${fieldLabel}“ muss eine Portnummer (1–65535) sein` };
      if (f.key === "host" && !HOST_RE.test(value)) return { error: `${channelLabel}: „${fieldLabel}“ ist kein gültiger Servername` };
      if (f.key === "domain" && !HOST_RE.test(value)) return { error: `${channelLabel}: „${fieldLabel}“ ist keine gültige Domain` };
      if (f.key === "region" && f.type === "text" && !/^[a-z0-9-]{2,30}$/.test(value)) return { error: `${channelLabel}: „${fieldLabel}“ ist ungültig` };
      config[f.key] = isSecret(f) ? sealSecret(value) : value;
    }
  }
  return { value: { provider: def.id, config } };
}

export async function saveMailSettings(input: unknown): Promise<{ ok: true; changed: string[] } | { ok: false; error: string }> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const data = parsed.data;
  if (!data.primary && data.fallback) return { ok: false, error: "Ein Ersatz-Anbieter braucht einen Haupt-Anbieter" };

  const previous = await getMailSettings();
  const primary = buildChannel(data.primary, previous.primary, "Haupt-Anbieter");
  if ("error" in primary) return { ok: false, error: primary.error };
  const fallback = buildChannel(data.fallback, previous.fallback, "Ersatz-Anbieter");
  if ("error" in fallback) return { ok: false, error: fallback.error };

  const stored: Stored = {
    fromName: data.fromName,
    fromAddress: data.fromAddress,
    replyTo: data.replyTo,
    primary: primary.value,
    fallback: fallback.value,
  };
  await writeSetting(KEY, stored);

  const changed: string[] = [];
  if (previous.primary?.provider !== stored.primary?.provider) changed.push("primary");
  if (previous.fallback?.provider !== stored.fallback?.provider) changed.push("fallback");
  if (previous.fromAddress !== stored.fromAddress) changed.push("fromAddress");
  return { ok: true, changed };
}
