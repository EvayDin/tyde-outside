-- 逐题答案及判卷来源结构；只读详情不会创建答案或派发阅卷任务。
BEGIN;

-- CreateTable
CREATE TABLE "EntranceExamAnswer" (
    "id" SERIAL NOT NULL,
    "attemptId" INTEGER NOT NULL,
    "paperId" INTEGER NOT NULL,
    "questionId" INTEGER NOT NULL,
    "answerContent" TEXT,
    "answerFilesJson" JSONB,
    "answeredFlag" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" VARCHAR(36) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EntranceExamAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EntranceExamGradingItem" (
    "id" SERIAL NOT NULL,
    "gradingRecordId" INTEGER NOT NULL,
    "attemptId" INTEGER NOT NULL,
    "questionId" INTEGER NOT NULL,
    "answerId" INTEGER NOT NULL,
    "correctness" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    "gradingOpinion" TEXT,
    "createdBy" VARCHAR(36) NOT NULL,
    "updatedBy" VARCHAR(36),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "EntranceExamGradingItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EntranceExamAnswer_attemptId_questionId_key" ON "EntranceExamAnswer"("attemptId", "questionId");

-- CreateIndex
CREATE UNIQUE INDEX "EntranceExamAnswer_id_attemptId_questionId_key" ON "EntranceExamAnswer"("id", "attemptId", "questionId");

-- CreateIndex
CREATE INDEX "EntranceExamGradingItem_answerId_attemptId_questionId_idx" ON "EntranceExamGradingItem"("answerId", "attemptId", "questionId");

-- CreateIndex
CREATE UNIQUE INDEX "EntranceExamGradingItem_gradingRecordId_questionId_key" ON "EntranceExamGradingItem"("gradingRecordId", "questionId");

-- CreateIndex
CREATE UNIQUE INDEX "EntranceExamAttempt_id_paperId_key" ON "EntranceExamAttempt"("id", "paperId");

-- CreateIndex
CREATE UNIQUE INDEX "EntranceExamQuestion_id_paperId_key" ON "EntranceExamQuestion"("id", "paperId");

-- CreateIndex
CREATE UNIQUE INDEX "EntranceExamGradingRecord_id_attemptId_key" ON "EntranceExamGradingRecord"("id", "attemptId");

-- AddForeignKey
ALTER TABLE "EntranceExamAnswer" ADD CONSTRAINT "EntranceExamAnswer_attemptId_paperId_fkey" FOREIGN KEY ("attemptId", "paperId") REFERENCES "EntranceExamAttempt"("id", "paperId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntranceExamAnswer" ADD CONSTRAINT "EntranceExamAnswer_questionId_paperId_fkey" FOREIGN KEY ("questionId", "paperId") REFERENCES "EntranceExamQuestion"("id", "paperId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntranceExamGradingItem" ADD CONSTRAINT "EntranceExamGradingItem_gradingRecordId_attemptId_fkey" FOREIGN KEY ("gradingRecordId", "attemptId") REFERENCES "EntranceExamGradingRecord"("id", "attemptId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntranceExamGradingItem" ADD CONSTRAINT "EntranceExamGradingItem_answerId_attemptId_questionId_fkey" FOREIGN KEY ("answerId", "attemptId", "questionId") REFERENCES "EntranceExamAnswer"("id", "attemptId", "questionId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "EntranceExamAnswer" ADD CONSTRAINT "EntranceExamAnswer_files" CHECK (
  "answerFilesJson" IS NULL OR jsonb_typeof("answerFilesJson") = 'array'
);
ALTER TABLE "EntranceExamGradingItem" ADD CONSTRAINT "EntranceExamGradingItem_correctness" CHECK (
  "correctness" IN ('PENDING','CORRECT','INCORRECT')
);
COMMIT;
