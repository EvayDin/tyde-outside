-- 仅从新项目已有单组织字段回填，不连接或导入旧库。
ALTER TABLE "Organization"
  ADD COLUMN "verifyStatus" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "status" VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "deleted" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "updatedBy" VARCHAR(36),
  ADD COLUMN "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE "Organization" SET "updatedAt" = "createdAt";
ALTER TABLE "Organization"
  ADD CONSTRAINT "Organization_verifyStatus_check" CHECK ("verifyStatus" IN ('PENDING', 'APPROVED', 'REJECTED')),
  ADD CONSTRAINT "Organization_status_check" CHECK ("status" IN ('ACTIVE', 'FROZEN', 'DISSOLVED'));

CREATE TABLE "UserOrgRel" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "uid" VARCHAR(36) NOT NULL,
  "orgId" UUID NOT NULL,
  "position" VARCHAR(16) NOT NULL DEFAULT 'MEMBER',
  "employmentType" VARCHAR(16),
  "joinStatus" VARCHAR(24) NOT NULL DEFAULT 'ACTIVE',
  "joinedAt" TIMESTAMPTZ(3) DEFAULT CURRENT_TIMESTAMP,
  "plannedLeaveDate" DATE,
  "leftAt" TIMESTAMPTZ(3),
  "versionNo" INTEGER NOT NULL DEFAULT 0,
  "createdBy" VARCHAR(36),
  "updatedBy" VARCHAR(36),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "UserOrgRel_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UserOrgRel_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "UserOrgRel_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "UserOrgRel_position_check" CHECK ("position" IN ('OWNER', 'ADMIN', 'MEMBER')),
  CONSTRAINT "UserOrgRel_employmentType_check" CHECK ("employmentType" IN ('FULL_TIME', 'PART_TIME')),
  CONSTRAINT "UserOrgRel_joinStatus_check" CHECK ("joinStatus" IN ('PENDING', 'PENDING_ACTIVATION', 'ACTIVE', 'EXIT_APPROVING', 'PENDING_LEAVE', 'LEFT', 'REMOVED')),
  CONSTRAINT "UserOrgRel_versionNo_check" CHECK ("versionNo" >= 0)
);
CREATE UNIQUE INDEX "UserOrgRel_userId_orgId_key" ON "UserOrgRel"("userId", "orgId");
CREATE INDEX "UserOrgRel_orgId_joinStatus_idx" ON "UserOrgRel"("orgId", "joinStatus");
CREATE INDEX "UserOrgRel_uid_idx" ON "UserOrgRel"("uid");
-- 未记录身份时只赋 MEMBER，不把未知身份提升为主管。
INSERT INTO "UserOrgRel" ("id", "userId", "uid", "orgId", "position", "joinedAt", "createdBy", "updatedBy", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", "uid", "organizationId", COALESCE("orgPosition", 'MEMBER'), "createdAt", "uid", "uid", "createdAt", "updatedAt"
FROM "User" WHERE "organizationId" IS NOT NULL;
