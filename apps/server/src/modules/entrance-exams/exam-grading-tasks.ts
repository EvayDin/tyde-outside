import type { Prisma } from '@prisma/client';
import type { TaskSnapshot, TaskSource, TaskScope } from '../projects/project-task-rounds.js';

export const gradingTaskTypes = ['ENTRANCE_EXAM_GRADING', 'ENTRANCE_EXAM_GRADING_RETRY'];
export function reviewerIds(value: Prisma.JsonValue): string[] {
  return Array.isArray(value)
    ? [
        ...new Set(
          value.flatMap((item) =>
            item &&
            typeof item === 'object' &&
            !Array.isArray(item) &&
            typeof item.userId === 'string'
              ? [item.userId]
              : [],
          ),
        ),
      ]
    : [];
}
// 历史版本、关闭考试的已交卷轮次继续有效；WAITING 不产生待办。
export async function collectGradingTasks(
  tx: Prisma.TransactionClient,
  projectId: number,
): Promise<TaskSnapshot> {
  const records = await tx.entranceExamGradingRecord.findMany({
    where: {
      status: { in: ['PENDING', 'PROCESSING', 'FAILED'] },
      attempt: { submittedAt: { not: null }, exam: { projectId, deleted: false } },
    },
    include: { gradingRound: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  const assigned = await tx.projectManagerRecruitment.findFirst({
    where: { projectId, status: 'ASSIGNED' },
    orderBy: [{ assignedAt: 'desc' }, { id: 'desc' }],
  });
  const ids = [...new Set(records.flatMap((r) => reviewerIds(r.gradingRound.reviewersJson)))];
  if (assigned) ids.push(assigned.candidateUserId);
  const active = new Set(
    (
      await tx.user.findMany({ where: { id: { in: ids }, status: 'ACTIVE' }, select: { id: true } })
    ).map((u) => u.id),
  );
  const sources = new Map<string, TaskSource>();
  const scopes = new Map<string, TaskScope>();
  const add = (userId: string, role: 'NAVIGATOR' | 'PM', taskType?: string, recordId?: number) => {
    if (!active.has(userId)) return;
    scopes.set(`${role}:${userId}`, {
      userId,
      role,
      perspective: role === 'PM' ? 'PROJECT_MANAGER' : 'NAVIGATOR',
      currentNodeCode: 'ENTRANCE_EXAM',
      mainEligible: false,
      boardVisible: true,
    });
    if (!taskType) return;
    const key = `${role}:${userId}:${taskType}`;
    const source = sources.get(key) ?? { userId, role, taskType, sources: [] };
    source.sources.push(`GRADING_RECORD:${recordId}`);
    sources.set(key, source);
  };
  // 所有历史人工池人员保留作用域，使被他人完成的轮次正确结算而不是误判离开项目。
  const rounds = await tx.entranceExamGradingRound.findMany({
    where: { gradingMode: 'MANUAL', version: { exam: { projectId, deleted: false } } },
  });
  const allIds = [...new Set(rounds.flatMap((r) => reviewerIds(r.reviewersJson)))];
  const allActive = await tx.user.findMany({
    where: { id: { in: allIds }, status: 'ACTIVE' },
    select: { id: true },
  });
  allActive.forEach((u) => active.add(u.id));
  for (const id of allIds) for (const role of ['NAVIGATOR', 'PM'] as const) add(id, role);
  if (assigned) add(assigned.candidateUserId, 'PM');
  for (const r of records) {
    if (r.gradingRound.gradingMode === 'MANUAL' && ['PENDING', 'PROCESSING'].includes(r.status))
      for (const id of reviewerIds(r.gradingRound.reviewersJson))
        for (const role of ['NAVIGATOR', 'PM'] as const)
          add(id, role, 'ENTRANCE_EXAM_GRADING', r.id);
    if (r.gradingRound.gradingMode === 'AUTO' && r.status === 'FAILED' && assigned)
      add(assigned.candidateUserId, 'PM', 'ENTRANCE_EXAM_GRADING_RETRY', r.id);
  }
  return { scopes: [...scopes.values()], sources: [...sources.values()] };
}

// 仅更新本采集器负责的阅卷快照；其他领域已有快照保留，完整跨领域优先级重算仍归04回补。
export async function refreshGradingSnapshots(
  tx: Prisma.TransactionClient,
  projectId: number,
  snapshot: TaskSnapshot,
  now: Date,
) {
  const records = await tx.entranceExamGradingRecord.findMany({
    where: { attempt: { exam: { projectId, deleted: false } } },
  });
  const byId = new Map(records.map((r) => [r.id, r]));
  const existing = await tx.projectRoleNodeSnapshot.findMany({
    where: { projectId, perspective: { in: ['NAVIGATOR', 'PROJECT_MANAGER'] } },
  });
  const recipients = new Map(snapshot.scopes.map((s) => [`${s.userId}:${s.perspective}`, s]));
  for (const old of existing)
    if (
      gradingTaskTypes.includes(old.branchNodeCode) &&
      !recipients.has(`${old.userId}:${old.perspective}`)
    ) {
      await tx.projectRoleNodeSnapshot.deleteMany({
        where: { id: old.id, sourceBizType: 'GRADING_RECORD' },
      });
    }
  for (const scope of snapshot.scopes) {
    const old = existing.find(
      (s) => s.userId === scope.userId && s.perspective === scope.perspective,
    );
    if (old && !gradingTaskTypes.includes(old.branchNodeCode)) continue;
    const candidate = snapshot.sources
      .filter((s) => s.userId === scope.userId && s.role === scope.role)
      .flatMap((s) =>
        s.sources.map((id) => ({
          taskType: s.taskType,
          record: byId.get(Number(id.split(':')[1])),
        })),
      )
      .filter((c) => c.record)
      .sort(
        (a, b) =>
          (b.taskType === 'ENTRANCE_EXAM_GRADING_RETRY' ? 95 : 75) -
            (a.taskType === 'ENTRANCE_EXAM_GRADING_RETRY' ? 95 : 75) ||
          a.record!.createdAt.getTime() - b.record!.createdAt.getTime() ||
          a.record!.id - b.record!.id,
      )[0];
    if (!candidate) {
      if (old)
        await tx.projectRoleNodeSnapshot.deleteMany({
          where: { id: old.id, sourceBizType: 'GRADING_RECORD' },
        });
      continue;
    }
    const data = {
      branchNodeCode: candidate.taskType,
      branchPriority: candidate.taskType === 'ENTRANCE_EXAM_GRADING_RETRY' ? 95 : 75,
      sourceBizType: 'GRADING_RECORD',
      sourceBizId: candidate.record!.id,
      sourceEventAt: candidate.record!.createdAt,
      calculatedAt: now,
    };
    await tx.projectRoleNodeSnapshot.upsert({
      where: {
        projectId_userId_perspective: {
          projectId,
          userId: scope.userId,
          perspective: scope.perspective,
        },
      },
      create: { projectId, userId: scope.userId, perspective: scope.perspective, ...data },
      update: data,
    });
  }
}
