/** 渲染注册流程中由 React Hook Form 管理的手机号、验证码和密码字段。 */
import { useEffect } from 'react';
import { useWatch } from 'react-hook-form';
import { Input } from '@/components/ui/input';
import AuthFormField from '@/components/ui/shared/AuthFormField';
import AuthPasswordInput from '@/components/ui/shared/AuthPasswordInput';
import type { RegisterFormController } from '../../types';
import { registerInputClassName } from '../../styles';
import { ConfirmPasswordField, FormSection, SmsCodeField } from '../RegisterFormParts';

/** 渲染注册所需的手机号、验证码和两次密码输入。 */
export default function AccountFields({
  controller,
  inputNameSuffix,
}: {
  controller: RegisterFormController;
  inputNameSuffix: string;
}) {
  const { form, accountType } = controller;
  const password = useWatch({ control: form.control, name: 'password' }) ?? '';
  const confirmPassword = useWatch({ control: form.control, name: 'confirmPassword' }) ?? '';
  const phoneError = form.formState.errors.phone;
  const passwordError = form.formState.errors.password;
  const phoneId = `register-phone-${inputNameSuffix}`;
  const passwordId = `register-password-${inputNameSuffix}`;
  const phoneField = form.register('phone', {
    required: '请输入手机号',
    pattern: { value: /^1[3-9]\d{9}$/, message: '请输入 11 位大陆手机号码' },
    /** 手机号变化后清空旧验证码，避免向新号码提交旧验证码。 */
    onChange: () => form.setValue('code', ''),
  });

  useEffect(() => {
    if (!confirmPassword || !form.formState.touchedFields.confirmPassword) return;
    /** 登录密码改变后重新校验已触碰的确认密码，避免保留旧的不一致错误。 */
    void form.trigger('confirmPassword');
  }, [confirmPassword, form, password]);

  return (
    <FormSection
      number={accountType === 'org' ? '2' : '1'}
      title={accountType === 'org' ? '主管基础信息' : '基础信息'}
    >
      <AuthFormField
        htmlFor={phoneId}
        label={
          <span>
            手机号码 <em>*</em>
          </span>
        }
        error={phoneError}
      >
        <Input
          id={phoneId}
          size="authRegister"
          className={registerInputClassName}
          type="tel"
          inputMode="numeric"
          autoComplete="off"
          maxLength={11}
          placeholder="例：138XXXXXXXX"
          aria-invalid={Boolean(phoneError)}
          {...phoneField}
        />
      </AuthFormField>
      <SmsCodeField controller={controller} inputNameSuffix={inputNameSuffix} />
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
              /^(?=.*[A-Za-z])(?=.*\d).{8,64}$/.test(value) ||
              '请输入 8～64 位且包含字母和数字的密码',
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
