import { Prisma, type PrismaClient } from '@prisma/client';
import type { AuthPrincipal } from '../auth/auth.service.js';
import { AuthError } from '../auth/auth.error.js';
import { businessDate } from '../organizations/member.service.js';
import { projectTime } from '../projects/project-time.js';

export interface PersonalApplicationQuery {
  businessType?: string | null;
  status?: string | null;
  startAt?: string | null;
  endAt?: string | null;
  current?: number;
  size?: number;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export class PersonalApplicationService {
  constructor(readonly db: PrismaClient) {}
  async list(input: PersonalApplicationQuery, principal: AuthPrincipal) {
    const current = input.current ?? 1,
      size = input.size ?? 20;
    if (
      !Number.isInteger(current) ||
      current < 1 ||
      current > 2147483647 ||
      !Number.isInteger(size) ||
      size < 1 ||
      size > 100
    )
      throw new AuthError(400, 'VALIDATION_ERROR', '分页参数不合法');
    const start = input.startAt ? businessDate(input.startAt) : undefined;
    const end = input.endAt ? businessDate(input.endAt) : undefined;
    if (start && end && start > end)
      throw new AuthError(400, 'VALIDATION_ERROR', 'startAt不能晚于endAt');
    const businessType =
      input.businessType === undefined ? 'ORG_MEMBER_EXIT' : input.businessType?.trim();
    return this.db.$transaction(
      async (tx) => {
        const where: Prisma.ApprovalFlowWhereInput = {
          applicantId: principal.userId,
          ...(businessType ? { businessType } : {}),
          ...(input.status ? { status: input.status } : {}),
          ...(start || end
            ? { appliedAt: { ...(start ? { gte: start } : {}), ...(end ? { lte: end } : {}) } }
            : {}),
        };
        const total = await tx.approvalFlow.count({ where });
        const offset = (current - 1) * size;
        const rows =
          offset >= total
            ? []
            : await tx.approvalFlow.findMany({
                where,
                orderBy: [{ appliedAt: 'desc' }, { id: 'desc' }],
                skip: offset,
                take: size,
              });
        const snapshots = rows.map((flow) => {
          const data = flow.formData;
          return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
        });
        const ids = rows.flatMap((flow, i) => {
          const id = snapshots[i]!.targetMemberId;
          return flow.businessType === 'ORG_MEMBER_EXIT' && typeof id === 'string' && uuid.test(id)
            ? [id]
            : [];
        });
        const members = ids.length
          ? await tx.userOrgRel.findMany({ where: { id: { in: ids } }, include: { user: true } })
          : [];
        const records = rows.map((flow, i) => {
          const data = snapshots[i]!;
          const text = (name: string) =>
            typeof data[name] === 'string' ? (data[name] as string) : null;
          const targetMemberId = text('targetMemberId');
          const member = members.find(
            (r) => r.id === targetMemberId && r.orgId === flow.applicantOrgId,
          );
          const name = member?.user.displayName?.trim(),
            real = member?.user.realName?.trim();
          let plannedLeaveDate = text('plannedLeaveDate');
          if (plannedLeaveDate) {
            try {
              businessDate(plannedLeaveDate, true);
            } catch {
              plannedLeaveDate = null;
            }
          }
          return {
            applicationId: flow.id,
            flowNo: flow.flowNo,
            flowVersionNo: flow.versionNo,
            businessType: flow.businessType,
            businessId: flow.businessId,
            businessNo: flow.businessNo,
            title: flow.title,
            applicantOrgId: flow.applicantOrgId,
            applicantOrgName: flow.applicantOrgName,
            applyReason: flow.applyReason,
            status: flow.status,
            currentNode: flow.currentNode,
            currentNodeCode: flow.currentNodeCode,
            formData: flow.formData,
            targetMemberId,
            targetMemberName: member
              ? name && real
                ? `${name}(${real})`
                : name || real || member.user.uid
              : text('targetMemberName'),
            plannedLeaveDate,
            appliedAt: projectTime(flow.appliedAt),
            finishedAt: flow.finishedAt ? projectTime(flow.finishedAt) : null,
          };
        });
        return { total, pages: Math.ceil(total / size), current, size, records };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
