# SSO

Self-hosted single sign-on server with passkeys, MFA and OpenID Connect. It runs on your own server, belongs to you and looks like your service: name, logo, favicon, email delivery and footer are set in the browser, not in code.

> The interface is available in English and German. Every user picks their language in the settings; without a choice it is German for a German browser language or an IP address from Germany, Austria or Switzerland, otherwise English. [Deutsche Version](README.de.md)

## What's included

- **Sign-in:** username → passkey **or** password → MFA (authenticator app, email code, recovery codes). MFA is mandatory by default and can be switched to "optional" in the admin area.
- **For your apps:** OpenID Connect (authorization code + PKCE, discovery, JWKS, userinfo), a simple app token flow and nginx `auth_request` for apps without login code of their own.
- **Management in the browser:** users, apps and permissions, an audit log with filters, sessions and trusted devices.
- **Customizable in the browser (Admin → System):** name, subtitle, logo (light/dark), favicon, footer links, email design, email providers with a fallback provider, optionally Cloudflare for DNS records.
- **Security:** server-side sessions, personal data encrypted in the database (AES-256-GCM), rate limits per IP and account, CSRF protection, password re-confirmation for sensitive changes, an audit log for everything important.

## Setup

You need a server with Docker (Compose v2) and a domain pointing to it. For just trying it out, `http://localhost:8122` is enough.

```bash
git clone <this-repository> sso && cd sso

./setup.sh                      # asks for the address, creates .env with all secrets + the admin password
docker compose up -d --build    # starts database + SSO, creates the admin account
```

Then open the address, sign in with the admin account from the output of `setup.sh` and finish the setup under **System**. There is no preset admin password: `setup.sh` generates one, shows it once and writes it to the `.env` as `MASTER_PASSWORD`. With mandatory MFA you set up an authenticator app or a passkey at the first admin login.

`./setup.sh` needs Node.js **or** Docker. With neither: copy `.env.example` to `.env` and fill it in by hand (every secret with `openssl rand -hex 32`).

### HTTPS

Passkeys and secure cookies only work over HTTPS (exception: `localhost`). Put a reverse proxy in front that points to `127.0.0.1:8122`:

- **Caddy** (easiest, certificates automatic): [`Caddyfile.example`](Caddyfile.example)
- **nginx:** [`nginx/sso.conf.example`](nginx/sso.conf.example) (+ [`nginx/sso-ratelimit.conf`](nginx/sso-ratelimit.conf))

Enter the same address as `APP_URL` in the `.env`. Important: the proxy must set `X-Real-IP`; the examples do. The app never trusts an IP sent by the client.

## Where do I configure what?

| What | Where |
|---|---|
| Public address, secrets, first admin account, database password | `.env` on the server (`./setup.sh`) |
| Name, subtitle, operator, contact link, footer links, time zone | Browser → **System → Appearance** |
| Logo, logo for light background, favicon | Browser → **System → Appearance** |
| Email colors and logo | Browser → **System → Appearance** |
| Email provider, sender, fallback provider, test email | Browser → **System → Email** |
| MFA mandatory or optional | Browser → **System → Security** |
| Cloudflare token and zone ID (optional) | Browser → **System → Cloudflare** |
| Users, apps, permissions, redirect URIs | Browser → **Users** / **Apps** |
| Language of the interface and emails | each user in **Settings → Language** |
| Session duration, rate limits, cookie domain (optional) | `.env` (see `.env.example`) |

The page **System → Overview** shows a checklist of everything still open and the values currently in effect from the `.env`.

### Email providers

Without email delivery no verification codes or welcome emails arrive. Available:

- **Your own server:** any SMTP server (STARTTLS, SSL/TLS or unencrypted for internal relays, with or without login)
- **Via SMTP, with prefilled servers:** Google (Gmail/Workspace), Microsoft 365, Amazon SES, Mailjet, SMTP2GO, IONOS, Strato, Mailtrap Sandbox (for testing, nothing is delivered)
- **Via API:** Brevo, Resend, SendGrid, Mailgun, Postmark, Mailtrap (Email Sending)

Each provider shows its fields with help text and a link to where you create the credentials. You can also set a **fallback provider** that takes over if the main provider fails. **Send test email** checks each provider individually and shows the real error message. Credentials are stored encrypted and never shown again; saving requires your password.

Logo uploads: PNG, SVG, WebP, JPEG; for the favicon JPG, WebP, GIF and PNG are converted to a square PNG, SVG and ICO stay unchanged. The logo in emails is loaded as a PNG from `APP_URL` (SVG uploads are converted automatically). The address must therefore be reachable from the internet, otherwise mail clients won't show the image.

