ALTER TABLE "Organization" ADD COLUMN "businessLicenseKey" VARCHAR(512);
CREATE TABLE "UploadedFile" (
 "id" UUID NOT NULL,
 "objectKey" VARCHAR(512) NOT NULL,
 "claimTokenHash" VARCHAR(64) NOT NULL,
 "bizType" VARCHAR(32) NOT NULL,
 "category" VARCHAR(32) NOT NULL,
 "fileName" VARCHAR(255) NOT NULL,
 "extension" VARCHAR(20) NOT NULL,
 "contentType" VARCHAR(128) NOT NULL,
 "fileSize" INTEGER NOT NULL CHECK ("fileSize" > 0),
 "fileHash" VARCHAR(64) NOT NULL,
 "sensitiveFlag" BOOLEAN NOT NULL,
 "ownerUid" VARCHAR(36),
 "status" VARCHAR(16) NOT NULL DEFAULT 'UPLOADED' CHECK ("status" IN ('UPLOADED','CLAIMED','RELEASED','DELETED')),
 "claimedBizType" VARCHAR(64),
 "claimedBizId" UUID,
 "claimedAt" TIMESTAMPTZ(3),
 "expiresAt" TIMESTAMPTZ(3),
 "deletedAt" TIMESTAMPTZ(3),
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMPTZ(3) NOT NULL,
 CONSTRAINT "UploadedFile_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "UploadedFile_objectKey_key" ON "UploadedFile"("objectKey");
CREATE INDEX "UploadedFile_status_expiresAt_idx" ON "UploadedFile"("status", "expiresAt");
CREATE INDEX "UploadedFile_ownerUid_idx" ON "UploadedFile"("ownerUid");
CREATE INDEX "UploadedFile_claimedBizType_claimedBizId_idx" ON "UploadedFile"("claimedBizType", "claimedBizId");
