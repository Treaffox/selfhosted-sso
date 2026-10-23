# SSO – Project Instructions

## Project Overview

Self-hosted Single Sign-On server. The SSO app runs on Next.js 15 with Prisma/PostgreSQL, the example client (`test-app`) on Express.js. It is deliberately operator-neutral: nothing about a particular domain, brand or mail provider is hard-coded.

## Stack

- **SSO App** (`sso-app/`): Next.js 15 (App Router), TypeScript, Tailwind CSS 3.4, Prisma 6, PostgreSQL 17
- **Test App** (`test-app/`): Express.js, EJS, TypeScript
- **Auth**: bcryptjs, @simplewebauthn, otplib, jose, nodemailer; sharp for logo conversion

## Architecture Rules

- All auth state is server-side (DB sessions, not JWT-based sessions)
- Login is a multi-step state machine: username → password/passkey → MFA
- OAuth2-like flow for client apps: redirect → login → code → token exchange; OIDC on top (`/oauth/*`, `/.well-known/*`)
- nginx auth_request integration via GET /api/auth/verify
- Master account is seeded from env vars, cannot be created through UI
- MFA policy (`security` setting, default mandatory) is read via `getSecuritySettings()`; there is no IP blacklist/country blocking in this project

## Configuration: where does a value live?

