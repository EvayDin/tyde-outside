/** 渲染个人资料中由 React Hook Form 管理的密码字段。 */
import { useEffect } from 'react';
import { useWatch } from 'react-hook-form';
import { passwordPattern } from '@tyde/shared';
import AuthFormField from '@/components/ui/shared/AuthFormField';
import AuthPasswordInput from '@/components/ui/shared/AuthPasswordInput';
import type { RegisterFormController } from '../../types';
import { registerInputClassName } from '../../styles';
import { ConfirmPasswordField, FormSection } from '../RegisterFormParts';

/** 渲染注册所需的两次密码输入。 */
export default function AccountFields({
  controller,
  inputNameSuffix,
}: {
  controller: RegisterFormController;
  inputNameSuffix: string;
}) {
  const { form } = controller;
  const password = useWatch({ control: form.control, name: 'password' }) ?? '';
  const confirmPassword = useWatch({ control: form.control, name: 'confirmPassword' }) ?? '';
  const passwordError = form.formState.errors.password;
  const passwordId = `register-password-${inputNameSuffix}`;

  useEffect(() => {
    if (!confirmPassword || !form.formState.touchedFields.confirmPassword) return;
    /** 登录密码改变后重新校验已触碰的确认密码，避免保留旧的不一致错误。 */
    void form.trigger('confirmPassword');
  }, [confirmPassword, form, password]);

  return (
    <FormSection number="1" title="基础信息">
      <AuthFormField
        htmlFor={passwordId}
        label={
          <span>
            登录密码 <em>*</em>
          </span>
        }
        error={passwordError}
      >
        <AuthPasswordInput
          id={passwordId}
          size="authRegister"
          className={registerInputClassName}
          autoComplete="new-password"
          maxLength={64}
          placeholder="8-64位，字母+数字"
          aria-invalid={Boolean(passwordError)}
          {...form.register('password', {
            required: '请输入密码',
            validate: (value) =>
              new RegExp(passwordPattern).test(value) ||
              '请输入 8～64 位字母、数字及允许的特殊字符，不能含空格或中文',
          })}
        />
      </AuthFormField>
      <ConfirmPasswordField
        controller={controller}
        inputNameSuffix={inputNameSuffix}
        password={password}
        confirmPassword={confirmPassword}
      />
    </FormSection>
  );
}
