import { Alert } from 'antd';
import { ApiError } from '@tyde/shared';
export function ErrorNotice({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : '操作失败，请稍后重试';
  return (
    <Alert
      type="error"
      showIcon
      title={message}
      description={
        error instanceof ApiError && error.requestId ? `请求编号：${error.requestId}` : undefined
      }
    />
  );
}
