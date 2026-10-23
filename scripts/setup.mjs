#!/usr/bin/env node
// Erzeugt die .env: fragt nach der öffentlichen Adresse, würfelt alle Geheimnisse und das Admin-Passwort.
// Benötigt nur Node.js (keine Pakete). Aufruf über ./setup.sh (nutzt bei Bedarf Docker, falls Node fehlt).
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = join(root, ".env");
const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const force = args.includes("--force");
const nonInteractive = args.includes("--yes");

if (existsSync(envPath) && !force) {
  console.error(".env existiert bereits – nichts überschrieben. Mit --force neu erzeugen (alte Schlüssel gehen dabei verloren!).");
  process.exit(1);
}

const hex = (bytes = 32) => randomBytes(bytes).toString("hex");
const password = () => randomBytes(15).toString("base64url");

async function ask(rl, question, fallback) {
  if (nonInteractive) return fallback;
  const answer = (await rl.question(`${question} [${fallback}]: `)).trim();
  return answer || fallback;
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
console.log("\nSSO einrichten\n");

let appUrl = flag("url") ?? (await ask(rl, "Öffentliche Adresse des SSO (https://… ; lokal zum Testen: http://localhost:8122)", "http://localhost:8122"));
appUrl = appUrl.replace(/\/+$/, "");
try {
  new URL(appUrl);
} catch {
  console.error(`„${appUrl}“ ist keine gültige Adresse.`);
  process.exit(1);
}
const username = flag("admin") ?? (await ask(rl, "Benutzername des ersten Admins", "admin"));
const givenPassword = flag("password");
rl.close();

const adminPassword = givenPassword ?? password();
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });

const values = {
  APP_URL: appUrl,
  MASTER_USERNAME: username,
  MASTER_PASSWORD: adminPassword,
  SESSION_SECRET: hex(),
  ENCRYPTION_KEY: hex(),
  DATA_ENCRYPTION_KEY: hex(),
  OIDC_PRIVATE_KEY_PEM: `'${privateKey.trim().replace(/\n/g, "\\n")}'`,
  DB_PASSWORD: hex(24),
};

// Kommentare und Reihenfolge der Vorlage bleiben erhalten; nur die Werte der Pflichtfelder werden gesetzt.
let template = readFileSync(join(root, ".env.example"), "utf8");
for (const [key, value] of Object.entries(values)) {
  template = template.replace(new RegExp(`^${key}=.*$`, "m"), () => `${key}=${value}`);
}
writeFileSync(envPath, template, { mode: 0o600 });
try {
  chmodSync(envPath, 0o600);
} catch {}

console.log(`
✓ .env wurde angelegt (nur für dich lesbar).

Dein erstes Admin-Konto
  Adresse:      ${appUrl}
  Benutzername: ${username}
  Passwort:     ${adminPassword}${givenPassword ? "" : "\n  (nur hier sichtbar, steht aber auch in der .env)"}

Nächste Schritte
  1. docker compose up -d --build
  2. ${appUrl} öffnen, anmelden und die Einrichtung unter „System“ abschließen
     (Name, Logo, E-Mail-Versand).

Wichtig: Sichere die .env an einem zweiten Ort (Passwortmanager). Geht DATA_ENCRYPTION_KEY verloren,
sind E-Mail-Adressen, IPs und Logs in der Datenbank nicht mehr lesbar.
${appUrl.startsWith("http://") && !appUrl.includes("localhost") ? "\nHinweis: Mit http:// laufen weder Passkeys noch sichere Cookies. Stelle für den Echtbetrieb HTTPS davor (siehe README).\n" : ""}`);
