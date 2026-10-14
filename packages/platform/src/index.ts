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
  auth: bridge ? electronAuth(bridge) : webAuth,
};
