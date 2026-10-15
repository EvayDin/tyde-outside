/** 组合公共 Field 原语，为受控表单统一标签、说明与可访问错误反馈。 */
import type { ReactNode } from 'react';
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '@/components/ui/field';
import { cn } from '@/lib/utils';

/** 传给字段控件的可访问性关联信息。 */
export interface FormFieldAccessibility {
  /** 当前字段是否存在错误。 */
  invalid: boolean;
  /** 错误元素 ID。 */
  errorId: string;
  /** 说明元素 ID。 */
  descriptionId: string;
  /** 当前控件需要关联的说明与错误元素。 */
  describedBy?: string;
}

interface FormFieldProps {
  /** 控件 ID，用于关联标签、说明和错误信息。 */
  controlId: string;
  /** 字段标签内容。 */
  label: ReactNode;
  /** 是否展示必填标记。 */
  required?: boolean;
  /** 单条或多条字段错误。 */
  error?: string | readonly string[] | null;
  /** 外部校验器已判定无效但暂未提供错误文字时仍保留无效状态。 */
  invalid?: boolean;
  /** 无错误时持续展示的字段说明。 */
  description?: ReactNode;
  /** 字段容器附加样式。 */
  className?: string;
  /** 标签附加样式。 */
  labelClassName?: string;
  /** 控件与反馈区域附加样式。 */
  contentClassName?: string;
  /** 标签和控件的排列方向，默认保持纵向表单布局。 */
  orientation?: 'vertical' | 'horizontal';
  /** 字段控件；函数形式可直接取得无障碍关联信息。 */
  children: ReactNode | ((accessibility: FormFieldAccessibility) => ReactNode);
}

/** 统一渲染字段标签、必填标记、辅助说明和读屏可感知的行内错误。 */
export function FormField({
  controlId,
  label,
  required = false,
  error,
  invalid = false,
  description,
  className,
  labelClassName,
  contentClassName,
  orientation = 'vertical',
  children,
}: FormFieldProps) {
  const messages = error ? (Array.isArray(error) ? [...error] : [error]) : [];
  const isInvalid = invalid || messages.length > 0;
  const errorId = `${controlId}-error`;
  const descriptionId = `${controlId}-description`;
  const describedBy = [
    description ? descriptionId : undefined,
    messages.length ? errorId : undefined,
  ]
    .filter((value): value is string => Boolean(value))
    .join(' ');
  const accessibility: FormFieldAccessibility = {
    invalid: isInvalid,
    errorId,
    descriptionId,
    ...(describedBy ? { describedBy } : {}),
  };

  return (
    <Field
      data-invalid={isInvalid}
      orientation={orientation}
      className={cn('min-w-0 gap-[6px]', className)}
    >
      <FieldLabel htmlFor={controlId} className={labelClassName}>
        {label}
        {required && (
          <span aria-hidden className="text-destructive">
            *
          </span>
        )}
      </FieldLabel>
      <FieldContent className={cn('min-w-0 gap-[5px]', contentClassName)}>
        {typeof children === 'function' ? children(accessibility) : children}
        {description && <FieldDescription id={descriptionId}>{description}</FieldDescription>}
        <FieldError
          id={errorId}
          errors={messages.map((message) => ({ message }))}
          className="text-[12px] leading-[18px]"
        />
      </FieldContent>
    </Field>
  );
}
