/**
 * Encrypts personal data that was stored in plaintext (run once after the encrypt_personal_data migration,
 * also safe to re-run; rows that are already encrypted are skipped) and fills the IP rule blind index.
 *
 *   DATA_ENCRYPTION_KEY=... npx tsx prisma/encrypt-existing.ts
 */
import { PrismaClient } from "@prisma/client";
import { blindIndex } from "../src/lib/data-crypto";
import { ENCRYPTED_FIELDS, decryptValue, encryptValue } from "../src/lib/db-encryption";

const BATCH = 500;
const prisma = new PrismaClient();

async function main() {
  let total = 0;
  for (const [model, fields] of Object.entries(ENCRYPTED_FIELDS)) {
    const accessor = (prisma as any)[model[0].toLowerCase() + model.slice(1)];
    const idField = model === "UserAvatar" ? "userId" : "id";
    const select: Record<string, boolean> = { [idField]: true };
    for (const f of fields) select[f] = true;
    if (model === "UserIpRule") select.ipHash = true;

    let cursor: string | undefined;
    let changed = 0;
    for (;;) {
      const rows: any[] = await accessor.findMany({
        select,
        orderBy: { [idField]: "asc" },
        take: BATCH,
        ...(cursor ? { cursor: { [idField]: cursor }, skip: 1 } : {}),
      });
      if (!rows.length) break;
      cursor = rows[rows.length - 1][idField];

      for (const row of rows) {
        const data: Record<string, unknown> = {};
        for (const f of fields) {
          if (row[f] == null) continue;
          const enc = encryptValue(model, f, row[f]);
          if (enc !== row[f]) data[f] = enc; // unchanged reference = already ciphertext
        }
        if (model === "UserIpRule") {
          const ip = decryptValue(model, "ipAddress", row.ipAddress) as string;
          const hash = blindIndex("ip", ip);
          if (row.ipHash !== hash) data.ipHash = hash;
        }
        if (Object.keys(data).length) {
          await accessor.update({ where: { [idField]: row[idField] }, data });
          changed++;
        }
      }
    }
    console.log(`${model}: ${changed} Zeilen aktualisiert`);
    total += changed;
  }
  console.log(`✓ Fertig (${total} Zeilen)`);
}

main()
  .catch((e) => {
    console.error("encrypt-existing Fehler:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
