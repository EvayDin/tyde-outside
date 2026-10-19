/** 提供 shadcn 官方 Label 基础组件。 */
import * as React from 'react';
import * as LabelPrimitive from '@radix-ui/react-label';

import { cn } from '@/lib/utils';

const labelClassName =
  'text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70';

/** 透传 Radix Label 的引用、语义和禁用状态样式。 */
const Label = React.forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>
>(({ className, ...props }, ref) => (
  <LabelPrimitive.Root ref={ref} className={cn(labelClassName, className)} {...props} />
));
Label.displayName = LabelPrimitive.Root.displayName;

export { Label };
