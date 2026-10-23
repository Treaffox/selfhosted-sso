import { getSiteSettings } from "../site-settings";
import { getMailSettings, isMailConfigured, type MailChannel, type MailSettings } from "./settings";
import { getProvider } from "./providers";
import type { MailMessage, MailSender } from "./types";

export { getMailSettings, isMailConfigured } from "./settings";

/** Error text without recipient details (SMTP errors tend to echo the address). */
function describeMailError(error: unknown): string {
  if (error instanceof Error) return `${error.name}${(error as { code?: string }).code ? ` (${(error as { code?: string }).code})` : ""}`;
  return "unbekannter Fehler";
}

async function senderFor(settings: MailSettings): Promise<MailSender> {
  const site = await getSiteSettings();
  return { name: settings.fromName || site.siteName, address: settings.fromAddress, replyTo: settings.replyTo || undefined };
}

async function sendVia(channel: MailChannel, settings: MailSettings, message: MailMessage): Promise<void> {
  const provider = getProvider(channel.provider);
  if (!provider) throw new Error("Unbekannter Anbieter");
  await provider.send(channel.config, await senderFor(settings), message);
}

/**
 * Sends through the main provider; if that fails, through the fallback provider.
 * Without any configuration nothing is delivered (the subject is logged outside of production so local setups still work).
 */
export async function deliverMail(message: MailMessage): Promise<boolean> {
  const settings = await getMailSettings();
  if (!isMailConfigured(settings)) {
    console.warn("[EMAIL] Kein Mailversand eingerichtet (Admin → System → E-Mail), Mail wurde nicht zugestellt");
    if (process.env.NODE_ENV !== "production") console.log(`[EMAIL] Dev: ${message.subject}`);
    return false;
  }

  for (const [label, channel] of [["primary", settings.primary], ["fallback", settings.fallback]] as const) {
    if (!channel) continue;
    try {
      await sendVia(channel, settings, message);
      console.log(`[EMAIL] Sent via ${label} (${channel.provider})`);
      return true;
    } catch (error) {
      console.error(`[EMAIL ERROR] ${label} (${channel.provider}) failed:`, describeMailError(error));
    }
  }
  return false;
}

/** Admin test: one specific channel, with the real error message so the admin can fix the setup. */
export async function testChannel(which: "primary" | "fallback", message: MailMessage): Promise<{ ok: true } | { ok: false; error: string }> {
  const settings = await getMailSettings();
  const channel = settings[which];
  if (!settings.fromAddress) return { ok: false, error: "Bitte zuerst eine Absenderadresse speichern" };
  if (!channel) return { ok: false, error: which === "primary" ? "Kein Haupt-Anbieter gespeichert" : "Kein Ersatz-Anbieter gespeichert" };
  try {
    await sendVia(channel, settings, message);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: (error instanceof Error ? error.message : "Unbekannter Fehler").slice(0, 400) };
  }
}
