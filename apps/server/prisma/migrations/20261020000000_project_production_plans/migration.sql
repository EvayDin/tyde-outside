-- CreateTable
CREATE TABLE "ProjectProductionPlan" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "operatorHeadcount" INTEGER NOT NULL,
    "operatorCpd" DECIMAL(20,4) NOT NULL,
    "inspectorHeadcount" INTEGER,
    "inspectorCpd" DECIMAL(20,4),
    "needWrittenExam" BOOLEAN NOT NULL DEFAULT true,
    "maxActiveExamCount" INTEGER NOT NULL DEFAULT 1,
    "needInterview" BOOLEAN NOT NULL DEFAULT false,
    "totalExpectedOutput" DECIMAL(30,4) NOT NULL,
    "confirmedBy" TEXT NOT NULL,
    "confirmedAt" TIMESTAMPTZ(3) NOT NULL,
    "extJson" JSONB,
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ProjectProductionPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectProductionCrowd" (
    "id" SERIAL NOT NULL,
    "planId" INTEGER NOT NULL,
    "sequenceNo" INTEGER NOT NULL,
    "crowdName" VARCHAR(100) NOT NULL,
    "profileRequirement" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ProjectProductionCrowd_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectProductionStage" (
    "id" SERIAL NOT NULL,
    "planId" INTEGER NOT NULL,
    "sequenceNo" INTEGER NOT NULL,
    "stageName" VARCHAR(100) NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "naturalDayCount" INTEGER NOT NULL,
    "workdayCount" INTEGER NOT NULL,
    "workdayCountSource" VARCHAR(20) NOT NULL DEFAULT 'AUTO',
    "operatorHeadcount" INTEGER NOT NULL,
    "operatorCpd" DECIMAL(20,4) NOT NULL,
    "accuracyRate" DECIMAL(7,4),
    "expectedOutput" DECIMAL(30,4) NOT NULL,
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ProjectProductionStage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectProductionPlan_projectId_key" ON "ProjectProductionPlan"("projectId");

-- CreateIndex
CREATE INDEX "ProjectProductionPlan_confirmedBy_confirmedAt_idx" ON "ProjectProductionPlan"("confirmedBy", "confirmedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectProductionCrowd_planId_sequenceNo_key" ON "ProjectProductionCrowd"("planId", "sequenceNo");

-- CreateIndex
CREATE INDEX "ProjectProductionStage_startDate_endDate_idx" ON "ProjectProductionStage"("startDate", "endDate");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectProductionStage_planId_sequenceNo_key" ON "ProjectProductionStage"("planId", "sequenceNo");

-- AddForeignKey
ALTER TABLE "ProjectProductionPlan" ADD CONSTRAINT "ProjectProductionPlan_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectProductionCrowd" ADD CONSTRAINT "ProjectProductionCrowd_planId_fkey" FOREIGN KEY ("planId") REFERENCES "ProjectProductionPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectProductionStage" ADD CONSTRAINT "ProjectProductionStage_planId_fkey" FOREIGN KEY ("planId") REFERENCES "ProjectProductionPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- 确认后的计划不可保存为缺失主项的草稿；历史保留，不级联物理删除。
ALTER TABLE "ProjectProductionPlan" ADD CONSTRAINT "ProjectProductionPlan_positive"
 CHECK ("operatorHeadcount" > 0 AND "operatorCpd" > 0 AND "maxActiveExamCount" > 0
 AND "totalExpectedOutput" > 0 AND (("inspectorHeadcount" IS NULL AND "inspectorCpd" IS NULL)
 OR ("inspectorHeadcount" IS NOT NULL AND "inspectorCpd" IS NOT NULL AND "inspectorHeadcount" > 0 AND "inspectorCpd" > 0)));
ALTER TABLE "ProjectProductionCrowd" ADD CONSTRAINT "ProjectProductionCrowd_valid"
 CHECK ("sequenceNo" > 0 AND length(btrim("crowdName")) > 0 AND length(btrim("profileRequirement")) > 0);
ALTER TABLE "ProjectProductionStage" ADD CONSTRAINT "ProjectProductionStage_valid"
 CHECK ("sequenceNo" > 0 AND length(btrim("stageName")) > 0 AND "endDate" >= "startDate"
 AND "naturalDayCount" = ("endDate" - "startDate") + 1 AND "workdayCount" > 0
 AND "workdayCountSource" IN ('AUTO', 'MANUAL') AND "operatorHeadcount" > 0 AND "operatorCpd" > 0
 AND ("accuracyRate" IS NULL OR ("accuracyRate" > 0 AND "accuracyRate" <= 100))
 AND "expectedOutput" = "operatorCpd" * "operatorHeadcount" * "workdayCount");
