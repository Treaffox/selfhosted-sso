# SSO

Selbst gehosteter Single-Sign-On-Server mit Passkeys, MFA und OpenID Connect. Er läuft auf deinem eigenen Server, gehört dir und sieht aus wie dein Dienst: Name, Logo, Favicon, E-Mail-Versand und Footer stellst du im Browser ein, nicht im Code.

> Die Oberfläche gibt es auf Deutsch und Englisch. Jeder Nutzer wählt seine Sprache in den Einstellungen; ohne Auswahl gilt Deutsch bei deutscher Browsersprache oder einer IP aus Deutschland, Österreich und der Schweiz, sonst Englisch. [English version](README.md)

## Was drin ist

- **Anmeldung:** Benutzername → Passkey **oder** Passwort → MFA (Authenticator-App, E-Mail-Code, Wiederherstellungscodes). MFA ist standardmäßig verpflichtend und lässt sich im Admin-Bereich auf „optional“ stellen.
- **Anmeldung auf einem anderen Gerät und als Gast:** Statt ein Passwort einzutippen, zeigt ein Gerät einen QR-Code und einen 6-stelligen Code, und der Besitzer gibt auf einem bereits angemeldeten Gerät frei. Ein Gast bekommt zeitlich begrenzten Zugriff (1, 8 oder 24 Stunden) auf genau eine App, ohne Sitzung im SSO. Beides ist standardmäßig an; jeder Nutzer kann es in den Einstellungen ausschalten. Mit einem MaxMind-Konto (**System → GeoIP**) zeigt die Freigabe zusätzlich einen ungefähren Standort.
- **Für deine Apps:** OpenID Connect (Authorization Code + PKCE, Discovery, JWKS, Userinfo), ein einfacher App-Token-Flow und nginx-`auth_request` für Apps ohne eigenen Login-Code.
- **Verwaltung im Browser:** Nutzer, Apps und Berechtigungen, Audit-Log mit Filtern, Sitzungen und vertraute Geräte.
- **Anpassbar im Browser (Admin → System):** Name, Untertitel, Logo (hell/dunkel), Favicon, Footer-Links, E-Mail-Design, E-Mail-Anbieter mit Ersatz-Anbieter, optional Cloudflare für DNS-Einträge.
- **Sicherheit:** serverseitige Sitzungen, personenbezogene Daten verschlüsselt in der Datenbank (AES-256-GCM), Rate-Limits pro IP und Konto, CSRF-Schutz, Passwort-Bestätigung für sensible Änderungen, Audit-Log für alles Wichtige.

## Einrichtung

Du brauchst einen Server mit Docker (Compose v2) und eine Domain, die auf ihn zeigt. Zum reinen Ausprobieren reicht `http://localhost:8122`.

```bash
git clone <dieses-repository> sso && cd sso

./setup.sh                      # fragt nach der Adresse, erzeugt .env mit allen Geheimnissen + Admin-Passwort
docker compose up -d --build    # startet Datenbank + SSO, legt das Admin-Konto an
```

Dann die Adresse öffnen, mit dem Admin-Konto aus der Ausgabe von `setup.sh` anmelden und die Einrichtung unter **System** abschließen. Das Admin-Passwort gibt es nicht vorgegeben: `setup.sh` würfelt es, zeigt es einmal an und schreibt es als `MASTER_PASSWORD` in die `.env`. Bei verpflichtendem MFA richtest du beim ersten Admin-Login eine Authenticator-App oder einen Passkey ein.

`./setup.sh` braucht Node.js **oder** Docker. Ohne beides: `.env.example` nach `.env` kopieren und von Hand ausfüllen (jedes Geheimnis mit `openssl rand -hex 32`).

### HTTPS

Passkeys und sichere Cookies funktionieren nur über HTTPS (Ausnahme: `localhost`). Stelle einen Reverse-Proxy davor, der auf `127.0.0.1:8122` zeigt:

