import type {
  AuthUser,
  LoginInput,
  RegistrationRequired,
  SmsLoginInput,
  SmsRegisterInput,
  SmsSendInput,
  UserProfileUpdateInput,
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
/** 现有组织资料查询响应；权限与身份由后端按指定组织校验。 */
export interface OrganizationDetail {
  id: string;
  name: string;
  unifiedCreditCode: string | null;
  description: string | null;
  businessLicenseUrl: string | null;
  logoUrl: string | null;
  expertiseTags: string[];
  verifyStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
  status: 'ACTIVE' | 'FROZEN' | 'DISSOLVED';
  position: 'OWNER' | 'ADMIN' | 'MEMBER';
  createdAt: string;
}
export interface AuthApi {
  health(): Promise<{ status: string }>;
  sendCode(input: SmsSendInput): Promise<string>;
  login(input: LoginInput): Promise<void>;
  verifyCode(input: SmsLoginInput): Promise<VerifyResult>;
  completeRegistration(input: SmsRegisterInput): Promise<AuthUser>;
  getCurrentUser(): Promise<AuthUser>;
  updateProfile(input: UserProfileUpdateInput): Promise<AuthUser>;
  /** 成功会撤销全部会话，调用方须返回登录页。 */
  changePassword(newPassword: string, confirmNewPassword: string): Promise<void>;
  getOrganization(orgId: string): Promise<OrganizationDetail>;
  logout(): Promise<void>;
}
export type BridgeResult<T> =
  { ok: true; data: T } | { ok: false; status: number; error: ApiFailure; retryAfter?: number };
/** 桌面仅向页面提供公开运行配置，不暴露认证、任意网络或系统接口。 */
export interface DesktopBridge {
  getRuntimeConfig(): Promise<BridgeResult<{ apiBaseUrl: string }>>;
}
