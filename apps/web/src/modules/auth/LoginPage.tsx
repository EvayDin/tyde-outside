import { useState } from 'react';
import { useForm } from 'react-hook-form';
import LoginFormPanel from './components/LoginFormPanel';
import type { LoginFormController, LoginFormValues, LoginMethod } from './types';

/** 复用原 Web 登录表单；此阶段只保留本地交互，不请求验证码或登录接口。 */
export function LoginPage() {
  const [role, setRole] = useState('领航员');
  const [method, setMethod] = useState<LoginMethod>('code');
  const [notice, setNotice] = useState('');
  const form = useForm<LoginFormValues>({
    defaultValues: { account: '', code: '', password: '' },
    shouldUnregister: true,
  });
  const controller: LoginFormController = {
    form,
    role,
    method,
    submitting: false,
    sms: {
      sending: false,
      countdown: 0,
      send: () => setNotice('验证码功能暂未开放。'),
    },
    actions: {
      changeRole: (value) => {
        setRole(value);
        setNotice('');
      },
      changeMethod: (value) => {
        setMethod(value);
        form.clearErrors();
        setNotice('');
      },
      finish: () => setNotice('登录功能暂未开放。'),
    },
  };
  return (
    <section aria-label="登录表单">
      <LoginFormPanel controller={controller} />
      {notice && (
        <p
          role="status"
          aria-label="操作提示"
          className="mt-[12px] rounded-[6px] bg-accent px-[12px] py-[9px] text-[12px] text-foreground"
        >
          {notice}
        </p>
      )}
    </section>
  );
}
