-- CreateTable
CREATE TABLE "ProjectRoleNodeSnapshot" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "userId" UUID NOT NULL,
    "perspective" VARCHAR(32) NOT NULL,
    "branchNodeCode" VARCHAR(64) NOT NULL,
    "branchPriority" INTEGER NOT NULL,
    "sourceBizType" VARCHAR(32) NOT NULL,
    "sourceBizId" INTEGER NOT NULL,
    "sourceEventAt" TIMESTAMPTZ(3) NOT NULL,
    "calculatedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ProjectRoleNodeSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectExpertAssignment" (
    "id" SERIAL NOT NULL,
    "assignmentNo" VARCHAR(64) NOT NULL,
    "projectId" INTEGER NOT NULL,
    "subjectType" VARCHAR(24) NOT NULL,
    "organizationId" UUID,
    "expertUserId" UUID,
    "projectOwnerUserId" UUID,
    "previousAssignmentId" INTEGER,
    "productionRequirement" DECIMAL(20,4),
    "operatorHeadcount" INTEGER,
    "inspectorHeadcount" INTEGER,
    "status" VARCHAR(24) NOT NULL DEFAULT 'PENDING_ACCEPTANCE',
    "acceptedAt" TIMESTAMPTZ(3),
    "rejectedAt" TIMESTAMPTZ(3),
    "rejectReason" TEXT,
    "createdBy" VARCHAR(36) NOT NULL,
    "updatedBy" VARCHAR(36),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ProjectExpertAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectExpertAssignmentOwner" (
    "id" SERIAL NOT NULL,
    "assignmentId" INTEGER NOT NULL,
    "userId" UUID NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    "appointedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMPTZ(3),
    "createdBy" VARCHAR(36) NOT NULL,
    "updatedBy" VARCHAR(36),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ProjectExpertAssignmentOwner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectEntranceExam" (
    "id" SERIAL NOT NULL,
    "examNo" VARCHAR(64) NOT NULL,
    "projectId" INTEGER NOT NULL,
    "examName" VARCHAR(128) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    "currentVersionId" INTEGER,
    "closedBy" VARCHAR(36),
    "closedAt" TIMESTAMPTZ(3),
    "closeReason" VARCHAR(500),
    "createdBy" VARCHAR(36) NOT NULL,
    "updatedBy" VARCHAR(36),
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ProjectEntranceExam_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EntranceExamGradingRound" (
    "id" SERIAL NOT NULL,
    "examVersionId" INTEGER NOT NULL,
    "roundNo" INTEGER NOT NULL,
    "gradingMode" VARCHAR(16) NOT NULL,
    "toolCode" VARCHAR(64),
    "toolName" VARCHAR(128),
    "toolConfigJson" JSONB,
    "reviewersJson" JSONB,
    "createdBy" VARCHAR(36) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EntranceExamGradingRound_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectRoleNodeSnapshot_userId_perspective_idx" ON "ProjectRoleNodeSnapshot"("userId", "perspective");

-- CreateIndex
CREATE INDEX "ProjectRoleNodeSnapshot_calculatedAt_idx" ON "ProjectRoleNodeSnapshot"("calculatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectRoleNodeSnapshot_projectId_userId_perspective_key" ON "ProjectRoleNodeSnapshot"("projectId", "userId", "perspective");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectExpertAssignment_assignmentNo_key" ON "ProjectExpertAssignment"("assignmentNo");

-- CreateIndex
CREATE INDEX "ProjectExpertAssignment_projectId_status_idx" ON "ProjectExpertAssignment"("projectId", "status");

-- CreateIndex
CREATE INDEX "ProjectExpertAssignmentOwner_userId_status_idx" ON "ProjectExpertAssignmentOwner"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectExpertAssignmentOwner_assignmentId_userId_key" ON "ProjectExpertAssignmentOwner"("assignmentId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectEntranceExam_examNo_key" ON "ProjectEntranceExam"("examNo");

-- CreateIndex
CREATE INDEX "ProjectEntranceExam_projectId_status_deleted_createdAt_idx" ON "ProjectEntranceExam"("projectId", "status", "deleted", "createdAt");

-- CreateIndex
CREATE INDEX "EntranceExamGradingRound_examVersionId_roundNo_idx" ON "EntranceExamGradingRound"("examVersionId", "roundNo");

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_expertAssignmentId_fkey" FOREIGN KEY ("expertAssignmentId") REFERENCES "ProjectExpertAssignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectRoleNodeSnapshot" ADD CONSTRAINT "ProjectRoleNodeSnapshot_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectRoleNodeSnapshot" ADD CONSTRAINT "ProjectRoleNodeSnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectExpertAssignment" ADD CONSTRAINT "ProjectExpertAssignment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectExpertAssignment" ADD CONSTRAINT "ProjectExpertAssignment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectExpertAssignment" ADD CONSTRAINT "ProjectExpertAssignment_expertUserId_fkey" FOREIGN KEY ("expertUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectExpertAssignment" ADD CONSTRAINT "ProjectExpertAssignment_projectOwnerUserId_fkey" FOREIGN KEY ("projectOwnerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectExpertAssignment" ADD CONSTRAINT "ProjectExpertAssignment_previousAssignmentId_fkey" FOREIGN KEY ("previousAssignmentId") REFERENCES "ProjectExpertAssignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectExpertAssignmentOwner" ADD CONSTRAINT "ProjectExpertAssignmentOwner_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "ProjectExpertAssignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectExpertAssignmentOwner" ADD CONSTRAINT "ProjectExpertAssignmentOwner_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectEntranceExam" ADD CONSTRAINT "ProjectEntranceExam_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- 读取前置不自动生成授权、接单、考试或支线；来源版本/业务表外键由05/07继续补齐。
ALTER TABLE "ProjectExpertAssignment" ADD CONSTRAINT "ProjectExpertAssignment_enums" CHECK (
 "subjectType" IN ('INDIVIDUAL','ORGANIZATION') AND "status" IN ('PENDING_ACCEPTANCE','ACCEPTED','REJECTED','REPLACED'));
ALTER TABLE "ProjectExpertAssignmentOwner" ADD CONSTRAINT "ProjectExpertAssignmentOwner_status" CHECK ("status" IN ('ACTIVE','REMOVED'));
ALTER TABLE "ProjectEntranceExam" ADD CONSTRAINT "ProjectEntranceExam_status" CHECK ("status" IN ('ACTIVE','CLOSED') AND ("currentVersionId" IS NULL OR "currentVersionId" > 0));
ALTER TABLE "EntranceExamGradingRound" ADD CONSTRAINT "EntranceExamGradingRound_valid" CHECK ("examVersionId" > 0 AND "roundNo" > 0 AND "gradingMode" IN ('AUTO','MANUAL'));
ALTER TABLE "ProjectRoleNodeSnapshot" ADD CONSTRAINT "ProjectRoleNodeSnapshot_valid" CHECK (
 "sourceBizId" > 0 AND "perspective" IN ('NAVIGATOR','PROJECT_MANAGER','EXPERT_RECRUITMENT_HANDLER','EXPERT_INDIVIDUAL','EXPERT_ORG_OWNER','EXPERT_PROJECT_OWNER','EXPERT_MEMBER') AND
 "branchNodeCode" IN ('MEMBER_MOVEMENT_APPROVAL','ENTRANCE_EXAM_GRADING_RETRY','EXPERT_RECRUITMENT_RETRY','SUBTASK_REWORK_REVIEW','SUBTASK_REWORK_SUBMIT','SUBTASK_ACCEPTANCE','ENTRANCE_EXAM_GRADING','OUTPUT_DATA_REVIEW','SUBTASK_CREATE','MEMBER_ENTRY_CONFIRM','ENTRANCE_EXAM','STANDARD_TRAINING','PRODUCTION_TASK'));
