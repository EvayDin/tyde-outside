import { Type, type Static } from '@sinclair/typebox';

export const APP_NAME = 'tyde';
export const API_PREFIX = '/api/v1';
export { IPC } from './ipc.js';
export const phoneSchema = Type.Object(
  {
    region: Type.Literal('CN'),
    phone: Type.String({ minLength: 1, maxLength: 32 }),
  },
  { additionalProperties: false },
);
export const verifySchema = Type.Object(
  {
    ...phoneSchema.properties,
    challengeId: Type.String({ format: 'uuid' }),
    code: Type.String({ pattern: '^[0-9]{6}$' }),
  },
  { additionalProperties: false },
);
export const registerSchema = Type.Object(
  {
    registrationToken: Type.String({ minLength: 43, maxLength: 128 }),
    username: Type.String({ minLength: 3, maxLength: 32 }),
    displayName: Type.String({ minLength: 1, maxLength: 320 }),
  },
  { additionalProperties: false },
);
export type PhoneInput = Static<typeof phoneSchema>;
export type VerifyInput = Static<typeof verifySchema>;
export type RegisterInput = Static<typeof registerSchema>;
export interface User {
  id: string;
  phoneE164: string;
  phoneRegion: string;
  username: string;
  displayName: string;
  createdAt: string;
}
export interface CodeResult {
  challengeId: string;
  expiresAt: string;
  resendAfterSeconds: number;
  mode: 'mock' | 'sms';
}
export interface SessionResult {
  user: User;
  sessionExpiresAt: string;
}
export interface Authenticated extends SessionResult {
  status: 'authenticated';
}
export interface RegistrationRequired {
  status: 'registration_required';
  registrationToken: string;
  expiresAt: string;
}
export type VerifyResult = Authenticated | RegistrationRequired;
export interface ApiFailure {
  code: string;
  message: string;
  requestId?: string;
  fields?: Record<string, string>;
}
export class ApiError extends Error {
  readonly code: string;
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
  sendCode(input: PhoneInput): Promise<CodeResult>;
  verifyCode(input: VerifyInput): Promise<VerifyResult>;
  completeRegistration(input: RegisterInput): Promise<Authenticated>;
  getCurrentUser(): Promise<SessionResult>;
  logout(): Promise<void>;
}
export type BridgeResult<T> =
  { ok: true; data: T } | { ok: false; status: number; error: ApiFailure; retryAfter?: number };
export interface DesktopBridge {
  health(): Promise<BridgeResult<{ status: string }>>;
  sendCode(input: PhoneInput): Promise<BridgeResult<CodeResult>>;
  verifyCode(input: VerifyInput): Promise<BridgeResult<VerifyResult>>;
  completeRegistration(input: RegisterInput): Promise<BridgeResult<Authenticated>>;
  getCurrentUser(): Promise<BridgeResult<SessionResult>>;
  logout(): Promise<BridgeResult<void>>;
}
