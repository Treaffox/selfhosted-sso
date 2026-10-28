import { Prisma } from "@prisma/client";
import {
  decryptBytes,
  decryptString,
  encryptBytes,
  encryptString,
  isEncryptedBytes,
  isEncryptedString,
} from "./data-crypto";

/**
 * Columns holding personal data. They are encrypted transparently on write and decrypted on read
 * by the Prisma extension below, so the rest of the code keeps working with plain values.
 * Encrypted columns can't be used in where clauses (use a blind index, see UserIpRule.ipHash).
 */
export const ENCRYPTED_FIELDS: Record<string, string[]> = {
  User: ["email"],
  UserAvatar: ["data"],
  Passkey: ["deviceName"],
  Session: ["ipAddress", "userAgent"],
  LoginSession: ["ipAddress"],
  LoginHistory: ["ipAddress", "userAgent"],
  TrustedDevice: ["deviceName", "ipAddress", "userAgent"],
  DeviceLoginRequest: ["ipAddress", "userAgent"],
  GuestGrant: ["ipAddress", "userAgent"],
  UserIpRule: ["ipAddress"],
  AuditLog: ["message", "actorName", "targetLabel", "ipAddress", "userAgent", "requestPath", "details"],
};

type Field = { kind: string; type: string };
const MODELS: Record<string, Record<string, Field>> = {};
for (const m of Prisma.dmmf.datamodel.models) {
  MODELS[m.name] = Object.fromEntries(m.fields.map((f) => [f.name, { kind: f.kind, type: f.type }]));
}
for (const [model, fields] of Object.entries(ENCRYPTED_FIELDS)) {
  for (const f of fields) {
    if (!MODELS[model]?.[f]) throw new Error(`ENCRYPTED_FIELDS: unknown field ${model}.${f}`);
  }
}

const isEncField = (model: string, field: string) => ENCRYPTED_FIELDS[model]?.includes(field) ?? false;
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v) && !(v instanceof Date) && !(v instanceof Uint8Array);
// Prisma's JsonNull/DbNull/... are class instances; real JSON values are plain objects/arrays
const isPlainJson = (v: unknown) =>
  Array.isArray(v) || (isObj(v) && Object.getPrototypeOf(v) === Object.prototype);

// ─── Values ───────────────────────────────────────────

export function encryptValue(model: string, field: string, value: unknown): unknown {
  if (value === null || value === undefined) return value;
  const ctx = `${model}.${field}`;
  const type = MODELS[model][field].type;
  if (type === "Bytes") {
    return value instanceof Uint8Array && !isEncryptedBytes(value) ? encryptBytes(value, ctx) : value;
  }
  if (type === "Json") {
    return isPlainJson(value) ? encryptString(JSON.stringify(value), ctx) : value;
  }
  return typeof value === "string" && !isEncryptedString(value) ? encryptString(value, ctx) : value;
}

export function decryptValue(model: string, field: string, value: unknown): unknown {
  const ctx = `${model}.${field}`;
  const type = MODELS[model][field].type;
  try {
    if (type === "Bytes") return isEncryptedBytes(value) ? decryptBytes(value, ctx) : value;
    if (!isEncryptedString(value)) return value; // legacy plaintext (before encrypt-existing ran)
    const plain = decryptString(value, ctx);
    return type === "Json" ? JSON.parse(plain) : plain;
  } catch (error) {
    console.error(`[ENCRYPTION] Entschlüsselung fehlgeschlagen: ${ctx}`, error instanceof Error ? error.message : error);
    if (type === "Bytes") throw error;
    return type === "Json" ? null : "[nicht entschlüsselbar]";
  }
}

// ─── Write path ───────────────────────────────────────

function encryptRelationOps(model: string, ops: unknown): unknown {
  if (!isObj(ops)) return ops;
  const out: Record<string, unknown> = { ...ops };
  const withData = (v: unknown) => {
    // update/updateMany: either the data itself or { where, data }
    if (isObj(v) && "data" in v && !MODELS[model].data) return { ...v, data: encryptData(model, v.data) };
    return encryptData(model, v);
  };
  if ("create" in out) out.create = encryptData(model, out.create);
  if ("update" in out) out.update = withData(out.update);
  if ("updateMany" in out) out.updateMany = Array.isArray(out.updateMany) ? out.updateMany.map(withData) : withData(out.updateMany);
  if (isObj(out.createMany)) out.createMany = { ...out.createMany, data: encryptData(model, out.createMany.data) };
  if (isObj(out.upsert)) out.upsert = { ...out.upsert, create: encryptData(model, out.upsert.create), update: encryptData(model, out.upsert.update) };
  if (isObj(out.connectOrCreate)) out.connectOrCreate = { ...out.connectOrCreate, create: encryptData(model, out.connectOrCreate.create) };
  return out;
}

function encryptData(model: string, data: unknown): unknown {
  if (Array.isArray(data)) return data.map((d) => encryptData(model, d));
  if (!isObj(data)) return data;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    const field = MODELS[model][key];
    if (field?.kind === "object") {
      out[key] = encryptRelationOps(field.type, value);
    } else if (isEncField(model, key)) {
      // update operators: { set: value }
      out[key] = isObj(value) && "set" in value && field?.type !== "Json" ? { ...value, set: encryptValue(model, key, value.set) } : encryptValue(model, key, value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

/** Encrypted columns can't be filtered in SQL – fail loudly instead of silently matching nothing. */
function assertNoEncryptedFilter(model: string, where: unknown): void {
  if (!isObj(where)) return;
  for (const [key, value] of Object.entries(where)) {
    if (key === "AND" || key === "OR" || key === "NOT") {
      for (const w of Array.isArray(value) ? value : [value]) assertNoEncryptedFilter(model, w);
    } else if (isEncField(model, key)) {
      throw new Error(`${model}.${key} is encrypted and can't be used in a where clause`);
    }
  }
}

// ─── Read path ────────────────────────────────────────

function decryptResult(model: string, result: unknown): unknown {
  if (Array.isArray(result)) {
    for (let i = 0; i < result.length; i++) result[i] = decryptResult(model, result[i]);
    return result;
  }
  if (!isObj(result)) return result;
  for (const key of Object.keys(result)) {
    const field = MODELS[model][key];
    if (!field || result[key] == null) continue;
    if (field.kind === "object") result[key] = decryptResult(field.type, result[key]);
    else if (isEncField(model, key)) result[key] = decryptValue(model, key, result[key]);
  }
  return result;
}

export const encryptionExtension = Prisma.defineExtension({
  name: "personal-data-encryption",
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        const a: Record<string, unknown> = { ...(args as Record<string, unknown>) };
        assertNoEncryptedFilter(model, a.where);
        if ("data" in a) a.data = encryptData(model, a.data);
        if ("create" in a) a.create = encryptData(model, a.create);
        if (operation === "upsert" && "update" in a) a.update = encryptData(model, a.update);
        return decryptResult(model, await query(a));
      },
    },
  },
});
