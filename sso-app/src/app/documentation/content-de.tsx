import { Badge } from "@/components/ui/badge";
import type { BrandView } from "@/lib/site-settings";
import { CodeBlock, InlineCode, Notice, Section, Table } from "./parts";

export interface DocsProps {
  brand: BrandView;
  appUrl: string;
  appExample: string;
  ssoHost: string;
  cookieDomain: string;
}

const TOC: { id: string; label: string }[] = [
  { id: "ueberblick", label: "Überblick" },
  { id: "zugangsdaten", label: "Zugangsdaten erhalten" },
  { id: "discovery", label: "Discovery & Schlüssel" },
  { id: "autorisierung", label: "1. Autorisierung anfordern" },
  { id: "token", label: "2. Token-Austausch" },
  { id: "id-token", label: "3. ID-Token prüfen" },
  { id: "userinfo", label: "4. Nutzerdaten abrufen" },
  { id: "profilbilder", label: "Profilbilder" },
  { id: "app-token", label: "App-Token-Flow" },
  { id: "berechtigungen", label: "Berechtigungen" },
  { id: "gast-zugang", label: "Gast-Zugang" },
  { id: "reverse-proxy", label: "Reverse-Proxy" },
  { id: "sicherheit", label: "Sicherheits-Checkliste" },
  { id: "fehler", label: "Fehlerreferenz" },
  { id: "support", label: "Support" },
];

