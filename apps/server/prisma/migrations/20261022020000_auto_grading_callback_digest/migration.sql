BEGIN;
ALTER TABLE "EntranceExamGradingRecord" ADD COLUMN "callbackDigest" VARCHAR(64);
ALTER TABLE "EntranceExamGradingRecord" ADD CONSTRAINT "EntranceExamGradingRecord_callbackDigest_check" CHECK ("callbackDigest" IS NULL OR "callbackDigest" ~ '^[0-9a-f]{64}$');
COMMIT;
