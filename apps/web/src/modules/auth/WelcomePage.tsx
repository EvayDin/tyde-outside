import { ArrowUpRight, Building2, Check, UserRound } from 'lucide-react';
import { Link } from '@tanstack/react-router';
import type { AuthUser } from '@tyde/shared';
import { Button } from '../../components/ui/button';
import { useWorkspaceView, workspaceViewOptions } from '../../layouts/WorkspaceView';

/** 展示真实账户及个人中心、组织入口，账户操作统一由工作台顶栏提供。 */
export function WelcomePage({ user }: { user: AuthUser }) {
  const { view } = useWorkspaceView();
  const managesOrganization =
    typeof user.organization?.id === 'string' &&
    ['OWNER', 'ADMIN'].includes(String(user.organization.position)) &&
    ['ACTIVE', 'EXIT_APPROVING', 'PENDING_LEAVE'].includes(String(user.organization.joinStatus));
  if (view !== 'EXPERT')
    return (
      <section className="space-y-[20px] rounded-[18px] border bg-card p-[24px] sm:p-[32px]">
        <h1 className="text-[28px] leading-tight font-semibold tracking-tight">
          {workspaceViewOptions.find((option) => option.value === view)?.label}工作台
        </h1>
        <div className="space-y-[12px]">
          <h2 className="text-[20px] font-semibold">工作台功能尚未接入</h2>
          <p className="text-[13px] leading-[22px] text-[var(--color-neutral-strong)]">
            当前角色的工作台功能正在准备中。
          </p>
        </div>
        <div className="flex flex-wrap gap-[12px]">
          <Button asChild variant="outline" size="mobileTouch">
            <Link to="/profile">
              <UserRound className="size-4" aria-hidden />
              个人中心
            </Link>
          </Button>
        </div>
      </section>
    );
  return (
    <div className="space-y-6">
      <div>
        <p className="mb-2 text-[12px] font-medium text-[var(--color-primary-strong)]">
          你的协作空间
        </p>
        <h1 className="m-0 text-[28px] leading-tight font-semibold tracking-tight">工作台</h1>
      </div>
      <section className="rounded-[18px] border bg-card p-6 sm:p-8">
        <div className="mb-5 grid size-12 place-items-center rounded-2xl bg-emerald-50 text-emerald-700">
          <Check className="size-6" aria-hidden />
        </div>
        <span className="text-xs text-muted-foreground">一切准备就绪</span>
        <h2 className="mt-2 text-[24px] leading-normal font-semibold">
          欢迎，{user.nickname || user.realName}
        </h2>
        <p className="mt-2 mb-6 text-[13px] text-[var(--color-neutral-strong)]">
          你已成功登录 tyde，从这里管理你的账户与个人资料。
        </p>
        <dl className="mb-5 space-y-3 text-sm">
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <dt className="text-muted-foreground">当前手机号</dt>
            <dd className="break-all">{user.phone}</dd>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <dt className="text-muted-foreground">用户编号</dt>
            <dd className="break-all">{user.uid}</dd>
          </div>
        </dl>
        <div className="mt-6 flex flex-wrap items-center gap-3 border-t pt-6">
          <Button asChild size="mobileTouch">
            <Link to="/profile">
              <UserRound className="size-4" aria-hidden />
              个人中心
              <ArrowUpRight className="size-4" aria-hidden />
            </Link>
          </Button>
          <Button asChild variant="outline" size="mobileTouch">
            <Link to="/organization">
              <Building2 className="size-4" aria-hidden />
              {managesOrganization ? '组织管理' : '我的组织'}
              <ArrowUpRight className="size-4" aria-hidden />
            </Link>
          </Button>
        </div>
        <p className="mt-4 text-[12px] text-[var(--color-neutral-strong)]">
          关闭应用或刷新页面后，登录状态会为你保留。
        </p>
      </section>
    </div>
  );
}
