/** 渲染 React Hook Form 登录凭证表单，并把业务动作委托给登录控制器。 */
import { LockIcon, PhoneIcon, ShieldCheckIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import AuthFormField from '@/components/ui/shared/AuthFormField';
import AuthPasswordInput from '@/components/ui/shared/AuthPasswordInput';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { LoginFormController, LoginMethod } from '../types';
import { loginInputClassName, submitButtonClassName } from '../styles';
import LoginRoleSelector from './LoginRoleSelector';

const loginMethodTabClassName =
  "relative h-[27px] rounded-[6px] border-0 bg-transparent px-0 pt-0 pb-[10px] text-[12px] leading-[20px] font-normal text-[var(--color-text-secondary)] shadow-none [font-family:inherit] transition-none hover:bg-transparent data-[state=active]:bg-transparent data-[state=active]:font-bold data-[state=active]:text-[var(--color-primary)] data-[state=active]:shadow-none data-[state=active]:after:absolute data-[state=active]:after:right-0 data-[state=active]:after:bottom-[-1px] data-[state=active]:after:left-0 data-[state=active]:after:h-[2px] data-[state=active]:after:bg-[var(--color-primary)] data-[state=active]:after:[content:'']";

/** 根据登录字段类型选择对应的输入前缀图标。 */
function InputIcon({ type }: { type: 'phone' | 'password' | 'code' }) {
  if (type === 'phone') return <PhoneIcon />;
  if (type === 'code') return <ShieldCheckIcon />;
  return <LockIcon />;
}

/** 在 shadcn Input 左侧放置保持原视觉的认证图标。 */
function LoginInputIcon({ type }: { type: 'phone' | 'password' | 'code' }) {
  return (
    <span className="pointer-events-none absolute top-1/2 left-[12px] z-10 -translate-y-1/2 text-[#86a0b1] [&_svg]:h-[17px] [&_svg]:w-[17px] [&_svg]:fill-none [&_svg]:stroke-current [&_svg]:[stroke-linecap:round] [&_svg]:[stroke-linejoin:round] [&_svg]:[stroke-width:1.7]">
      <InputIcon type={type} />
    </span>
  );
}

/** 渲染登录表单，并绑定 Zod 验证、提交与短信动作。 */
export default function LoginFormPanel({ controller }: { controller: LoginFormController }) {
  const { form, role, method, submitting, sms, actions } = controller;
  const { errors } = form.formState;

  return (
    <form
      className="mt-0 grid gap-[24px] pt-[4px]"
      autoComplete="off"
      noValidate
      onSubmit={form.handleSubmit(actions.finish)}
    >
      <LoginRoleSelector role={role} onChange={actions.changeRole} />

      <Tabs
        value={method}
        className="grid gap-[24px]"
        onValueChange={(value) => {
          if (value === 'password' || value === 'code') {
            actions.changeMethod(value satisfies LoginMethod);
          }
        }}
      >
        <TabsList
          aria-label="登录方式"
          className="flex h-[28px] w-full justify-start gap-[22px] rounded-none border-b border-[#e6edf1] bg-transparent p-0"
        >
          <TabsTrigger
            id="login-method-tab-code"
            value="code"
            aria-controls="login-credential-panel"
            className={loginMethodTabClassName}
          >
            验证码登录
          </TabsTrigger>
          <TabsTrigger
            id="login-method-tab-password"
            value="password"
            aria-controls="login-credential-panel"
            className={loginMethodTabClassName}
          >
            密码登录
          </TabsTrigger>
        </TabsList>

        <div
          id="login-credential-panel"
          role="tabpanel"
          aria-labelledby={`login-method-tab-${method}`}
          className="grid gap-[24px]"
        >
          <AuthFormField
            htmlFor="login-account"
            label="手机号"
            required
            error={errors.account}
            layout="login"
          >
            <div className="relative min-w-0">
              <LoginInputIcon type="phone" />
              <Input
                id="login-account"
                size="auth"
                className={`${loginInputClassName} pl-[41px]`}
                type="tel"
                inputMode="numeric"
                autoComplete="off"
                maxLength={11}
                placeholder="请输入手机号"
                required
                aria-invalid={Boolean(errors.account)}
                {...form.register('account', {
                  required: '请输入手机号',
                  pattern: { value: /^1[3-9]\d{9}$/, message: '请输入 11 位大陆手机号码' },
                })}
              />
            </div>
          </AuthFormField>

          {method === 'password' ? (
            <AuthFormField
              htmlFor="login-password"
              label="密码"
              required
              error={errors.password}
              layout="login"
            >
              <div className="relative min-w-0">
                <LoginInputIcon type="password" />
                <AuthPasswordInput
                  id="login-password"
                  size="auth"
                  className={`${loginInputClassName} pl-[41px]`}
                  autoComplete="new-password"
                  maxLength={64}
                  placeholder="请输入密码"
                  required
                  aria-label="密码"
                  aria-invalid={Boolean(errors.password)}
                  {...form.register('password', { required: '请输入密码' })}
                />
              </div>
            </AuthFormField>
          ) : (
            <AuthFormField
              htmlFor="login-code"
              label="验证码"
              required
              error={errors.code}
              layout="login"
            >
              <div className="relative min-w-0">
                <LoginInputIcon type="code" />
                <Input
                  id="login-code"
                  size="auth"
                  className={`${loginInputClassName} pr-[92px] pl-[41px]`}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  placeholder="请输入6位验证码"
                  required
                  aria-invalid={Boolean(errors.code)}
                  {...form.register('code', {
                    required: '请输入验证码',
                    pattern: { value: /^\d{6}$/, message: '请输入 6 位验证码' },
                  })}
                />
                {/* 输入框内验证码操作是复合控件，保留 24px 高度与紧凑水平留白。 */}
                <Button
                  type="button"
                  variant="link"
                  size="authInline"
                  className="absolute top-1/2 right-[7px] -translate-y-1/2 border border-transparent px-[4px] py-0 leading-normal font-[650] [font-family:inherit] hover:no-underline"
                  disabled={sms.sending || sms.countdown > 0}
                  onClick={() => sms.send(form.getValues('account') ?? '')}
                >
                  {sms.sending
                    ? '发送中'
                    : sms.countdown > 0
                      ? `${sms.countdown}s 后重发`
                      : '获取验证码'}
                </Button>
              </div>
            </AuthFormField>
          )}
        </div>
      </Tabs>

      <Button
        type="submit"
        size="authSubmit"
        className={`${submitButtonClassName} ![font-family:inherit]`}
        disabled={submitting}
      >
        {submitting ? '登录中...' : `以「${role}」身份登录`}
      </Button>
    </form>
  );
}
