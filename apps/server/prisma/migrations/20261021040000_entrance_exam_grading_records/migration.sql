-- 只创建逐轮判卷记录结构，不生成任务或考试结果；考生交卷/阅卷写流程后续接入。
BEGIN;

-- CreateTable
CREATE TABLE "EntranceExamGradingRecord" (
    "id" SERIAL NOT NULL,
    "attemptId" INTEGER NOT NULL,
    "gradingRoundId" INTEGER NOT NULL,
    "examVersionId" INTEGER NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    "reviewerUserId" UUID,
    "toolTraceId" VARCHAR(128),
    "score" DECIMAL(10,2),
    "roundResult" VARCHAR(16),
    "conclusionSummary" TEXT,
    "errorMessage" VARCHAR(1000),
    "startedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "createdBy" VARCHAR(36) NOT NULL,
    "updatedBy" VARCHAR(36),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "EntranceExamGradingRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EntranceExamGradingRecord_reviewerUserId_status_createdAt_idx" ON "EntranceExamGradingRecord"("reviewerUserId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "EntranceExamGradingRecord_gradingRoundId_status_createdAt_idx" ON "EntranceExamGradingRecord"("gradingRoundId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "EntranceExamGradingRecord_status_attemptId_idx" ON "EntranceExamGradingRecord"("status", "attemptId");

-- CreateIndex
CREATE UNIQUE INDEX "EntranceExamGradingRecord_attemptId_gradingRoundId_key" ON "EntranceExamGradingRecord"("attemptId", "gradingRoundId");

-- CreateIndex
CREATE UNIQUE INDEX "EntranceExamGradingRound_id_examVersionId_key" ON "EntranceExamGradingRound"("id", "examVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "EntranceExamAttempt_id_examVersionId_key" ON "EntranceExamAttempt"("id", "examVersionId");

-- AddForeignKey
ALTER TABLE "EntranceExamGradingRecord" ADD CONSTRAINT "EntranceExamGradingRecord_attemptId_examVersionId_fkey" FOREIGN KEY ("attemptId", "examVersionId") REFERENCES "EntranceExamAttempt"("id", "examVersionId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntranceExamGradingRecord" ADD CONSTRAINT "EntranceExamGradingRecord_gradingRoundId_examVersionId_fkey" FOREIGN KEY ("gradingRoundId", "examVersionId") REFERENCES "EntranceExamGradingRound"("id", "examVersionId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntranceExamGradingRecord" ADD CONSTRAINT "EntranceExamGradingRecord_reviewerUserId_fkey" FOREIGN KEY ("reviewerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "EntranceExamGradingRecord" ADD CONSTRAINT "EntranceExamGradingRecord_valid" CHECK (
  "status" IN ('WAITING','PENDING','PROCESSING','COMPLETED','FAILED')
  AND ("score" IS NULL OR "score" >= 0)
  AND ("roundResult" IS NULL OR "roundResult" IN ('ADMITTED','ELIMINATED'))
);
COMMIT;