- **Caddy** (am einfachsten, Zertifikate automatisch): [`Caddyfile.example`](Caddyfile.example)
- **nginx:** [`nginx/sso.conf.example`](nginx/sso.conf.example) (+ [`nginx/sso-ratelimit.conf`](nginx/sso-ratelimit.conf))

Trage dieselbe Adresse als `APP_URL` in der `.env` ein. Wichtig: Der Proxy muss `X-Real-IP` setzen; die Beispiele tun das. Die App vertraut nie einer vom Client gesendeten IP.

## Wo stelle ich was ein?

| Was | Wo |
|---|---|
| Öffentliche Adresse, Geheimnisse, erstes Admin-Konto, Datenbank-Passwort | `.env` auf dem Server (`./setup.sh`) |
| Name, Untertitel, Betreiber, Kontakt-Link, Footer-Links, Zeitzone | Browser → **System → Erscheinungsbild** |
| Logo, Logo für hellen Hintergrund, Favicon | Browser → **System → Erscheinungsbild** |
| E-Mail-Farben und -Logo | Browser → **System → Erscheinungsbild** |
| E-Mail-Anbieter, Absender, Ersatz-Anbieter, Testmail | Browser → **System → E-Mail** |
| MaxMind-Konto für Standorte zu IP-Adressen (GeoIP) | Browser → **System → GeoIP** |
| Cloudflare-Token und Zonen-ID (optional) | Browser → **System → Cloudflare** |
| Nutzer, Apps, Berechtigungen, Redirect-URIs | Browser → **Nutzer** / **Apps** |
| MFA verpflichtend oder optional | Browser → **System → Sicherheit** |
| Sprache der Oberfläche und der E-Mails | jeder Nutzer selbst unter **Einstellungen → Sprache** |
| Sitzungsdauer, Rate-Limits, Cookie-Domain (optional) | `.env` (siehe `.env.example`) |

Die Seite **System → Übersicht** zeigt eine Checkliste mit allem, was noch offen ist, und die aktuell wirksamen Werte aus der `.env`.

### E-Mail-Anbieter

Ohne Mailversand kommen keine Bestätigungscodes und Willkommensmails an. Zur Auswahl stehen:

- **Eigener Server:** beliebiger SMTP-Server (STARTTLS, SSL/TLS oder unverschlüsselt für interne Relays, mit oder ohne Login)
- **Per SMTP, mit vorgefüllten Servern:** Google (Gmail/Workspace), Microsoft 365, Amazon SES, Mailjet, SMTP2GO, IONOS, Strato, Mailtrap Sandbox (zum Testen, es wird nichts zugestellt)
- **Per API:** Brevo, Resend, SendGrid, Mailgun, Postmark, Mailtrap (Email Sending)

Jeder Anbieter zeigt seine Felder mit Hilfetext und einem Link zur Stelle, an der du die Zugangsdaten anlegst. Zusätzlich kannst du einen **Ersatz-Anbieter** hinterlegen, der einspringt, wenn der Haupt-Anbieter ausfällt. Mit **Testmail senden** prüfst du jeden Anbieter einzeln und siehst die echte Fehlermeldung. Zugangsdaten werden verschlüsselt gespeichert und nie wieder angezeigt; Speichern verlangt dein Passwort.

Empfohlene Größen (stehen auch neben den Upload-Feldern, rechts daneben zeigt eine Live-Vorschau Tab, Kopfzeile und Anmeldeseite im hellen und dunklen Design): Logo etwa 480 × 120 px (4 : 1, mindestens 64 px hoch, wird 24 px hoch im Header, 32 px hoch auf der Anmeldeseite und 140 px breit in E-Mails gezeigt), Favicon 256 × 256 px quadratisch (mindestens 64 × 64 px, angezeigt mit 16 bis 32 px). Unpassende Bilder (zu klein, fast quadratisch, JPEG ohne Transparenz) markiert die Seite mit einem Hinweis.

