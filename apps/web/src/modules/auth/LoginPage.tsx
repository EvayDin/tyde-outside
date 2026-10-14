import { useEffect, useState } from 'react';
import { Alert, Button, Form, Input, Space, Typography } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ApiError, type CodeResult, type RegistrationRequired } from '@tyde-outside/shared';
import { api } from '../../services/api';
import { SESSION_KEY } from '../../hooks/useSession';
import { ErrorNotice } from '../../components/ErrorNotice';

export interface PendingRegistration extends RegistrationRequired {
  phone: string;
}
export function LoginPage({
  onRegistration,
}: {
  onRegistration: (grant: PendingRegistration) => void;
}) {
  const [form] = Form.useForm<{ phone: string; code: string }>();
  const [challenge, setChallenge] = useState<CodeResult>();
  const [readyAt, setReadyAt] = useState(0);
  const [tick, setTick] = useState(Date.now());
  const [localError, setLocalError] = useState<unknown>();
  const navigate = useNavigate();
  const cache = useQueryClient();
  const remaining = Math.max(0, Math.ceil((readyAt - tick) / 1000));
  useEffect(() => {
    const timer = window.setInterval(() => setTick(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, []);
  const send = useMutation({
    mutationFn: async () => {
      const { phone } = await form.validateFields(['phone']);
      return api.sendCode({ region: 'CN', phone: phone.trim() });
    },
    onSuccess: (data) => {
      setChallenge(data);
      setReadyAt(Date.now() + data.resendAfterSeconds * 1000);
      setTick(Date.now());
      form.setFieldValue('code', '');
      setLocalError(undefined);
    },
    onError: (error) => {
      if (error instanceof ApiError && error.retryAfter) {
        setReadyAt(Date.now() + error.retryAfter * 1000);
        setTick(Date.now());
      }
    },
  });
  const verify = useMutation({
    mutationFn: async (values: { phone: string; code: string }) => {
      if (!challenge) throw new Error('请先获取验证码');
      if (new Date(challenge.expiresAt).getTime() <= Date.now())
        throw new Error('验证码已过期，请重新获取');
      return api.verifyCode({
        region: 'CN',
        phone: values.phone.trim(),
        code: values.code,
        challengeId: challenge.challengeId,
      });
    },
    onSuccess: (result, values) => {
      if (result.status === 'registration_required') {
        onRegistration({ ...result, phone: values.phone.trim() });
        navigate('/register');
      } else {
        cache.setQueryData(SESSION_KEY, result);
        navigate('/', { replace: true });
      }
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 410) setChallenge(undefined);
    },
  });
  return (
    <>
      <span className="step-label">欢迎回来</span>
      <Typography.Title level={2}>登录 / 注册</Typography.Title>
      <p className="subtitle">使用手机验证码继续，首次使用将自动注册。</p>
      <Form
        form={form}
        layout="vertical"
        requiredMark={false}
        onFinish={(values) => {
          setLocalError(undefined);
          verify.mutate(values);
        }}
        onValuesChange={(changed) => {
          if ('phone' in changed) {
            setChallenge(undefined);
            verify.reset();
            send.reset();
          }
        }}
      >
        <Form.Item
          name="phone"
          label="手机号码"
          rules={[
            { required: true, message: '请输入手机号' },
            { pattern: /^1[3-9]\d{9}$/, message: '请输入 11 位大陆手机号码' },
          ]}
        >
          <Input
            addonBefore="+86"
            autoComplete="tel-national"
            inputMode="tel"
            maxLength={11}
            placeholder="请输入手机号码"
            disabled={send.isPending || verify.isPending}
          />
        </Form.Item>
        <Form.Item label="验证码" required>
          <Space.Compact block>
            <Form.Item
              name="code"
              noStyle
              rules={[
                { required: true, message: '请输入验证码' },
                { pattern: /^\d{6}$/, message: '请输入 6 位验证码' },
              ]}
            >
              <Input
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="6 位验证码"
                disabled={verify.isPending}
              />
            </Form.Item>
            <Button
              loading={send.isPending}
              disabled={remaining > 0 || verify.isPending}
              onClick={() => {
                setLocalError(undefined);
                send.mutate();
              }}
            >
              {remaining > 0 ? `${remaining}s 后重发` : '获取验证码'}
            </Button>
          </Space.Compact>
        </Form.Item>
        {challenge?.mode === 'mock' && (
          <Alert
            type="info"
            showIcon
            title="当前为内部试用，不发送短信。测试验证码：095270"
            className="notice"
          />
        )}
        <ErrorNotice
          error={
            localError ?? verify.error ?? (send.error instanceof Error ? send.error : undefined)
          }
        />
        <Button
          type="primary"
          htmlType="submit"
          block
          loading={verify.isPending}
          disabled={send.isPending}
          className="submit"
        >
          继续
        </Button>
      </Form>
      <p className="fine-print">验证码仅用于本次登录。请使用约定的测试手机号。</p>
    </>
  );
}
