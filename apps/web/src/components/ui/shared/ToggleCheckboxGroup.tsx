/** 提供保留原生多选语义的按钮式与标签式复选组。 */
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** 多选组中的结构化选项；简单场景也可直接传字符串。 */
export interface ToggleCheckboxOption<Value extends string> {
  /** 写入受控数组的稳定值。 */
  value: Value;
  /** 未选中时展示的文字或图标内容。 */
  label: ReactNode;
  /** 选中时替换 `label` 的内容，例如附加勾选标记。 */
  selectedLabel?: ReactNode;
}

/** 传递给选项样式函数的当前渲染状态。 */
export interface ToggleCheckboxOptionState<Value extends string> {
  /** 当前选项的数据。 */
  option: ToggleCheckboxOption<Value>;
  /** 当前选项是否被选中。 */
  selected: boolean;
  /** 当前选项是否禁止操作。 */
  disabled: boolean;
}

/** `ToggleCheckboxGroup` 的受控属性。 */
interface ToggleCheckboxGroupProps<Value extends string> {
  /** 多选组容器 ID，用于关联可见标签。 */
  id?: string;
  /** 当前选中的值数组；默认空数组。 */
  value?: Value[];
  /** 任一 checkbox 变化时返回完整的新值数组。 */
  onChange?: (value: Value[]) => void;
  /** 选项列表，支持字符串简写或带独立标签的结构化配置。 */
  options: readonly (Value | ToggleCheckboxOption<Value>)[];
  /** 需要禁用的选项值。 */
  disabledOptions?: readonly Value[];
  /** `button` 和 `pill` 使用内置外观；`bare` 只保留内容居中、焦点和表单语义。 */
  variant?: 'button' | 'pill' | 'bare';
  /** 多选组外层容器样式。 */
  className?: string;
  /** checkbox 组的无障碍名称。 */
  ariaLabel?: string;
  /** 当前多选值是否未通过校验。 */
  invalid?: boolean;
  /** 是否将多选组标记为必填。 */
  required?: boolean;
  /** 多选组关联的说明或错误元素 ID。 */
  ariaDescribedBy?: string;
  /** 所有选项共用的样式，或根据选中、禁用状态动态生成样式。 */
  optionClassName?: string | ((state: ToggleCheckboxOptionState<Value>) => string | undefined);
}

/**
 * 将一组原生 checkbox 呈现为可多选的按钮或标签，适合角色、能力标签等短选项。
 */
export function ToggleCheckboxGroup<Value extends string>({
  id,
  value = [],
  onChange,
  options,
  disabledOptions = [],
  variant = 'button',
  className,
  ariaLabel,
  invalid = false,
  required = false,
  ariaDescribedBy,
  optionClassName,
}: ToggleCheckboxGroupProps<Value>) {
  return (
    <div
      id={id}
      data-slot="toggle-checkbox-group"
      className={cn(
        variant !== 'bare' && 'flex',
        variant === 'button' && 'gap-[7px]',
        variant === 'pill' && 'flex-wrap gap-[8px]',
        className,
      )}
      role="group"
      aria-label={ariaLabel}
      aria-required={required || undefined}
      aria-invalid={invalid || undefined}
      aria-describedby={ariaDescribedBy}
    >
      {options.map((optionInput) => {
        const option =
          typeof optionInput === 'string'
            ? { value: optionInput, label: optionInput }
            : optionInput;
        const selected = value.includes(option.value);
        const disabled = disabledOptions.includes(option.value);

        return (
          <Button
            className={cn(
              'inline-flex items-center justify-center text-center',
              variant !== 'bare' &&
                'm-0 cursor-pointer py-0 font-normal [font-family:inherit] transition-none',
              variant === 'button'
                ? 'h-[34px] px-[11px] text-[12px] leading-[20px]'
                : variant === 'pill'
                  ? 'h-[31px] px-[12px] text-[12px] leading-[20px]'
                  : undefined,
              'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[var(--color-primary)]',
              typeof optionClassName === 'function'
                ? optionClassName({ option, selected, disabled })
                : optionClassName,
            )}
            variant={variant === 'bare' ? 'unstyled' : selected ? 'primaryOutline' : 'outline'}
            asChild
            disabled={disabled}
            key={option.value}
          >
            <label>
              <input
                className="sr-only"
                type="checkbox"
                value={option.value}
                checked={selected}
                disabled={disabled}
                onChange={(event) => {
                  const nextValue = event.target.checked
                    ? [...value, option.value]
                    : value.filter((item) => item !== option.value);
                  onChange?.(nextValue);
                }}
              />
              {selected && option.selectedLabel !== undefined ? option.selectedLabel : option.label}
            </label>
          </Button>
        );
      })}
    </div>
  );
}
