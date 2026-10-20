import { Prisma, type PrismaClient, type UserOrgRel } from '@prisma/client';
import { AuthError } from '../auth/auth.error.js';
import type { AuthPrincipal } from '../auth/auth.service.js';
import { lockOrganization, participatingStatuses } from './organization.service.js';

export interface MemberQuery {
  orgId: string;
  keyword?: string | null;
  joinedStartDate?: string | null;
  joinedEndDate?: string | null;
  leftStartDate?: string | null;
  leftEndDate?: string | null;
  employmentType?: string | null;
  position?: string | null;
  joinStatus?: string | null;
  projectId?: string | null;
  current?: number;
  size?: number;
}
export interface MemberUpdateInput {
  orgId: string;
  memberId: string;
  versionNo: number;
  joinedAt?: string | null;
  employmentType?: string | null;
}
export interface MemberPositionInput {
  orgId: string;
  memberId: string;
  position: string;
}
const invalid = (message: string) => new AuthError(400, 'VALIDATION_ERROR', message);
const conflict = (message = '成员资料已被更新，请刷新后重试') =>
  new AuthError(409, 'DUPLICATE', message);

// 旧接口不含时区的日期/时间按业务时区上海解释；禁止 Date 自动进位非法日期。
export function businessDate(value: string, dateOnly = false): Date {
  const pattern = dateOnly
    ? /^(\d{4})-(\d{2})-(\d{2})$/
    : /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;
  const parts = pattern.exec(value);
  if (!parts) throw invalid('日期格式不正确');
  const [, y, m, d, h = '00', min = '00', sec = '00'] = parts;
  const utc = new Date(`${y}-${m}-${d}T${h}:${min}:${sec}.000Z`);
  if (
    !Number.isFinite(utc.getTime()) ||
    utc.toISOString().slice(0, 19) !== `${y}-${m}-${d}T${h}:${min}:${sec}`
  )
    throw invalid('日期值不合法');
  return new Date(utc.getTime() - 8 * 3_600_000);
}
function dateFilter(start?: string | null, end?: string | null) {
  const from = start ? businessDate(start, true) : undefined;
  const to = end ? businessDate(end, true) : undefined;
  if (from && to && from > to) throw invalid('日期范围起点不能晚于终点');
  return {
    ...(from ? { gte: from } : {}),
    ...(to ? { lt: new Date(to.getTime() + 86_400_000) } : {}),
  };
}

