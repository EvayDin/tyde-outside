import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from '@tanstack/react-router';
import { ApiError } from '@tyde/shared';
import { api } from '@/services/api';
import { ErrorNotice } from '@/components/ErrorNotice';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import LoginFormPanel from './components/LoginFormPanel';
import type { LoginFormController, LoginFormValues, LoginMode } from './types';

/** 开发环境验证本地验证码后进入个人资料；真实登录与资料提交仍未开放。 */
export function LoginPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<LoginMode>('sms');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [sending, setSending] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const cooldownUntil = useRef(0);
  const inFlight = useRef(false);
  const mounted = useRef(false);
  const localChallenge = useRef<{ phone: string; expiresAt: number } | null>(null);
  const focusCode = useRef(false);
  const form = useForm<LoginFormValues>({
    defaultValues: { account: '', code: '', password: '' },
    shouldUnregister: true,
  });

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const coolingDown = countdown > 0;
  useEffect(() => {
    if (mode === 'sms' && focusCode.current) {
      focusCode.current = false;
      form.setFocus('code');
    }
  }, [form, mode]);

  useEffect(() => {
    if (!coolingDown) return;
    const timer = window.setInterval(() => {
      setCountdown(Math.max(0, Math.ceil((cooldownUntil.current - Date.now()) / 1000)));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [coolingDown]);

  function startCooldown(seconds: number) {
    cooldownUntil.current = Date.now() + seconds * 1000;
    setCountdown(Math.max(0, Math.ceil(seconds)));
  }

  function changeMode(nextMode: LoginMode) {
    if (inFlight.current || nextMode === mode) return;
    localChallenge.current = null;
    form.reset({ account: form.getValues('account'), code: '', password: '' });
    setNotice('');
    setError(null);
    setMode(nextMode);
  }

  async function sendCode() {
    if (inFlight.current || cooldownUntil.current > Date.now()) return;
    inFlight.current = true;
    setNotice('');
    setError(null);
    try {
      if (!(await form.trigger('account', { shouldFocus: true })) || !mounted.current) return;
      setSending(true);
      form.setValue('code', '');
      localChallenge.current = null;
      const phone = form.getValues('account');
      const result = await api.sendCode({ region: 'CN', phone });
      if (!mounted.current) return;
      if (import.meta.env.DEV && result.mode === 'mock')
        localChallenge.current = { phone, expiresAt: Date.parse(result.expiresAt) };
      startCooldown(result.resendAfterSeconds);
      setNotice(
        result.mode === 'mock'
          ? import.meta.env.DEV
            ? '本地测试验证码：095270（不会发送短信）。'
            : '当前为测试短信模式，不会发送真实短信，请使用验证码 095270。'
          : '验证码已发送，请查收短信。',
      );
    } catch (failure) {
      if (!mounted.current) return;
      setError(failure);
      if (failure instanceof ApiError && failure.status === 429 && failure.retryAfter)
        startCooldown(failure.retryAfter);
    } finally {
      inFlight.current = false;
      if (mounted.current) setSending(false);
    }
  }

  const controller: LoginFormController = {
    mode,
    form,
    submitting: false,
    sms: {
      sending,
      countdown,
      send: () => void sendCode(),
    },
    actions: {
      changeAccount: () => {
        localChallenge.current = null;
        form.setValue('code', '');
        form.clearErrors('code');
        setNotice('');
        setError(null);
      },
      finish: ({ account, code }) => {
        setError(null);
        setNotice('');
        if (mode === 'password') {
          setNotice('密码登录暂未开放，请使用验证码登录或注册。');
          return;
        }
        if (import.meta.env.DEV) {
          const challenge = localChallenge.current;
          if (!challenge || challenge.phone !== account) {
            setNotice('请先获取本地测试验证码。');
            return;
          }
          if (challenge.expiresAt <= Date.now()) {
            localChallenge.current = null;
            setNotice('验证码已过期，请重新获取。');
            return;
          }
          if (code !== '095270') {
            form.setError('code', { type: 'validate', message: '验证码不正确' });
            return;
          }
          void navigate({ to: '/register' });
          return;
        }
        setNotice('登录 / 注册功能暂未开放，尚未验证手机号或创建账号。');
      },
    },
  };
  return (
    <Tabs
      value={mode}
      onValueChange={(value) => {
        if (value === 'sms' || value === 'password') changeMode(value);
      }}
      aria-label="登录 / 注册表单"
    >
      <TabsList
        aria-label="登录方式"
        className="grid h-[44px] w-full grid-cols-2 rounded-none border-b bg-transparent p-0"
      >
        {(['sms', 'password'] as const).map((value) => (
          <TabsTrigger
            key={value}
            value={value}
            disabled={sending}
            className="h-[44px] rounded-none border-b-2 border-transparent bg-transparent text-[14px] data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-none"
          >
            {value === 'sms' ? '验证码登录' : '密码登录'}
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsContent value={mode} className="mt-[24px]">
        <LoginFormPanel controller={controller} />
        {error != null && (
          <div className="mt-[12px]">
            <ErrorNotice error={error} />
          </div>
        )}
        {notice && (
          <p
            role="status"
            aria-label="操作提示"
            className="mt-[12px] rounded-[6px] bg-accent px-[12px] py-[9px] text-[12px] text-foreground"
          >
            {notice}
          </p>
        )}
        {mode === 'password' && (
          <p className="mt-[8px] flex items-center justify-center text-[12px] text-muted-foreground">
            还没有账号？
            <Button
              variant="link"
              size="mobileTouch"
              className="px-[4px]"
              onClick={() => {
                focusCode.current = true;
                changeMode('sms');
              }}
            >
              验证码注册
            </Button>
          </p>
        )}
      </TabsContent>
    </Tabs>
  );
}
