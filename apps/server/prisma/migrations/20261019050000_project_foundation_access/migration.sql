-- 登录身份仍固定EXPERT，管理角色由受信运维流程维护，不回填或自动授权现有用户。
CREATE TABLE "ManagementGrant" (
  "userId" UUID NOT NULL,
  "role" VARCHAR(16) NOT NULL,
  "grantedBy" VARCHAR(128) NOT NULL,
  "grantedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMPTZ(3),
  CONSTRAINT "ManagementGrant_pkey" PRIMARY KEY ("userId", "role"),
  CONSTRAINT "ManagementGrant_role_check" CHECK ("role" IN ('NAVIGATOR', 'PM')),
  CONSTRAINT "ManagementGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "ManagementGrant_role_revokedAt_idx" ON "ManagementGrant"("role", "revokedAt");
CREATE TABLE "ManagementGrantAudit" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "role" VARCHAR(16) NOT NULL,
  "action" VARCHAR(16) NOT NULL,
  "actor" VARCHAR(128) NOT NULL,
  "reason" VARCHAR(500) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ManagementGrantAudit_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ManagementGrantAudit_role_check" CHECK ("role" IN ('NAVIGATOR', 'PM')),
  CONSTRAINT "ManagementGrantAudit_action_check" CHECK ("action" IN ('GRANT', 'REVOKE')),
  CONSTRAINT "ManagementGrantAudit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "ManagementGrantAudit_userId_createdAt_idx" ON "ManagementGrantAudit"("userId", "createdAt");
CREATE TABLE "ProjectCategory" (
  "id" SERIAL NOT NULL,
  "categoryCode" VARCHAR(64) NOT NULL,
  "categoryName" VARCHAR(128) NOT NULL,
  "categoryLevel" SMALLINT NOT NULL,
  "searchKeywords" VARCHAR(500),
  "sortNo" INTEGER NOT NULL DEFAULT 0,
  "status" VARCHAR(16) NOT NULL DEFAULT 'ENABLED',
  "createdBy" VARCHAR(128) NOT NULL,
  "updatedBy" VARCHAR(128) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ProjectCategory_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProjectCategory_level_check" CHECK ("categoryLevel" BETWEEN 1 AND 3),
  CONSTRAINT "ProjectCategory_status_check" CHECK ("status" IN ('ENABLED', 'DISABLED'))
);
CREATE UNIQUE INDEX "ProjectCategory_categoryCode_key" ON "ProjectCategory"("categoryCode");
CREATE UNIQUE INDEX "ProjectCategory_categoryLevel_categoryName_key" ON "ProjectCategory"("categoryLevel", "categoryName");
CREATE INDEX "ProjectCategory_status_categoryLevel_sortNo_id_idx" ON "ProjectCategory"("status", "categoryLevel", "sortNo", "id");
