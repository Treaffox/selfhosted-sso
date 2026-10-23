-- Personal data is encrypted by the application (lib/db-encryption.ts). Run `npm run db:encrypt-existing`
-- after this migration to encrypt existing rows and fill the IP rule blind index.

-- Blind index for IP rules (ipAddress itself is encrypted now). Existing rows get a random placeholder
-- until encrypt-existing computes the real HMAC.
ALTER TABLE "UserIpRule" ADD COLUMN "ipHash" TEXT NOT NULL DEFAULT (gen_random_uuid())::text;
DROP INDEX "UserIpRule_userId_ipAddress_key";
CREATE UNIQUE INDEX "UserIpRule_userId_ipHash_key" ON "UserIpRule"("userId", "ipHash");

-- IP column is ciphertext, an index on it is useless
DROP INDEX "AuditLog_ipAddress_idx";
