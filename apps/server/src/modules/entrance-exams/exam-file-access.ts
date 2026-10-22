import type { PrismaClient } from '@prisma/client';
import type { AuthPrincipal } from '../auth/auth.service.js';
import { ManagementService } from '../management/management.service.js';
// 05先接实管理端范围；考生及已接单组织职责范围仍由07/08补齐，不凭项目成员身份放行。
export async function canReadManagedExamFile(
  db: PrismaClient,
  examId: number,
  principal: AuthPrincipal,
) {
  const exam = await db.projectEntranceExam.findFirst({
    where: { id: examId, deleted: false, project: { deleted: false } },
    select: { projectId: true, project: { select: { requesterId: true, createdBy: true } } },
  });
  if (!exam) return false;
  const management = new ManagementService(db);
  if (
    (principal.userId === exam.project.requesterId || principal.uid === exam.project.createdBy) &&
    (await management.hasRole(principal, 'NAVIGATOR'))
  )
    return true;
  if (await management.hasRole(principal, 'PM'))
    return Boolean(
      await db.projectManagerRecruitment.findFirst({
        where: {
          projectId: exam.projectId,
          status: 'ASSIGNED',
          OR: [
            { candidateUserId: principal.userId },
            { expertRecruitmentHandlerUserId: principal.userId },
          ],
        },
        select: { id: true },
      }),
    );
  return false;
}
