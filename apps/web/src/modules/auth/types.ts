import type { UseFormReturn } from 'react-hook-form';

/** 原 Web 的角色展示模型；仅用于前端表单，不冒充当前后端的权限契约。 */
export const AUTH_ROLES = [
  { value: 'NAVIGATOR', label: '领航员' },
  { value: 'PM', label: '策略官' },
  { value: 'EXPERT', label: '执行专家' },
] as const;
export type AuthRole = (typeof AUTH_ROLES)[number]['value'];

/** 以下类型仅描述共享 UI 的本地状态，尚未映射后端 DTO。 */
export type AuthMode = 'login' | 'register';
export type LoginMethod = 'password' | 'code';
export type RegisterAccountType = 'personal' | 'org';
export type RegisterUploadType = 'businessLicense' | 'orgLogo';
export const ORG_POSITIONS = ['OWNER', 'ADMIN', 'MEMBER'] as const;
export type OrgPosition = (typeof ORG_POSITIONS)[number];
export const ORG_POSITION_LABEL = { OWNER: '主管', ADMIN: '管理员', MEMBER: '成员' } as const;

/** 登录凭证只保存在组件内存中。 */
export interface LoginFormValues {
  account: string;
  password?: string;
  code?: string;
}

/** 注册字段沿用原 Web 表单；不作为 API 请求直接提交。 */
export interface RegisterFormValues {
  roles: string[];
  phone: string;
  code: string;
  password: string;
  confirmPassword: string;
  realName: string;
  nickname?: string;
  idCardNo?: string;
  email?: string;
  orgName?: string;
  unifiedCreditCode?: string;
  orgPosition: OrgPosition;
  orgDescription?: string;
  expertiseTags: string[];
}

/** 复用登录展示组件所需的本地控制器。 */
export interface LoginFormController {
  form: UseFormReturn<LoginFormValues>;
  role: string;
  method: LoginMethod;
  submitting: boolean;
  sms: { sending: boolean; countdown: number; send: (account: string) => void };
  actions: {
    changeRole: (role: string) => void;
    changeMethod: (method: LoginMethod) => void;
    finish: (values: LoginFormValues) => void;
  };
}

/** 复用注册展示组件所需的本地控制器；文件仅选择与预览。 */
export interface RegisterFormController {
  form: UseFormReturn<RegisterFormValues>;
  accountType: RegisterAccountType;
  registering: boolean;
  upload: {
    businessLicenseAsset: { fileName: string } | null;
    orgLogoUrl: string;
    uploadingFile: RegisterUploadType | null;
    selectFile: (file: File | undefined, type: RegisterUploadType) => void;
  };
  sms: { sending: boolean; countdown: number; send: (phone: string) => void };
  actions: {
    changeAccountType: (type: RegisterAccountType) => void;
    realNameBlur: () => void;
    nicknameBlur: () => void;
    finish: (values: RegisterFormValues) => void;
  };
}