Logo-Uploads: PNG, SVG, WebP, JPEG; beim Favicon werden JPG, WebP, GIF und PNG in ein quadratisches PNG umgewandelt, SVG und ICO bleiben unverändert. Das Logo in E-Mails wird als PNG von `APP_URL` geladen (SVG-Uploads werden dafür automatisch umgewandelt). Die Adresse muss deshalb aus dem Internet erreichbar sein, sonst zeigen Mailprogramme das Bild nicht.

## Apps anbinden

1. **Apps → Neue App** anlegen und die Redirect-URI(s) eintragen.
2. OpenID-Connect-Zugangsdaten erzeugen (Client-ID/Secret) oder den App-Token nutzen.
3. Die öffentliche Dokumentation unter `<deine-adresse>/documentation` enthält Beispiele für alle drei Wege, mit deiner Adresse bereits eingesetzt.
4. Für nginx-`auth_request`: [`nginx/protected-app.conf.example`](nginx/protected-app.conf.example) und [`nginx/sso-cookie-strip.conf`](nginx/sso-cookie-strip.conf).

Eine lauffähige Beispiel-App (Express) liegt in [`test-app/`](test-app), Start mit `docker-compose.example-app.yml`.

## Betrieb

```bash
docker compose logs -f sso                  # Logs
git pull && docker compose up -d --build    # Update (Migrationen laufen beim Start automatisch)
docker compose exec -T db pg_dump -U sso sso | gzip > sso-$(date +%F).sql.gz    # Datenbank-Backup
```

**Sichere die `.env` getrennt von der Datenbank.** Ohne `DATA_ENCRYPTION_KEY` sind verschlüsselte Daten (E-Mail-Adressen, IPs, Audit-Log, Profilbilder) nicht mehr lesbar; ohne `ENCRYPTION_KEY` sind die gespeicherten E-Mail- und Cloudflare-Zugangsdaten unbrauchbar (dann neu eintragen); ohne `OIDC_PRIVATE_KEY_PEM` wechselt der Signaturschlüssel und ausgestellte Tokens werden ungültig.

Die Datenbank (PostgreSQL 17) lauscht nur im Docker-Netz. Die Compose-Datei sperrt Auto-Updater (Watchtower, WUD) für den Datenbank-Container, weil ein automatischer Sprung auf eine neue Hauptversion die Datenbank unbrauchbar macht.

**Wechsel auf PostgreSQL 18.** Die App läuft auch mit PostgreSQL 18 (getestet). Eine neue Hauptversion startet nicht auf dem alten Datenverzeichnis, deshalb wird eine bestehende Installation per Dump/Restore umgezogen. Das alte Volume bleibt bis zum Schluss erhalten:

```bash
docker compose stop sso                                                              # 1. App zuerst stoppen: nach dem Dump darf nichts mehr geschrieben werden
docker compose exec -T db pg_dump -U sso --clean --if-exists sso > sso-pg17.sql    # 2. Dump
docker compose down                                                                  # 3. stoppen (Volumes bleiben)
# 4. docker-compose.yml, Dienst "db": image: postgres:18-alpine und ein NEUES Volume, eingehängt unter
#    /var/lib/postgresql (PostgreSQL-18-Images nutzen /var/lib/postgresql/data nicht mehr), z. B. sso-pgdata18
docker compose up -d db
until docker compose logs db 2>&1 | grep -q "init process complete"; do sleep 1; done  # 5. warten, bis die Ersteinrichtung durch ist
docker compose exec -T db psql -U sso -d sso -v ON_ERROR_STOP=1 < sso-pg17.sql      # 6. Restore
docker compose up -d sso
```

## Konfigurationsreferenz (`.env`)

