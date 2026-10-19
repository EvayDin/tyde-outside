import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { ApiError, MOCK_SMS_CODE } from '@tyde/shared';
import { api } from '@/services/api';
import { SESSION_KEY, sessionQuery } from '@/hooks/useSession';
import { useAuthFlow } from './AuthFlow';
import { ErrorNotice } from '@/components/ErrorNotice';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import LoginFormPanel from './components/LoginFormPanel';
import type { LoginFormController, LoginFormValues, LoginMode } from './types';

/** 通过统一双端适配完成短信或密码登录。 */
export function LoginPage() {
  const navigate = useNavigate();
  const cache = useQueryClient();
  const flow = useAuthFlow();
  const [initialFeedback] = useState(flow.loginFeedback);
  const [mode, setMode] = useState<LoginMode>(initialFeedback ? 'password' : 'sms');
  const [notice, setNotice] = useState(initialFeedback?.message ?? '');
  const [error, setError] = useState<unknown>(null);
  const [sending, setSending] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const cooldownUntil = useRef(0);
  const inFlight = useRef(false);
  const mounted = useRef(false);
  const focusCode = useRef(false);
  const form = useForm<LoginFormValues>({
    defaultValues: { account: initialFeedback?.phone ?? '', code: '', password: '' },
    shouldUnregister: true,
  });

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    flow.clearLoginFeedback();
  }, [flow.clearLoginFeedback]);

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
      const phone = form.getValues('account');
      const result = await api.sendCode({ phone, scene: 'login' });
      if (mounted.current)
        setNotice(
          result.includes(MOCK_SMS_CODE) ? result : `${result} 测试验证码：${MOCK_SMS_CODE}`,
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
    submitting,
    sms: {
      sending,
      countdown,
      send: () => void sendCode(),
    },
    actions: {
      changeAccount: () => {
        form.setValue('code', '');
        form.clearErrors('code');
        setNotice('');
        setError(null);
      },
      finish: async ({ account, code, password }) => {
        if (inFlight.current) return;
        inFlight.current = true;
        setSubmitting(true);
        setError(null);
        setNotice('');
        try {
          if (mode === 'password') {
            await api.login({ account, password });
          } else {
            const result = await api.verifyCode({ phone: account, code });
            if (!mounted.current) return;
            if (result.status === 'registration_required') {
              if (
                !Number.isFinite(Date.parse(result.expiresAt)) ||
                Date.parse(result.expiresAt) <= Date.now()
              )
                throw new Error('注册凭证已过期，请重新获取验证码。');
              flow.startRegistration({ ...result, phone: account });
              await navigate({ to: '/register' });
              return;
            }
          }
          if (!mounted.current) return;
          await cache.cancelQueries({ queryKey: SESSION_KEY });
          const user = await cache.fetchQuery({ ...sessionQuery, staleTime: 0 });
          if (!user) throw new Error('无法确认登录状态，请重新登录。');
          if (mounted.current) await navigate({ to: '/', replace: true });
        } catch (failure) {
          if (!mounted.current) return;
          setError(failure);
          if (failure instanceof ApiError && failure.status === 429 && failure.retryAfter)
            startCooldown(failure.retryAfter);
        } finally {
          inFlight.current = false;
          if (mounted.current) setSubmitting(false);
        }
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
            disabled={sending || submitting}
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
              disabled={sending || submitting}
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
