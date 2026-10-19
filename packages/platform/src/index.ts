import type { DesktopBridge } from '@tyde/shared';
import { webAuth } from './web.js';
import { electronAuth } from './electron.js';
declare global {
  interface Window {
    tydeDesktop?: DesktopBridge;
  }
}
const bridge = typeof window !== 'undefined' ? window.tydeDesktop : undefined;
export const platform = {
  isElectron: Boolean(bridge),
  // 只登记已实现的能力；页面依此隐藏 Web 不支持的桌面功能。
  capabilities: Object.freeze({ secureSessionStorage: Boolean(bridge) }),
  auth: bridge ? electronAuth(bridge) : webAuth,
};
