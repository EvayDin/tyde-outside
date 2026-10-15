/** 提供统一替代浏览器原生 title 的可访问提示气泡。 */
import type { ReactElement, ReactNode } from 'react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface HintTooltipProps {
  content: ReactNode;
  children: ReactElement;
  side?: 'top' | 'right' | 'bottom' | 'left';
  className?: string;
}

/** 让提示同时响应悬停和键盘焦点，并使用系统统一视觉样式。 */
export function HintTooltip({ content, children, side = 'top', className }: HintTooltipProps) {
  return (
    <TooltipProvider delayDuration={250} skipDelayDuration={100}>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent
          side={side}
          className={cn(
            'max-w-[280px] bg-[var(--color-primary-dark)] text-center text-white',
            className,
          )}
        >
          {content}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
