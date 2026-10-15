import { Check, ShieldCheck } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { SessionResult } from '@tyde/shared';
import { api, capabilities } from '../../services/api';
import { SESSION_KEY } from '../../hooks/useSession';
import { ErrorNotice } from '../../components/ErrorNotice';
import { Button } from '../../components/ui/button';

/** 共用会话页面，桌面专有说明按实际平台能力显示。 */
export function WelcomePage({ session }: { session: SessionResult }) {
  const cache = useQueryClient();
  const logout = useMutation({
    mutationFn: () => api.logout(),
    onSuccess: () => {
      cache.setQueryData(SESSION_KEY, null);
      void cache.invalidateQueries({ queryKey: SESSION_KEY });
    },
  });
  return (
    <>
      <div className="mb-5 grid size-12 place-items-center rounded-2xl bg-emerald-50 text-emerald-700">
        <Check className="size-6" aria-hidden />
      </div>
      <span className="step-label">一切准备就绪</span>
      <h2>欢迎，{session.user.displayName}</h2>
      <p className="subtitle">你已成功登录 tyde。</p>
      <dl className="mb-5 space-y-3 text-sm">
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <dt className="text-muted-foreground">当前手机号</dt>
          <dd className="break-all">{session.user.phoneE164}</dd>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <dt className="text-muted-foreground">用户名</dt>
          <dd className="break-all">{session.user.username}</dd>
        </div>
      </dl>
      <ErrorNotice error={logout.error} />
      <Button className="mt-5 w-full" onClick={() => logout.mutate()} loading={logout.isPending}>
        退出登录
      </Button>
      <p className="fine-print">关闭应用或刷新页面后，登录状态会为你保留。</p>
      {capabilities.secureSessionStorage && (
        <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="size-3.5 shrink-0" aria-hidden />
          登录凭证由系统安全存储加密保存
        </p>
      )}
    </>
  );
}
