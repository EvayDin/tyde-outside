import { useState } from 'react';
import { cn } from '@/lib/utils';

/** 账户头像加载失败时使用姓名首字。 */
export function UserAvatar({
  url,
  name,
  className,
}: {
  url?: string | null;
  name: string;
  className?: string;
}) {
  const [failedUrl, setFailedUrl] = useState<string>();
  return (
    <span
      className={cn(
        'inline-flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-accent text-[16px] font-semibold text-[var(--color-primary-strong)]',
        className,
      )}
    >
      {url && failedUrl !== url ? (
        <img
          src={url}
          alt={name + '的头像'}
          className="size-full object-cover"
          referrerPolicy="no-referrer"
          onError={() => setFailedUrl(url)}
        />
      ) : (
        <span aria-hidden>{Array.from(name.trim())[0] || '我'}</span>
      )}
    </span>
  );
}
