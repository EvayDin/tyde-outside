-- 项目草稿、分类快照和附件；仅新增表，不读取旧库或自动创建业务数据。
-- CreateTable
CREATE TABLE "Project" (
    "id" SERIAL NOT NULL,
    "projectNo" VARCHAR(40) NOT NULL,
    "requesterType" VARCHAR(16) NOT NULL,
    "requesterId" UUID NOT NULL,
    "requesterName" VARCHAR(320) NOT NULL,
    "projectName" VARCHAR(128),
    "projectDescription" TEXT,
    "difficultyLevel" VARCHAR(16),
    "projectQuantity" DECIMAL(20,4),
    "quantityUnit" VARCHAR(30),
    "deadline" TIMESTAMPTZ(3),
    "requiredHeadcount" INTEGER,
    "educationRequirement" VARCHAR(24) NOT NULL DEFAULT 'BACHELOR',
    "employmentType" VARCHAR(16),
    "experienceRequirement" TEXT,
    "workSummary" TEXT,
    "specialRequirement" TEXT,
    "mandatoryRequirement" TEXT,
    "standardContent" TEXT,
    "standardLink" VARCHAR(2000),
    "status" VARCHAR(16) NOT NULL DEFAULT 'DRAFT',
    "currentNodeCode" VARCHAR(40),
    "publishedAt" TIMESTAMPTZ(3),
    "closedAt" TIMESTAMPTZ(3),
    "versionNo" INTEGER NOT NULL DEFAULT 0,
    "extJson" JSONB,
    "createdBy" VARCHAR(36) NOT NULL,
    "updatedBy" VARCHAR(36) NOT NULL,
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectCategoryRelation" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "categoryId" INTEGER NOT NULL,
    "categoryLevel" SMALLINT NOT NULL,
    "categoryNameSnapshot" VARCHAR(128) NOT NULL,
    "sortNo" INTEGER NOT NULL DEFAULT 0,
    "createdBy" VARCHAR(36) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectCategoryRelation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectAttachment" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "attachmentType" VARCHAR(24) NOT NULL,
    "fileName" VARCHAR(255) NOT NULL,
    "objectKey" VARCHAR(500) NOT NULL,
    "extension" VARCHAR(16) NOT NULL,
    "contentType" VARCHAR(128) NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "fileHash" VARCHAR(64) NOT NULL,
    "sortNo" INTEGER NOT NULL DEFAULT 0,
    "status" VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    "uploaderName" VARCHAR(320) NOT NULL,
    "createdBy" VARCHAR(36) NOT NULL,
    "updatedBy" VARCHAR(36) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ProjectAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Project_projectNo_key" ON "Project"("projectNo");

-- CreateIndex
CREATE INDEX "Project_createdBy_status_deleted_idx" ON "Project"("createdBy", "status", "deleted");

-- CreateIndex
CREATE INDEX "Project_requesterType_requesterId_projectName_idx" ON "Project"("requesterType", "requesterId", "projectName");

-- CreateIndex
CREATE INDEX "ProjectCategoryRelation_projectId_categoryLevel_sortNo_id_idx" ON "ProjectCategoryRelation"("projectId", "categoryLevel", "sortNo", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectCategoryRelation_projectId_categoryId_key" ON "ProjectCategoryRelation"("projectId", "categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectAttachment_objectKey_key" ON "ProjectAttachment"("objectKey");

-- CreateIndex
CREATE INDEX "ProjectAttachment_projectId_status_sortNo_id_idx" ON "ProjectAttachment"("projectId", "status", "sortNo", "id");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectCategoryRelation" ADD CONSTRAINT "ProjectCategoryRelation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectCategoryRelation" ADD CONSTRAINT "ProjectCategoryRelation_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ProjectCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectAttachment" ADD CONSTRAINT "ProjectAttachment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Prisma schema不能表达部分唯一索引；逻辑删除不占用草稿/发布名称。
CREATE UNIQUE INDEX "Project_one_live_draft_per_creator" ON "Project"("createdBy") WHERE "deleted" = false AND "status" = 'DRAFT';
CREATE UNIQUE INDEX "Project_unique_published_name" ON "Project"("requesterType", "requesterId", "projectName") WHERE "deleted" = false AND "status" = 'PUBLISHED';
ALTER TABLE "Project" ADD CONSTRAINT "Project_status_check" CHECK ("status" IN ('DRAFT', 'PUBLISHED'));
ALTER TABLE "Project" ADD CONSTRAINT "Project_requester_type_check" CHECK ("requesterType" IN ('INDIVIDUAL', 'ORGANIZATION'));
ALTER TABLE "Project" ADD CONSTRAINT "Project_version_check" CHECK ("versionNo" >= 0);
ALTER TABLE "ProjectCategoryRelation" ADD CONSTRAINT "ProjectCategoryRelation_level_check" CHECK ("categoryLevel" BETWEEN 1 AND 3);
ALTER TABLE "ProjectAttachment" ADD CONSTRAINT "ProjectAttachment_type_check" CHECK ("attachmentType" IN ('STANDARD_REFERENCE', 'CASE', 'OTHER'));
ALTER TABLE "ProjectAttachment" ADD CONSTRAINT "ProjectAttachment_status_check" CHECK ("status" IN ('ACTIVE', 'DELETED'));
