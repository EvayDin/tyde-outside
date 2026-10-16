/** 组合 React Hook Form 个人注册账号、身份和补充信息区块。 */
import { useId } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import AuthFormField from '@/components/ui/shared/AuthFormField';
import type { RegisterFormController } from '../types';
import { registerInputClassName, submitButtonClassName } from '../styles';
import { FormSection } from './RegisterFormParts';
import AccountFields from './register/AccountFields';
import IdentityFields from './register/IdentityFields';

/** 编排个人注册分区，当前只校验本地输入，不提交。 */
export default function RegisterFormPanel({ controller }: { controller: RegisterFormController }) {
  const { form, registering, actions } = controller;
  const inputNameSuffix = useId();
  const emailError = form.formState.errors.email;

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      autoComplete="off"
      noValidate
      onSubmit={form.handleSubmit(actions.finish)}
    >
      <div className="min-h-0 flex-1 overflow-y-auto pt-[8px] pr-[8px] pb-[8px] [overscroll-behavior:contain] [scrollbar-gutter:stable] max-[900px]:overflow-visible max-[900px]:p-0">
        <AccountFields controller={controller} inputNameSuffix={inputNameSuffix} />
        <IdentityFields controller={controller} inputNameSuffix={inputNameSuffix} />
        <FormSection number="3" title="补充信息">
          <AuthFormField
            htmlFor="email"
            label={
              <span>
                邮箱 <small>（选填）</small>
              </span>
            }
            error={emailError}
          >
            <Input
              id="email"
              size="authRegister"
              className={registerInputClassName}
              type="email"
              autoComplete="off"
              maxLength={128}
              placeholder="用于备用通知"
              aria-invalid={Boolean(emailError)}
              {...form.register('email', {
                pattern: { value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, message: '请输入有效邮箱' },
              })}
            />
          </AuthFormField>
        </FormSection>
      </div>
      <div className="flex-none border-t border-[#eef2f4] bg-white pt-[16px] max-[900px]:mt-[16px] max-[900px]:border-t-0 max-[900px]:pt-0">
        <Button
          type="submit"
          size="authSubmit"
          className={`${submitButtonClassName} !bg-[#202020] ![font-family:inherit] !shadow-none hover:!bg-[#080808]`}
          disabled={registering}
        >
          {registering ? '注册中...' : '完成注册'}
        </Button>
      </div>
    </form>
  );
}
