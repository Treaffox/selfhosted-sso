import express from "express";
import cookieParser from "cookie-parser";
import path from "path";
import { timingSafeEqual } from "crypto";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "../views"));

const SSO_URL = process.env.SSO_URL || "http://localhost:8122";
const SSO_APP_ID = process.env.SSO_APP_ID || "";
const SSO_APP_TOKEN = process.env.SSO_APP_TOKEN || "";
const APP_URL = process.env.APP_URL || "http://localhost:8123";
const PORT = parseInt(process.env.APP_PORT || "8123", 10);

// Simple in-memory session store (for demonstration only)
const sessions = new Map<string, { userId: string; username: string; permission: string }>();

function generateSessionId(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

const STATE_COOKIE = "test_oauth_state";

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

// Middleware: check if user is logged in
function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const sessionId = req.cookies?.test_session;
  const session = sessionId ? sessions.get(sessionId) : null;
  if (!session) {
    // Redirect to SSO login with only app_id (redirect_uri resolved from app config).
    // `state` ties the callback to THIS browser: without it an attacker could hand the victim a code
    // of their own account (login CSRF).
    const state = generateSessionId();
    res.cookie(STATE_COOKIE, state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 10 * 60 * 1000,
    });
    const loginUrl = new URL("/auth/login", SSO_URL);
    loginUrl.searchParams.set("app_id", SSO_APP_ID);
    loginUrl.searchParams.set("state", state);
    return res.redirect(loginUrl.toString());
  }
  (req as any).user = session;
  next();
}

// Home page (public)
app.get("/", (req, res) => {
  const sessionId = req.cookies?.test_session;
  const session = sessionId ? sessions.get(sessionId) : null;
  res.render("index", { user: session || null, ssoUrl: SSO_URL });
});

// Dashboard (protected)
app.get("/dashboard", requireAuth, (req, res) => {
  res.render("dashboard", { user: (req as any).user });
});

// SSO Callback: exchange authorization code for user info
app.get("/auth/callback", async (req, res) => {
  const { code, state } = req.query;
  if (!code || typeof code !== "string") {
    return res.status(400).send("Fehlender Autorisierungscode");
  }
  const expectedState = req.cookies?.[STATE_COOKIE];
  res.clearCookie(STATE_COOKIE);
  if (typeof state !== "string" || typeof expectedState !== "string" || !safeEqual(state, expectedState)) {
    return res.status(400).send("Ungültiger Login-Status. Bitte erneut anmelden.");
  }

  try {
    const tokenRes = await fetch(`${SSO_URL}/api/auth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code,
        app_token: SSO_APP_TOKEN,
      }),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.json().catch(() => ({}));
      return res.status(401).type("text/plain").send(`SSO-Authentifizierung fehlgeschlagen: ${(err as any).error || tokenRes.statusText}`);
    }

    const userData = await tokenRes.json() as {
      user_id: string;
      username: string;
      permission: string;
    };

    // Check permission level
    if (userData.permission === "DENY") {
      return res.status(403).send("Zugriff verweigert. Du hast keine Berechtigung für diese Anwendung.");
    }

    // Create local session
    const sessionId = generateSessionId();
    sessions.set(sessionId, {
      userId: userData.user_id,
      username: userData.username,
      permission: userData.permission,
    });

    res.cookie("test_session", sessionId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 24 * 60 * 60 * 1000, // 24h
    });

    res.redirect("/dashboard");
  } catch (err) {
    console.error("SSO callback error:", err);
    res.status(500).send("Interner Fehler bei der SSO-Authentifizierung");
  }
});

// Logout
app.post("/auth/logout", (req, res) => {
  const sessionId = req.cookies?.test_session;
  if (sessionId) {
    sessions.delete(sessionId);
    res.clearCookie("test_session");
  }
  res.redirect("/");
});

app.listen(PORT, () => {
  console.log(`Test-App läuft auf http://localhost:${PORT}`);
  console.log(`SSO-Server: ${SSO_URL}`);
});