- **`.env` (lib/config.ts)** – only what the server needs to boot or what would lock everyone out if changed at runtime: `APP_URL` (issuer, WebAuthn origin, mail links; cookies are `Secure` iff it is https), `COOKIE_DOMAIN`, `WEBAUTHN_RP_ID`, secrets, DB, rate limits, session lifetimes. Never read `process.env.APP_URL` directly; use `getAppUrl()` and friends.
- **Database, edited by the master in the browser (Admin → System)** – everything else:
  - `SystemSetting` rows via lib/settings.ts (`readSetting`/`writeSetting`, 5 s cache; `sealSecret`/`openSecret` for secrets: AES-256-GCM with `ENCRYPTION_KEY`, never sent to the browser)
  - `site` → lib/site-settings.ts (name, tagline, org, contact, footer links, mail header colour, time zone). The page chrome gets a `BrandView` via `getBrandView()` (Header/Footer/BrandLogo take it as a prop; client components can't call it)
  - `mail` → lib/mail/ (provider catalog in providers.ts, settings + validation in settings.ts, `deliverMail()` = main provider then fallback provider). To add a provider: one `ProviderDef` (fields drive the admin form, `type: "password"` = secret) – no UI code
  - `cloudflare` → lib/cloudflare.ts (`getCloudflareConfig()`, optional; only DNS records tracked in `AppDnsRecord` can be changed)
  - `BrandAsset` rows (logo, logoLight, favicon) via lib/brand-assets.ts, served publicly by `/api/branding/[asset]`
- A new admin-editable setting: add it to the matching module, expose it in `app/api/admin/settings/*`, the page in `app/admin/settings/*`, and add an `EVENTS` entry for the audit log.

## Code Conventions

- UI is bilingual (de/en). Write the German text as the key: `t("Anmelden")` (client: `useT()` / `useI18n()` → `t`, `tn` for text with markup, `te(data.error, "Fehler")` for API errors; server: `await getT()`), and add the English text to `sso-app/src/lib/i18n/en`. Module-level constants use `N_("…")` and are translated with `t(x)` at render time. `npm run i18n:check` must pass (CI). API responses keep German `error` strings; the browser translates them. Audit sentences are stored in German and rendered per viewer (`renderAuditMessage`); e-mails are rendered in the recipient's language (`lib/email.ts`). Language order: user setting → `sso_lang` cookie → browser language/IP country (DE/AT/CH → German) → English (`lib/i18n/server.ts`)
- Inter font, weight 600+ (semibold minimum)
- Dark theme: #050505 background, #fafafa text, no fade-in animations
- API routes return JSON with `error` field on failure
- Client components use `"use client"` directive
- Admin routes require `isMaster` check
- All crypto uses lib/crypto.ts utilities (AES-256-GCM, SHA-256)
- Personal data is encrypted at rest (AES-256-GCM, `lib/data-crypto.ts`, key `DATA_ENCRYPTION_KEY`, per-tenant subkeys via HKDF). The Prisma client in `lib/db.ts` encrypts/decrypts the columns listed in `ENCRYPTED_FIELDS` (`lib/db-encryption.ts`) transparently: User.email, avatars, IPs/user agents/device names, audit log text + details. New personal-data columns must be added to that list. Encrypted columns can't be used in `where` (throws); for equality lookups use `blindIndex()` (see `UserIpRule.ipHash`), audit filters on encrypted columns run in memory (`lib/audit-query.ts`). Never log emails/IPs/usernames to the console. Existing plaintext rows: `npm run db:encrypt-existing`
- Rate limiting via lib/rate-limit.ts (in-memory). Credential attempts (password, MFA, passkey) additionally per account via `guardCredentialAttempt` (lib/login-flow.ts): lock + attempt budget, familiar IP+browser bypasses the lock so strangers can't lock the owner out
- Client IP only via `getClientIp()` / lib/client-ip.ts (`X-Real-IP`, fallback LAST `X-Forwarded-For` entry; never the first one – the client controls it)
- Redirect targets are validated in lib/safe-redirect.ts: `returnTo` same-origin only, `redirect_uri` exact or origin-only registered URI (`https://app.example.com/` allows any path on that origin). Unregistered targets are ignored, never followed
- All login endings (password, MFA, passkey) go through `completeLogin` (lib/login-flow.ts); the passkey must belong to the account being logged into (`verifyPasskeyAuthentication(…, expectedUserId)`)
- Session and trusted-device tokens are stored hashed (`h1:<sha256>`, lib/token-store.ts); the cookie keeps the raw token. Use `tokenLookupKeys()`, never query `token` with the raw value
- Sensitive account changes (TOTP setup, passkey add/delete, recovery codes, e-mail change, password change) and the sensitive system settings (mail providers, Cloudflare credentials – whoever controls mail sees login codes) need the current password again: `requireReauth()` (lib/reauth.ts). A password change ends all other sessions and trusted devices. A new e-mail address is only stored as pending (`LoginSession` row `email-change-<userId>`, lib/pending.ts) and replaces the active one after the code sent to it was confirmed (`POST /api/settings/email/verify`)
- middleware.ts rejects cross-origin writes (`Sec-Fetch-Site` / `Origin`); token endpoints (`/oauth/token`, `/api/auth/token`, `/oauth/userinfo`) are exempt. With a shared `COOKIE_DOMAIN` the session cookie reaches sibling subdomains, so SameSite=Lax alone is no CSRF protection
- Uploaded images are served from our own origin: SVGs are validated (no script, handlers, external refs) and `/api/branding/*` sends its own sandboxing CSP (excluded from the global header rule in next.config.ts on purpose). Keep it that way when touching either
- Audit log: always via `logAudit(action, details, userId?, ip?, extra?)` from lib/audit.ts (re-exported by lib/auth.ts). It never throws and fills actor, session reference, IP, user agent, request path/method automatically from the request (middleware sets `x-audit-path`/`x-audit-method`). New actions get an entry in the `EVENTS` catalog (category + German sentence). Viewer: /admin/audit (filters: lib/audit-query.ts, AND/OR conditions with include/exclude operators)
- Never write secrets (API keys, SMTP passwords, tokens) to logs or audit details

## Development

```bash
docker run -d --name sso-dev-db -p 127.0.0.1:5433:5432 -e POSTGRES_USER=sso -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=sso postgres:17-alpine
cd sso-app && cp .env.example .env
npm install && npx prisma migrate deploy && npx prisma db seed
npm run dev                   # port 8122
cd ../test-app && npm run dev # port 8123
```

Check before committing: `npx tsc --noEmit` and `npm run build` (CI runs both).

## Database

PostgreSQL 17 (docker-compose service `db`). Migrations live in `sso-app/prisma/migrations`; the container runs `prisma migrate deploy` + the master seed on every start. After a schema change: `npx prisma migrate dev --name <name>`. The compose file carries labels that keep auto-updaters (Watchtower, WUD) away from the DB container – keep them: an automatic Postgres major upgrade breaks the data directory.

The OIDC signing key is `OIDC_PRIVATE_KEY_PEM` in `.env` (PKCS#8, `\n`-escaped); keep it in the backup, otherwise the JWKS `kid` changes.

## Known Issues / Open Bugs

None known.
