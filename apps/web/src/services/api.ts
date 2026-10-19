import { platform } from '@tyde/platform';

/** 开发和生产均请求真实后端，不在页面生成验证码、账号或会话。 */
export const api = platform.auth;
export const isDesktop = platform.isElectron;
export const capabilities = platform.capabilities;
