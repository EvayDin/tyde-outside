import type { Prisma } from '@prisma/client';
import type { TaskSnapshot } from './project-task-rounds.js';

// 修复本域拒单支线；其他领域快照和完整优先级重算仍由04负责。
export async function syncRecruitmentRetrySnapshot(
  tx: Prisma.TransactionClient,
  projectId: number,
  snapshot: TaskSnapshot,
) {
  const old = await tx.projectRoleNodeSnapshot.findMany({
    where: { projectId, perspective: { in: ['PROJECT_MANAGER', 'EXPERT_RECRUITMENT_HANDLER'] } },
  });
  const sources = await tx.projectExpertAssignment.findMany({
    where: { projectId, status: 'REJECTED', replacements: { none: {} } },
    orderBy: [{ rejectedAt: 'asc' }, { id: 'asc' }],
  });
  const recipients = snapshot.scopes.filter(
    (s) =>
      s.role === 'PM' &&
      snapshot.sources.some(
        (t) => t.userId === s.userId && t.taskType === 'EXPERT_RECRUITMENT_RETRY',
      ),
  );
  const scopes = recipients.filter(
    (s) =>
      s.perspective === 'PROJECT_MANAGER' ||
      !recipients.some((r) => r.userId === s.userId && r.perspective === 'PROJECT_MANAGER'),
  );
  for (const row of old)
    if (
      row.branchNodeCode === 'EXPERT_RECRUITMENT_RETRY' &&
      !scopes.some((s) => s.userId === row.userId && s.perspective === row.perspective)
    )
      await tx.projectRoleNodeSnapshot.deleteMany({
        where: { id: row.id, sourceBizType: 'EXPERT_ASSIGNMENT' },
      });
  for (const scope of scopes) {
    const existing = old.find(
      (r) => r.userId === scope.userId && r.perspective === scope.perspective,
    );
    if (existing && existing.branchNodeCode !== 'EXPERT_RECRUITMENT_RETRY') continue;
    const source = sources[0];
    if (!source) continue;
    const data = {
      branchNodeCode: 'EXPERT_RECRUITMENT_RETRY',
      branchPriority: 90,
      sourceBizType: 'EXPERT_ASSIGNMENT',
      sourceBizId: source.id,
      sourceEventAt: source.rejectedAt ?? source.createdAt,
      calculatedAt: new Date(),
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
