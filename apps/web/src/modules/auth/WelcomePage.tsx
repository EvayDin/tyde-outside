import { Check } from 'lucide-react';
import type { AuthUser } from '@tyde/shared';

/** 展示当前账户信息，账户操作统一由工作台顶栏提供。 */
export function WelcomePage({ user }: { user: AuthUser }) {
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
          你已成功登录 tyde，欢迎回到你的协作空间。
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
        <p className="mt-4 text-[12px] text-[var(--color-neutral-strong)]">
          关闭应用或刷新页面后，登录状态会为你保留。
        </p>
      </section>
    </div>
  );
}
