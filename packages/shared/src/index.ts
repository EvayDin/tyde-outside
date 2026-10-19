import type {
  AuthUser,
  LoginInput,
  RegistrationRequired,
  SmsLoginInput,
  SmsRegisterInput,
  SmsSendInput,
} from './auth.js';

export const APP_NAME = 'tyde';
export const API_PREFIX = '/api/v1';
/** 当前 mock 短信的固定测试码，服务端使用、前端发码成功后展示；接入真实短信时移除展示。 */
export const MOCK_SMS_CODE = '095270';
export { IPC } from './ipc.js';
export * from './auth.js';

/** 登录令牌由平台适配器保管，页面只接收登录状态或注册指引。 */
export interface Authenticated {
  status: 'authenticated';
}
export type VerifyResult = Authenticated | RegistrationRequired;
export interface ApiFailure {
  code: string | number;
  message: string;
  requestId?: string;
  fields?: Record<string, string>;
}
export class ApiError extends Error {
  readonly code: string | number;
  readonly status: number;
  readonly requestId?: string;
  readonly retryAfter?: number;
  constructor(status: number, failure: ApiFailure, retryAfter?: number) {
    super(failure.message);
    this.name = 'ApiError';
    this.code = failure.code;
    this.status = status;
    this.requestId = failure.requestId;
    this.retryAfter = retryAfter;
  }
}
export interface AuthApi {
  health(): Promise<{ status: string }>;
  sendCode(input: SmsSendInput): Promise<string>;
  login(input: LoginInput): Promise<void>;
  verifyCode(input: SmsLoginInput): Promise<VerifyResult>;
  completeRegistration(input: SmsRegisterInput): Promise<AuthUser>;
  getCurrentUser(): Promise<AuthUser>;
  logout(): Promise<void>;
}
export type BridgeResult<T> =
  { ok: true; data: T } | { ok: false; status: number; error: ApiFailure; retryAfter?: number };
export interface DesktopBridge {
  health(): Promise<BridgeResult<{ status: string }>>;
  sendCode(input: SmsSendInput): Promise<BridgeResult<string>>;
  login(input: LoginInput): Promise<BridgeResult<void>>;
  verifyCode(input: SmsLoginInput): Promise<BridgeResult<VerifyResult>>;
  completeRegistration(input: SmsRegisterInput): Promise<BridgeResult<AuthUser>>;
  getCurrentUser(): Promise<BridgeResult<AuthUser>>;
  logout(): Promise<BridgeResult<void>>;
}
