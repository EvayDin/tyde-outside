/** 提供保留原生单选语义的通用分段选择组件。 */
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { inputSizeClassNames, type InputSize } from '@/components/ui/input-size';
import { HintTooltip } from '@/components/ui/shared/HintTooltip';
import { cn } from '@/lib/utils';

/** 选中指示器相对分段控件容器的偏移与尺寸。 */
interface SegmentedControlIndicatorRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 判断两次测量结果是否相同，避免重复渲染。 */
function isSameIndicatorRect(
  previous: SegmentedControlIndicatorRect | null,
  next: SegmentedControlIndicatorRect,
) {
  return (
    previous !== null &&
    previous.x === next.x &&
    previous.y === next.y &&
    previous.width === next.width &&
    previous.height === next.height
  );
}

/** 分段选择器的单个选项。 */
export interface SegmentedControlOption<Value extends string> {
  /** 可选的原生表单控件 ID，用于关联受控内容区域。 */
  id?: string;
  /** 提交给受控状态的稳定值。 */
  value: Value;
  /** 展示内容，可包含文字和图标。 */
  label: ReactNode;
  /** 当前选项所控制内容区域的 ID。 */
  ariaControls?: string;
  /** 是否禁止选择当前选项。 */
  disabled?: boolean;
  /** 当前选项禁用时向鼠标和键盘用户展示的原因。 */
  disabledReason?: ReactNode;
}

/** 传递给选项样式函数的当前渲染状态。 */
export interface SegmentedControlOptionState<Value extends string> {
  /** 当前选项的数据。 */
  option: SegmentedControlOption<Value>;
  /** 当前选项是否被选中。 */
  selected: boolean;
  /** 当前选项是否被禁用。 */
  disabled: boolean;
}

/** `SegmentedControl` 的受控属性。 */
interface SegmentedControlProps<Value extends string> {
  /** 原生 radio 组名称；同一组内必须一致，页面内不同组应避免重名。 */
  name: string;
  /** 当前选中的选项值；空字符串表示尚未选择。 */
  value: Value | '';
  /** 可选择的互斥选项。 */
  options: readonly SegmentedControlOption<Value>[];
  /** 用户选择新选项时触发。 */
  onValueChange: (value: Value) => void;
  /** 分段选择器外层容器样式。 */
  className?: string;
  /** radio 组的无障碍名称。 */
  ariaLabel?: string;
  /** 通过外部可见标签元素为 radio 组命名。 */
  ariaLabelledBy?: string;
  /** radio 组关联的说明或错误元素 ID。 */
  ariaDescribedBy?: string;
  /** 是否将当前组标记为必填。 */
  required?: boolean;
  /** 是否将当前组标记为校验失败。 */
  invalid?: boolean;
  /** 是否禁止操作整个 radio 组。 */
  disabled?: boolean;
  /** 控制选项高度、水平间距与字体大小；省略时保留各视觉变体的原尺寸。 */
  size?: InputSize;
  /** `default` 为深色选中态，`soft` 为工作台统一浅色胶囊，`bare` 仅保留基础语义。 */
  variant?: 'default' | 'soft' | 'bare';
  /** 所有选项共用的样式，或根据选项和选中状态动态生成样式。 */
  optionClassName?: string | ((state: SegmentedControlOptionState<Value>) => string | undefined);
  /** `bare` 变体提供时启用跨选项平滑移动的共享背景；默认变体自带深色指示器。 */
  indicatorClassName?: string;
  /** 是否在选项内容前展示原生 radio 对应的可见圆形选择标记。 */
  showRadioIndicator?: boolean;
}

/**
 * 在少量互斥选项间切换的分段选择器，使用原生 radio 保留键盘操作和表单语义。
 */
