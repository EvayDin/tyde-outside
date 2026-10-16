import { useState } from 'react';
import { useForm } from 'react-hook-form';
import RegisterFormPanel from './components/RegisterFormPanel';
import type { RegisterFormController, RegisterFormValues } from './types';

/** 个人注册输入只留在当前页面内存中。 */
export function RegisterPage() {
  const [notice, setNotice] = useState('');
  const form = useForm<RegisterFormValues>({
    defaultValues: {
      password: '',
      confirmPassword: '',
      realName: '',
      nickname: '',
      idCardNo: '',
      email: '',
    },
    mode: 'onBlur',
    shouldUnregister: true,
  });

  const controller: RegisterFormController = {
    form,
    registering: false,
    actions: {
      finish: () => setNotice('注册功能暂未开放，个人资料尚未提交。'),
    },
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-[8px]">
      {notice && (
        <p
          role="status"
          aria-label="操作提示"
          className="flex-none rounded-[8px] bg-[#eef8fa] px-[12px] py-[10px] text-[13px] leading-[1.5] text-[#236578]"
        >
          {notice}
        </p>
      )}
      <RegisterFormPanel controller={controller} />
    </div>
  );
}
