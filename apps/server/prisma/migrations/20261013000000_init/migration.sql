CREATE TABLE "User" (
  "id" UUID PRIMARY KEY, "phoneE164" VARCHAR(16) NOT NULL,
  "phoneRegion" VARCHAR(2) NOT NULL, "username" VARCHAR(32) NOT NULL,
  "displayName" VARCHAR(320) NOT NULL, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "User_username_format" CHECK ("username" ~ '^[a-z][a-z0-9_]{2,31}$')
);
CREATE UNIQUE INDEX "User_phoneE164_key" ON "User"("phoneE164");
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
CREATE TABLE "VerificationChallenge" (
  "id" UUID PRIMARY KEY, "phoneE164" VARCHAR(16) NOT NULL,
  "purpose" VARCHAR(16) NOT NULL DEFAULT 'login', "codeDigest" VARCHAR(64) NOT NULL,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL, "failedAttempts" INTEGER NOT NULL DEFAULT 0,
  "consumedAt" TIMESTAMPTZ(3), "invalidatedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "VerificationChallenge_phoneE164_createdAt_idx" ON "VerificationChallenge"("phoneE164", "createdAt");
CREATE INDEX "VerificationChallenge_expiresAt_idx" ON "VerificationChallenge"("expiresAt");
CREATE TABLE "RegistrationGrant" (
  "id" UUID PRIMARY KEY, "tokenDigest" VARCHAR(64) NOT NULL,
  "phoneE164" VARCHAR(16) NOT NULL, "phoneRegion" VARCHAR(2) NOT NULL,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL, "consumedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "RegistrationGrant_tokenDigest_key" ON "RegistrationGrant"("tokenDigest");
CREATE INDEX "RegistrationGrant_expiresAt_idx" ON "RegistrationGrant"("expiresAt");
CREATE TABLE "Session" (
  "id" UUID PRIMARY KEY, "tokenDigest" VARCHAR(64) NOT NULL,
  "userId" UUID NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "clientType" VARCHAR(16) NOT NULL, "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "revokedAt" TIMESTAMPTZ(3), "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "Session_tokenDigest_key" ON "Session"("tokenDigest");
CREATE INDEX "Session_userId_idx" ON "Session"("userId");
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");
CREATE TABLE "AuthRateLimit" (
  "key" VARCHAR(200) PRIMARY KEY, "count" INTEGER NOT NULL DEFAULT 0,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL
);
CREATE INDEX "AuthRateLimit_expiresAt_idx" ON "AuthRateLimit"("expiresAt");
