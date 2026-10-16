ALTER TABLE "User"
 ADD COLUMN "uid" VARCHAR(36),
 ADD COLUMN "accountType" VARCHAR(16) NOT NULL DEFAULT 'INDIVIDUAL',
 ADD COLUMN "passwordHash" VARCHAR(256),
 ADD COLUMN "email" VARCHAR(128),
 ADD COLUMN "realName" VARCHAR(64),
 ADD COLUMN "idCardNo" VARCHAR(32),
 ADD COLUMN "role" VARCHAR(16) NOT NULL DEFAULT 'EXPERT',
 ADD COLUMN "status" VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
 ADD COLUMN "lastLoginAt" TIMESTAMPTZ(3),
 ADD COLUMN "lastLoginIp" VARCHAR(64),
 ADD COLUMN "organizationId" UUID,
 ADD COLUMN "orgPosition" VARCHAR(16);
UPDATE "User" SET "uid" = replace("id"::text, '-', ''), "realName" = left("displayName", 64);
ALTER TABLE "User" ALTER COLUMN "uid" SET NOT NULL;
CREATE UNIQUE INDEX "User_uid_key" ON "User"("uid");
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "User_idCardNo_key" ON "User"("idCardNo");
ALTER TABLE "Session" ADD COLUMN "refreshDigest" VARCHAR(64), ADD COLUMN "refreshExpiresAt" TIMESTAMPTZ(3);
CREATE UNIQUE INDEX "Session_refreshDigest_key" ON "Session"("refreshDigest");
CREATE TABLE "Organization" (
 "id" UUID NOT NULL PRIMARY KEY,
 "name" VARCHAR(128) NOT NULL,
 "unifiedCreditCode" VARCHAR(32),
 "description" VARCHAR(1024),
 "logoUrl" VARCHAR(512),
 "expertiseTags" TEXT[] NOT NULL,
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "Organization_name_key" ON "Organization"("name");
CREATE UNIQUE INDEX "Organization_unifiedCreditCode_key" ON "Organization"("unifiedCreditCode");
ALTER TABLE "User" ADD CONSTRAINT "User_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
