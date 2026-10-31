import { Badge } from "@/components/ui/badge";
import { CodeBlock, InlineCode, Notice, Section, Table } from "./parts";
import type { DocsProps } from "./content-de";

const TOC: { id: string; label: string }[] = [
  { id: "ueberblick", label: "Overview" },
  { id: "zugangsdaten", label: "Getting credentials" },
  { id: "discovery", label: "Discovery & keys" },
  { id: "autorisierung", label: "1. Request authorization" },
  { id: "token", label: "2. Token exchange" },
  { id: "id-token", label: "3. Verify the ID token" },
  { id: "userinfo", label: "4. Fetch user data" },
  { id: "profilbilder", label: "Profile pictures" },
  { id: "app-token", label: "App token flow" },
  { id: "berechtigungen", label: "Permissions" },
  { id: "gast-zugang", label: "Guest access" },
  { id: "reverse-proxy", label: "Reverse proxy" },
  { id: "sicherheit", label: "Security checklist" },
  { id: "fehler", label: "Error reference" },
  { id: "support", label: "Support" },
];

export function DocsEn({ brand, appUrl, appExample, ssoHost, cookieDomain }: DocsProps) {
  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10 sm:py-14">
      <div className="max-w-3xl mb-12">
        <Badge variant="default" className="mb-4">
          Public documentation
        </Badge>
        <h1 className="text-3xl sm:text-4xl font-black text-foreground mb-4">SSO integration</h1>
        <p className="text-muted text-[15px] leading-relaxed">
          {brand.siteName} is the central identity provider for the services of this installation. Applications can connect in several equivalent ways – via{" "}
          <strong className="text-foreground">OpenID Connect</strong>, via the <strong className="text-foreground">app token flow</strong> or through a{" "}
          <strong className="text-foreground">reverse proxy</strong>. This page describes the public interfaces and contains no credentials, admin functions or operational internals – it is safe to share.
        </p>
      </div>

      <div className="lg:grid lg:grid-cols-[220px_1fr] lg:gap-12">
        <nav className="hidden lg:block sticky top-20 self-start">
          <p className="text-xs font-bold text-muted uppercase tracking-widest mb-3">Contents</p>
          <ul className="space-y-1 text-sm">
            {TOC.map((item) => (
              <li key={item.id}>
                <a href={`#${item.id}`} className="block px-2 py-1 rounded-md text-muted hover:text-foreground hover:bg-surface-lighter transition-colors">
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="max-w-3xl space-y-16 min-w-0">
          <Section id="ueberblick" title="Overview">
            <p>Depending on the application, one of these integration paths fits. The SSO supports all three equally and you can choose freely per application.</p>
            <Table
              head={["Path", "How it works", "Suited for"]}
              rows={[
                ["OpenID Connect", "Standard authorization code flow; identity via id_token, profile data via /oauth/userinfo", "Applications and libraries that speak OIDC/OAuth; web apps, SPAs, mobile apps"],
                ["App token flow", "Redirect to the SSO, then a server-side exchange of the code with an app token", "Server-side applications with their own backend"],
                ["Reverse proxy", "nginx auth_request checks the SSO session, the application needs no integration code of its own", "Internal tools and admin interfaces"],
              ]}
            />
            <p>
              Sections 1 to 4 describe the OpenID Connect flow (authorization code flow, OAuth 2.1 with PKCE): the user is redirected to {brand.siteName}, signs in there (passkey, password + MFA), and your application receives a short-lived, single-use authorization code.
              You exchange it on the server for an <InlineCode>id_token</InlineCode> (identity of the user) and an <InlineCode>access_token</InlineCode> (for further API calls). The other two paths follow further below.
            </p>
            <Table
              head={["Client type", "When to use", "Client secret", "PKCE"]}
              rows={[
                ["confidential", "Server-side web apps (the backend keeps secrets safe)", "required", "recommended"],
                ["public", "SPAs, mobile apps, CLI tools (no safe place to store secrets)", "no secret", "mandatory"],
              ]}
            />
            <p>
              All endpoints are only called over HTTPS (except locally via <InlineCode>localhost</InlineCode> during development).
            </p>
          </Section>

          <Section id="zugangsdaten" title="Getting credentials">
            <p>
              Client ID and client secret (OpenID Connect) or the app token (app token flow) are not created by yourself but set up by the SSO administration. Contact the administrator of this installation with the following details:
            </p>
            <ul className="list-disc list-outside pl-5 space-y-1">
              <li>Name of the application</li>
              <li>
                Redirect URI(s) – no wildcards, no prefix matching. With OpenID Connect the URI must match exactly; with the app token flow and behind the reverse proxy the bare origin is enough (e.g.{" "}
                <InlineCode>{appExample}/</InlineCode>), then every path on exactly this origin is allowed. If you run several instances with the same credentials, list the origin of{" "}
                <strong className="text-foreground">every</strong> instance – an application can have any number of redirect URIs
              </li>
              <li>Desired integration path and, for OpenID Connect, client type (confidential or public)</li>
              <li>
                Required permission levels, if you need to differentiate beyond <InlineCode>ALLOW</InlineCode>/<InlineCode>DENY</InlineCode>
              </li>
            </ul>
            <p>
              The client secret is shown to you <strong className="text-foreground">only once</strong> and must be handed over securely (e.g. through a password manager with shared access) – never by plain-text email or chat. If a secret is lost or compromised it can be rotated at any time; the old secret becomes invalid immediately.
            </p>
          </Section>

          <Section id="discovery" title="Discovery & signing keys">
            <p>All endpoints, supported scopes and signing algorithms can be found in the public OIDC discovery document:</p>
            <CodeBlock>{`GET ${appUrl}/.well-known/openid-configuration`}</CodeBlock>
            <p>The public keys for verifying the token signature (RS256) are available as a JWKS:</p>
            <CodeBlock>{`GET ${appUrl}/.well-known/jwks.json`}</CodeBlock>
            <p>An OIDC/OAuth client library for your language can read this document automatically, so endpoints don't have to be hard-coded.</p>
          </Section>

          <Section id="autorisierung" title="1. Request authorization">
            <p>
              Redirect the user to the authorization endpoint. PKCE is mandatory for <InlineCode>public</InlineCode> clients and strongly recommended for <InlineCode>confidential</InlineCode> clients:
            </p>
            <CodeBlock>{`import crypto from "crypto";

const codeVerifier = crypto.randomBytes(32).toString("base64url");
const codeChallenge = crypto
  .createHash("sha256")
  .update(codeVerifier)
  .digest("base64url");
const state = crypto.randomBytes(16).toString("base64url");

// bind codeVerifier + state to the user's session on the server
// (e.g. httpOnly cookie), do NOT hand them to the client (browser).

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
              The <InlineCode>redirect_uri</InlineCode> must match a registered URI exactly. Otherwise the SSO answers with <InlineCode>400 invalid_request</InlineCode> and does{" "}
              <strong className="text-foreground">not</strong> redirect – so faulty targets can't be abused as an open redirect. PKCE is only supported with <InlineCode>S256</InlineCode> (<InlineCode>plain</InlineCode> is rejected);
              without <InlineCode>code_challenge_method</InlineCode> <InlineCode>S256</InlineCode> applies.
            </p>
            <p>
              If the user already has a valid SSO session (single sign-on!), the redirect happens immediately without another login prompt. {brand.siteName} then redirects back to your <InlineCode>redirect_uri</InlineCode> – either with{" "}
              <InlineCode>?code=...&amp;state=...</InlineCode> or, if the permission is missing, with <InlineCode>?error=access_denied&amp;state=...</InlineCode>.
            </p>
          </Section>

          <Section id="token" title="2. Token exchange">
            <p>
              The authorization code is valid for only a few minutes and can be redeemed exactly once. Exchange it <strong className="text-foreground">on the server</strong> (never in the browser) for tokens:
            </p>
            <CodeBlock>{`app.get("/auth/callback", async (req, res) => {
  const { code, state, error } = req.query;

  if (error) return res.status(403).send("Access denied");
  if (!code || state !== session.oauthState) {
    return res.status(400).send("Invalid request (state mismatch)");
  }

  const tokenRes = await fetch("${appUrl}/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: String(code),
      redirect_uri: "${appExample}/auth/callback",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET, // confidential clients only; on the server!
      code_verifier: session.codeVerifier,
    }),
  });

  if (!tokenRes.ok) return res.status(401).send("Token exchange failed");

  const tokens = await tokenRes.json();
  // tokens.id_token, tokens.access_token, tokens.expires_in, tokens.token_type
});`}</CodeBlock>
            <p>
              For <InlineCode>public</InlineCode> clients <InlineCode>client_secret</InlineCode> is omitted; the <InlineCode>code_verifier</InlineCode> from step 1 is enough instead.{" "}
              <InlineCode>client_id</InlineCode>/<InlineCode>client_secret</InlineCode> can alternatively be sent in an HTTP Basic auth header. The endpoint accepts{" "}
              <InlineCode>application/x-www-form-urlencoded</InlineCode> and <InlineCode>application/json</InlineCode>; all parameters must be strings. A request limit applies per IP address (<InlineCode>429 rate_limit_exceeded</InlineCode>),
              and responses carry <InlineCode>Cache-Control: no-store</InlineCode>.
            </p>
          </Section>

          <Section id="id-token" title="3. Verify the ID token">
            <p>
              Verify the signature and claims of the <InlineCode>id_token</InlineCode> against the JWKS – never trust a token whose signature wasn't checked locally:
            </p>
            <CodeBlock>{`import { jwtVerify, createRemoteJWKSet } from "jose";

const JWKS = createRemoteJWKSet(
  new URL("${appUrl}/.well-known/jwks.json")
);

const { payload } = await jwtVerify(tokens.id_token, JWKS, {
  issuer: "${appUrl}",
  audience: CLIENT_ID,
});

// payload.sub is the stable, unique user ID – use it as the primary key,
// never the username or the email.`}</CodeBlock>
            <p>
              In particular check that <InlineCode>aud</InlineCode> matches your <InlineCode>client_id</InlineCode> and that <InlineCode>exp</InlineCode> hasn't passed – most JWT libraries do this automatically as long as{" "}
              <InlineCode>issuer</InlineCode> and <InlineCode>audience</InlineCode> are passed correctly.
            </p>
          </Section>

          <Section id="userinfo" title="4. Fetch user data">
            <p>
              Additional profile data can be fetched with the <InlineCode>access_token</InlineCode>:
            </p>
            <CodeBlock>{`const res = await fetch("${appUrl}/oauth/userinfo", {
  headers: { Authorization: \`Bearer \${tokens.access_token}\` },
});
const profile = await res.json();
// { sub, permission, preferred_username, name, picture, email, email_verified }`}</CodeBlock>
            <p>
              <InlineCode>email</InlineCode> and <InlineCode>email_verified</InlineCode> only come with the <InlineCode>email</InlineCode> scope and only if the user has an address on file.{" "}
              <InlineCode>email_verified</InlineCode> is <InlineCode>true</InlineCode> because the SSO only adopts an address entered by a user after a code sent to the new address was confirmed; addresses set by the administration count as verified.
              Still link accounts via <InlineCode>sub</InlineCode>, never via the address.
            </p>
            <p>
              The access token is valid for one hour. There is currently no refresh token grant – after expiry a new redirect to <InlineCode>/oauth/authorize</InlineCode> yields a new token without a login prompt thanks to the existing SSO session.
            </p>
          </Section>

          <Section id="profilbilder" title="Profile pictures">
            <p>
              Users can upload a profile picture in the SSO settings. It is delivered as the <InlineCode>picture</InlineCode> claim – in the <InlineCode>id_token</InlineCode> and in the <InlineCode>/oauth/userinfo</InlineCode> response, only if the{" "}
              <InlineCode>profile</InlineCode> scope was requested and the user has set a picture. If the user has none, the claim is missing – show your own placeholder then (e.g. the initial letter).
            </p>
            <CodeBlock>{`{
  "sub": "cm0abc...",
  "preferred_username": "max",
  "picture": "${appUrl}/api/avatar/cm0abc...?v=1790880605123"
}`}</CodeBlock>
            <p>
              The URL is an absolute link to <InlineCode>GET /api/avatar/&#123;sub&#125;</InlineCode> and can be embedded directly in an <InlineCode>&lt;img&gt;</InlineCode> – without login, token or cookie. Response: PNG, JPEG or WebP (256×256, max. 512 KB),{" "}
              <InlineCode>404</InlineCode> without a picture. The <InlineCode>v</InlineCode> parameter is a version number that changes with every new picture; responses can be cached for a day, so with the stored URL you get cache invalidation automatically.
            </p>
            <CodeBlock>{`<img src="\${profile.picture}" alt="" width="40" height="40"
     referrerpolicy="no-referrer" />`}</CodeBlock>
            <p>
              If your app sets a Content-Security-Policy, <InlineCode>{appUrl}</InlineCode> must be allowed under <InlineCode>img-src</InlineCode>. Take over the URL again on every login (or token request) instead of storing it permanently, so changed or removed pictures are picked up.
            </p>
            <p>
              Other ways: the reverse proxy endpoint <InlineCode>/api/auth/verify</InlineCode> delivers the header <InlineCode>X-Avatar-Url</InlineCode>, and the app token exchange <InlineCode>/api/auth/token</InlineCode> contains the field{" "}
              <InlineCode>picture</InlineCode> (<InlineCode>null</InlineCode> without a picture).
            </p>
          </Section>

          <Section id="app-token" title="App token flow">
            <p>
              The app token flow is a lean path for server-side applications. Instead of client ID and client secret you use the app token that the SSO administration creates for your application (shown once). The flow has two steps.
            </p>
            <p>
              <strong className="text-foreground">1. Redirect.</strong> Send the user to the SSO. The <InlineCode>redirect_uri</InlineCode> must match a registered URI: exactly, or – if the registered URI consists of the origin only (e.g.{" "}
              <InlineCode>https://app.example.com/</InlineCode>) – with any path on exactly this origin. Unregistered targets are ignored (no code, no redirect). If it is not given, the first registered one is used. After the login (or immediately with an existing SSO session) the user lands at your site with a code:
            </p>
            <CodeBlock>{`${appUrl}/auth/login?app_id=YOUR_APP_ID&redirect_uri=https://app.example.com/callback&state=RANDOM_VALUE

→ https://app.example.com/callback?code=...&state=RANDOM_VALUE
→ if the permission is missing: ?error=access_denied&state=RANDOM_VALUE`}</CodeBlock>
            <p>
              Check <InlineCode>state</InlineCode> against your stored value. The code is valid for 5 minutes and can be used only once.
            </p>
            <p>
              <strong className="text-foreground">2. Code exchange (server to server).</strong>
            </p>
            <CodeBlock>{`const res = await fetch("${appUrl}/api/auth/token", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ code, app_token: process.env.SSO_APP_TOKEN }),
});
const user = await res.json();
// { user_id, username, permission, picture }`}</CodeBlock>
            <p>
              <InlineCode>permission</InlineCode> is the user's permission level for your application (see Permissions). The app token belongs exclusively in your backend – never in browser code or a repository.
            </p>
          </Section>

          <Section id="berechtigungen" title="Permissions (permission levels)">
            <p>
              Every application defines its own permission levels (at least <InlineCode>ALLOW</InlineCode> and <InlineCode>DENY</InlineCode>). If a user has <InlineCode>DENY</InlineCode>, <InlineCode>/oauth/authorize</InlineCode> aborts with{" "}
              <InlineCode>error=access_denied</InlineCode> before a code is even issued – your app only has to display this case in a friendly way.
            </p>
            <p>
              If a user has no assignment of their own, the application's default level applies (configurable in the administration, preset to <InlineCode>DENY</InlineCode>).
            </p>
            <p>
              Temporary <strong>guest accounts</strong> are the exception: they only have a password (never MFA), the default level does not apply to them – without an explicit assignment they get <InlineCode>DENY</InlineCode>. The admin sets the lifetime freely (quick choices from one hour to 90 days, otherwise any number up to ten years). Tokens and sessions end with the account at the latest, and the account is deleted when it expires.
            </p>
            <p>
              Fine-grained, app-specific levels (e.g. <InlineCode>ADMIN</InlineCode>, <InlineCode>VIEWER</InlineCode>) are delivered by the SSO in the <InlineCode>permission</InlineCode> claim – in the <InlineCode>id_token</InlineCode> and in the{" "}
              <InlineCode>/oauth/userinfo</InlineCode> response, regardless of the requested scope. The id_token contains the level at the time of the token exchange, <InlineCode>/oauth/userinfo</InlineCode> the current one. If access is revoked (<InlineCode>DENY</InlineCode>),
              the SSO rejects the exchange and further userinfo calls.
            </p>
            <CodeBlock>{`{
  "sub": "cm0abc...",
  "permission": "ADMIN"
}`}</CodeBlock>
          </Section>

          <Section id="gast-zugang" title="Guest access">
            <p>
              Users can give a guest short-term access to a single
              application without opening up their other applications: on the login page
              the guest requests a QR code together with a 6-digit code, the owner of the
              account confirms on a signed-in device and sets the duration (1, 8
              or 24 hours). The guest gets <strong className="text-foreground">no
              SSO session</strong> and sees nothing of the account; your application receives
              code, token and user data like with any other login. Every account can turn
              guest access off in its own settings; the admin account has none.
            </p>
            <Notice title="Implement the guest logic in your application">
              The SSO can only end a guest immediately where it is asked on every
              request. It does not know your application&apos;s own session. Without guest logic
              the guest stays signed in after the duration has passed or after the owner
              ended the access early, until your application&apos;s session ends, often only
              after days. This affects every application with its own session (OIDC and
              app token). Only the reverse proxy protection is covered without changes.
            </Notice>
            <p>
              A guest can be recognized by the claim <InlineCode>guest: true</InlineCode> in the{" "}
              <InlineCode>id_token</InlineCode> and in the{" "}
              <InlineCode>/oauth/userinfo</InlineCode> response, in the app token variant
              by <InlineCode>guest</InlineCode> and <InlineCode>expires_at</InlineCode> in the
              response of <InlineCode>/api/auth/token</InlineCode>, behind the reverse proxy by{" "}
              <InlineCode>X-Guest: 1</InlineCode> and <InlineCode>X-Guest-Expires</InlineCode>.
              Access and ID tokens expire at the latest with the guest access (<InlineCode>exp</InlineCode>);
              there are no refresh tokens.
            </p>
            <Table
              head={["Integration", "What the SSO ends", "What your application implements"]}
              rows={[
                ["Reverse proxy (auth_request)", "Everything: the check runs on every request, ending takes effect immediately.", "Nothing. Only extend the cookie map by sso_guest (see reverse proxy protection)."],
                ["OIDC (authorize/token)", "The tokens: exp reaches at most to the end of the guest access, there is no refresh token. After ending, the access token and /oauth/userinfo are invalid immediately.", "Evaluate the guest claim and let your own session run at most until the exp of the ID token. For immediate ending, check the access token regularly (e.g. every 30–60 s) against /oauth/userinfo; end the session on 401."],
                ["App token (/api/auth/token)", "New logins only. The code is exchanged once, after that the SSO is not asked again.", "Read guest and expires_at from the response and end the session at expires_at at the latest. For immediate ending, check the guest session regularly via /api/auth/verify (see below); end the session on 401."],
              ]}
            />
            <p>
              Response of <InlineCode>POST /api/auth/token</InlineCode> for a guest:
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
              The guest check for app token applications: forward only the visitor&apos;s{" "}
              <InlineCode>sso_guest</InlineCode> cookie to the SSO (not the
              whole Cookie header, otherwise an existing SSO session would apply). The
              cookie has the domain <InlineCode>{cookieDomain}</InlineCode> and only reaches
              applications on this domain (<InlineCode>COOKIE_DOMAIN</InlineCode> has to be set for that).
              Your proxy must not remove it. Applications on other domains can only enforce{" "}
              <InlineCode>expires_at</InlineCode> or <InlineCode>exp</InlineCode>.
            </p>
            <CodeBlock>{`GET ${appUrl}/api/auth/verify?app_id=YOUR_APP_ID
Cookie: sso_guest=<value from the visitor's browser>

200  guest access valid (headers X-Guest: 1, X-Guest-Expires)
401  ended, expired or for another application -> end the session`}</CodeBlock>
          </Section>

          <Section id="reverse-proxy" title="Reverse proxy protection">
            <p>
              For internal tools without login code of their own, access can also be secured entirely at the reverse proxy level (nginx <InlineCode>auth_request</InlineCode>). The application itself then needs no SSO integration code at all:
            </p>
            <CodeBlock>{`# http level (once): cookie header without sso_session/sso_trusted/sso_guest, for the app.
# All other cookies of the app stay unchanged; an empty result makes nginx omit the header.
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
    proxy_pass http://sso-backend/api/auth/verify?app_id=YOUR_APP_ID;
    proxy_pass_request_body off;
    proxy_set_header Content-Length "";
    proxy_set_header Cookie $http_cookie;                 # only here the SSO cookie may be sent along
    proxy_set_header Host ${ssoHost};
    # real client IP: never pass on headers sent by the client
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    # optional, for the audit log (which instance/page was accessed)
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

    proxy_set_header Cookie $cookie_without_sso;          # don't pass the SSO cookie on to the app
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $remote_addr;

    error_page 401 = @sso_login;
    proxy_pass http://app-backend;
}

location @sso_login {
    # register the app's origin (https://app.example.com/) in the SSO as a redirect URI
    return 302 ${appUrl}/auth/login?app_id=YOUR_APP_ID&redirect_uri=$scheme://$host$request_uri;
}`}</CodeBlock>
            <p>
              The endpoint <InlineCode>/api/auth/verify</InlineCode> answers with <InlineCode>200</InlineCode> and the headers <InlineCode>X-User-Id</InlineCode>, <InlineCode>X-Username</InlineCode>, <InlineCode>X-Permission</InlineCode>,{" "}
              <InlineCode>X-Email</InlineCode> (only if an address is on file) and <InlineCode>X-Avatar-Url</InlineCode> (only with a profile picture). For a guest access (see Guest access) <InlineCode>X-Guest: 1</InlineCode> and <InlineCode>X-Guest-Expires</InlineCode> are added; the <InlineCode>sso_guest</InlineCode> cookie only applies to the application it was issued for. Without a valid session you get <InlineCode>401</InlineCode>; with <InlineCode>DENY</InlineCode>, a disabled or unknown application and
              for accounts that still have to change a temporary password or set up a second factor, <InlineCode>403</InlineCode>. If <InlineCode>app_id</InlineCode> (or the header <InlineCode>X-App-Token</InlineCode>) is missing, the endpoint answers with <InlineCode>400</InlineCode> instead of letting just any signed-in user through –
              so a proxy configuration without an app identifier stands out immediately.
            </p>
            <p>
              The headers <InlineCode>X-Real-IP</InlineCode> and <InlineCode>X-Forwarded-For</InlineCode> must contain <InlineCode>$remote_addr</InlineCode> in the subrequest (not <InlineCode>$proxy_add_x_forwarded_for</InlineCode>): the SSO uses the IP for the audit log and request limits
              and only trusts the proxy, never a value set by the client. <InlineCode>X-Original-Host</InlineCode>, <InlineCode>X-Original-URI</InlineCode> and <InlineCode>X-Original-Method</InlineCode> are optional; they appear in the audit log and distinguish several instances that use the same application
              (the same <InlineCode>app_id</InlineCode>). Each of these instances must run over HTTPS under <InlineCode>{cookieDomain}</InlineCode>, because the session cookie is only valid there.
            </p>
            <p>
              The protected application receives the verified user identity exclusively through headers set by the proxy – the app may only trust these headers if it is reachable{" "}
              <strong className="text-foreground">only</strong> through the proxy (no direct access to the origin port from outside). This variant suits internal admin interfaces, not applications that must also be directly reachable from outside your network.
            </p>
          </Section>

          <Section id="sicherheit" title="Security checklist">
            <ul className="space-y-2">
              {[
                "HTTPS only in production – no http:// except localhost during development.",
                "Have the redirect_uri registered (exactly or as a bare origin); never accept wildcards or dynamic values.",
                "Check state on every callback: store a random value in an httpOnly cookie before the redirect and compare and delete it in the callback (otherwise login CSRF: an attacker slips their code to the user).",
                "Use PKCE – mandatory for public clients, an additional layer of defense for confidential clients.",
                "Store and use client_secret on the server only – never in frontend code, mobile apps or Git repositories.",
                "Always verify the id_token locally against the JWKS (signature, issuer, audience, expiry) – don't decode it unchecked.",
                "Don't log the access_token and don't keep it in localStorage in SPAs; prefer server-side sessions (backend for frontend).",
                "Set your application's own session cookies as httpOnly, secure and sameSite=lax|strict.",
                "Behind nginx auth_request: don't pass the SSO cookies (sso_session, sso_trusted, sso_guest) on to the app (proxy_set_header Cookie $cookie_without_sso), the app doesn't need them. The cookie is valid for all subdomains of the COOKIE_DOMAIN; a compromised app could otherwise take over the session.",
                "Behind nginx auth_request: set X-Real-IP and X-Forwarded-For in the subrequest to $remote_addr, never to values supplied by the client.",
                "Only trust the identity headers (X-User-Id, X-Username, X-Permission) if the app is reachable only through the proxy; overwrite headers of the same name sent by the client in the proxy.",
                "Link accounts in your app via sub or user_id, never via email or username (users can change or reuse both).",
                "Handle error=access_denied and other error cases from /oauth/authorize properly instead of ignoring them.",
                "Rotate client secrets regularly and have them reissued immediately if you suspect a compromise.",
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

          <Section id="fehler" title="Error reference">
            <Table
              head={["Error", "HTTP status", "Meaning"]}
              rows={[
                ["invalid_request", "400", "Required parameters are missing or malformed."],
                ["invalid_client", "400", "Unknown or inactive client_id."],
                ["invalid_grant", "400", "Code invalid, expired, already used, or PKCE/secret check failed."],
                ["unsupported_grant_type", "400", "Only authorization_code is supported."],
                ["access_denied", "Redirect", "The user has no permission (DENY) for this application."],
                ["invalid_token", "401", "access_token at /oauth/userinfo is invalid or expired."],
                ["rate_limit_exceeded", "429", "Too many requests in a short time – retry with backoff."],
              ]}
            />
            <p>
              <InlineCode>invalid_request</InlineCode> also occurs at <InlineCode>/oauth/authorize</InlineCode> if the <InlineCode>redirect_uri</InlineCode> is not registered, a public client asks without a <InlineCode>code_challenge</InlineCode>, or a method other than{" "}
              <InlineCode>S256</InlineCode> is requested. In these cases there is deliberately no redirect.
            </p>
            <p>The other two paths report errors through the HTTP status:</p>
            <Table
              head={["Endpoint", "HTTP status", "Meaning"]}
              rows={[
                ["/api/auth/token", "400", "Body is not valid JSON or code/app_token are missing."],
                ["/api/auth/token", "401", "Code invalid, expired, already used, or the app token doesn't match the application."],
                ["/api/auth/token", "429", "Too many requests from this IP address."],
                ["/api/auth/verify", "400", "Neither app_id nor X-App-Token given."],
                ["/api/auth/verify", "401", "No or expired SSO session."],
                ["/api/auth/verify", "403", "DENY permission, application disabled/unknown, or password change required."],
              ]}
            />
          </Section>

          <Section id="support" title="Support">
            <p>
              Please submit questions about the integration, requests for new app credentials or reports about security problems through the operator's official channels – not as an unencrypted message with credentials in plain text.
            </p>
            {brand.contactUrl && (
              <a href={brand.contactUrl} className="inline-flex items-center gap-2 text-sm font-bold text-foreground hover:underline">
                Get in touch →
              </a>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}
