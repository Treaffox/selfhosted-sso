import crypto from "crypto";

/**
 * Encryption of personal data at rest (email, IPs, user agents, audit logs, avatars, ...).
 *
 * Key hierarchy: one master key (KeyProvider) → per-tenant subkeys via HKDF. Every ciphertext carries
 * the tenant key id in its header, so several instances/tenants can share the code (and even a database)
 * with separate keys. Swapping the key source (KMS/Vault) only means a different KeyProvider.
 *
 * String format: enc:v1:<keyId>:<base64url(iv | tag | ciphertext)>
 * Bytes format:  "SSOENC01" | len(keyId) | keyId | iv | tag | ciphertext
 * The context ("Model.field") is authenticated as AAD, so ciphertexts can't be moved between columns.
 */

const STRING_PREFIX = "enc:v1:";
const BYTES_MAGIC = Buffer.from("SSOENC01");
const IV_LEN = 12;
const TAG_LEN = 16;
const KEY_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export type KeyPurpose = "enc" | "blind";

export interface KeyProvider {
  /** Key id used for new ciphertexts (the current tenant). */
  currentKeyId(): string;
  /** 32-byte subkey for a tenant and purpose. */
  getKey(keyId: string, purpose: KeyPurpose): Buffer;
}

/** Master key from DATA_ENCRYPTION_KEY (64 hex chars or base64 of 32 bytes); subkeys derived with HKDF. */
class EnvKeyProvider implements KeyProvider {
  private master: Buffer | null = null;
  private cache = new Map<string, Buffer>();

  private getMaster(): Buffer {
    if (this.master) return this.master;
    const raw = process.env.DATA_ENCRYPTION_KEY?.trim();
    if (!raw) throw new Error("DATA_ENCRYPTION_KEY must be set (openssl rand -hex 32)");
    const key = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
    if (key.length !== 32) throw new Error("DATA_ENCRYPTION_KEY must be 32 bytes (64 hex chars or base64)");
    return (this.master = key);
  }

  currentKeyId(): string {
    // Multi-instance: set TENANT_KEY_ID per instance (later: derive from the request/tenant context)
    return process.env.TENANT_KEY_ID?.trim() || "default";
  }

  getKey(keyId: string, purpose: KeyPurpose): Buffer {
    if (!KEY_ID_RE.test(keyId)) throw new Error("Invalid key id");
    const cacheKey = `${purpose}:${keyId}`;
    let key = this.cache.get(cacheKey);
    if (!key) {
      key = Buffer.from(crypto.hkdfSync("sha256", this.getMaster(), Buffer.from("sso-data-v1"), cacheKey, 32));
      this.cache.set(cacheKey, key);
    }
    return key;
  }
}

let provider: KeyProvider = new EnvKeyProvider();

/** Replace the key source (e.g. KMS-backed provider). */
export function setKeyProvider(p: KeyProvider): void {
  provider = p;
}

export function isEncryptedString(v: unknown): v is string {
  return typeof v === "string" && v.startsWith(STRING_PREFIX);
}

export function isEncryptedBytes(v: unknown): v is Uint8Array {
  return v instanceof Uint8Array && v.length > BYTES_MAGIC.length && Buffer.from(v.subarray(0, BYTES_MAGIC.length)).equals(BYTES_MAGIC);
}

function seal(plain: Buffer, keyId: string, context: string): { iv: Buffer; tag: Buffer; ct: Buffer } {
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv("aes-256-gcm", provider.getKey(keyId, "enc"), iv);
  cipher.setAAD(Buffer.from(context));
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  return { iv, tag: cipher.getAuthTag(), ct };
}

function open(keyId: string, iv: Buffer, tag: Buffer, ct: Buffer, context: string): Buffer {
  const decipher = crypto.createDecipheriv("aes-256-gcm", provider.getKey(keyId, "enc"), iv);
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

export function encryptString(plain: string, context: string): string {
  const keyId = provider.currentKeyId();
  const { iv, tag, ct } = seal(Buffer.from(plain, "utf8"), keyId, context);
  return `${STRING_PREFIX}${keyId}:${Buffer.concat([iv, tag, ct]).toString("base64url")}`;
}

export function decryptString(value: string, context: string): string {
  const rest = value.slice(STRING_PREFIX.length);
  const sep = rest.indexOf(":");
  if (sep < 1) throw new Error("Invalid ciphertext");
  const keyId = rest.slice(0, sep);
  const raw = Buffer.from(rest.slice(sep + 1), "base64url");
  if (raw.length < IV_LEN + TAG_LEN) throw new Error("Invalid ciphertext");
  const iv = raw.subarray(0, IV_LEN);
  const tag = raw.subarray(IV_LEN, IV_LEN + TAG_LEN);
  return open(keyId, iv, tag, raw.subarray(IV_LEN + TAG_LEN), context).toString("utf8");
}

export function encryptBytes(plain: Uint8Array, context: string): Buffer {
  const keyId = provider.currentKeyId();
  const { iv, tag, ct } = seal(Buffer.from(plain), keyId, context);
  return Buffer.concat([BYTES_MAGIC, Buffer.from([keyId.length]), Buffer.from(keyId), iv, tag, ct]);
}

export function decryptBytes(value: Uint8Array, context: string): Buffer {
  const buf = Buffer.from(value);
  let o = BYTES_MAGIC.length;
  const idLen = buf[o++];
  const keyId = buf.subarray(o, o + idLen).toString();
  o += idLen;
  const iv = buf.subarray(o, o + IV_LEN);
  const tag = buf.subarray(o + IV_LEN, o + IV_LEN + TAG_LEN);
  return open(keyId, iv, tag, buf.subarray(o + IV_LEN + TAG_LEN), context);
}

/**
 * Deterministic keyed hash for equality lookups on encrypted values (e.g. IP rules).
 * Reveals only equality, not the value. `purpose` separates indexes from each other.
 */
export function blindIndex(purpose: string, value: string): string {
  const key = provider.getKey(provider.currentKeyId(), "blind");
  return crypto.createHmac("sha256", key).update(`${purpose}\0${value.trim().toLowerCase()}`).digest("hex");
}
