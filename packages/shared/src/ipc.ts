// preload 只导入此入口，避免加载服务器 schema 与不必要的运行时代码。
export const IPC = {
  sendCode: 'auth:send-code',
  verifyCode: 'auth:verify-code',
  register: 'auth:register',
  me: 'auth:me',
  logout: 'auth:logout',
  health: 'app:health',
} as const;
