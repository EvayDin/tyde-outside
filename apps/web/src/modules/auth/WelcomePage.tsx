import { Button, Descriptions, Typography } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { SessionResult } from '@tyde-outside/shared';
import { api } from '../../services/api';
import { SESSION_KEY } from '../../hooks/useSession';
import { ErrorNotice } from '../../components/ErrorNotice';
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
      <div className="welcome-icon">✓</div>
      <span className="step-label">一切准备就绪</span>
      <Typography.Title level={2}>欢迎，{session.user.displayName}</Typography.Title>
      <p className="subtitle">你已成功登录 tyde-outside。</p>
      <Descriptions
        column={1}
        size="small"
        items={[
          { key: 'phone', label: '当前手机号', children: session.user.phoneE164 },
          { key: 'username', label: '用户名', children: session.user.username },
        ]}
      />
      <ErrorNotice error={logout.error} />
      <Button block className="submit" onClick={() => logout.mutate()} loading={logout.isPending}>
        退出登录
      </Button>
      <p className="fine-print">关闭应用或刷新页面后，登录状态会为你保留。</p>
    </>
  );
}
