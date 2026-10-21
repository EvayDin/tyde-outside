import type { Prisma, PrismaClient } from '@prisma/client';
import { AuthError } from '../auth/auth.error.js';
import type { AuthPrincipal } from '../auth/auth.service.js';

export type ManagementRole = 'NAVIGATOR' | 'PM';
export interface GrantChange {
  uid: string;
  role: ManagementRole;
  action: 'GRANT' | 'REVOKE';
  actor: string;
  reason: string;
}

export class ManagementService {
  constructor(readonly db: PrismaClient) {}

  // 每次业务调用读取独立授权；不缓存到令牌，也不信任登录角色或客户端角色头。
  async requireRole(principal: AuthPrincipal, role: ManagementRole) {
    if (!(await this.hasRole(principal, role)))
      throw new AuthError(403, 'FORBIDDEN', '当前账号没有所需的管理授权');
  }

  async hasRole(principal: AuthPrincipal, role: ManagementRole) {
    return hasManagementRole(this.db, principal, role);
  }

  // 仅供持有数据库运维权限的本地命令调用，不提供HTTP授权入口。
  async change(input: GrantChange) {
    if (
      !['NAVIGATOR', 'PM'].includes(input.role) ||
      !['GRANT', 'REVOKE'].includes(input.action) ||
      !input.uid.trim() ||
      input.uid.length > 36 ||
      !input.actor.trim() ||
      input.actor.trim().length > 128 ||
      !input.reason.trim() ||
      input.reason.trim().length > 500
    )
      throw new AuthError(400, 'VALIDATION_ERROR', '授权参数、操作人或原因不合法');
    return this.db.$transaction(async (tx: Prisma.TransactionClient) => {
      // 按用户串行化授予/撤销；与账号写操作共用用户行锁。
      const users = await tx.$queryRaw<{ id: string; status: string }[]>`
        SELECT "id", "status" FROM "User" WHERE "uid" = ${input.uid.trim()} FOR UPDATE`;
      const user = users[0];
      if (!user) throw new AuthError(404, 'NOT_FOUND', '目标用户不存在');
      if (input.action === 'GRANT' && user.status !== 'ACTIVE')
        throw new AuthError(400, 'VALIDATION_ERROR', '仅可为正常账号授予管理权限');
      const where = { userId_role: { userId: user.id, role: input.role } };
      const existing = await tx.managementGrant.findUnique({ where });
      const active = Boolean(existing && existing.revokedAt === null);
      if (active === (input.action === 'GRANT')) return { changed: false };
      const now = new Date();
      if (input.action === 'GRANT') {
        const data = { grantedBy: input.actor.trim(), grantedAt: now, revokedAt: null };
        await tx.managementGrant.upsert({
          where,
          create: { userId: user.id, role: input.role, ...data },
          update: data,
        });
      } else {
        await tx.managementGrant.update({ where, data: { revokedAt: now } });
      }
      await tx.managementGrantAudit.create({
        data: {
          userId: user.id,
          role: input.role,
          action: input.action,
          actor: input.actor.trim(),
          reason: input.reason.trim(),
          createdAt: now,
        },
      });
      return { changed: true };
    });
  }
}

export async function hasManagementRole(
  db: Pick<PrismaClient, 'managementGrant'>,
  principal: AuthPrincipal,
  role: ManagementRole,
) {
  const grant = await db.managementGrant.findFirst({
    where: { userId: principal.userId, role, revokedAt: null, user: { status: 'ACTIVE' } },
    select: { userId: true },
  });
  return Boolean(grant);
}
