-- 历史昵称重复时直接失败，禁止自动修改用户资料；部署前先检查重复值。
BEGIN;
ALTER TABLE "User"
  ADD COLUMN "avatarUrl" VARCHAR(512),
  ADD COLUMN "bio" VARCHAR(1000),
  ADD COLUMN "idVerified" SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN "updatedBy" VARCHAR(36);
ALTER TABLE "User" ADD CONSTRAINT "User_idVerified_check" CHECK ("idVerified" IN (0, 1));
CREATE UNIQUE INDEX "User_displayName_key" ON "User"("displayName");
COMMIT;
