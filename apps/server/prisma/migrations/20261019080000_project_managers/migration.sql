-- 策略官任职、管理主线任务轮次及事务事件基础，不自动授权或创建任职。
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "creditScore" INTEGER DEFAULT 100;

-- CreateTable
CREATE TABLE "ProjectManagerRecruitment" (
    "id" SERIAL NOT NULL,
    "recruitmentNo" VARCHAR(40) NOT NULL,
    "projectId" INTEGER NOT NULL,
    "candidateUserId" UUID NOT NULL,
    "expertRecruitmentHandlerUserId" UUID,
    "recruitmentType" VARCHAR(16) NOT NULL,
    "assignmentMode" VARCHAR(24) NOT NULL DEFAULT 'DIRECT',
    "status" VARCHAR(24) NOT NULL DEFAULT 'ASSIGNED',
    "previousManagerUserId" UUID,
    "acceptanceDeadline" TIMESTAMPTZ(3),
    "respondedAt" TIMESTAMPTZ(3),
    "assignedAt" TIMESTAMPTZ(3) NOT NULL,
    "replacedAt" TIMESTAMPTZ(3),
    "rejectReason" TEXT,
    "createdBy" VARCHAR(36) NOT NULL,
    "updatedBy" VARCHAR(36) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ProjectManagerRecruitment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectTaskRound" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "userId" UUID NOT NULL,
    "role" VARCHAR(16) NOT NULL,
    "taskType" VARCHAR(64) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'OPEN',
    "participated" BOOLEAN NOT NULL DEFAULT false,
    "openedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMPTZ(3),

    CONSTRAINT "ProjectTaskRound_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectEventOutbox" (
    "id" UUID NOT NULL,
    "projectId" INTEGER NOT NULL,
    "eventType" VARCHAR(64) NOT NULL,
    "operation" VARCHAR(96) NOT NULL,
    "actorUserId" UUID,
    "payload" JSONB NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectEventOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectManagerRecruitment_recruitmentNo_key" ON "ProjectManagerRecruitment"("recruitmentNo");

-- CreateIndex
CREATE INDEX "ProjectManagerRecruitment_projectId_status_assignedAt_id_idx" ON "ProjectManagerRecruitment"("projectId", "status", "assignedAt", "id");

-- CreateIndex
CREATE INDEX "ProjectManagerRecruitment_candidateUserId_status_idx" ON "ProjectManagerRecruitment"("candidateUserId", "status");

-- CreateIndex
CREATE INDEX "ProjectTaskRound_projectId_status_idx" ON "ProjectTaskRound"("projectId", "status");

-- CreateIndex
CREATE INDEX "ProjectTaskRound_userId_role_status_finishedAt_idx" ON "ProjectTaskRound"("userId", "role", "status", "finishedAt");

-- CreateIndex
CREATE INDEX "ProjectEventOutbox_status_nextAttemptAt_createdAt_idx" ON "ProjectEventOutbox"("status", "nextAttemptAt", "createdAt");

-- CreateIndex
CREATE INDEX "ProjectEventOutbox_projectId_createdAt_idx" ON "ProjectEventOutbox"("projectId", "createdAt");

-- AddForeignKey
ALTER TABLE "ProjectManagerRecruitment" ADD CONSTRAINT "ProjectManagerRecruitment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectManagerRecruitment" ADD CONSTRAINT "ProjectManagerRecruitment_candidateUserId_fkey" FOREIGN KEY ("candidateUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectManagerRecruitment" ADD CONSTRAINT "ProjectManagerRecruitment_expertRecruitmentHandlerUserId_fkey" FOREIGN KEY ("expertRecruitmentHandlerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectManagerRecruitment" ADD CONSTRAINT "ProjectManagerRecruitment_previousManagerUserId_fkey" FOREIGN KEY ("previousManagerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectTaskRound" ADD CONSTRAINT "ProjectTaskRound_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectTaskRound" ADD CONSTRAINT "ProjectTaskRound_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectEventOutbox" ADD CONSTRAINT "ProjectEventOutbox_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Prisma模型无法表达部分唯一索引；历史REPLACED/已完成轮次不占用唯一名额。
CREATE UNIQUE INDEX "ProjectManagerRecruitment_one_assigned" ON "ProjectManagerRecruitment"("projectId") WHERE "status" = 'ASSIGNED';
CREATE UNIQUE INDEX "ProjectTaskRound_one_open" ON "ProjectTaskRound"("projectId", "userId", "role", "taskType") WHERE "status" = 'OPEN';
ALTER TABLE "ProjectManagerRecruitment" ADD CONSTRAINT "ProjectManagerRecruitment_status_check" CHECK ("status" IN ('PENDING_ACCEPTANCE', 'ASSIGNED', 'REPLACED', 'REJECTED', 'CANCELLED'));
ALTER TABLE "ProjectManagerRecruitment" ADD CONSTRAINT "ProjectManagerRecruitment_type_check" CHECK ("recruitmentType" IN ('INITIAL', 'REPLACEMENT'));
ALTER TABLE "ProjectManagerRecruitment" ADD CONSTRAINT "ProjectManagerRecruitment_mode_check" CHECK ("assignmentMode" IN ('DIRECT', 'REQUIRE_ACCEPTANCE'));
ALTER TABLE "ProjectTaskRound" ADD CONSTRAINT "ProjectTaskRound_role_check" CHECK ("role" IN ('NAVIGATOR', 'PM', 'EXPERT'));
ALTER TABLE "ProjectTaskRound" ADD CONSTRAINT "ProjectTaskRound_status_check" CHECK ("status" IN ('OPEN', 'COMPLETED', 'CANCELLED'));
ALTER TABLE "ProjectEventOutbox" ADD CONSTRAINT "ProjectEventOutbox_status_check" CHECK ("status" IN ('PENDING', 'PROCESSING', 'DELIVERED', 'FAILED'));
ALTER TABLE "ProjectEventOutbox" ADD CONSTRAINT "ProjectEventOutbox_attempts_check" CHECK ("attempts" >= 0);
