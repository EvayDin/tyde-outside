import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/** 统一错误与说明消息的语义和视觉，图标由调用方按用途选择。 */
export function Alert({
  className,
  variant = 'default',
  ...props
}: ComponentProps<'div'> & { variant?: 'default' | 'destructive' }) {
  return (
    <div
      data-slot="alert"
      role={variant === 'destructive' ? 'alert' : 'status'}
      className={cn(
        'flex items-start gap-2.5 rounded-xl border p-3.5 text-sm leading-relaxed',
        variant === 'destructive'
          ? 'border-destructive/25 bg-destructive/5 text-destructive'
          : 'border-primary/20 bg-accent text-accent-foreground',
        className,
      )}
      {...props}
    />
  );
}
