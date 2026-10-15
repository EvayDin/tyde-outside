/** 提供基于原生文件输入的可访问文件选择与拖放交互。 */
import { useState, type ComponentProps, type DragEvent, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface FileUploadFieldProps extends Omit<
  ComponentProps<'input'>,
  'children' | 'className' | 'onChange' | 'type'
> {
  /** 文件选择区内展示的业务内容。 */
  children: ReactNode;
  /** 文件选择区外层样式。 */
  className?: string;
  /** 可聚焦视觉区域的样式。 */
  contentClassName?: string;
  /** 是否允许把文件拖放到选择区，默认开启以统一所有上传入口。 */
  dropzone?: boolean;
  /** 用户选中或拖入文件后接收标准 File 数组。 */
  onFilesSelected: (files: File[]) => void;
}

/** 将 FileList 转换为便于业务校验和上传的不可变数组。 */
function toFiles(fileList: FileList | null) {
  return fileList ? Array.from(fileList) : [];
}

/**
 * 使用原生 input 保留浏览器文件选择能力，并统一点击、键盘焦点和可选拖放交互。
 * 上传请求仍由业务 Hook 交给 TanStack Query 管理。
 */
export function FileUploadField({
  children,
  className,
  contentClassName,
  disabled,
  dropzone = true,
  multiple,
  onFilesSelected,
  ...props
}: FileUploadFieldProps) {
  const [dragging, setDragging] = useState(false);

  /** 读取本次选择，并清空 input 以允许再次选择同一个文件。 */
  const handleChange: ComponentProps<'input'>['onChange'] = (event) => {
    const files = toFiles(event.currentTarget.files);
    if (files.length > 0) onFilesSelected(multiple ? files : files.slice(0, 1));
    event.currentTarget.value = '';
  };

  /** 接收拖放文件，并复用与文件选择相同的业务回调。 */
  const handleDrop = (event: DragEvent<HTMLLabelElement>) => {
    if (!dropzone) return;
    event.preventDefault();
    setDragging(false);
    if (disabled) return;
    const files = toFiles(event.dataTransfer.files);
    if (files.length > 0) onFilesSelected(multiple ? files : files.slice(0, 1));
  };

  return (
    <label
      data-slot="file-upload-field"
      data-dragging={dragging || undefined}
      aria-disabled={disabled || undefined}
      title={dropzone ? '点击或拖拽上传文件' : undefined}
      className={cn('relative block', disabled && 'cursor-not-allowed opacity-50', className)}
      onDragEnter={(event) => {
        if (!dropzone) return;
        event.preventDefault();
        if (disabled) return;
        setDragging(true);
      }}
      onDragOver={(event) => {
        if (dropzone) event.preventDefault();
      }}
      onDragLeave={(event) => {
        if (
          !dropzone ||
          (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))
        )
          return;
        setDragging(false);
      }}
      onDrop={handleDrop}
    >
      <input
        {...props}
        type="file"
        className="peer sr-only"
        disabled={disabled}
        multiple={multiple}
        onChange={handleChange}
      />
      <span
        className={cn(
          'flex cursor-pointer peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--color-primary)] peer-focus-visible:ring-offset-2 peer-aria-invalid:border-destructive peer-aria-invalid:ring-2 peer-aria-invalid:ring-destructive/20',
          disabled && 'cursor-not-allowed',
          dragging && 'border-[var(--color-primary)] bg-[var(--color-primary-soft)]',
          contentClassName,
        )}
      >
        {children}
      </span>
    </label>
  );
}
