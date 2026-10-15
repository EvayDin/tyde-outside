/** 提供注册表单内部复用的分区、验证码和确认密码字段组件。 */
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import AuthFormField from '@/components/ui/shared/AuthFormField';
import AuthPasswordInput from '@/components/ui/shared/AuthPasswordInput';
import type { RegisterFormController } from '../types';
import { registerInputClassName } from '../styles';

/** 渲染带编号标题和双列表单网格的注册信息区块。 */
export function FormSection({
  number,
  title,
  children,
}: {
  number: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="mb-[20px]">
      <div className="mb-[13px] flex items-center gap-[9px]">
        <span className="grid h-[21px] w-[21px] place-items-center rounded-full bg-[#dff4f7] text-[12px] leading-none text-[#149cb3]">
          {number}
        </span>
        <b className="text-[12px] text-[#294554]">{title}</b>
        <i className="ml-[7px] h-px flex-1 bg-[var(--color-divider)]" />
      </div>
      <div className="grid grid-cols-2 gap-[12px] max-[580px]:grid-cols-1">{children}</div>
    </section>
  );
}

/** 渲染由 React Hook Form 管理的短信验证码字段与发送按钮。 */
export function SmsCodeField({
  controller,
  inputNameSuffix,
}: {
  controller: RegisterFormController;
  inputNameSuffix: string;
}) {
  const { form, sms } = controller;
  const error = form.formState.errors.code;
  const controlId = `register-code-${inputNameSuffix}`;

  return (
    <AuthFormField
      htmlFor={controlId}
      label={
        <span>
          短信验证码 <em>*</em>
        </span>
      }
      error={error}
    >
      <div className="flex min-w-0 gap-[7px]">
        <Input
          id={controlId}
          size="authRegister"
          className={`${registerInputClassName} min-w-0 flex-1`}
          inputMode="numeric"
          autoComplete="off"
          placeholder="6位验证码"
          maxLength={6}
          aria-invalid={Boolean(error)}
          {...form.register('code', {
            required: '请输入验证码',
            pattern: { value: /^\d{6}$/, message: '请输入 6 位验证码' },
          })}
        />
        <Button
          type="button"
          size="formCompact"
          className="border border-transparent leading-none font-[650] [font-family:inherit] shadow-[0_4px_9px_rgba(6,59,70,0.2)]"
          disabled={sms.sending || sms.countdown > 0}
          onClick={() => sms.send(form.getValues('phone') ?? '')}
        >
          {sms.sending ? '发送中' : sms.countdown > 0 ? `${sms.countdown}s后重发` : '获取'}
        </Button>
      </div>
    </AuthFormField>
  );
}

/** 渲染确认密码字段，并展示与密码字段的一致性状态。 */
export function ConfirmPasswordField({
  controller,
  inputNameSuffix,
  password,
  confirmPassword,
}: {
  controller: RegisterFormController;
  inputNameSuffix: string;
  password: string;
  confirmPassword: string;
}) {
  const error = controller.form.formState.errors.confirmPassword;
  const controlId = `register-confirm-password-${inputNameSuffix}`;
  const validationStatus = confirmPassword
    ? password === confirmPassword
      ? /^(?=.*[A-Za-z])(?=.*\d).{8,64}$/.test(password)
        ? 'match'
        : undefined
      : 'mismatch'
    : undefined;

  return (
    <AuthFormField
      htmlFor={controlId}
      label={
        <span className="flex items-center gap-[5px]">
          <span>
            确认密码 <em>*</em>
          </span>
          {validationStatus && (
            <span
              className={`grid h-[16px] w-[16px] place-items-center rounded-full text-[12px] leading-none font-[750] text-white ${validationStatus === 'match' ? 'bg-[#52c41a]' : 'bg-[#ff4d4f]'}`}
              role="status"
              aria-label={validationStatus === 'match' ? '两次密码一致' : '两次密码不一致'}
            >
              {validationStatus === 'match' ? '✓' : '✕'}
            </span>
          )}
        </span>
      }
      error={error}
    >
      <AuthPasswordInput
        id={controlId}
        size="authRegister"
        className={registerInputClassName}
        autoComplete="new-password"
        placeholder="请再次输入密码进行核对"
        maxLength={64}
        aria-invalid={Boolean(error)}
        {...controller.form.register('confirmPassword', {
          required: '请再次输入密码',
          validate: (value) =>
            value === controller.form.getValues('password') || '两次输入的密码不一致',
        })}
      />
    </AuthFormField>
  );
}
