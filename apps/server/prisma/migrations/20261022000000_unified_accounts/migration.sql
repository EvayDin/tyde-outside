-- 不清理数据；开发测试账号可另行重建。旧组织状态不在本迁移中篡改。
ALTER TABLE "Session" ADD COLUMN "selectedRole" VARCHAR(16) NOT NULL DEFAULT 'EXPERT';
ALTER TABLE "Session" ADD CONSTRAINT "Session_selectedRole_check" CHECK ("selectedRole" IN ('NAVIGATOR', 'PM', 'EXPERT'));
ALTER TABLE "Organization" ALTER COLUMN "verifyStatus" SET DEFAULT 'APPROVED';
