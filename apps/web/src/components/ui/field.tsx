/** 提供 shadcn 官方 Field 组合式 API，用于组织标签、说明和校验错误。 */
import { useMemo } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';
import { Label } from '@/components/ui/label';

const fieldVariants = cva('group/field data-[invalid=true]:text-destructive flex w-full gap-3', {
  variants: {
    orientation: {
      vertical: ['flex-col [&>*]:w-full [&>.sr-only]:w-auto'],
      horizontal: [
        'flex-row items-center',
        '[&>[data-slot=field-label]]:flex-auto',
        'has-[>[data-slot=field-content]]:[&>[role=checkbox],[role=radio]]:mt-px has-[>[data-slot=field-content]]:items-start',
      ],
    },
  },
  defaultVariants: {
    orientation: 'vertical',
  },
});

/** 渲染支持垂直、水平和响应式布局的字段容器。 */
function Field({
  className,
  orientation = 'vertical',
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof fieldVariants>) {
  return (
    <div
      role="group"
      data-slot="field"
      data-orientation={orientation}
      className={cn(fieldVariants({ orientation }), className)}
      {...props}
    />
  );
}

/** 包裹字段标题、说明和控件区域。 */
function FieldContent({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="field-content"
      className={cn('group/field-content flex flex-1 flex-col gap-1.5 leading-snug', className)}
      {...props}
    />
  );
}

/** 渲染可与表单控件关联的字段标签。 */
function FieldLabel({ className, ...props }: React.ComponentProps<typeof Label>) {
  return (
    <Label
      data-slot="field-label"
      className={cn(
        'group/field-label peer/field-label flex w-fit gap-2 leading-snug group-data-[disabled=true]/field:opacity-50',
        'has-[>[data-slot=field]]:w-full has-[>[data-slot=field]]:flex-col has-[>[data-slot=field]]:rounded-md has-[>[data-slot=field]]:border [&>[data-slot=field]]:p-4',
        'has-data-[state=checked]:bg-primary/5 has-data-[state=checked]:border-primary dark:has-data-[state=checked]:bg-primary/10',
        className,
      )}
      {...props}
    />
  );
}

/** 渲染字段的辅助说明文本。 */
function FieldDescription({ className, ...props }: React.ComponentProps<'p'>) {
  return (
    <p
      data-slot="field-description"
      className={cn(
        'text-muted-foreground text-sm font-normal leading-normal group-has-[[data-orientation=horizontal]]/field:text-balance',
        'nth-last-2:-mt-1 last:mt-0 [[data-variant=legend]+&]:-mt-1.5',
        '[&>a:hover]:text-primary [&>a]:underline [&>a]:underline-offset-4',
        className,
      )}
      {...props}
    />
  );
}

/** 合并并展示一个或多个字段校验错误。 */
function FieldError({
  className,
  children,
  errors,
  ...props
}: React.ComponentProps<'div'> & {
  errors?: Array<{ message?: string } | undefined>;
}) {
  const content = useMemo(() => {
    if (children) {
      return children;
    }

    const messages = errors?.flatMap((error) => (error?.message ? [error.message] : [])) ?? [];

    if (messages.length === 0) {
      return null;
    }

    if (messages.length === 1) {
      return messages[0];
    }

    return (
      <ul className="ml-4 flex list-disc flex-col gap-1">
        {messages.map((message, index) => (
          <li key={`${message}-${index}`}>{message}</li>
        ))}
      </ul>
    );
  }, [children, errors]);

  if (!content) return null;

  return (
    <div
      data-slot="field-error-motion"
      className="motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-1 duration-[180ms]"
    >
      <div
        role="alert"
        data-slot="field-error"
        className={cn('text-destructive text-sm font-normal', className)}
        {...props}
      >
        {content}
      </div>
    </div>
  );
}

export { Field, FieldLabel, FieldDescription, FieldError, FieldContent };
