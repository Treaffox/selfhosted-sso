import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";

let cachedKey: { source: string; key: Buffer } | null = null;

function getEncryptionKey(): Buffer {
  const source = process.env.ENCRYPTION_KEY ?? process.env.SESSION_SECRET;
  if (!source) throw new Error("ENCRYPTION_KEY or SESSION_SECRET must be set");
  // scrypt is deliberately slow: derive once, not on every encrypt/decrypt
  if (cachedKey?.source !== source) {
    cachedKey = { source, key: crypto.scryptSync(source, "sso-encryption-v1", 32) };
  }
  return cachedKey.key;
}

/** Encrypt a string with AES-256-GCM. Returns iv:tag:ciphertext in hex. */
export function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, getEncryptionKey(), iv);
  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const tag = cipher.getAuthTag().toString("hex");
  return `${iv.toString("hex")}:${tag}:${encrypted}`;
}

/** Decrypt an AES-256-GCM encrypted string. */
export function decrypt(encryptedText: string): string {
  const parts = encryptedText.split(":");
  if (parts.length !== 3) throw new Error("Invalid encrypted format");
  const [ivHex, tagHex, ciphertext] = parts;
  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  const decipher = crypto.createDecipheriv(ALGORITHM, getEncryptionKey(), iv);
  decipher.setAuthTag(tag);
  let decrypted = decipher.update(ciphertext, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

/** Generate a cryptographically secure random token (hex). */
export function generateToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("hex");
}

/** Generate a short numeric code (e.g., for email verification). */
export function generateNumericCode(digits = 6): string {
  const max = Math.pow(10, digits);
  const num = crypto.randomInt(0, max);
  return num.toString().padStart(digits, "0");
}

/** Generate human-readable recovery codes. */
export function generateRecoveryCodes(count = 10): string[] {
  const codes: string[] = [];
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars
  for (let i = 0; i < count; i++) {
    let code = "";
    for (let j = 0; j < 8; j++) {
      code += chars[crypto.randomInt(0, chars.length)];
      if (j === 3) code += "-";
    }
    codes.push(code);
  }
  return codes;
}

/** SHA-256 hash (for app tokens – non-reversible). */
export function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

/** HMAC-SHA256 for signing inter-service messages. */
export function hmacSign(data: string, secret?: string): string {
  const key = secret ?? process.env.SESSION_SECRET;
  if (!key) throw new Error("SESSION_SECRET must be set");
  return crypto.createHmac("sha256", key).update(data).digest("hex");
}

/** Verify HMAC-SHA256 signature with constant-time comparison. */
export function hmacVerify(
  data: string,
  signature: string,
  secret?: string
): boolean {
  const expected = Buffer.from(hmacSign(data, secret), "hex");
  const given = Buffer.from(signature, "hex");
  if (given.length !== expected.length) return false;
  return crypto.timingSafeEqual(given, expected);
}