| Variable | Pflicht | Bedeutung |
|---|---|---|
| `APP_URL` | ja | Öffentliche Adresse ohne Pfad, z. B. `https://sso.example.com`. Bestimmt OIDC-Issuer, Passkey-Domain, Links in E-Mails |
| `MASTER_USERNAME`, `MASTER_PASSWORD` | ja | Erstes Admin-Konto, wird nur angelegt, solange es noch keinen Admin gibt |
| `SESSION_SECRET`, `ENCRYPTION_KEY`, `DATA_ENCRYPTION_KEY` | ja | Geheimnisse, jeweils `openssl rand -hex 32` |
| `OIDC_PRIVATE_KEY_PEM` | empfohlen | Signaturschlüssel der ID-Tokens; leer = neuer Schlüssel bei jedem Start |
| `DB_PASSWORD` | ja (Docker) | Passwort der mitgelieferten Datenbank |
| `SSO_PORT` | nein | Lokaler Port, Standard `8122` |
| `COOKIE_DOMAIN` | nein | z. B. `.example.com`, damit Subdomain-Apps hinter `auth_request` die Sitzung teilen |
| `WEBAUTHN_RP_ID` | nein | Passkey-Domain, falls sie von `APP_URL` abweichen soll (übergeordnete Domain) |
| `SESSION_MAX_AGE_HOURS`, `TRUSTED_DEVICE_MAX_AGE_DAYS` | nein | Standard 24 Stunden / 30 Tage |
| `RATE_LIMIT_*` | nein | Siehe `.env.example` |
| `TENANT_KEY_ID` | nein | Schlüssel-Kennung für die Datenverschlüsselung, Standard `default` |

## Entwicklung

```bash
docker run -d --name sso-dev-db -p 127.0.0.1:5433:5432 -e POSTGRES_USER=sso -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=sso postgres:17-alpine
cd sso-app
cp .env.example .env
npm install
npx prisma migrate deploy && npx prisma db seed
npm run dev          # http://localhost:8122
```

Stack: Next.js 16 (App Router), TypeScript, Tailwind 3.4, Prisma 6, PostgreSQL 17, `@simplewebauthn`, `otplib`, `jose`, `nodemailer`, `sharp`.

Neue Migration nach einer Schema-Änderung: `npx prisma migrate dev --name <name>`.

## Sicherheit

Schwachstellen bitte nicht öffentlich als Issue melden, sondern über GitHub → Security → „Report a vulnerability“.

Die Länderbestimmung für die Sprachwahl läuft über eine lokale Datenbank (`@ip-location-db`, CC0, aus den Daten der regionalen Internetregistries); es wird keine IP an Dritte gesendet. Dasselbe gilt für den optionalen Standort zu IP-Adressen (GeoLite2 von MaxMind): MaxMind bekommt nur die Download-Anfrage mit deinem Konto, die Abfragen laufen auf deinem Server. Die Datenbank liegt im Volume `sso-geoip` und gehört nicht zu diesem Repository (die MaxMind-Lizenz erlaubt keine Weitergabe).

Zum Design: Hochgeladene SVG-Logos werden auf Skripte, Event-Handler und externe Verweise geprüft und mit einer sandboxenden Content-Security-Policy ausgeliefert. Änderungen an E-Mail-Versand und Cloudflare verlangen das Passwort des Admins erneut, weil wer den Mailversand kontrolliert, Anmelde- und Reset-Codes mitlesen kann. Alle Änderungen landen im Audit-Log.

## Lizenz

[PolyForm Noncommercial License 1.0.0](LICENSE.md): frei nutzbar, veränderbar und weitergebbar für jeden nichtkommerziellen Zweck (privat, Hobby, Forschung, Bildung, gemeinnützige Organisationen u. Ä.). Unternehmen, die es kommerziell nutzen möchten, können eine kommerzielle Lizenz unter contact@trfx.de anfragen. Es handelt sich um eine „source-available“-Lizenz, nicht um eine von der OSI anerkannte Open-Source-Lizenz.
