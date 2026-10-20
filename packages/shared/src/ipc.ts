// preload 只导入此入口，避免加载服务器 schema 与不必要的运行时代码。
export const IPC = { runtime: 'app:runtime' } as const;
