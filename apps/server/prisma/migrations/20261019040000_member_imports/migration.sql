-- 幂等回执与整批账号/关系写入同事务；处理中用事务级advisory锁，崩溃自动释放。
CREATE TABLE "MemberImportReceipt" (
  "key" VARCHAR(64) NOT NULL,
  "requestHash" VARCHAR(64) NOT NULL,
  "response" JSONB NOT NULL,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MemberImportReceipt_pkey" PRIMARY KEY ("key")
);
CREATE INDEX "MemberImportReceipt_expiresAt_idx" ON "MemberImportReceipt"("expiresAt");
