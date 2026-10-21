import { platform } from '@tyde/platform';

/** 两端个人中心与认证均使用实际 HTTP/Cookie 接口，不在页面叠加模拟用户或保存结果。 */
export const api = platform.auth;
export const isDesktop = platform.isElectron;
export const capabilities = platform.capabilities;
