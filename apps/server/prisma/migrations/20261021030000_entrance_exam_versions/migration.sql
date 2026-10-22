-- 只新增配置结构及来源约束；不生成考试/版本，不清空历史引用。
-- 若旧读取前置存在孤立版本或重复轮次，本事务失败，须先核对真实来源。
BEGIN;

-- DropIndex
DROP INDEX "EntranceExamGradingRound_examVersionId_roundNo_idx";

-- CreateTable
CREATE TABLE "EntranceExamVersion" (
    "id" SERIAL NOT NULL,
    "examId" INTEGER NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "examNameSnapshot" VARCHAR(128) NOT NULL,
    "durationMinutes" INTEGER,
    "registrationDeadline" TIMESTAMPTZ(3) NOT NULL,
    "fullScore" DECIMAL(10,2) NOT NULL,
    "passScore" DECIMAL(10,2) NOT NULL,
    "decisionRule" VARCHAR(24) NOT NULL DEFAULT 'MAJORITY',
    "tieBreakRule" VARCHAR(16),
    "publishedBy" VARCHAR(36) NOT NULL,
    "publishedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdBy" VARCHAR(36) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EntranceExamVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EntranceExamPaper" (
    "id" SERIAL NOT NULL,
    "examVersionId" INTEGER NOT NULL,
    "sequenceNo" INTEGER NOT NULL,
    "paperName" VARCHAR(100),
    "totalScore" DECIMAL(10,2) NOT NULL,
    "createdBy" VARCHAR(36) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EntranceExamPaper_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EntranceExamQuestion" (
    "id" SERIAL NOT NULL,
    "paperId" INTEGER NOT NULL,
    "sequenceNo" INTEGER NOT NULL,
    "questionContent" TEXT,
    "questionFilesJson" JSONB,
    "requiredFlag" BOOLEAN NOT NULL DEFAULT true,
    "score" DECIMAL(10,2) NOT NULL,
    "scoreSource" VARCHAR(16) NOT NULL DEFAULT 'AUTO',
    "referenceAnswer" TEXT,
    "referenceFilesJson" JSONB,
    "createdBy" VARCHAR(36) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EntranceExamQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EntranceExamVersion_examId_publishedAt_idx" ON "EntranceExamVersion"("examId", "publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "EntranceExamVersion_examId_versionNo_key" ON "EntranceExamVersion"("examId", "versionNo");

-- CreateIndex
CREATE UNIQUE INDEX "EntranceExamVersion_id_examId_key" ON "EntranceExamVersion"("id", "examId");

-- CreateIndex
CREATE UNIQUE INDEX "EntranceExamPaper_examVersionId_sequenceNo_key" ON "EntranceExamPaper"("examVersionId", "sequenceNo");

-- CreateIndex
CREATE UNIQUE INDEX "EntranceExamPaper_id_examVersionId_key" ON "EntranceExamPaper"("id", "examVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "EntranceExamQuestion_paperId_sequenceNo_key" ON "EntranceExamQuestion"("paperId", "sequenceNo");

-- CreateIndex
CREATE UNIQUE INDEX "EntranceExamGradingRound_examVersionId_roundNo_key" ON "EntranceExamGradingRound"("examVersionId", "roundNo");

-- AddForeignKey
ALTER TABLE "ProjectEntranceExam" ADD CONSTRAINT "ProjectEntranceExam_currentVersionId_id_fkey" FOREIGN KEY ("currentVersionId", "id") REFERENCES "EntranceExamVersion"("id", "examId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntranceExamGradingRound" ADD CONSTRAINT "EntranceExamGradingRound_examVersionId_fkey" FOREIGN KEY ("examVersionId") REFERENCES "EntranceExamVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntranceExamAttempt" ADD CONSTRAINT "EntranceExamAttempt_examVersionId_examId_fkey" FOREIGN KEY ("examVersionId", "examId") REFERENCES "EntranceExamVersion"("id", "examId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntranceExamAttempt" ADD CONSTRAINT "EntranceExamAttempt_paperId_examVersionId_fkey" FOREIGN KEY ("paperId", "examVersionId") REFERENCES "EntranceExamPaper"("id", "examVersionId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntranceExamVersion" ADD CONSTRAINT "EntranceExamVersion_examId_fkey" FOREIGN KEY ("examId") REFERENCES "ProjectEntranceExam"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntranceExamPaper" ADD CONSTRAINT "EntranceExamPaper_examVersionId_fkey" FOREIGN KEY ("examVersionId") REFERENCES "EntranceExamVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntranceExamQuestion" ADD CONSTRAINT "EntranceExamQuestion_paperId_fkey" FOREIGN KEY ("paperId") REFERENCES "EntranceExamPaper"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "EntranceExamVersion" ADD CONSTRAINT "EntranceExamVersion_valid" CHECK (
  "versionNo" > 0 AND ("durationMinutes" IS NULL OR "durationMinutes" > 0)
  AND "fullScore" > 0 AND "passScore" > 0 AND "passScore" <= "fullScore"
  AND "decisionRule" IN ('MAJORITY','MANUAL_PRIORITY')
  AND ("tieBreakRule" IS NULL OR "tieBreakRule" IN ('STRICT','LENIENT'))
);
ALTER TABLE "EntranceExamPaper" ADD CONSTRAINT "EntranceExamPaper_valid" CHECK ("sequenceNo" > 0 AND "totalScore" > 0);
ALTER TABLE "EntranceExamQuestion" ADD CONSTRAINT "EntranceExamQuestion_valid" CHECK (
  "sequenceNo" > 0 AND "score" > 0 AND "scoreSource" IN ('AUTO','MANUAL')
  AND ("questionFilesJson" IS NULL OR jsonb_typeof("questionFilesJson") = 'array')
  AND ("referenceFilesJson" IS NULL OR jsonb_typeof("referenceFilesJson") = 'array')
);
-- 复合外键默认MATCH SIMPLE；防止非空paperId借NULL版本跳过归属校验。
ALTER TABLE "EntranceExamAttempt" ADD CONSTRAINT "EntranceExamAttempt_paper_version" CHECK ("paperId" IS NULL OR "examVersionId" IS NOT NULL);
COMMIT;
