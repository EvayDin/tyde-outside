-- 未发生打卡的当天/未来请假不具备自动考勤结论；保留NULL，不伪造未来缺勤。
-- 沿原日级考勤可空状态语义，无数据重写，无新增权限或审批流程数据。
BEGIN;
ALTER TABLE "OrgAttendanceDaily" ALTER COLUMN "autoStatus" DROP NOT NULL;
ALTER TABLE "OrgAttendanceDaily" ALTER COLUMN "finalStatus" DROP NOT NULL;
ALTER TABLE "OrgAttendanceAdjustment" ALTER COLUMN "beforeStatus" DROP NOT NULL;
COMMIT;
