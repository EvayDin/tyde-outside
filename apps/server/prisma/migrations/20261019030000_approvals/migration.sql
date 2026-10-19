-- CreateTable
CREATE TABLE "ApprovalProcess" (
    "id" UUID NOT NULL,
    "processCode" VARCHAR(64) NOT NULL,
    "processName" VARCHAR(100) NOT NULL,
    "businessType" VARCHAR(64) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" VARCHAR(16) NOT NULL DEFAULT 'DRAFT',
    "allowWithdraw" BOOLEAN NOT NULL DEFAULT true,
    "description" VARCHAR(500),
    "createdBy" VARCHAR(36),
    "updatedBy" VARCHAR(36),
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ApprovalProcess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalConfig" (
    "id" UUID NOT NULL,
    "processId" UUID NOT NULL,
    "nodeSeq" INTEGER NOT NULL,
    "nodeCode" VARCHAR(64) NOT NULL,
    "nodeName" VARCHAR(100) NOT NULL,
    "approverType" VARCHAR(32) NOT NULL,
    "approverConfig" JSONB,
    "approveMode" VARCHAR(16) NOT NULL DEFAULT 'ANY',
    "conditionJson" JSONB,
    "noApproverAction" VARCHAR(16) NOT NULL DEFAULT 'AUTO_PASS',
    "timeoutHours" INTEGER,
    "createdBy" VARCHAR(36),
    "updatedBy" VARCHAR(36),
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ApprovalConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalFlow" (
    "id" UUID NOT NULL,
    "flowNo" VARCHAR(64) NOT NULL,
    "processId" UUID,
    "processCode" VARCHAR(64) NOT NULL,
    "processVersion" INTEGER NOT NULL DEFAULT 1,
    "businessType" VARCHAR(64) NOT NULL,
    "businessId" VARCHAR(64) NOT NULL,
    "businessNo" VARCHAR(64),
    "title" VARCHAR(200) NOT NULL,
    "applicantId" UUID NOT NULL,
    "applicantName" VARCHAR(200) NOT NULL,
    "applicantOrgId" UUID,
    "applicantOrgName" VARCHAR(128),
    "formData" JSONB,
    "beforeData" JSONB,
    "afterData" JSONB,
    "applyReason" VARCHAR(1000),
    "status" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    "currentNode" INTEGER,
    "currentNodeCode" VARCHAR(64),
    "totalNodes" INTEGER NOT NULL DEFAULT 0,
    "versionNo" INTEGER NOT NULL DEFAULT 0,
    "appliedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMPTZ(3),
    "remark" VARCHAR(1000),
    "createdBy" VARCHAR(36),
    "updatedBy" VARCHAR(36),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ApprovalFlow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalNode" (
    "id" UUID NOT NULL,
    "flowId" UUID NOT NULL,
    "flowNo" VARCHAR(64) NOT NULL,
    "configId" UUID,
    "nodeSeq" INTEGER NOT NULL,
    "nodeCode" VARCHAR(64) NOT NULL,
    "nodeName" VARCHAR(100) NOT NULL,
    "approverId" UUID NOT NULL,
    "approverUid" VARCHAR(36) NOT NULL,
    "approverName" VARCHAR(200) NOT NULL,
    "approverType" VARCHAR(32) NOT NULL,
    "approverSource" JSONB,
    "nodeStatus" VARCHAR(16) NOT NULL DEFAULT 'WAITING',
    "approveComment" VARCHAR(1000),
    "approvedAt" TIMESTAMPTZ(3),
    "dueAt" TIMESTAMPTZ(3),
    "versionNo" INTEGER NOT NULL DEFAULT 0,
    "createdBy" VARCHAR(36),
    "updatedBy" VARCHAR(36),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ApprovalNode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalActionLog" (
    "id" BIGSERIAL NOT NULL,
    "flowId" UUID NOT NULL,
    "nodeId" UUID,
    "actionType" VARCHAR(16) NOT NULL,
    "operatorId" UUID,
    "operatorName" VARCHAR(200) NOT NULL,
    "fromStatus" VARCHAR(24),
    "toStatus" VARCHAR(24),
    "actionComment" VARCHAR(1000),
    "actionData" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprovalActionLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationDeparture" (
    "id" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "memberVersion" INTEGER NOT NULL,
    "orgId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "effectiveAt" TIMESTAMPTZ(3) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "OrganizationDeparture_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ApprovalProcess_businessType_status_deleted_idx" ON "ApprovalProcess"("businessType", "status", "deleted");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalProcess_processCode_version_key" ON "ApprovalProcess"("processCode", "version");

-- CreateIndex
CREATE INDEX "ApprovalConfig_processId_deleted_idx" ON "ApprovalConfig"("processId", "deleted");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalConfig_processId_nodeSeq_key" ON "ApprovalConfig"("processId", "nodeSeq");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalConfig_processId_nodeCode_key" ON "ApprovalConfig"("processId", "nodeCode");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalFlow_flowNo_key" ON "ApprovalFlow"("flowNo");

-- CreateIndex
CREATE INDEX "ApprovalFlow_businessType_businessId_status_idx" ON "ApprovalFlow"("businessType", "businessId", "status");

-- CreateIndex
CREATE INDEX "ApprovalFlow_applicantOrgId_status_idx" ON "ApprovalFlow"("applicantOrgId", "status");

-- CreateIndex
CREATE INDEX "ApprovalNode_approverId_nodeStatus_createdAt_idx" ON "ApprovalNode"("approverId", "nodeStatus", "createdAt");

-- CreateIndex
CREATE INDEX "ApprovalNode_flowId_nodeSeq_idx" ON "ApprovalNode"("flowId", "nodeSeq");

-- CreateIndex
CREATE INDEX "ApprovalActionLog_flowId_createdAt_idx" ON "ApprovalActionLog"("flowId", "createdAt");

-- CreateIndex
CREATE INDEX "ApprovalActionLog_nodeId_id_idx" ON "ApprovalActionLog"("nodeId", "id");

-- CreateIndex
CREATE INDEX "OrganizationDeparture_status_createdAt_idx" ON "OrganizationDeparture"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationDeparture_memberId_memberVersion_key" ON "OrganizationDeparture"("memberId", "memberVersion");

-- AddForeignKey
ALTER TABLE "ApprovalConfig" ADD CONSTRAINT "ApprovalConfig_processId_fkey" FOREIGN KEY ("processId") REFERENCES "ApprovalProcess"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalNode" ADD CONSTRAINT "ApprovalNode_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "ApprovalFlow"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalActionLog" ADD CONSTRAINT "ApprovalActionLog_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "ApprovalFlow"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalActionLog" ADD CONSTRAINT "ApprovalActionLog_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "ApprovalNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;


ALTER TABLE "ApprovalProcess"
  ADD CONSTRAINT "ApprovalProcess_status_check" CHECK ("status" IN ('DRAFT','ENABLED','DISABLED')),
  ADD CONSTRAINT "ApprovalProcess_version_check" CHECK ("version" >= 1);
ALTER TABLE "ApprovalConfig"
  ADD CONSTRAINT "ApprovalConfig_seq_check" CHECK ("nodeSeq" >= 1),
  ADD CONSTRAINT "ApprovalConfig_type_check" CHECK ("approverType" IN ('USER','ROLE','ORG_LEADER','APPLICANT_MANAGER','FORM_USER')),
  ADD CONSTRAINT "ApprovalConfig_mode_check" CHECK ("approveMode" IN ('ANY','ALL','SEQUENTIAL')),
  ADD CONSTRAINT "ApprovalConfig_noApprover_check" CHECK ("noApproverAction" IN ('AUTO_PASS','AUTO_REJECT')),
  ADD CONSTRAINT "ApprovalConfig_timeout_check" CHECK ("timeoutHours" IS NULL OR "timeoutHours" >= 0);
ALTER TABLE "ApprovalFlow"
  ADD CONSTRAINT "ApprovalFlow_status_check" CHECK ("status" IN ('PENDING','APPROVED','REJECTED','WITHDRAWN','CANCELED')),
  ADD CONSTRAINT "ApprovalFlow_version_check" CHECK ("versionNo" >= 0 AND "processVersion" >= 1 AND "totalNodes" >= 0),
  ADD CONSTRAINT "ApprovalFlow_currentNode_check" CHECK ("currentNode" IS NULL OR "currentNode" >= 1);
ALTER TABLE "ApprovalNode"
  ADD CONSTRAINT "ApprovalNode_status_check" CHECK ("nodeStatus" IN ('WAITING','PENDING','APPROVED','REJECTED','SKIPPED','CANCELED','TRANSFERRED')),
  ADD CONSTRAINT "ApprovalNode_type_check" CHECK ("approverType" IN ('USER','ROLE','ORG_LEADER','APPLICANT_MANAGER','FORM_USER')),
  ADD CONSTRAINT "ApprovalNode_version_check" CHECK ("versionNo" >= 0 AND "nodeSeq" >= 1);
ALTER TABLE "ApprovalActionLog"
  ADD CONSTRAINT "ApprovalActionLog_type_check" CHECK ("actionType" IN ('SUBMIT','APPROVE','REJECT','WITHDRAW','TRANSFER','AUTO_PASS','AUTO_REJECT','CANCEL','SKIP'));
ALTER TABLE "OrganizationDeparture"
  ADD CONSTRAINT "OrganizationDeparture_status_check" CHECK ("status" IN ('PENDING','COMPLETED')),
  ADD CONSTRAINT "OrganizationDeparture_version_check" CHECK ("memberVersion" >= 0);

-- 保留旧种子；组织退出Service使用内置单主管流程，不执行此历史ROLE配置，不由它放宽管理权限。
INSERT INTO "ApprovalProcess" ("id", "processCode", "processName", "businessType", "version", "status", "allowWithdraw", "description", "createdBy", "updatedBy", "updatedAt")
VALUES ('00000000-0000-4000-8000-000000000101', 'ORG_MEMBER_EXIT', '退出组织审批', 'ORG_MEMBER_EXIT', 1, 'ENABLED', true, '历史配置：主管或管理员审批；当前组织退出使用内置OWNER单节点，不执行此定义', 'SYSTEM', 'SYSTEM', CURRENT_TIMESTAMP);
INSERT INTO "ApprovalConfig" ("id", "processId", "nodeSeq", "nodeCode", "nodeName", "approverType", "approverConfig", "approveMode", "noApproverAction", "createdBy", "updatedBy", "updatedAt")
VALUES ('00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000101', 1, 'EXIT_APPROVAL', '主管或管理员审批', 'ROLE', '{"roleCodes":["OWNER","ADMIN"]}', 'ANY', 'AUTO_REJECT', 'SYSTEM', 'SYSTEM', CURRENT_TIMESTAMP);
