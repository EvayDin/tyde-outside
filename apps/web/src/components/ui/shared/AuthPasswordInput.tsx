/** 提供由 shadcn Input 组合出的可切换显隐认证密码输入框。 */
import { forwardRef, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, type InputProps } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/** 保留原生密码语义，并提供可访问的显隐切换按钮。 */
const AuthPasswordInput = forwardRef<HTMLInputElement, Omit<InputProps, 'type'>>(
  ({ className, disabled, ...props }, ref) => {
    const [visible, setVisible] = useState(false);

    return (
      <div className="relative w-full min-w-0">
        <Input
          {...props}
          ref={ref}
          disabled={disabled}
          type={visible ? 'text' : 'password'}
          className={cn(className, 'pr-[38px]')}
        />
        {/* 密码框内图标是 32px 输入框的复合控件，保留原 28px 点击区域。 */}
        <Button
          type="button"
          variant="ghost"
          size="iconSm"
          className="absolute top-1/2 right-[5px] size-[28px] -translate-y-1/2 hover:bg-transparent"
          disabled={disabled}
          aria-label={visible ? '隐藏密码' : '显示密码'}
          aria-pressed={visible}
          onClick={() => setVisible((current) => !current)}
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </Button>
      </div>
    );
  },
);
AuthPasswordInput.displayName = 'AuthPasswordInput';

export default AuthPasswordInput;
