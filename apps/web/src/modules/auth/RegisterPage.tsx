import { useEffect, useState } from 'react';
import { Button, Form, Input, Typography } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '@tyde/shared';
import { api } from '../../services/api';
import { SESSION_KEY } from '../../hooks/useSession';
import { ErrorNotice } from '../../components/ErrorNotice';
import type { PendingRegistration } from './LoginPage';

export function RegisterPage({
  grant,
  clearGrant,
}: {
  grant: PendingRegistration;
  clearGrant: () => void;
}) {
  const navigate = useNavigate();
  const cache = useQueryClient();
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    const update = () => setExpired(Date.now() >= new Date(grant.expiresAt).getTime());
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [grant.expiresAt]);
  const register = useMutation({
    mutationFn: (values: { username: string; displayName: string }) =>
      api.completeRegistration({ ...values, registrationToken: grant.registrationToken }),
    onSuccess: (result) => {
      cache.setQueryData(SESSION_KEY, result);
      clearGrant();
      navigate('/', { replace: true });
    },
  });
  const needRestart =
    expired ||
    (register.error instanceof ApiError &&
      ['REGISTRATION_EXPIRED', 'PHONE_ALREADY_REGISTERED'].includes(register.error.code));
  function restart() {
    clearGrant();
    navigate('/auth', { replace: true });
  }
  return (
    <>
      <span className="step-label">最后一步 · 手机号已验证</span>
      <Typography.Title level={2}>认识一下你</Typography.Title>
      <p className="subtitle">为 +86 {grant.phone} 完善注册资料。</p>
      <Form
        layout="vertical"
        requiredMark={false}
        onFinish={(values) => register.mutate(values)}
        disabled={needRestart || register.isPending}
      >
        <Form.Item
          name="username"
          label="用户名（英文）"
          extra="3～32 位，字母开头，可含数字和下划线，不区分大小写。"
          rules={[
            { required: true, message: '请输入用户名' },
            { pattern: /^[a-zA-Z][a-zA-Z0-9_]{2,31}$/, message: '用户名格式不正确' },
          ]}
        >
          <Input autoComplete="username" maxLength={32} placeholder="例如 alex_ding" />
        </Form.Item>
        <Form.Item
          name="displayName"
          label="姓名"
          rules={[
            { required: true, message: '请输入姓名' },
            {
              validator: async (_, value: string) => {
                const name = (value ?? '').trim().normalize('NFC');
                if (!name || [...name].length > 80 || /[\p{Cc}\p{Cf}]/u.test(name))
                  throw new Error('请输入 1～80 字的姓名，不含控制字符');
              },
            },
          ]}
        >
          <Input autoComplete="name" placeholder="中文、英文或其他语言均可" />
        </Form.Item>
        <ErrorNotice error={expired ? new Error('手机号验证已过期，请重新验证') : register.error} />
        <Button
          type="primary"
          block
          htmlType="submit"
          className="submit"
          loading={register.isPending}
        >
          完成注册
        </Button>
      </Form>
      <Button type="link" block onClick={restart} disabled={register.isPending} className="back">
        {needRestart ? '重新验证手机号' : '返回并重新验证'}
      </Button>
    </>
  );
}