## Connecting apps

1. Create an app under **Apps → New app** and enter the redirect URI(s).
2. Generate OpenID Connect credentials (client ID/secret) or use the app token.
3. The public documentation at `<your-address>/documentation` has examples for all three paths, with your address already filled in.
4. For nginx `auth_request`: [`nginx/protected-app.conf.example`](nginx/protected-app.conf.example) and [`nginx/sso-cookie-strip.conf`](nginx/sso-cookie-strip.conf).

A runnable example app (Express) is in [`test-app/`](test-app), started with `docker-compose.example-app.yml`.

## Operation

```bash
docker compose logs -f sso                  # logs
git pull && docker compose up -d --build    # update (migrations run automatically on start)
docker compose exec -T db pg_dump -U sso sso | gzip > sso-$(date +%F).sql.gz    # database backup
```

**Back up the `.env` separately from the database.** Without `DATA_ENCRYPTION_KEY` encrypted data (email addresses, IPs, audit log, profile pictures) is unreadable; without `ENCRYPTION_KEY` the stored email and Cloudflare credentials are unusable (enter them again); without `OIDC_PRIVATE_KEY_PEM` the signing key changes and issued tokens become invalid.

The database (PostgreSQL 17) only listens inside the Docker network. The compose file keeps auto-updaters (Watchtower, WUD) away from the database container, because an automatic jump to a new major version makes the database unusable.

## Configuration reference (`.env`)

| Variable | Required | Meaning |
|---|---|---|
| `APP_URL` | yes | Public address without path, e.g. `https://sso.example.com`. Determines OIDC issuer, passkey domain, links in emails |
| `MASTER_USERNAME`, `MASTER_PASSWORD` | yes | First admin account, only created while no admin exists yet |
| `SESSION_SECRET`, `ENCRYPTION_KEY`, `DATA_ENCRYPTION_KEY` | yes | Secrets, each `openssl rand -hex 32` |
| `OIDC_PRIVATE_KEY_PEM` | recommended | Signing key of the ID tokens; empty = new key on every start |
| `DB_PASSWORD` | yes (Docker) | Password of the bundled database |
| `SSO_PORT` | no | Local port, default `8122` |
| `COOKIE_DOMAIN` | no | e.g. `.example.com`, so subdomain apps behind `auth_request` share the session |
| `WEBAUTHN_RP_ID` | no | Passkey domain if it should differ from `APP_URL` (a parent domain) |
| `SESSION_MAX_AGE_HOURS`, `TRUSTED_DEVICE_MAX_AGE_DAYS` | no | Default 24 hours / 30 days |
| `RATE_LIMIT_*` | no | See `.env.example` |
| `TENANT_KEY_ID` | no | Key identifier for data encryption, default `default` |

## Development

```bash
docker run -d --name sso-dev-db -p 127.0.0.1:5433:5432 -e POSTGRES_USER=sso -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=sso postgres:17-alpine
cd sso-app
cp .env.example .env
npm install
npx prisma migrate deploy && npx prisma db seed
npm run dev          # http://localhost:8122
```

Stack: Next.js 15 (App Router), TypeScript, Tailwind 3.4, Prisma 6, PostgreSQL 17, `@simplewebauthn`, `otplib`, `jose`, `nodemailer`, `sharp`. Architecture rules are in [`CLAUDE.md`](CLAUDE.md).

Translations: the German source text is the key (`t("Anmelden")`), English lives in `sso-app/src/lib/i18n/en`. `npm run i18n:check` lists missing entries (CI runs it).

New migration after a schema change: `npx prisma migrate dev --name <name>`.

## Security

Please don't report vulnerabilities as a public issue; use GitHub → Security → "Report a vulnerability".

On the design: uploaded SVG logos are checked for scripts, event handlers and external references and served with a sandboxing Content-Security-Policy. Changes to email delivery, Cloudflare and the MFA policy require the admin's password again, because whoever controls email delivery can read sign-in and reset codes. All changes end up in the audit log. The country lookup for the language choice uses a local database (`@ip-location-db`, CC0, derived from the regional internet registries' data); no IP is sent to third parties.

## License

[PolyForm Noncommercial License 1.0.0](LICENSE): free to use, modify and share for any noncommercial purpose (private use, hobby projects, research, education, charities and similar). Commercial use needs a separate agreement with the author. Note that this is a source-available license, not an OSI-approved open-source license.
