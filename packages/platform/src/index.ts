import { ApiError, type DesktopBridge } from '@tyde/shared';
import { createHttpAuth, webAuth } from './web.js';

declare global {
  interface Window {
    tydeDesktop?: DesktopBridge;
  }
}
const bridge = typeof window !== 'undefined' ? window.tydeDesktop : undefined;
let runtime: Promise<string> | undefined;
const desktopAuth = bridge
  ? createHttpAuth(() => {
      runtime ??= bridge
        .getRuntimeConfig()
        .then((result) => {
          if (!result.ok) throw new ApiError(result.status, result.error);
          return result.data.apiBaseUrl;
        })
        .catch((error: unknown) => {
          runtime = undefined;
          throw error;
        });
      return runtime;
    }, 'include')
  : undefined;
export const platform = {
  isElectron: Boolean(bridge),
  // 当前桌面仅提供公开运行配置，尚无需要页面调用的系统能力。
  capabilities: Object.freeze({}),
  auth: desktopAuth ?? webAuth,
};
