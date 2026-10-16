/** 组合 React Hook Form 个人注册账号与个人信息区块。 */
import { useId } from 'react';
import { Button } from '@/components/ui/button';
import type { RegisterFormController } from '../types';
import { submitButtonClassName } from '../styles';
import AccountFields from './register/AccountFields';
import IdentityFields from './register/IdentityFields';

/** 编排个人注册分区，当前只校验本地输入，不提交。 */
export default function RegisterFormPanel({ controller }: { controller: RegisterFormController }) {
  const { form, registering, actions } = controller;
  const inputNameSuffix = useId();

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      autoComplete="off"
      noValidate
      onSubmit={form.handleSubmit(actions.finish)}
    >
      <div className="pt-[8px] pb-[8px] max-[900px]:p-0">
        <AccountFields controller={controller} inputNameSuffix={inputNameSuffix} />
        <IdentityFields controller={controller} inputNameSuffix={inputNameSuffix} />
      </div>
      <div className="flex-none border-t border-[#eef2f4] bg-white pt-[16px] max-[900px]:mt-[16px] max-[900px]:border-t-0 max-[900px]:pt-0">
        <Button
          type="submit"
          size="authSubmit"
          className={`${submitButtonClassName} !bg-[#202020] ![font-family:inherit] !shadow-none hover:!bg-[#080808]`}
          disabled={registering}
        >
          {registering ? '注册中...' : '提交'}
        </Button>
      </div>
    </form>
  );
}
