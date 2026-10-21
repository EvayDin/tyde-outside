-- 多业务标识：组织保留原UUID文本，项目使用旧接口数值ID的十进制文本。
-- 不改变claimedBizType、业务归属或权限，不重写已应用的迁移。
ALTER TABLE "UploadedFile"
  ALTER COLUMN "claimedBizId" TYPE VARCHAR(64)
  USING "claimedBizId"::text;
