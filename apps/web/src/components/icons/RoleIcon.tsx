/** 根据系统注册角色渲染一致的业务角色图标。 */
import type { AuthRole } from '@/modules/auth/types';
import type { IconProps } from './icons';

/** 根据注册角色返回对应的线性人物图标。 */
export default function RoleIcon({ role, ...props }: IconProps & { role: AuthRole }) {
  if (role === 'NAVIGATOR') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" {...props}>
        <circle cx="9" cy="7" r="3" />
        <path d="M3.5 18v-1.2A4.8 4.8 0 0 1 8.3 12h1.4c1.1 0 2.1.4 2.9 1" />
        <circle cx="16.5" cy="16.5" r="2.5" />
        <path d="M16.5 12.7v1.1m0 5.4v1.1m3.8-3.8h-1.1m-5.4 0h-1.1m6.5-2.7-.8.8m-3.8 3.8-.8.8m5.4 0-.8-.8m-3.8-3.8-.8-.8" />
      </svg>
    );
  }

  if (role === 'EXPERT') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" {...props}>
        <circle cx="8" cy="7" r="3" />
        <path d="M2.5 18v-1.2A4.8 4.8 0 0 1 7.3 12h1.4c2.2 0 4.1 1.5 4.6 3.5" />
        <path d="m15 12.8 1.8 1.8 4-4" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" {...props}>
      <circle cx="12" cy="7" r="3.5" />
      <path d="M5 19v-1.5A5.5 5.5 0 0 1 10.5 12h3a5.5 5.5 0 0 1 5.5 5.5V19" />
    </svg>
  );
}
