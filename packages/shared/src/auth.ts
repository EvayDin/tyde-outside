import { Type, type Static } from '@sinclair/typebox';
const options = { additionalProperties: false };
const phone = Type.String({ pattern: '^1[3-9][0-9]{9}$' });
const code = Type.String({ minLength: 4, maxLength: 8 });
export const passwordPattern =
  '^(?=.*[A-Za-z])(?=.*[0-9])[A-Za-z0-9!@#$%^&*()_+\\-=\\[\\]{};\':",.<>/?]{8,64}$';
const password = Type.String({ minLength: 8, maxLength: 64, pattern: passwordPattern });
const role = Type.Union(['NAVIGATOR', 'PM', 'EXPERT', 'OPS'].map((value) => Type.Literal(value)));
export const smsSendSchema = Type.Object(
  {
    phone,
    scene: Type.Union([
      Type.Literal('login'),
      Type.Literal('register'),
      Type.Literal('reset_password'),
    ]),
  },
  options,
);
export const smsLoginSchema = Type.Object({ phone, code, role: Type.Optional(role) }, options);
export const loginSchema = Type.Object(
  {
    account: Type.String({ minLength: 1, maxLength: 128 }),
    password: Type.String({ minLength: 1, maxLength: 64 }),
    role: Type.Optional(role),
  },
  options,
);
export const passwordResetSchema = Type.Object({ phone, code, newPassword: password }, options);
export const refreshSchema = Type.Object(
  { refreshToken: Type.String({ minLength: 1, maxLength: 4096 }) },
  options,
);
export const smsRegisterSchema = Type.Object(
  {
    accountType: Type.Union([Type.Literal('INDIVIDUAL'), Type.Literal('ORGANIZATION')]),
    roles: Type.Optional(Type.Array(role)),
    password,
    confirmPassword: Type.String({ minLength: 1, maxLength: 64 }),
    nickname: Type.Optional(Type.String({ maxLength: 64 })),
    realName: Type.String({ minLength: 1, maxLength: 64 }),
    idCardNo: Type.Optional(Type.String({ maxLength: 32 })),
    orgPosition: Type.Optional(
      Type.Union([Type.Literal('OWNER'), Type.Literal('ADMIN'), Type.Literal('MEMBER')]),
    ),
    phone,
    code,
    email: Type.Optional(Type.String({ maxLength: 128 })),
    organization: Type.Optional(
      Type.Object(
        {
          name: Type.String({ minLength: 1, maxLength: 128 }),
          unifiedCreditCode: Type.Optional(Type.String({ maxLength: 32 })),
          businessLicense: Type.Optional(
            Type.Object(
              {
                objectKey: Type.String({ minLength: 1, maxLength: 512 }),
                uploadToken: Type.String({ minLength: 1, maxLength: 256 }),
              },
              options,
            ),
          ),
          description: Type.Optional(Type.String({ maxLength: 1024 })),
          logoUrl: Type.Optional(Type.String({ maxLength: 512 })),
          expertiseTags: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 128 }))),
        },
        options,
      ),
    ),
  },
  options,
);
export type SmsSendInput = Static<typeof smsSendSchema>;
export type SmsLoginInput = Static<typeof smsLoginSchema>;
export type LoginInput = Static<typeof loginSchema>;
export type SmsRegisterInput = Static<typeof smsRegisterSchema>;
export type PasswordResetInput = Static<typeof passwordResetSchema>;
export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
}
export interface Result<T> {
  code: number;
  message: string;
  data: T;
}
export interface AuthUser {
  id: string;
  uid: string;
  accountType: 'INDIVIDUAL' | 'ORGANIZATION';
  phone: string;
  nickname: string;
  realName: string;
  idCardNo: string | null;
  idVerified: number;
  avatarUrl: string | null;
  bio: string | null;
  role: 'EXPERT';
  roles: ['EXPERT'];
  selectedRole: 'EXPERT' | null;
  hasExpertManagementRole: boolean;
  status: string;
  creditScore: number;
  lastLoginAt: string | null;
  lastLoginIp: string | null;
  organization: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}