export function SegmentedControl<Value extends string>({
  name,
  value,
  options,
  onValueChange,
  className,
  ariaLabel,
  ariaLabelledBy,
  ariaDescribedBy,
  required = false,
  invalid = false,
  disabled = false,
  size,
  variant = 'default',
  optionClassName,
  indicatorClassName,
  showRadioIndicator = false,
}: SegmentedControlProps<Value>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [indicatorRect, setIndicatorRect] = useState<SegmentedControlIndicatorRect | null>(null);
  const resolvedIndicatorClassName =
    indicatorClassName ??
    (variant === 'default'
      ? 'rounded-[12px] bg-[var(--color-primary-dark)] shadow-sm'
      : variant === 'soft'
        ? 'rounded-[12px] bg-white shadow-sm'
        : undefined);
  const selectedIndex = options.findIndex((option) => option.value === value);
  const hasIndicator = Boolean(resolvedIndicatorClassName) && selectedIndex >= 0;
  const optionCount = options.length;

  /**
   * 直接测量选中项相对容器的偏移，指示器只在容器坐标系内位移，
   * 因此不会把对话框重新居中等祖先位移算进动画里。
   */
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || !hasIndicator) {
      setIndicatorRect(null);
      return;
    }

    const readOptions = () =>
      Array.from(
        container.querySelectorAll<HTMLElement>(':scope > [data-slot="segmented-control-option"]'),
      );
    const measure = () => {
      const target = readOptions()[selectedIndex];
      if (!target) return;
      const next = {
        x: target.offsetLeft,
        y: target.offsetTop,
        width: target.offsetWidth,
        height: target.offsetHeight,
      };
      setIndicatorRect((previous) => (isSameIndicatorRect(previous, next) ? previous : next));
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    readOptions().forEach((option) => observer.observe(option));
    return () => observer.disconnect();
  }, [hasIndicator, optionCount, selectedIndex]);

  return (
    <div
      ref={containerRef}
      data-slot="segmented-control"
      data-size={size}
      className={cn(
        resolvedIndicatorClassName && 'relative',
        variant === 'default' &&
          'flex rounded-[12px] border border-[var(--color-border)] bg-white p-[4px]',
        variant === 'default' && !size && 'h-[39px]',
        // 显式尺寸控制整个控件高度，内部选项填满扣除边框和内边距后的空间。
        size && inputSizeClassNames[size].split(' ').filter((token) => token.startsWith('h-')),
        variant === 'soft' &&
          'flex rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-[4px]',
        className,
      )}
      role="radiogroup"
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      aria-describedby={ariaDescribedBy}
      aria-required={required || undefined}
      aria-invalid={invalid || undefined}
      aria-disabled={disabled || undefined}
    >
      {resolvedIndicatorClassName && indicatorRect && (
        <span
          aria-hidden="true"
          data-slot="segmented-control-motion-indicator"
          className={cn(
            'pointer-events-none absolute top-0 left-0 z-0 transition-transform duration-150 ease-out motion-reduce:transition-none',
            resolvedIndicatorClassName,
          )}
          style={{
            transform: `translate3d(${indicatorRect.x}px, ${indicatorRect.y}px, 0)`,
            width: indicatorRect.width,
            height: indicatorRect.height,
          }}
        />
      )}
      {options.map((option) => {
        const selected = option.value === value;
        const optionDisabled = disabled || option.disabled === true;
        const optionContent = (
          <>
            {showRadioIndicator && (
              <span
                aria-hidden="true"
                data-slot="segmented-control-radio-indicator"
                className={cn(
                  'grid size-[18px] shrink-0 place-items-center rounded-full border-2 bg-white transition-colors duration-150 motion-reduce:transition-none',
                  selected
                    ? 'border-[var(--color-primary)]'
                    : 'border-[var(--color-text-secondary)]',
                )}
              >
                {selected && <span className="size-[8px] rounded-full bg-[var(--color-primary)]" />}
              </span>
            )}
            {option.label}
          </>
        );
        const visibleOptionContent = resolvedIndicatorClassName ? (
          <span className="relative z-[1] inline-flex items-center justify-center gap-[inherit]">
            {optionContent}
          </span>
        ) : (
          optionContent
        );
        const describedOptionContent =
          optionDisabled && option.disabledReason ? (
            <HintTooltip content={option.disabledReason}>
              <span
                className="relative z-[21] inline-flex h-full w-full items-center justify-center rounded-[inherit] outline-none"
                tabIndex={0}
              >
                {visibleOptionContent}
              </span>
            </HintTooltip>
          ) : (
            visibleOptionContent
          );

        return (
          <Button
            className={cn(
              'relative inline-flex items-center justify-center text-center',
              showRadioIndicator && 'gap-[10px]',
              // 不裁剪也不隔离层叠上下文，指示器才能跨选项滑动并始终位于所有文字下方。
              resolvedIndicatorClassName && 'relative',
              variant === 'default' &&
                'h-[29px] min-w-0 flex-1 border-0 p-0 text-[12px] leading-[20px] font-[650] [font-family:inherit] shadow-none transition-colors duration-150 ease-out motion-reduce:transition-none',
              variant === 'default' &&
                (selected
                  ? 'bg-transparent text-white hover:bg-transparent'
                  : 'bg-transparent text-[var(--color-text-secondary)] hover:bg-transparent'),
              variant === 'soft' &&
                'cursor-pointer gap-[4px] border-0 bg-transparent px-[12px] py-[4px] text-[12px] leading-[normal] font-medium [font-family:Arial] shadow-none transition-colors duration-150 ease-out hover:bg-transparent motion-reduce:transition-none',
              variant === 'soft' && !size && 'max-[680px]:min-h-[44px]',
              variant === 'soft' &&
                (selected
                  ? 'text-[var(--color-primary)] hover:text-[var(--color-primary)]'
                  : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text)]'),
              optionDisabled && 'cursor-not-allowed opacity-50',
              'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[var(--color-primary)]',
              typeof optionClassName === 'function'
                ? optionClassName({ option, selected, disabled: optionDisabled })
                : optionClassName,
              size && inputSizeClassNames[size],
              size && 'h-full',
            )}
            variant={variant === 'bare' ? 'unstyled' : 'ghost'}
            asChild
            disabled={optionDisabled}
            key={option.value}
          >
            <label data-slot="segmented-control-option">
              <input
                id={option.id}
                className={cn(
                  'absolute inset-0 z-20 size-full cursor-pointer opacity-0',
                  optionDisabled && option.disabledReason && 'pointer-events-none',
                )}
                type="radio"
                name={name}
                value={option.value}
                checked={selected}
                aria-controls={option.ariaControls}
                aria-invalid={invalid || undefined}
                disabled={optionDisabled}
                required={required}
                onChange={() => onValueChange(option.value)}
              />
              {describedOptionContent}
            </label>
          </Button>
        );
      })}
    </div>
  );
}
