/** In-memory rate limiter. Replace with Redis for multi-instance deployments. */

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

// Periodic cleanup every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (entry.resetAt < now) store.delete(key);
  }
}, 5 * 60 * 1000);

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

/** Check rate limit. Returns whether the request is allowed. */
export function checkRateLimit(
  key: string,
  maxAttempts: number,
  windowMs: number
): RateLimitResult {
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || entry.resetAt < now) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: maxAttempts - 1, resetAt: now + windowMs };
  }

  if (entry.count >= maxAttempts) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }

  entry.count++;
  return {
    allowed: true,
    remaining: maxAttempts - entry.count,
    resetAt: entry.resetAt,
  };
}

/** Forget a counter (e.g. after a successful authentication). */
export function resetRateLimit(key: string): void {
  store.delete(key);
}

/** Pre-configured rate limiters. */
export function rateLimitLogin(ip: string): RateLimitResult {
  const max = parseInt(process.env.RATE_LIMIT_LOGIN_MAX ?? "20", 10);
  const window = parseInt(process.env.RATE_LIMIT_LOGIN_WINDOW_MS ?? "900000", 10);
  return checkRateLimit(`login:${ip}`, max, window);
}

export function rateLimitEmail(userId: string): RateLimitResult {
  const max = parseInt(process.env.RATE_LIMIT_EMAIL_MAX ?? "8", 10);
  const window = parseInt(process.env.RATE_LIMIT_EMAIL_WINDOW_MS ?? "600000", 10);
  return checkRateLimit(`email:${userId}`, max, window);
}

export function rateLimitApi(ip: string): RateLimitResult {
  return checkRateLimit(`api:${ip}`, 100, 60000);
}

/**
 * Credential attempts per account (password, MFA code, passkey), counted BEFORE the check so parallel
 * requests can't exceed the budget. Independent of the client IP, which an attacker can rotate.
 */
export function rateLimitLoginAttempt(userId: string): RateLimitResult {
  const max = parseInt(process.env.RATE_LIMIT_ATTEMPT_MAX ?? "10", 10);
  const window = parseInt(process.env.RATE_LIMIT_ATTEMPT_WINDOW_MS ?? "900000", 10);
  return checkRateLimit(`attempt:${userId}`, max, window);
}

export function resetLoginAttempts(userId: string): void {
  resetRateLimit(`attempt:${userId}`);
}

/** Password confirmation for sensitive account changes (step-up). */
export function rateLimitReauth(userId: string): RateLimitResult {
  return checkRateLimit(`reauth:${userId}`, 5, 15 * 60 * 1000);
}

export function resetReauth(userId: string): void {
  resetRateLimit(`reauth:${userId}`);
}

/** Verification codes entered for an e-mail change. */
export function rateLimitEmailVerify(userId: string): RateLimitResult {
  return checkRateLimit(`emailverify:${userId}`, 5, 15 * 60 * 1000);
}

/** New device-login / guest requests from one client IP. */
export function rateLimitDeviceRequest(ip: string): RateLimitResult {
  return checkRateLimit(`devreq:${ip}`, 10, 15 * 60 * 1000);
}

/**
 * New requests aimed at one account. Not answered with an error when exceeded (that would reveal the account exists):
 * the caller hands out a decoy request instead.
 */
export function rateLimitDeviceRequestPerAccount(userId: string): RateLimitResult {
  return checkRateLimit(`devreq-user:${userId}`, 5, 15 * 60 * 1000);
}

/** Approvals / denials by the signed-in owner (QR link or typed code). */
export function rateLimitDeviceApprove(userId: string): RateLimitResult {
  return checkRateLimit(`devapprove:${userId}`, 30, 15 * 60 * 1000);
}
