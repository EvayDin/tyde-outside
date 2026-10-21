import type { Prisma, PrismaClient } from '@prisma/client';
import { AuthError } from '../auth/auth.error.js';
import type { AuthPrincipal } from '../auth/auth.service.js';
import { participatingStatuses } from '../organizations/organization.service.js';

export async function resolveCurrentRequester(
  db: PrismaClient | Prisma.TransactionClient,
  principal: AuthPrincipal,
  input: { requesterId?: string | null; requesterType?: 'INDIVIDUAL' | 'ORGANIZATION' | null },
) {
  if (input.requesterId != null && input.requesterId !== principal.userId)
    throw new AuthError(403, 'FORBIDDEN', '只能使用当前登录账号作为需求方');
  const user = await db.user.findUnique({
    where: { id: principal.userId },
    include: {
      memberships: {
        where: { joinStatus: { in: participatingStatuses }, organization: { deleted: false } },
        include: { organization: true },
      },
    },
  });
  if (!user) throw new AuthError(404, 'NOT_FOUND', '需求方用户不存在');
  if (input.requesterType != null && user.accountType !== input.requesterType)
    throw new AuthError(400, 'VALIDATION_ERROR', '需求方类型与当前账号不一致');
  if (user.accountType === 'ORGANIZATION') {
    // 与当前用户资料的多组织选取规则一致，不接受客户端指定组织代替当前账号。
    const selected = [...user.memberships].sort(
      (a, b) =>
        Number(b.position === 'OWNER') - Number(a.position === 'OWNER') ||
        (a.joinedAt?.getTime() ?? Infinity) - (b.joinedAt?.getTime() ?? Infinity) ||
        a.id.localeCompare(b.id),
    )[0];
    const org = selected?.organization;
    if (!org?.name.trim())
      throw new AuthError(400, 'VALIDATION_ERROR', '当前组织账号未关联组织信息');
    return {
      user,
      requester: {
        requesterType: user.accountType as 'INDIVIDUAL' | 'ORGANIZATION',
        requesterId: user.id,
        requesterName: org.name,
        orgId: org.id,
        orgVerifyStatus: org.verifyStatus,
      },
    };
  }
  const nickname = user.displayName.trim();
  const realName = user.realName?.trim();
  const name = nickname && realName ? `${nickname}(${realName})` : nickname || realName;
  if (!name) throw new AuthError(400, 'VALIDATION_ERROR', '当前个人账号未填写姓名');
  return {
    user,
    requester: {
      requesterType: user.accountType as 'INDIVIDUAL' | 'ORGANIZATION',
      requesterId: user.id,
      requesterName: name,
      orgId: null,
      orgVerifyStatus: null,
    },
  };
}
