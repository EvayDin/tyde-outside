import { app, safeStorage } from 'electron';
import { readFile, writeFile, rename, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
export class SessionStore {
  constructor(private readonly origin: string) {}
  private get path() {
    return join(
      app.getPath('userData'),
      `session-${createHash('sha256').update(this.origin).digest('hex').slice(0, 16)}.bin`,
    );
  }
  private ensureEncryption() {
    if (!safeStorage.isEncryptionAvailable())
      throw new Error('系统安全存储不可用，请检查钥匙串 / 系统账户');
  }
  async load(): Promise<string | undefined> {
    let bytes: Buffer;
    try {
      bytes = await readFile(this.path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
    this.ensureEncryption();
    try {
      const token = safeStorage.decryptString(bytes);
      return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : undefined;
    } catch {
      await this.clear();
      return undefined;
    }
  }
  async save(token: string): Promise<void> {
    this.ensureEncryption();
    await mkdir(app.getPath('userData'), { recursive: true });
    const temp = `${this.path}.tmp`;
    await writeFile(temp, safeStorage.encryptString(token), { mode: 0o600 });
    await rename(temp, this.path);
  }
  async clear(): Promise<void> {
    await rm(this.path, { force: true });
  }
}
