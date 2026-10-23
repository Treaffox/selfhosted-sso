import { z } from "zod";
import { validateRegisteredRedirectUri } from "./safe-redirect";

export const usernameSchema = z
  .string()
  .min(3, "Benutzername muss mind. 3 Zeichen haben")
  .max(32, "Benutzername darf max. 32 Zeichen haben")
  .regex(
    /^[a-zA-Z0-9._-]+$/,
    "Nur Buchstaben, Zahlen, Punkte, Bindestriche und Unterstriche"
  );

export const passwordSchema = z
  .string()
  .min(8, "Passwort muss mind. 8 Zeichen haben")
  .max(128, "Passwort darf max. 128 Zeichen haben");

export const emailSchema = z.string().email("Ungültige E-Mail-Adresse");

export const totpCodeSchema = z
  .string()
  .length(6, "Code muss 6 Ziffern haben")
  .regex(/^\d{6}$/, "Code muss 6 Ziffern haben");

export const emailCodeSchema = z
  .string()
  .length(6, "Code muss 6 Ziffern haben")
  .regex(/^\d{6}$/, "Code muss 6 Ziffern haben");

export const recoveryCodeSchema = z
  .string()
  .regex(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/, "Ungültiges Format");

export const appNameSchema = z
  .string()
  .min(1, "App-Name erforderlich")
  .max(64, "App-Name max. 64 Zeichen");

// Native apps (public/PKCE clients) redirect back via a custom URI scheme
// (e.g. "com.example.app:/oauth2redirect", "myapp://callback") instead of
// https. Those are allowed, but never script-like schemes (javascript:, data:, ...),
// and plain http:// only for loopback hosts. See validateRegisteredRedirectUri.
export const redirectUriSchema = z
  .string()
  .superRefine((url, ctx) => {
    const problem = validateRegisteredRedirectUri(url);
    if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem });
  });

export const sessionDurationHoursSchema = z
  .number()
  .int("Muss eine ganze Zahl sein")
  .min(1, "Mindestens 1 Stunde")
  .max(720, "Maximal 720 Stunden (30 Tage)");

export const permissionLevelSchema = z
  .string()
  .min(1)
  .max(32)
  .regex(/^[A-Z0-9_-]+$/, "Nur Großbuchstaben, Zahlen, Bindestriche und Unterstriche");

/** Validate and return parsed data or throw. */
export function validate<T>(schema: z.ZodType<T>, data: unknown): T {
  return schema.parse(data);
}

/** Validate and return { success, data, error }. */
export function safeParse<T>(
  schema: z.ZodType<T>,
  data: unknown
): { success: true; data: T } | { success: false; error: string } {
  const result = schema.safeParse(data);
  if (result.success) return { success: true, data: result.data };
  return {
    success: false,
    error: result.error.issues.map((i) => i.message).join(", "),
  };
}

export const dnsRecordSchema = z.object({
  type: z.enum(["A", "AAAA", "CNAME", "TXT", "MX"]),
  name: z.string().trim().min(1, "Name erforderlich").max(253, "Name zu lang"),
  content: z.string().trim().min(1, "Inhalt erforderlich").max(2000, "Inhalt zu lang"),
  // 1 = automatic
  ttl: z.number().int().refine((n) => n === 1 || (n >= 60 && n <= 86400), "TTL: Auto oder 60–86400 Sekunden").default(1),
  proxied: z.boolean().default(false),
  priority: z.number().int().min(0).max(65535).optional(),
});
