export interface FileConfig {
  provider: 'disabled' | 'oss';
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  accessKeySecret: string;
  maxSize: number;
  maxRequestSize: number;
  maxBatchCount: number;
  urlExpireSeconds: number;
  unclaimedExpireSeconds: number;
  releasedExpireSeconds: number;
  cleanupBatchSize: number;
}

export function readFileConfig(source: NodeJS.ProcessEnv): FileConfig {
  const provider = source.FILE_STORAGE_PROVIDER ?? 'disabled';
  if (provider !== 'disabled' && provider !== 'oss')
    throw new Error('FILE_STORAGE_PROVIDER 配置无效');
  function positive(name: string, fallback: number, max = Number.MAX_SAFE_INTEGER) {
    const value = Number(source[name] ?? fallback);
    if (!Number.isSafeInteger(value) || value < 1 || value > max)
      throw new Error(`${name} 配置无效`);
    return value;
  }
  const endpoint = source.OSS_ENDPOINT ?? '';
  const bucket = source.OSS_BUCKET ?? '';
  const accessKeyId = source.OSS_ACCESS_KEY_ID ?? '';
  const accessKeySecret = source.OSS_ACCESS_KEY_SECRET ?? '';
  if (provider === 'oss') {
    const url = new URL(endpoint);
    if (
      url.protocol !== 'https:' ||
      url.pathname !== '/' ||
      url.search ||
      url.hash ||
      url.username ||
      url.password ||
      url.port
    )
      throw new Error('OSS_ENDPOINT 必须是无路径的 HTTPS 区域端点');
    if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket) || !accessKeyId || !accessKeySecret)
      throw new Error('请配置新项目专用 OSS bucket 和访问密钥');
  }
  return {
    provider,
    endpoint,
    bucket,
    accessKeyId,
    accessKeySecret,
    maxSize: positive('TYDE_FILE_MAX_SIZE', 50 * 1024 * 1024, 2147483647),
    maxRequestSize: positive('TYDE_UPLOAD_MAX_REQUEST_SIZE', 100 * 1024 * 1024),
    maxBatchCount: positive('TYDE_FILE_MAX_BATCH', 10, 100),
    urlExpireSeconds: positive('TYDE_FILE_URL_EXPIRE', 604800, 2147483647),
    unclaimedExpireSeconds: positive('TYDE_FILE_UNCLAIMED_EXPIRE', 86400),
    releasedExpireSeconds: positive('TYDE_FILE_RELEASED_EXPIRE', 86400),
    cleanupBatchSize: positive('TYDE_FILE_CLEANUP_BATCH', 100, 1000),
  };
}