export class MemberService {
  constructor(readonly db: PrismaClient) {}
  async list(input: MemberQuery, principal: AuthPrincipal) {
    return this.db.$transaction(
      async (tx) => {
        await this.manager(tx, input.orgId, principal.userId);
        await this.organization(tx, input.orgId);
        const joinedAt = dateFilter(input.joinedStartDate, input.joinedEndDate);
        const leftAt = dateFilter(input.leftStartDate, input.leftEndDate);
        if (input.projectId != null)
          throw new AuthError(503, 'NOT_IMPLEMENTED', '项目成员关系尚未迁移，暂不支持按项目筛选');
        const current = input.current ?? 1,
          size = input.size ?? 20;
        const keyword = input.keyword?.trim();
        const where: Prisma.UserOrgRelWhereInput = {
          orgId: input.orgId,
          ...(input.employmentType ? { employmentType: input.employmentType } : {}),
          ...(input.position ? { position: input.position } : {}),
          ...(input.joinStatus ? { joinStatus: input.joinStatus } : {}),
          ...(Object.keys(joinedAt).length ? { joinedAt } : {}),
          ...(Object.keys(leftAt).length ? { leftAt } : {}),
          ...(keyword
            ? {
                user: {
                  OR: [
                    { realName: { contains: keyword } },
                    { uid: { contains: keyword } },
                    { phoneE164: `+86${keyword}` },
                  ],
                },
              }
            : {}),
        };
        const total = await tx.userOrgRel.count({ where });
        const offset = (current - 1) * size;
        const rows =
          offset >= total
            ? []
            : await tx.userOrgRel.findMany({
                where,
                include: { user: true },
                orderBy: [{ joinedAt: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }],
                skip: offset,
                take: size,
              });
        return {
          total,
          pages: Math.ceil(total / size),
          current,
          size,
          records: rows.map((rel) => ({
            memberId: rel.id,
            userId: rel.userId,
            uid: rel.uid,
            realName: rel.user.realName,
            nickname: rel.user.displayName,
            phoneMasked: /^\+86\d{11}$/.test(rel.user.phoneE164)
              ? rel.user.phoneE164.slice(3).replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2')
              : '****',
            avatarUrl: rel.user.avatarUrl,
            userStatus: rel.user.status,
            employmentType: rel.employmentType,
            position: rel.position,
            joinStatus: rel.joinStatus,
            joinedAt: rel.joinedAt?.toISOString() ?? null,
            plannedLeaveDate: rel.plannedLeaveDate?.toISOString().slice(0, 10) ?? null,
            leftAt: rel.leftAt?.toISOString() ?? null,
            activeProjectCount: null, // 项目关系未迁移，不能把未知数量伪造为0。
            versionNo: rel.versionNo,
          })),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  async update(input: MemberUpdateInput, principal: AuthPrincipal) {
    return this.db.$transaction(async (tx) => {
      await lockOrganization(tx, input.orgId);
      const actor = await this.manager(tx, input.orgId, principal.userId);
      await this.organization(tx, input.orgId);
      if (input.joinedAt == null && input.employmentType == null)
        throw invalid('joinedAt和employmentType至少填写一项');
      const joinedAt = input.joinedAt != null ? businessDate(input.joinedAt) : undefined;
      if (joinedAt && joinedAt > new Date()) throw invalid('入组时间不得晚于当前时间');
      const target = await this.member(tx, input.orgId, input.memberId);
      if (actor.position === 'ADMIN' && target.position !== 'MEMBER' && target.id !== actor.id)
        throw new AuthError(403, 'FORBIDDEN', '管理员只能编辑普通成员或自己');
      const updated = await tx.userOrgRel.updateMany({
        where: { id: target.id, orgId: input.orgId, versionNo: input.versionNo },
        data: {
          ...(joinedAt ? { joinedAt } : {}),
          ...(input.employmentType != null ? { employmentType: input.employmentType } : {}),
          versionNo: { increment: 1 },
          updatedBy: principal.uid,
          updatedAt: new Date(),
        },
      });
      if (updated.count !== 1) throw conflict();
      const rel = await this.member(tx, input.orgId, input.memberId);
      return {
        memberId: rel.id,
        userId: rel.userId,
        joinedAt: rel.joinedAt?.toISOString() ?? null,
        employmentType: rel.employmentType,
        versionNo: rel.versionNo,
        updatedAt: rel.updatedAt.toISOString(),
      };
    });
  }
  async position(input: MemberPositionInput, principal: AuthPrincipal) {
    return this.db.$transaction(async (tx) => {
      await lockOrganization(tx, input.orgId);
      const actor = await this.manager(tx, input.orgId, principal.userId);
      await this.organization(tx, input.orgId);
      const target = await this.member(tx, input.orgId, input.memberId);
      if (target.joinStatus !== 'ACTIVE') throw invalid('仅在职成员可以变更组织角色');
      if (actor.position === 'ADMIN') {
        if (input.position === 'OWNER')
          throw new AuthError(403, 'FORBIDDEN', '管理员不能变更主管角色');
        if (target.id !== actor.id && target.position !== 'MEMBER')
          throw new AuthError(403, 'FORBIDDEN', '管理员只能变更普通成员或自己的角色');
      } else {
        const owner = await tx.userOrgRel.findFirst({
          where: { orgId: input.orgId, position: 'OWNER', joinStatus: 'ACTIVE' },
          orderBy: { id: 'asc' },
        });
        if (!owner || owner.id !== actor.id) throw conflict('组织主管已发生变化，请刷新后重试');
      }
      const beforePosition = target.position;
      if (beforePosition === input.position) return this.positionResponse(target, beforePosition);
      if (actor.position === 'OWNER' && target.id === actor.id)
        throw invalid('主管不能直接降低自己的角色，请先将主管转让给其他成员');
      const addsAdmin =
        (input.position === 'ADMIN' && beforePosition !== 'ADMIN') ||
        (input.position === 'OWNER' && beforePosition !== 'ADMIN');
      if (addsAdmin) {
        const count = await tx.userOrgRel.count({
          where: {
            orgId: input.orgId,
            position: 'ADMIN',
            joinStatus: { in: ['PENDING', 'PENDING_ACTIVATION', ...participatingStatuses] },
          },
        });
        if (count >= 5) throw invalid('每个组织最多5名管理员');
      }
      if (input.position === 'OWNER') await this.writePosition(tx, actor, 'ADMIN', principal.uid);
      const updated = await this.writePosition(tx, target, input.position, principal.uid);
      return this.positionResponse(updated, beforePosition);
    });
  }
  private positionResponse(rel: UserOrgRel, beforePosition: string) {
    return {
      memberId: rel.id,
      beforePosition,
      position: rel.position,
      updatedAt: rel.updatedAt.toISOString(),
    };
  }
  private writePosition(
    tx: Prisma.TransactionClient,
    rel: UserOrgRel,
    position: string,
    uid: string,
  ) {
    return tx.userOrgRel.update({
      where: { id: rel.id },
      data: { position, versionNo: { increment: 1 }, updatedBy: uid, updatedAt: new Date() },
    });
  }
  private async manager(tx: Prisma.TransactionClient, orgId: string, userId: string) {
    const rel = await tx.userOrgRel.findUnique({ where: { userId_orgId: { userId, orgId } } });
    if (!rel || !participatingStatuses.includes(rel.joinStatus))
      throw new AuthError(403, 'FORBIDDEN', '当前用户不属于该组织');
    if (!['OWNER', 'ADMIN'].includes(rel.position))
      throw new AuthError(403, 'FORBIDDEN', '仅组织主管或管理员可管理组织人员');
    return rel;
  }
  private async organization(tx: Prisma.TransactionClient, orgId: string) {
    if (!(await tx.organization.findFirst({ where: { id: orgId, deleted: false } })))
      throw new AuthError(404, 'NOT_FOUND', '组织不存在');
  }
  private async member(tx: Prisma.TransactionClient, orgId: string, memberId: string) {
    const rel = await tx.userOrgRel.findFirst({ where: { id: memberId, orgId } });
    if (!rel) throw new AuthError(404, 'NOT_FOUND', '组织成员不存在');
    return rel;
  }
}
