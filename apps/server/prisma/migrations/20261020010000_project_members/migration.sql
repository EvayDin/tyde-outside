-- CreateTable
CREATE TABLE "ProjectMember" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "userId" UUID NOT NULL,
    "userOrgRelId" UUID,
    "organizationId" UUID,
    "expertAssignmentId" INTEGER,
    "admissionAttemptId" INTEGER,
    "admittedAt" TIMESTAMPTZ(3),
    "entryDecision" VARCHAR(12),
    "plannedEntryDate" DATE,
    "entryDeclineReason" VARCHAR(500),
    "projectRole" VARCHAR(20) NOT NULL DEFAULT 'MEMBER',
    "status" VARCHAR(24) NOT NULL DEFAULT 'ACTIVE',
    "joinedAt" TIMESTAMPTZ(3),
    "standardTrainingConfirmedAt" TIMESTAMPTZ(3),
    "plannedLeaveDate" DATE,
    "leftAt" TIMESTAMPTZ(3),
    "createdBy" VARCHAR(36) NOT NULL,
    "updatedBy" VARCHAR(36),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ProjectMember_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectMember_admissionAttemptId_key" ON "ProjectMember"("admissionAttemptId");

-- CreateIndex
CREATE INDEX "ProjectMember_userId_status_idx" ON "ProjectMember"("userId", "status");

-- CreateIndex
CREATE INDEX "ProjectMember_userOrgRelId_status_idx" ON "ProjectMember"("userOrgRelId", "status");

-- CreateIndex
CREATE INDEX "ProjectMember_projectId_status_joinedAt_idx" ON "ProjectMember"("projectId", "status", "joinedAt");

-- CreateIndex
CREATE INDEX "ProjectMember_projectId_status_plannedEntryDate_plannedLeav_idx" ON "ProjectMember"("projectId", "status", "plannedEntryDate", "plannedLeaveDate");

-- CreateIndex
CREATE INDEX "ProjectMember_projectId_organizationId_status_idx" ON "ProjectMember"("projectId", "organizationId", "status");

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_userOrgRelId_fkey" FOREIGN KEY ("userOrgRelId") REFERENCES "UserOrgRel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- 不新增project/user唯一限制：保留旧成员历史及每次准入的独立关系。
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_enums" CHECK (
 "projectRole" IN ('MEMBER','PROJECT_MANAGER') AND
 "status" IN ('PENDING_CONFIRM','PENDING_ENTRY','ACTIVE','ENTRY_DECLINED','PENDING_EXIT','PENDING_TRANSFER','LEFT','REMOVED') AND
 ("entryDecision" IS NULL OR "entryDecision" IN ('YES','NO')) AND
 ("expertAssignmentId" IS NULL OR "expertAssignmentId" > 0) AND
 ("admissionAttemptId" IS NULL OR "admissionAttemptId" > 0));
