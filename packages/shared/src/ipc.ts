// preload 只导入此入口，避免加载服务器 schema 与不必要的运行时代码。
export const IPC = {
  sendCode: 'auth:send-code',
  login: 'auth:login',
  verifyCode: 'auth:verify-code',
  register: 'auth:register',
  me: 'auth:me',
  logout: 'auth:logout',
  health: 'app:health',
} as const;

/** 仅开发客户端使用的本地请求通道；生产仍通过 IPC 返回结果。 */
export const DESKTOP_NETWORK_SCHEME = 'tyde-debug';
export const DESKTOP_REQUEST_ROUTES = {
  [IPC.sendCode]: { path: '/api/v1/auth/sms/send', method: 'POST' },
  [IPC.login]: { path: '/api/v1/auth/login', method: 'POST' },
  [IPC.verifyCode]: { path: '/api/v1/auth/sms/login', method: 'POST' },
  [IPC.register]: { path: '/api/v1/auth/register', method: 'POST' },
  [IPC.me]: { path: '/api/v1/users/me', method: 'GET' },
  [IPC.logout]: { path: '/api/v1/auth/logout', method: 'POST' },
  [IPC.health]: { path: '/api/v1/health/ready', method: 'GET' },
} as const;

export interface DesktopNetworkTicket {
  networkRequestId: string;
}
