import { readFile, writeFile, rename, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
}
export interface SessionEncryption {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}
export function isSessionTokens(value: unknown): value is SessionTokens {
  if (!value || typeof value !== 'object') return false;
  const tokens = value as Partial<SessionTokens>;
  return (
    typeof tokens.accessToken === 'string' &&
    /^[A-Za-z0-9_-]{43}$/.test(tokens.accessToken) &&
    typeof tokens.refreshToken === 'string' &&
    /^[A-Za-z0-9_-]{43}$/.test(tokens.refreshToken)
  );
}
export class SessionStore {
  private pending: Promise<unknown> = Promise.resolve();
  private readonly path: string;
  constructor(
    origin: string,
    private readonly directory: string,
    private readonly encryption: SessionEncryption,
  ) {
    this.path = join(
      directory,
      `session-${createHash('sha256').update(new URL(origin).origin).digest('hex').slice(0, 16)}.bin`,
    );
  }
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pending.then(operation, operation);
    this.pending = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
  private ensureEncryption() {
    if (!this.encryption.isEncryptionAvailable())
      throw new Error('系统安全存储不可用，请检查钥匙串 / 系统账户');
  }
  load(): Promise<SessionTokens | undefined> {
    return this.serial(async () => {
      let bytes: Buffer;
      try {
        bytes = await readFile(this.path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw error;
      }
      this.ensureEncryption();
      try {
        const saved: unknown = JSON.parse(this.encryption.decryptString(bytes));
        if (isSessionTokens(saved))
          return { accessToken: saved.accessToken, refreshToken: saved.refreshToken };
      } catch {
        // 无法解密或旧版单令牌会话均失效，重新登录后写入新格式。
      }
      await rm(this.path, { force: true });
      return undefined;
    });
  }
  save(tokens: SessionTokens): Promise<void> {
    return this.serial(async () => {
      if (!isSessionTokens(tokens)) throw new Error('服务返回了无效会话');
      this.ensureEncryption();
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const temp = `${this.path}.tmp`;
      try {
        await writeFile(
          temp,
          this.encryption.encryptString(
            JSON.stringify({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken }),
          ),
          { mode: 0o600 },
        );
        await rename(temp, this.path);
      } finally {
        await rm(temp, { force: true });
      }
    });
  }
  clear(): Promise<void> {
    return this.serial(() => rm(this.path, { force: true }));
  }
}
