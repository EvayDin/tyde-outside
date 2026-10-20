/** 提供由 shadcn Input 组合出的可切换显隐认证密码输入框。 */
import { forwardRef, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, type InputProps } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/** 保留原生密码语义，并提供可访问的显隐切换按钮。 */
const AuthPasswordInput = forwardRef<HTMLInputElement, Omit<InputProps, 'type'>>(
  ({ className, disabled, size, ...props }, ref) => {
    const [visible, setVisible] = useState(false);

    return (
      <div className="relative w-full min-w-0">
        <Input
          {...props}
          size={size}
          ref={ref}
          disabled={disabled}
          type={visible ? 'text' : 'password'}
          className={cn(className, size === 'profile' ? 'pr-[48px]' : 'pr-[38px]')}
        />
        {/* 个人中心随输入框扩展点击区，认证页保留紧凑尺寸。 */}
        <Button
          type="button"
          variant="ghost"
          size="iconSm"
          className={cn(
            'absolute top-1/2 -translate-y-1/2 hover:bg-transparent',
            size === 'profile'
              ? 'right-0 size-[40px] max-[640px]:size-[44px]'
              : 'right-[5px] size-[28px]',
          )}
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
