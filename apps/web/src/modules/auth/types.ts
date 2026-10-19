import type { UseFormReturn } from 'react-hook-form';

export type LoginMode = 'sms' | 'password';

/** 登录凭证只保存在组件内存中。 */
export interface LoginFormValues {
  account: string;
  code: string;
  password: string;
}

/** 个人注册表单字段；手机号与一次性注册凭证由内存流程补齐。 */
export interface RegisterFormValues {
  password: string;
  confirmPassword: string;
  realName: string;
  nickname?: string;
  idCardNo?: string;
  email?: string;
}

/** 复用登录展示组件所需的本地控制器。 */
export interface LoginFormController {
  mode: LoginMode;
  form: UseFormReturn<LoginFormValues>;
  submitting: boolean;
  sms: { sending: boolean; countdown: number; send: () => void };
  actions: {
    changeAccount: () => void;
    finish: (values: LoginFormValues) => void;
  };
}

/** 复用个人注册展示组件所需的本地控制器。 */
export interface RegisterFormController {
  form: UseFormReturn<RegisterFormValues>;
  registering: boolean;
  actions: {
    finish: (values: RegisterFormValues) => void;
  };
}
