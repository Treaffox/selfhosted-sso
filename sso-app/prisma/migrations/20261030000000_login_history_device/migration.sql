-- Keyed hash of the browser's device cookie, so "familiar device" no longer rests on IP + user agent alone
ALTER TABLE "LoginHistory" ADD COLUMN "deviceHash" TEXT;
CREATE INDEX "LoginHistory_userId_deviceHash_idx" ON "LoginHistory"("userId", "deviceHash");