export function DocsDe({ brand, appUrl, appExample, ssoHost, cookieDomain }: DocsProps) {
  return (
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10 sm:py-14">
          <div className="max-w-3xl mb-12">
            <Badge variant="default" className="mb-4">
              Öffentliche Dokumentation
            </Badge>
            <h1 className="text-3xl sm:text-4xl font-black text-foreground mb-4">
              SSO-Integration
            </h1>
            <p className="text-muted text-[15px] leading-relaxed">
              {brand.siteName} ist der zentrale Identity Provider für die Dienste dieser Installation. Anwendungen
              können sich auf mehreren gleichwertigen Wegen anbinden – per{" "}
              <strong className="text-foreground">OpenID Connect</strong>, per{" "}
              <strong className="text-foreground">App-Token-Flow</strong> oder über einen{" "}
              <strong className="text-foreground">Reverse-Proxy</strong>. Diese Seite
              beschreibt die öffentlichen Schnittstellen und enthält keine Zugangsdaten,
              Admin-Funktionen oder Betriebsinterna – sie kann gefahrlos geteilt werden.
            </p>
          </div>

          <div className="lg:grid lg:grid-cols-[220px_1fr] lg:gap-12">
            <nav className="hidden lg:block sticky top-20 self-start">
              <p className="text-xs font-bold text-muted uppercase tracking-widest mb-3">
                Inhalt
              </p>
              <ul className="space-y-1 text-sm">
                {TOC.map((item) => (
                  <li key={item.id}>
                    <a
                      href={`#${item.id}`}
                      className="block px-2 py-1 rounded-md text-muted hover:text-foreground hover:bg-surface-lighter transition-colors"
                    >
                      {item.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>

            <div className="max-w-3xl space-y-16 min-w-0">
              <Section id="ueberblick" title="Überblick">
                <p>
                  Je nach Anwendung passt einer dieser Integrationswege. Alle drei
                  werden vom SSO gleichermaßen unterstützt und lassen sich pro
                  Anwendung frei wählen.
                </p>
                <Table
                  head={["Weg", "Funktionsweise", "Geeignet für"]}
                  rows={[
                    ["OpenID Connect", "Standardisierter Authorization-Code-Flow; Identität über id_token, Profildaten über /oauth/userinfo", "Anwendungen und Bibliotheken, die OIDC/OAuth sprechen; Web-Apps, SPAs, mobile Apps"],
                    ["App-Token-Flow", "Weiterleitung zum SSO, danach serverseitiger Austausch des Codes mit einem App-Token", "Serverseitige Anwendungen mit eigenem Backend"],
                    ["Reverse-Proxy", "nginx auth_request prüft die SSO-Session, die Anwendung benötigt keinen eigenen Integrationscode", "Interne Tools und Admin-Oberflächen"],
                  ]}
                />
                <p>
                  Die Abschnitte 1 bis 4 beschreiben den OpenID-Connect-Ablauf
                  (Authorization-Code-Flow, OAuth 2.1 mit PKCE): Der Nutzer wird zu
                  {brand.siteName} weitergeleitet, meldet sich dort an (Passkey, Passwort + MFA),
                  und deine Anwendung erhält einen kurzlebigen, einmal verwendbaren
                  Autorisierungscode. Diesen tauschst du serverseitig gegen ein{" "}
                  <InlineCode>id_token</InlineCode> (Identität des Nutzers) und ein{" "}
                  <InlineCode>access_token</InlineCode> (für weitere API-Aufrufe) ein.
                  Die anderen beiden Wege stehen weiter unten.
                </p>
                <Table
                  head={["Client-Typ", "Wann verwenden", "Client Secret", "PKCE"]}
                  rows={[
                    ["confidential", "Serverseitige Web-Apps (Backend hält Secrets sicher)", "erforderlich", "empfohlen"],
                    ["public", "SPAs, mobile Apps, CLI-Tools (kein sicherer Speicherort für Secrets)", "kein Secret", "zwingend erforderlich"],
                  ]}
                />
                <p>
                  Alle Endpunkte werden ausschließlich über HTTPS angesprochen (außer
                  lokal via <InlineCode>localhost</InlineCode> in der Entwicklung).
                </p>
              </Section>

              <Section id="zugangsdaten" title="Zugangsdaten erhalten">
                <p>
                  Client-ID und Client-Secret (OpenID Connect) bzw. App-Token
                  (App-Token-Flow) werden nicht selbstständig erzeugt,
                  sondern von der SSO-Administration angelegt. Wende dich an das
                  Administrator dieser Installation mit folgenden Angaben:
                </p>
                <ul className="list-disc list-outside pl-5 space-y-1">
                  <li>Name der Anwendung</li>
                  <li>
                    Redirect-URI(s) – kein Wildcard, kein Präfix-Matching. Bei OpenID Connect
                    muss die URI exakt übereinstimmen; beim App-Token-Flow und hinter dem
                    Reverse-Proxy genügt die reine Origin (z. B.{" "}
                    <InlineCode>{appExample}/</InlineCode>), dann ist jeder Pfad
                    auf genau dieser Origin erlaubt. Betreibst du mehrere Instanzen mit denselben
                    Zugangsdaten, nenne die Origin <strong className="text-foreground">jeder</strong>{" "}
                    Instanz – eine Anwendung kann beliebig viele Redirect-URIs haben
                  </li>
                  <li>Gewünschter Integrationsweg und, bei OpenID Connect, Client-Typ (confidential oder public)</li>
                  <li>
                    Benötigte Berechtigungsstufen, falls über{" "}
                    <InlineCode>ALLOW</InlineCode>/<InlineCode>DENY</InlineCode> hinaus
                    differenziert werden soll
                  </li>
                </ul>
                <p>
                  Das Client-Secret wird dir <strong className="text-foreground">einmalig</strong> angezeigt
                  und muss sicher übergeben werden (z. B. über einen Passwort-Manager
                  mit geteiltem Zugriff) – niemals per Klartext-E-Mail oder Chat.
                  Geht ein Secret verloren oder ist es kompromittiert, lässt es sich
                  jederzeit rotieren; das alte Secret wird dabei sofort ungültig.
                </p>
              </Section>

              <Section id="discovery" title="Discovery & Signaturschlüssel">
                <p>
                  Alle Endpunkte, unterstützten Scopes und Signaturverfahren lassen
                  sich über das öffentliche OIDC-Discovery-Dokument ermitteln:
                </p>
                <CodeBlock>{`GET ${appUrl}/.well-known/openid-configuration`}</CodeBlock>
                <p>
                  Die öffentlichen Schlüssel zur Prüfung der Token-Signatur (RS256)
                  stehen als JWKS bereit:
                </p>
                <CodeBlock>{`GET ${appUrl}/.well-known/jwks.json`}</CodeBlock>
                <p>
                  Eine OIDC-/OAuth-Client-Bibliothek deiner Sprache kann dieses
                  Dokument automatisch auswerten, sodass Endpunkte nicht fest
                  verdrahtet werden müssen.
                </p>
              </Section>

              <Section id="autorisierung" title="1. Autorisierung anfordern">
                <p>
                  Leite den Nutzer zum Autorisierungs-Endpunkt weiter. Für{" "}
                  <InlineCode>public</InlineCode>-Clients ist PKCE Pflicht, für{" "}
                  <InlineCode>confidential</InlineCode>-Clients dringend empfohlen:
                </p>
                <CodeBlock>{`import crypto from "crypto";

const codeVerifier = crypto.randomBytes(32).toString("base64url");
const codeChallenge = crypto
  .createHash("sha256")
  .update(codeVerifier)
  .digest("base64url");
const state = crypto.randomBytes(16).toString("base64url");

// codeVerifier + state serverseitig an die Nutzer-Session binden
// (z.B. httpOnly-Cookie), NICHT an den Client (Browser) weitergeben.

const authorizeUrl = new URL("${appUrl}/oauth/authorize");
authorizeUrl.searchParams.set("client_id", CLIENT_ID);
authorizeUrl.searchParams.set("redirect_uri", "${appExample}/auth/callback");
authorizeUrl.searchParams.set("response_type", "code");
authorizeUrl.searchParams.set("scope", "openid profile email");
authorizeUrl.searchParams.set("state", state);
authorizeUrl.searchParams.set("code_challenge", codeChallenge);
authorizeUrl.searchParams.set("code_challenge_method", "S256");

res.redirect(authorizeUrl.toString());`}</CodeBlock>
                <p>
                  Die <InlineCode>redirect_uri</InlineCode> muss exakt einer registrierten
                  URI entsprechen. Andernfalls antwortet der SSO mit{" "}
                  <InlineCode>400 invalid_request</InlineCode> und leitet{" "}
                  <strong className="text-foreground">nicht</strong> weiter – fehlerhafte Ziele
                  lassen sich so nicht als Open Redirect missbrauchen. PKCE wird ausschließlich
                  mit <InlineCode>S256</InlineCode> unterstützt (<InlineCode>plain</InlineCode>{" "}
                  wird abgelehnt); ohne <InlineCode>code_challenge_method</InlineCode> gilt{" "}
                  <InlineCode>S256</InlineCode>.
                </p>
                <p>
                  Hat der Nutzer bereits eine gültige SSO-Session (Single Sign-On!),
                  erfolgt die Weiterleitung sofort ohne erneute Login-Eingabe. {brand.siteName}
                  leitet danach an deinen <InlineCode>redirect_uri</InlineCode> zurück –
                  entweder mit <InlineCode>?code=...&amp;state=...</InlineCode> oder,
                  bei fehlender Berechtigung, mit{" "}
                  <InlineCode>?error=access_denied&amp;state=...</InlineCode>.
                </p>
              </Section>

              <Section id="token" title="2. Token-Austausch">
                <p>
                  Der Autorisierungscode ist nur wenige Minuten gültig und exakt
                  einmal einlösbar. Tausche ihn <strong className="text-foreground">serverseitig</strong>{" "}
                  (niemals im Browser) gegen Tokens ein:
                </p>
                <CodeBlock>{`app.get("/auth/callback", async (req, res) => {
  const { code, state, error } = req.query;

  if (error) return res.status(403).send("Zugriff verweigert");
  if (!code || state !== session.oauthState) {
    return res.status(400).send("Ungültige Anfrage (State-Mismatch)");
  }

  const tokenRes = await fetch("${appUrl}/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: String(code),
      redirect_uri: "${appExample}/auth/callback",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET, // nur bei confidential-Clients; serverseitig!
      code_verifier: session.codeVerifier,
    }),
  });

  if (!tokenRes.ok) return res.status(401).send("Token-Austausch fehlgeschlagen");

  const tokens = await tokenRes.json();
  // tokens.id_token, tokens.access_token, tokens.expires_in, tokens.token_type
});`}</CodeBlock>
                <p>
                  Bei <InlineCode>public</InlineCode>-Clients entfällt{" "}
                  <InlineCode>client_secret</InlineCode>; stattdessen genügt der{" "}
                  <InlineCode>code_verifier</InlineCode> aus Schritt 1.{" "}
                  <InlineCode>client_id</InlineCode>/<InlineCode>client_secret</InlineCode>{" "}
                  können alternativ auch per HTTP-Basic-Auth-Header übertragen werden.
                  Der Endpunkt akzeptiert{" "}
                  <InlineCode>application/x-www-form-urlencoded</InlineCode> und{" "}
                  <InlineCode>application/json</InlineCode>; alle Parameter müssen Strings sein.
                  Pro IP-Adresse gilt ein Anfragelimit (<InlineCode>429 rate_limit_exceeded</InlineCode>),
                  und die Antworten sind mit <InlineCode>Cache-Control: no-store</InlineCode> versehen.
                </p>
              </Section>

              <Section id="id-token" title="3. ID-Token prüfen">
                <p>
                  Verifiziere Signatur und Claims des <InlineCode>id_token</InlineCode>{" "}
                  gegen die JWKS – vertraue niemals einem Token, dessen Signatur
                  nicht lokal geprüft wurde:
                </p>
                <CodeBlock>{`import { jwtVerify, createRemoteJWKSet } from "jose";

const JWKS = createRemoteJWKSet(
  new URL("${appUrl}/.well-known/jwks.json")
);

const { payload } = await jwtVerify(tokens.id_token, JWKS, {
  issuer: "${appUrl}",
  audience: CLIENT_ID,
});

// payload.sub ist die stabile, eindeutige Nutzer-ID – verwende sie
// als primären Schlüssel, niemals den Benutzernamen oder die E-Mail.`}</CodeBlock>
                <p>
                  Prüfe insbesondere, dass <InlineCode>aud</InlineCode> deiner{" "}
                  <InlineCode>client_id</InlineCode> entspricht und{" "}
                  <InlineCode>exp</InlineCode> nicht abgelaufen ist – die meisten
                  JWT-Bibliotheken erledigen das automatisch, sofern{" "}
                  <InlineCode>issuer</InlineCode> und <InlineCode>audience</InlineCode>{" "}
                  korrekt übergeben werden.
                </p>
              </Section>

              <Section id="userinfo" title="4. Nutzerdaten abrufen">
                <p>
                  Zusätzliche Profildaten lassen sich mit dem{" "}
                  <InlineCode>access_token</InlineCode> abrufen:
                </p>
                <CodeBlock>{`const res = await fetch("${appUrl}/oauth/userinfo", {
  headers: { Authorization: \`Bearer \${tokens.access_token}\` },
});
const profile = await res.json();
// { sub, permission, preferred_username, name, picture, email, email_verified }`}</CodeBlock>
                <p>
                  <InlineCode>email</InlineCode> und <InlineCode>email_verified</InlineCode>{" "}
                  kommen nur mit dem Scope <InlineCode>email</InlineCode> und nur, wenn der Nutzer
                  eine Adresse hinterlegt hat. <InlineCode>email_verified</InlineCode> ist{" "}
                  <InlineCode>true</InlineCode>, weil der SSO eine vom Nutzer eingetragene Adresse
                  erst übernimmt, nachdem ein Code bestätigt wurde, der an die neue Adresse
                  geschickt wird; von der Administration gesetzte Adressen gelten als geprüft.
                  Verknüpfe Konten dennoch über <InlineCode>sub</InlineCode>, nie über die Adresse.
                </p>
                <p>
                  Das Access Token ist eine Stunde gültig. Es gibt derzeit keinen
                  Refresh-Token-Grant – nach Ablauf führt eine erneute Weiterleitung
                  zu <InlineCode>/oauth/authorize</InlineCode> dank bestehender
                  SSO-Session ohne Login-Prompt zu einem neuen Token.
                </p>
              </Section>

              <Section id="profilbilder" title="Profilbilder">
                <p>
                  Nutzer können in den SSO-Einstellungen ein Profilbild hochladen. Es
                  wird als <InlineCode>picture</InlineCode>-Claim ausgeliefert – im{" "}
                  <InlineCode>id_token</InlineCode> und in der{" "}
                  <InlineCode>/oauth/userinfo</InlineCode>-Antwort, jeweils nur wenn der
                  Scope <InlineCode>profile</InlineCode> angefragt wurde und der Nutzer
                  ein Bild gesetzt hat. Hat der Nutzer keins, fehlt der Claim – zeige
                  dann einen eigenen Platzhalter (z. B. den Anfangsbuchstaben).
                </p>
                <CodeBlock>{`{
  "sub": "cm0abc...",
  "preferred_username": "max",
  "picture": "${appUrl}/api/avatar/cm0abc...?v=1790880605123"
}`}</CodeBlock>
                <p>
                  Die URL ist ein absoluter Link auf{" "}
                  <InlineCode>GET /api/avatar/&#123;sub&#125;</InlineCode> und kann direkt
                  in ein <InlineCode>&lt;img&gt;</InlineCode> eingebunden werden – ohne
                  Login, Token oder Cookie. Antwort: PNG, JPEG oder WebP (256×256,
                  max. 512 KB), <InlineCode>404</InlineCode> ohne Bild. Der Parameter{" "}
                  <InlineCode>v</InlineCode> ist eine Versionsnummer und ändert sich bei
                  jedem neuen Bild; die Antworten sind einen Tag cachebar, mit
                  gespeicherter URL bekommst du also automatisch die Cache-Invalidierung.
                </p>
                <CodeBlock>{`<img src="\${profile.picture}" alt="" width="40" height="40"
     referrerpolicy="no-referrer" />`}</CodeBlock>
                <p>
                  Setzt deine App eine Content-Security-Policy, muss{" "}
                  <InlineCode>{appUrl}</InlineCode> unter{" "}
                  <InlineCode>img-src</InlineCode> erlaubt sein. Die URL solltest du
                  bei jedem Login (bzw. Token-Abruf) neu übernehmen statt dauerhaft zu
                  speichern, damit geänderte oder entfernte Bilder nachgezogen werden.
                </p>
                <p>
                  Weitere Wege: Der Reverse-Proxy-Endpunkt{" "}
                  <InlineCode>/api/auth/verify</InlineCode> liefert den Header{" "}
                  <InlineCode>X-Avatar-Url</InlineCode>, und der App-Token-Austausch{" "}
                  <InlineCode>/api/auth/token</InlineCode> enthält das Feld{" "}
                  <InlineCode>picture</InlineCode> (<InlineCode>null</InlineCode> ohne
                  Bild).
                </p>
              </Section>

              <Section id="app-token" title="App-Token-Flow">
                <p>
                  Der App-Token-Flow ist ein schlanker Weg für serverseitige
                  Anwendungen. Statt Client-ID und Client-Secret verwendest du den
                  App-Token, den die SSO-Administration für deine Anwendung anlegt
                  (wird einmalig angezeigt). Der Ablauf besteht aus zwei Schritten.
                </p>
                <p>
                  <strong className="text-foreground">1. Weiterleitung.</strong> Leite den
                  Nutzer zum SSO. Die <InlineCode>redirect_uri</InlineCode> muss einer
                  registrierten URI entsprechen: exakt, oder – wenn die registrierte URI nur
                  aus der Origin besteht (z. B. <InlineCode>https://app.example.com/</InlineCode>) –
                  mit beliebigem Pfad auf genau dieser Origin. Nicht registrierte Ziele
                  werden ignoriert (kein Code, keine Weiterleitung). Ist sie nicht angegeben,
                  wird die erste registrierte verwendet. Nach dem Login (bzw. sofort bei
                  bestehender SSO-Session) landet der Nutzer mit einem Code bei dir:
                </p>
                <CodeBlock>{`${appUrl}/auth/login?app_id=DEINE_APP_ID&redirect_uri=https://app.example.com/callback&state=ZUFALLSWERT

→ https://app.example.com/callback?code=...&state=ZUFALLSWERT
→ bei fehlender Berechtigung: ?error=access_denied&state=ZUFALLSWERT`}</CodeBlock>
                <p>
                  Prüfe <InlineCode>state</InlineCode> gegen deinen gespeicherten Wert.
                  Der Code ist 5 Minuten gültig und nur einmal verwendbar.
                </p>
                <p>
                  <strong className="text-foreground">2. Code-Austausch (Server-zu-Server).</strong>
                </p>
                <CodeBlock>{`const res = await fetch("${appUrl}/api/auth/token", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ code, app_token: process.env.SSO_APP_TOKEN }),
});
const user = await res.json();
// { user_id, username, permission, picture }`}</CodeBlock>
                <p>
                  <InlineCode>permission</InlineCode> ist die Berechtigungsstufe des
                  Nutzers für deine Anwendung (siehe Berechtigungen). Der App-Token
                  gehört ausschließlich in dein Backend – niemals in Browser-Code oder
                  ein Repository.
                </p>
              </Section>

              <Section id="berechtigungen" title="Berechtigungen (Permission Levels)">
                <p>
                  Jede Anwendung definiert eigene Berechtigungsstufen (mindestens{" "}
                  <InlineCode>ALLOW</InlineCode> und <InlineCode>DENY</InlineCode>).
                  Hat ein Nutzer <InlineCode>DENY</InlineCode>, bricht{" "}
                  <InlineCode>/oauth/authorize</InlineCode> mit{" "}
                  <InlineCode>error=access_denied</InlineCode> ab, bevor überhaupt ein
                  Code ausgestellt wird – deine App muss diesen Fall nur noch
                  freundlich anzeigen.
                </p>
                <p>
                  Hat ein Nutzer keine eigene Zuweisung, gilt das Standard-Level der
                  Anwendung (in der Administration einstellbar, vorbelegt mit{" "}
                  <InlineCode>DENY</InlineCode>).
                </p>
                <p>
                  Feingranulare, app-spezifische Stufen (z. B. <InlineCode>ADMIN</InlineCode>,{" "}
                  <InlineCode>VIEWER</InlineCode>) liefert der SSO im Claim{" "}
                  <InlineCode>permission</InlineCode> – im <InlineCode>id_token</InlineCode> und
                  in der <InlineCode>/oauth/userinfo</InlineCode>-Antwort, unabhängig vom
                  angefragten Scope. Das id_token enthält die Stufe zum Zeitpunkt des
                  Token-Austauschs, <InlineCode>/oauth/userinfo</InlineCode> die aktuelle. Wird
                  der Zugriff entzogen (<InlineCode>DENY</InlineCode>), lehnt der SSO den
                  Austausch und weitere userinfo-Aufrufe ab.
                </p>
                <CodeBlock>{`{
  "sub": "cm0abc...",
  "permission": "ADMIN"
}`}</CodeBlock>
              </Section>

              <Section id="gast-zugang" title="Gast-Zugang">
                <p>
                  Nutzer können einem Gast für kurze Zeit Zugriff auf eine einzelne
                  Anwendung geben, ohne ihre übrigen Anwendungen freizugeben: Der Gast fordert
                  auf der Login-Seite einen QR-Code samt 6-stelligem Code an, der Besitzer des
                  Kontos bestätigt auf einem angemeldeten Gerät und legt die Dauer fest (1, 8
                  oder 24 Stunden). Der Gast bekommt <strong className="text-foreground">keine
                  SSO-Session</strong> und sieht nichts vom Konto; deine Anwendung erhält
                  Code, Token und Nutzerdaten wie bei jedem anderen Login. Jedes Konto kann
                  Gast-Zugänge in den eigenen Einstellungen ausschalten; für das Admin-Konto gibt es sie nicht.
                </p>
                <Notice title="Setze die Gast-Logik in deiner Anwendung um">
                  Der SSO kann einen Gast nur dort sofort beenden, wo er bei jeder Anfrage gefragt
                  wird. Die eigene Session deiner Anwendung kennt er nicht. Ohne Gast-Logik bleibt
                  der Gast nach Ablauf der Dauer oder nach dem vorzeitigen Beenden durch den
                  Besitzer so lange angemeldet, bis die Session deiner Anwendung endet, oft erst
                  nach Tagen. Das betrifft jede Anwendung mit eigener Session (OIDC und
                  App-Token). Nur der Reverse-Proxy-Schutz ist ohne Änderung abgedeckt.
                </Notice>
                <p>
                  Erkennbar ist ein Gast am Claim <InlineCode>guest: true</InlineCode> im{" "}
                  <InlineCode>id_token</InlineCode> und in der{" "}
                  <InlineCode>/oauth/userinfo</InlineCode>-Antwort, bei der App-Token-Variante
                  an <InlineCode>guest</InlineCode> und <InlineCode>expires_at</InlineCode> in der
                  Antwort von <InlineCode>/api/auth/token</InlineCode>, hinter dem Reverse-Proxy an{" "}
                  <InlineCode>X-Guest: 1</InlineCode> und <InlineCode>X-Guest-Expires</InlineCode>.
                  Access- und ID-Token laufen spätestens mit dem Gast-Zugang ab (<InlineCode>exp</InlineCode>);
                  Refresh-Tokens gibt es nicht.
                </p>
                <Table
                  head={["Anbindung", "Das beendet der SSO", "Das setzt deine Anwendung um"]}
                  rows={[
                    ["Reverse-Proxy (auth_request)", "Alles: Die Prüfung läuft bei jeder Anfrage, Beenden wirkt sofort.", "Nichts. Nur die Cookie-Map um sso_guest erweitern (siehe Reverse-Proxy-Schutz)."],
                    ["OIDC (authorize/token)", "Die Tokens: exp reicht höchstens bis zum Ende des Gast-Zugangs, es gibt keinen Refresh-Token. Nach dem Beenden sind Access-Token und /oauth/userinfo sofort ungültig.", "Claim guest auswerten und die eigene Session höchstens bis exp des ID-Tokens laufen lassen. Für sofortiges Beenden das Access-Token regelmäßig (z. B. alle 30–60 s) gegen /oauth/userinfo prüfen; bei 401 die Session beenden."],
                    ["App-Token (/api/auth/token)", "Nur neue Logins. Der Code wird einmal getauscht, danach fragt der SSO nicht mehr nach.", "guest und expires_at aus der Antwort lesen und die Session spätestens zu expires_at beenden. Für sofortiges Beenden die Gast-Session regelmäßig über /api/auth/verify prüfen (siehe unten); bei 401 die Session beenden."],
                  ]}
                />
                <p>
                  Antwort von <InlineCode>POST /api/auth/token</InlineCode> bei einem Gast:
                </p>
                <CodeBlock>{`{
  "user_id": "cm0abc...",
  "username": "max",
  "picture": null,
  "permission": "ALLOW",
  "guest": true,
  "expires_at": "2026-10-27T17:49:53.713Z"
}`}</CodeBlock>
                <p>
                  Die Gast-Prüfung für App-Token-Anwendungen: Gib nur das Cookie{" "}
                  <InlineCode>sso_guest</InlineCode> des Besuchers an den SSO weiter (nicht den
                  ganzen Cookie-Header, sonst gilt eine eventuell vorhandene SSO-Session). Das
                  Cookie hat die Domain <InlineCode>{cookieDomain}</InlineCode> und kommt nur bei
                  Anwendungen auf dieser Domain an (dafür muss <InlineCode>COOKIE_DOMAIN</InlineCode> gesetzt
                  sein). Dein Proxy darf es nicht entfernen. Anwendungen auf anderen Domains können nur{" "}
                  <InlineCode>expires_at</InlineCode> bzw. <InlineCode>exp</InlineCode> durchsetzen.
                </p>
                <CodeBlock>{`GET ${appUrl}/api/auth/verify?app_id=DEINE_APP_ID
Cookie: sso_guest=<Wert aus dem Browser des Besuchers>

200  Gast-Zugang gültig (Header X-Guest: 1, X-Guest-Expires)
401  beendet, abgelaufen oder für eine andere Anwendung -> Session beenden`}</CodeBlock>
              </Section>

              <Section id="reverse-proxy" title="Reverse-Proxy-Schutz">
                <p>
                  Für interne Tools ohne eigenen Login-Code lässt sich der Zugriff
                  auch komplett auf Ebene des Reverse-Proxys absichern (nginx{" "}
                  <InlineCode>auth_request</InlineCode>). Die Anwendung selbst
                  benötigt dann keinerlei SSO-Integrationscode:
                </p>
                <CodeBlock>{`# http-Ebene (einmal): Cookie-Header ohne sso_session/sso_trusted/sso_guest, für die App.
# Alle anderen Cookies der App bleiben unverändert; ein leeres Ergebnis lässt nginx den Header weglassen.
map $http_cookie $cookie_no_session {
    default $http_cookie;
    "~^(?<pre>(?:.*;\\s*)?)sso_session=[^;]*(?:;\\s*(?<post>.*))?$" "$pre$post";
}
map $cookie_no_session $cookie_no_trusted {
    default $cookie_no_session;
    "~^(?<pre2>(?:.*;\\s*)?)sso_trusted=[^;]*(?:;\\s*(?<post2>.*))?$" "$pre2$post2";
}
map $cookie_no_trusted $cookie_without_sso {
    default $cookie_no_trusted;
    "~^(?<pre3>(?:.*;\\s*)?)sso_guest=[^;]*(?:;\\s*(?<post3>.*))?$" "$pre3$post3";
}

location = /_sso_auth {
    internal;
    proxy_pass http://sso-backend/api/auth/verify?app_id=DEINE_APP_ID;
    proxy_pass_request_body off;
    proxy_set_header Content-Length "";
    proxy_set_header Cookie $http_cookie;                 # nur hier darf der SSO-Cookie mit
    proxy_set_header Host ${ssoHost};
    # echte Client-IP: nie vom Client mitgeschickte Header durchreichen
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    # optional, für das Audit-Log (welche Instanz/Seite wurde aufgerufen)
    proxy_set_header X-Original-Host $host;
    proxy_set_header X-Original-URI $request_uri;
    proxy_set_header X-Original-Method $request_method;
}

location / {
    auth_request /_sso_auth;

    auth_request_set $sso_id     $upstream_http_x_user_id;
    auth_request_set $sso_user   $upstream_http_x_username;
    auth_request_set $sso_perm   $upstream_http_x_permission;
    auth_request_set $sso_avatar $upstream_http_x_avatar_url;
    proxy_set_header X-User-Id    $sso_id;
    proxy_set_header X-Username   $sso_user;
    proxy_set_header X-Permission $sso_perm;
    proxy_set_header X-Avatar-Url $sso_avatar;

    proxy_set_header Cookie $cookie_without_sso;          # SSO-Cookie nicht an die App weiterreichen
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $remote_addr;

    error_page 401 = @sso_login;
    proxy_pass http://app-backend;
}

location @sso_login {
    # Origin der App (https://app.example.com/) im SSO als Redirect-URI registrieren
    return 302 ${appUrl}/auth/login?app_id=DEINE_APP_ID&redirect_uri=$scheme://$host$request_uri;
}`}</CodeBlock>
                <p>
                  Der Endpunkt <InlineCode>/api/auth/verify</InlineCode> antwortet mit{" "}
                  <InlineCode>200</InlineCode> und den Headern{" "}
                  <InlineCode>X-User-Id</InlineCode>, <InlineCode>X-Username</InlineCode>,{" "}
                  <InlineCode>X-Permission</InlineCode>, <InlineCode>X-Email</InlineCode> (nur wenn
                  eine Adresse hinterlegt ist) und <InlineCode>X-Avatar-Url</InlineCode> (nur mit
                  Profilbild). Bei einem Gast-Zugang (siehe Gast-Zugang) kommen{" "}
                  <InlineCode>X-Guest: 1</InlineCode> und <InlineCode>X-Guest-Expires</InlineCode>{" "}
                  dazu; das Cookie <InlineCode>sso_guest</InlineCode> gilt nur für die
                  Anwendung, für die es ausgestellt wurde. Ohne gültige Session kommt <InlineCode>401</InlineCode>; bei{" "}
                  <InlineCode>DENY</InlineCode>, deaktivierter oder unbekannter Anwendung sowie bei
                  Konten, die noch ein temporäres Passwort ändern müssen, <InlineCode>403</InlineCode>.
                  Fehlt <InlineCode>app_id</InlineCode> (bzw. der Header{" "}
                  <InlineCode>X-App-Token</InlineCode>), antwortet der Endpunkt mit{" "}
                  <InlineCode>400</InlineCode>, statt irgendeinen angemeldeten Nutzer
                  durchzulassen – eine Proxy-Konfiguration ohne App-Kennung fällt also sofort auf.
                </p>
                <p>
                  Die Header <InlineCode>X-Real-IP</InlineCode> und{" "}
                  <InlineCode>X-Forwarded-For</InlineCode> müssen im Subrequest{" "}
                  <InlineCode>$remote_addr</InlineCode> enthalten (nicht{" "}
                  <InlineCode>$proxy_add_x_forwarded_for</InlineCode>): Der SSO wertet die IP für
                  Audit-Log und Anfragelimits aus und vertraut nur dem Proxy, nie einem
                  vom Client gesetzten Wert. <InlineCode>X-Original-Host</InlineCode>,{" "}
                  <InlineCode>X-Original-URI</InlineCode> und{" "}
                  <InlineCode>X-Original-Method</InlineCode> sind optional; sie erscheinen im
                  Audit-Log und unterscheiden mehrere Instanzen, die dieselbe Anwendung (dieselbe{" "}
                  <InlineCode>app_id</InlineCode>) nutzen. Jede dieser Instanzen muss unter{" "}
                  <InlineCode>{cookieDomain}</InlineCode> per HTTPS laufen, weil das Session-Cookie nur
                  dort gilt.
                </p>
                <p>
                  Die geschützte Anwendung erhält die verifizierte Nutzeridentität
                  ausschließlich über Header, die vom Proxy gesetzt werden – die App
                  darf diesen Headern nur vertrauen, wenn sie{" "}
                  <strong className="text-foreground">ausschließlich</strong> über den Proxy
                  erreichbar ist (kein direkter Zugriff auf den Origin-Port von außen).
                  Diese Variante eignet sich für interne Admin-Oberflächen, nicht für
                  Anwendungen, die auch von außerhalb deines Netzwerks direkt
                  erreichbar sein müssen.
                </p>
              </Section>

              <Section id="sicherheit" title="Sicherheits-Checkliste">
                <ul className="space-y-2">
                  {[
                    "Ausschließlich HTTPS in Produktion – kein http:// außer localhost in der Entwicklung.",
                    "redirect_uri registrieren lassen (exakt oder als reine Origin); niemals Wildcards oder dynamische Werte akzeptieren.",
                    "state bei jedem Callback prüfen: zufälligen Wert vor der Weiterleitung in einem httpOnly-Cookie ablegen und im Callback abgleichen und löschen (sonst Login-CSRF: ein Angreifer schiebt dem Nutzer seinen Code unter).",
                    "PKCE verwenden – bei public Clients zwingend, bei confidential Clients als zusätzliche Verteidigungsebene.",
                    "client_secret ausschließlich serverseitig speichern und verwenden – niemals in Frontend-Code, Mobile-Apps oder Git-Repositories.",
                    "id_token immer lokal gegen die JWKS verifizieren (Signatur, issuer, audience, Ablauf) – nicht ungeprüft dekodieren.",
                    "access_token nicht loggen und bei SPAs nicht in localStorage ablegen; bevorzugt serverseitige Sessions (Backend-for-Frontend).",
                    "Eigene Session-Cookies der Anwendung als httpOnly, secure und sameSite=lax|strict setzen.",
                    "Hinter nginx auth_request: die SSO-Cookies (sso_session, sso_trusted, sso_guest) nicht an die App weiterreichen (proxy_set_header Cookie $cookie_without_sso), die App braucht sie nicht. Das Cookie gilt für alle Subdomains der COOKIE_DOMAIN; eine kompromittierte App könnte sonst die Session übernehmen.",
                    "Hinter nginx auth_request: X-Real-IP und X-Forwarded-For im Subrequest auf $remote_addr setzen, nie auf vom Client gelieferte Werte.",
                    "Den Identity-Headern (X-User-Id, X-Username, X-Permission) nur trauen, wenn die App ausschließlich über den Proxy erreichbar ist; vom Client mitgeschickte Header gleichen Namens im Proxy überschreiben.",
                    "Konten in deiner App über sub bzw. user_id verknüpfen, nie über E-Mail oder Benutzernamen (beides können Nutzer ändern bzw. wiederverwenden).",
                    "error=access_denied und andere Fehlerfälle von /oauth/authorize sauber behandeln, statt sie zu ignorieren.",
                    "Client-Secrets regelmäßig rotieren und nach Verdacht auf Kompromittierung sofort neu ausstellen lassen.",
                  ].map((tip) => (
                    <li key={tip} className="flex gap-3 text-sm leading-relaxed">
                      <span className="text-success shrink-0" aria-hidden>
                        ✓
                      </span>
                      <span>{tip}</span>
                    </li>
                  ))}
                </ul>
              </Section>

              <Section id="fehler" title="Fehlerreferenz">
                <Table
                  head={["Fehler", "HTTP-Status", "Bedeutung"]}
                  rows={[
                    ["invalid_request", "400", "Pflichtparameter fehlen oder sind fehlerhaft."],
                    ["invalid_client", "400", "Unbekannte oder inaktive client_id."],
                    ["invalid_grant", "400", "Code ungültig, abgelaufen, bereits verwendet oder PKCE/Secret-Prüfung fehlgeschlagen."],
                    ["unsupported_grant_type", "400", "Nur authorization_code wird unterstützt."],
                    ["access_denied", "Redirect", "Nutzer hat keine Berechtigung (DENY) für diese Anwendung."],
                    ["invalid_token", "401", "access_token an /oauth/userinfo ist ungültig oder abgelaufen."],
                    ["rate_limit_exceeded", "429", "Zu viele Anfragen in kurzer Zeit – mit Backoff erneut versuchen."],
                  ]}
                />
                <p>
                  <InlineCode>invalid_request</InlineCode> tritt bei{" "}
                  <InlineCode>/oauth/authorize</InlineCode> auch auf, wenn die{" "}
                  <InlineCode>redirect_uri</InlineCode> nicht registriert ist, ein public Client
                  ohne <InlineCode>code_challenge</InlineCode> anfragt oder eine andere Methode als{" "}
                  <InlineCode>S256</InlineCode> verlangt wird. In diesen Fällen gibt es bewusst
                  keine Weiterleitung.
                </p>
                <p>Die anderen beiden Wege melden Fehler über den HTTP-Status:</p>
                <Table
                  head={["Endpunkt", "HTTP-Status", "Bedeutung"]}
                  rows={[
                    ["/api/auth/token", "400", "Body ist kein gültiges JSON oder code/app_token fehlen."],
                    ["/api/auth/token", "401", "Code ungültig, abgelaufen, bereits verwendet oder App-Token passt nicht zur Anwendung."],
                    ["/api/auth/token", "429", "Zu viele Anfragen von dieser IP-Adresse."],
                    ["/api/auth/verify", "400", "Weder app_id noch X-App-Token übergeben."],
                    ["/api/auth/verify", "401", "Keine oder abgelaufene SSO-Session."],
                    ["/api/auth/verify", "403", "Berechtigung DENY, Anwendung deaktiviert/unbekannt oder Passwortänderung erforderlich."],
                  ]}
                />
              </Section>

              <Section id="support" title="Support">
                <p>
                  Fragen zur Integration, Anträge auf neue App-Zugangsdaten oder
                  Meldungen zu Sicherheitsproblemen bitte über die offiziellen
                  Wege des Betreibers einreichen – nicht per unverschlüsselter Nachricht
                  mit Zugangsdaten im Klartext.
                </p>
                {brand.contactUrl && (
                  <a
                    href={brand.contactUrl}
                    className="inline-flex items-center gap-2 text-sm font-bold text-foreground hover:underline"
                  >
                    Kontakt aufnehmen →
                  </a>
                )}
              </Section>
            </div>
          </div>
        </div>
  );
}
