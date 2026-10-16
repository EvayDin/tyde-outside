import { platform } from '@tyde/platform';
import type { AuthApi } from '@tyde/shared';

/** 开发页面只在本地演示验证码；生产构建继续使用实际双端适配。 */
export const api: AuthApi = import.meta.env.DEV
  ? {
      ...platform.auth,
      sendCode: async () => ({
        challengeId: crypto.randomUUID(),
        expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
        resendAfterSeconds: 60,
        mode: 'mock',
      }),
    }
  : platform.auth;
export const isDesktop = platform.isElectron;
export const capabilities = platform.capabilities;
