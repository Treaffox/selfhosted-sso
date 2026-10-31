-- Guest accounts: a user with an expiry date is deleted once it has passed
ALTER TABLE "User" ADD COLUMN "expiresAt" TIMESTAMP(3);
CREATE INDEX "User_expiresAt_idx" ON "User"("expiresAt");
