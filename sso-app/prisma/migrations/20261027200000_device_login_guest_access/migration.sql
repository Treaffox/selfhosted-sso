-- AlterTable
ALTER TABLE "AuthCode" ADD COLUMN     "guestGrantId" TEXT;

-- AlterTable
ALTER TABLE "OAuthAccessToken" ADD COLUMN     "guestGrantId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "deviceLoginEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "guestLoginEnabled" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "DeviceLoginRequest" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "userId" TEXT,
    "tokenHash" TEXT NOT NULL,
    "pollHash" TEXT NOT NULL,
    "loginSessionId" TEXT,
    "appId" TEXT,
    "redirectUri" TEXT,
    "state" TEXT,
    "oidcRequest" TEXT,
    "ipAddress" TEXT NOT NULL,
    "userAgent" TEXT,
    "durationHours" INTEGER,
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "approvedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeviceLoginRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuestGrant" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "tokenHash" TEXT,
    "ipAddress" TEXT NOT NULL,
    "userAgent" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuestGrant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DeviceLoginRequest_tokenHash_key" ON "DeviceLoginRequest"("tokenHash");

-- CreateIndex
CREATE INDEX "DeviceLoginRequest_userId_status_idx" ON "DeviceLoginRequest"("userId", "status");

-- CreateIndex
CREATE INDEX "DeviceLoginRequest_expiresAt_idx" ON "DeviceLoginRequest"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "GuestGrant_tokenHash_key" ON "GuestGrant"("tokenHash");

-- CreateIndex
CREATE INDEX "GuestGrant_userId_idx" ON "GuestGrant"("userId");

-- CreateIndex
CREATE INDEX "GuestGrant_appId_idx" ON "GuestGrant"("appId");

-- CreateIndex
CREATE INDEX "GuestGrant_expiresAt_idx" ON "GuestGrant"("expiresAt");

-- AddForeignKey
ALTER TABLE "AuthCode" ADD CONSTRAINT "AuthCode_guestGrantId_fkey" FOREIGN KEY ("guestGrantId") REFERENCES "GuestGrant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OAuthAccessToken" ADD CONSTRAINT "OAuthAccessToken_guestGrantId_fkey" FOREIGN KEY ("guestGrantId") REFERENCES "GuestGrant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceLoginRequest" ADD CONSTRAINT "DeviceLoginRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestGrant" ADD CONSTRAINT "GuestGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestGrant" ADD CONSTRAINT "GuestGrant_appId_fkey" FOREIGN KEY ("appId") REFERENCES "App"("id") ON DELETE CASCADE ON UPDATE CASCADE;
