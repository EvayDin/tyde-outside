-- 本迁移只定义结构，不回填或伪造接单/考试事实。已有ProjectMember.admissionAttemptId若有孤立值，外键会拒绝应用，须核对真实来源后修复，禁止自动清空。
BEGIN;

-- CreateTable
CREATE TABLE "OrgMemberSchedule" (
    "id" SERIAL NOT NULL,
    "scopeKey" VARCHAR(36) NOT NULL,
    "orgId" UUID,
    "userOrgRelId" UUID,
    "userId" UUID NOT NULL,
    "scheduleDate" DATE NOT NULL,
    "dayType" VARCHAR(8) NOT NULL,
    "shiftStartAt" TIMESTAMP(3),
    "shiftEndAt" TIMESTAMP(3),
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'Asia/Shanghai',
    "sourceType" VARCHAR(16) NOT NULL DEFAULT 'MANUAL',
    "batchNo" VARCHAR(64),
    "status" VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    "versionNo" INTEGER NOT NULL DEFAULT 0,
    "createdBy" VARCHAR(36) NOT NULL,
    "updatedBy" VARCHAR(36) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "OrgMemberSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrgAttendanceDaily" (
    "id" SERIAL NOT NULL,
    "scopeKey" VARCHAR(36) NOT NULL,
    "orgId" UUID,
    "userOrgRelId" UUID,
    "userId" UUID NOT NULL,
    "attendanceDate" DATE NOT NULL,
    "scheduleId" INTEGER,
    "expectedStartAt" TIMESTAMP(3),
    "expectedEndAt" TIMESTAMP(3),
    "firstClockInAt" TIMESTAMP(3),
    "lastClockOutAt" TIMESTAMP(3),
    "autoStatus" VARCHAR(24) NOT NULL,
    "finalStatus" VARCHAR(24) NOT NULL,
    "lateMinutes" INTEGER NOT NULL DEFAULT 0,
    "earlyLeaveMinutes" INTEGER NOT NULL DEFAULT 0,
    "workedMinutes" INTEGER NOT NULL DEFAULT 0,
    "reviewRequired" BOOLEAN NOT NULL DEFAULT false,
    "reviewReason" VARCHAR(1000),
    "manualOverride" BOOLEAN NOT NULL DEFAULT false,
    "manualRemark" VARCHAR(1000),
    "correctedBy" VARCHAR(36),
    "correctedAt" TIMESTAMPTZ(3),
    "calculatedAt" TIMESTAMPTZ(3),
    "versionNo" INTEGER NOT NULL DEFAULT 0,
    "createdBy" VARCHAR(36) NOT NULL,
    "updatedBy" VARCHAR(36) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "OrgAttendanceDaily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrgAttendanceAdjustment" (
    "id" SERIAL NOT NULL,
    "attendanceDailyId" INTEGER NOT NULL,
    "beforeStatus" VARCHAR(24) NOT NULL,
    "afterStatus" VARCHAR(24) NOT NULL,
    "beforeRemark" VARCHAR(1000),
    "afterRemark" VARCHAR(1000),
    "reason" VARCHAR(1000) NOT NULL,
    "operatorUserId" UUID NOT NULL,
    "operatorName" VARCHAR(200) NOT NULL,
    "createdBy" VARCHAR(36) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrgAttendanceAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonalScheduleReceipt" (
    "id" SERIAL NOT NULL,
    "userId" UUID NOT NULL,
    "key" VARCHAR(128) NOT NULL,
    "requestHash" VARCHAR(64) NOT NULL,
    "response" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PersonalScheduleReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectExpertAssignmentMember" (
    "id" SERIAL NOT NULL,
    "assignmentId" INTEGER NOT NULL,
    "userId" UUID NOT NULL,
    "userOrgRelId" UUID NOT NULL,
    "status" VARCHAR(16) NOT NULL,
    "rejectReason" VARCHAR(500),
    "respondedAt" TIMESTAMPTZ(3),
    "createdBy" VARCHAR(36) NOT NULL,
    "updatedBy" VARCHAR(36),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ProjectExpertAssignmentMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EntranceExamAttempt" (
    "id" SERIAL NOT NULL,
    "attemptNo" VARCHAR(64) NOT NULL,
    "examId" INTEGER NOT NULL,
    "examVersionId" INTEGER,
    "paperId" INTEGER,
    "candidateUserId" UUID NOT NULL,
    "candidateUid" VARCHAR(36) NOT NULL,
    "candidateName" VARCHAR(200) NOT NULL,
    "userOrgRelId" UUID,
    "organizationId" UUID,
    "organizationName" VARCHAR(128),
    "sourceBizType" VARCHAR(64) NOT NULL DEFAULT 'EXPERT_ORDER',
    "sourceBizId" INTEGER,
    "gradingStatus" VARCHAR(24) NOT NULL DEFAULT 'NOT_STARTED',
    "finalResult" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    "enteredAt" TIMESTAMPTZ(3),
    "answerDeadlineAt" TIMESTAMPTZ(3),
    "integritySignedAt" TIMESTAMPTZ(3),
    "submittedAt" TIMESTAMPTZ(3),
    "cancelledAt" TIMESTAMPTZ(3),
    "finalDecidedAt" TIMESTAMPTZ(3),
    "decisionDetailJson" JSONB,
    "createdBy" VARCHAR(36) NOT NULL,
    "updatedBy" VARCHAR(36),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "EntranceExamAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrgMemberSchedule_orgId_scheduleDate_idx" ON "OrgMemberSchedule"("orgId", "scheduleDate");

-- CreateIndex
CREATE UNIQUE INDEX "OrgMemberSchedule_scopeKey_userId_scheduleDate_key" ON "OrgMemberSchedule"("scopeKey", "userId", "scheduleDate");

-- CreateIndex
CREATE INDEX "OrgAttendanceDaily_orgId_attendanceDate_idx" ON "OrgAttendanceDaily"("orgId", "attendanceDate");

-- CreateIndex
CREATE UNIQUE INDEX "OrgAttendanceDaily_scopeKey_userId_attendanceDate_key" ON "OrgAttendanceDaily"("scopeKey", "userId", "attendanceDate");

-- CreateIndex
CREATE INDEX "OrgAttendanceAdjustment_attendanceDailyId_createdAt_idx" ON "OrgAttendanceAdjustment"("attendanceDailyId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PersonalScheduleReceipt_userId_key_key" ON "PersonalScheduleReceipt"("userId", "key");

-- CreateIndex
CREATE INDEX "ProjectExpertAssignmentMember_userId_status_idx" ON "ProjectExpertAssignmentMember"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectExpertAssignmentMember_assignmentId_userId_key" ON "ProjectExpertAssignmentMember"("assignmentId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "EntranceExamAttempt_attemptNo_key" ON "EntranceExamAttempt"("attemptNo");

-- CreateIndex
CREATE INDEX "EntranceExamAttempt_candidateUserId_examId_idx" ON "EntranceExamAttempt"("candidateUserId", "examId");

-- CreateIndex
CREATE UNIQUE INDEX "UserOrgRel_id_userId_orgId_key" ON "UserOrgRel"("id", "userId", "orgId");

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_admissionAttemptId_fkey" FOREIGN KEY ("admissionAttemptId") REFERENCES "EntranceExamAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgMemberSchedule" ADD CONSTRAINT "OrgMemberSchedule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgMemberSchedule" ADD CONSTRAINT "OrgMemberSchedule_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgMemberSchedule" ADD CONSTRAINT "OrgMemberSchedule_userOrgRelId_userId_orgId_fkey" FOREIGN KEY ("userOrgRelId", "userId", "orgId") REFERENCES "UserOrgRel"("id", "userId", "orgId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgAttendanceDaily" ADD CONSTRAINT "OrgAttendanceDaily_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgAttendanceDaily" ADD CONSTRAINT "OrgAttendanceDaily_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgAttendanceDaily" ADD CONSTRAINT "OrgAttendanceDaily_userOrgRelId_userId_orgId_fkey" FOREIGN KEY ("userOrgRelId", "userId", "orgId") REFERENCES "UserOrgRel"("id", "userId", "orgId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgAttendanceDaily" ADD CONSTRAINT "OrgAttendanceDaily_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "OrgMemberSchedule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgAttendanceAdjustment" ADD CONSTRAINT "OrgAttendanceAdjustment_attendanceDailyId_fkey" FOREIGN KEY ("attendanceDailyId") REFERENCES "OrgAttendanceDaily"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgAttendanceAdjustment" ADD CONSTRAINT "OrgAttendanceAdjustment_operatorUserId_fkey" FOREIGN KEY ("operatorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonalScheduleReceipt" ADD CONSTRAINT "PersonalScheduleReceipt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectExpertAssignmentMember" ADD CONSTRAINT "ProjectExpertAssignmentMember_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "ProjectExpertAssignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectExpertAssignmentMember" ADD CONSTRAINT "ProjectExpertAssignmentMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectExpertAssignmentMember" ADD CONSTRAINT "ProjectExpertAssignmentMember_userOrgRelId_fkey" FOREIGN KEY ("userOrgRelId") REFERENCES "UserOrgRel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntranceExamAttempt" ADD CONSTRAINT "EntranceExamAttempt_examId_fkey" FOREIGN KEY ("examId") REFERENCES "ProjectEntranceExam"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntranceExamAttempt" ADD CONSTRAINT "EntranceExamAttempt_candidateUserId_fkey" FOREIGN KEY ("candidateUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntranceExamAttempt" ADD CONSTRAINT "EntranceExamAttempt_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntranceExamAttempt" ADD CONSTRAINT "EntranceExamAttempt_userOrgRelId_fkey" FOREIGN KEY ("userOrgRelId") REFERENCES "UserOrgRel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 独立作用域明确使用PERSONAL；组织作用域必须包含成员关系，不使用UUID零值伪造成员。
ALTER TABLE "OrgMemberSchedule" ADD CONSTRAINT "OrgMemberSchedule_scope_check" CHECK (
  ("orgId" IS NULL AND "userOrgRelId" IS NULL AND "scopeKey" = 'PERSONAL') OR
  ("orgId" IS NOT NULL AND "userOrgRelId" IS NOT NULL AND "scopeKey" = "orgId"::text)
);
ALTER TABLE "OrgAttendanceDaily" ADD CONSTRAINT "OrgAttendanceDaily_scope_check" CHECK (
  ("orgId" IS NULL AND "userOrgRelId" IS NULL AND "scopeKey" = 'PERSONAL') OR
  ("orgId" IS NOT NULL AND "userOrgRelId" IS NOT NULL AND "scopeKey" = "orgId"::text)
);
ALTER TABLE "OrgMemberSchedule" ADD CONSTRAINT "OrgMemberSchedule_shift_check" CHECK (
  ("dayType" = 'REST' AND "shiftStartAt" IS NULL AND "shiftEndAt" IS NULL) OR
  ("dayType" = 'WORK' AND "shiftStartAt" IS NOT NULL AND "shiftEndAt" IS NOT NULL
   AND "shiftStartAt"::date = "scheduleDate" AND "shiftEndAt"::date = "scheduleDate" AND "shiftStartAt" < "shiftEndAt")
);

COMMIT;
