import { CircleAlert } from 'lucide-react';
import { ApiError } from '@tyde/shared';
import { Alert } from './ui/alert';

/** 共用错误提示，保留后端请求编号以便跨端定位问题。 */
export function ErrorNotice({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : '操作失败，请稍后重试';
  return (
    <Alert variant="destructive">
      <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div>
        <p>{message}</p>
        {error instanceof ApiError && error.requestId && (
          <p className="mt-1 break-all text-xs">请求编号：{error.requestId}</p>
        )}
      </div>
    </Alert>
  );
}
