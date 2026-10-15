import { platform } from '@tyde/platform';
export const api = platform.auth;
export const isDesktop = platform.isElectron;
export const capabilities = platform.capabilities;
