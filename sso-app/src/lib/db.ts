import { PrismaClient } from "@prisma/client";
import { encryptionExtension } from "./db-encryption";

function createClient() {
  return new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  }).$extends(encryptionExtension);
}

const globalForPrisma = globalThis as unknown as { prisma: ReturnType<typeof createClient> };

/** Prisma client; personal-data columns (see ENCRYPTED_FIELDS) are encrypted/decrypted transparently. */
export const db = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}
