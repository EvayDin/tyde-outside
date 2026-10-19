import { Check, ShieldCheck } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import type { AuthUser } from '@tyde/shared';
import { api, capabilities } from '../../services/api';
import { SESSION_KEY } from '../../hooks/useSession';
import { ErrorNotice } from '../../components/ErrorNotice';
import { Button } from '../../components/ui/button';

/** 展示当前后端用户，退出成功后清除全部页面缓存。 */
export function WelcomePage({ user }: { user: AuthUser }) {
  const cache = useQueryClient();
  const navigate = useNavigate();
  const logout = useMutation({
    mutationFn: () => api.logout(),
    onSuccess: async () => {
      await cache.cancelQueries();
      cache.clear();
      cache.setQueryData(SESSION_KEY, null);
      await navigate({ to: '/auth', replace: true });
    },
  });
  return (
    <>
      <div className="mb-5 grid size-12 place-items-center rounded-2xl bg-emerald-50 text-emerald-700">
        <Check className="size-6" aria-hidden />
      </div>
      <span className="text-xs text-muted-foreground">一切准备就绪</span>
      <h1 className="mt-2 text-[24px] font-semibold">欢迎，{user.nickname || user.realName}</h1>
      <p className="mt-2 mb-5 text-sm text-muted-foreground">你已成功登录 tyde。</p>
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
      <ErrorNotice error={logout.error} />
      <Button className="mt-5 w-full" onClick={() => logout.mutate()} loading={logout.isPending}>
        退出登录
      </Button>
      <p className="mt-4 text-center text-xs text-muted-foreground">
        关闭应用或刷新页面后，登录状态会为你保留。
      </p>
      {capabilities.secureSessionStorage && (
        <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="size-3.5 shrink-0" aria-hidden />
          登录凭证由系统安全存储加密保存
        </p>
      )}
    </>
  );
}
