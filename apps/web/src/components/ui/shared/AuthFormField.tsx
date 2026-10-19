/** 将 shadcn Field 组合为认证页统一的登录与注册字段布局。 */
import type { ReactNode } from 'react';
import type { FieldError as ReactHookFormFieldError } from 'react-hook-form';
import { FormField } from '@/components/ui/shared/FormField';
import { cn } from '@/lib/utils';

interface AuthFormFieldProps {
  /** 控件 ID，用于建立标签与输入框关联。 */
  htmlFor: string;
  /** 字段标签，可包含必填或选填说明。 */
  label: ReactNode;
  /** 是否展示统一的必填标记。 */
  required?: boolean;
  /** React Hook Form 返回的当前字段错误。 */
  error?: ReactHookFormFieldError;
  /** 登录字段横排，注册字段竖排。 */
  layout?: 'login' | 'register';
  /** 调用方用于网格跨列等业务布局的附加类名。 */
  className?: string;
  /** 实际表单控件。 */
  children: ReactNode;
}

/** 渲染带无障碍错误关联的认证字段。 */
export default function AuthFormField({
  htmlFor,
  label,
  required = false,
  error,
  layout = 'register',
  className,
  children,
}: AuthFormFieldProps) {
  return (
    <FormField
      controlId={htmlFor}
      label={label}
      required={required}
      error={error?.message}
      invalid={Boolean(error)}
      className={cn(
        'min-w-0 gap-[5px]',
        layout === 'login' && 'grid grid-cols-[66px_minmax(0,1fr)] gap-x-[10px]',
        className,
      )}
      labelClassName={cn(
        'text-[12px] font-[650] text-[var(--color-neutral-strong)] [&_em]:not-italic [&_em]:text-[var(--color-danger)] [&_small]:text-[inherit] [&_small]:text-[var(--color-text-secondary)]',
        layout === 'login' && 'h-[40px] items-center justify-end text-[13px] font-normal',
      )}
      contentClassName="min-w-0 gap-[5px]"
    >
      {children}
    </FormField>
  );
}
