import type { PropsWithChildren } from 'react';
import { Tag } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { api, isDesktop } from '../services/api';
export function AuthLayout({ children }: PropsWithChildren) {
  const health = useQuery({
    queryKey: ['health'],
    queryFn: () => api.health(),
    refetchInterval: 60_000,
  });
  return (
    <main className="shell">
      <header className="topbar">
        <a className="wordmark" href="#/">
          <span className="brand-mark">t</span>tyde
        </a>
        <Tag variant="filled">{isDesktop ? '桌面端' : 'Web 端'}</Tag>
      </header>
      <div className="content">
        <aside className="intro">
          <span className="eyebrow">YOUR NEXT CHAPTER</span>
          <h1>
            从这里，
            <br />
            开启新的可能。
          </h1>
          <p>
            一个账号，连接每一端。
            <br />
            欢迎来到 tyde。
          </p>
          <div className="intro-note">
            <span className="note-line" />
            简单开始，自在连接
          </div>
        </aside>
        <section className="panel">{children}</section>
      </div>
      <footer>
        <span>tyde · 内部试用版</span>
        <span className="service">
          <i
            className={
              health.isSuccess ? 'dot connected' : health.isPending ? 'dot' : 'dot disconnected'
            }
          />
          {health.isSuccess ? '服务已连接' : health.isPending ? '正在连接服务' : '服务暂不可用'}
        </span>
      </footer>
    </main>
  );
}
