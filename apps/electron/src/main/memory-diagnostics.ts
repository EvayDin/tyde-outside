import type { App } from 'electron';
import { appendFileSync, existsSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const MAX_LOG_BYTES = 1024 * 1024;

/** 最多保留两份 1 MiB 日志，不在内存中保存采样历史。 */
export function appendMemorySample(path: string, sample: unknown): void {
  const line = `${JSON.stringify(sample)}\n`;
  if (Buffer.byteLength(line) > MAX_LOG_BYTES) throw new Error('Memory sample is too large');
  if (existsSync(path) && statSync(path).size + Buffer.byteLength(line) > MAX_LOG_BYTES) {
    renameSync(path, `${path}.previous`);
    writeFileSync(path, line);
  } else {
    appendFileSync(path, line);
  }
}

/** 显式开启的开发诊断；不挂接 inspector，不记录 URL、请求体或账号数据。 */
export function startMemoryDiagnostics(app: App): void {
  if (app.isPackaged || process.env.TYDE_MEMORY_DIAGNOSTICS !== '1') return;
  const path = join(app.getPath('userData'), 'memory-diagnostics.jsonl');
  console.info(`[桌面内存] 每 10 秒采样，日志：${path}（另保留一份 .previous）`);
  let sampling = false;
  let stopped = false;
  const stop = () => {
    stopped = true;
    clearInterval(timer);
    app.removeListener('before-quit', stop);
  };
  const sample = async () => {
    if (sampling || stopped) return;
    sampling = true;
    try {
      const mainMemory = await process.getProcessMemoryInfo();
      if (stopped) return;
      const mainHeap = process.memoryUsage();
      appendMemorySample(path, {
        timestamp: new Date().toISOString(),
        uptimeSeconds: Math.round(process.uptime()),
        versions: { electron: process.versions.electron, chrome: process.versions.chrome },
        // Electron 进程指标单位 KiB，Node 堆指标单位 byte，避免和虚拟地址空间混淆。
        processes: app.getAppMetrics().map(({ pid, type, memory }) => ({
          pid,
          type,
          workingSetKiB: memory.workingSetSize,
          peakWorkingSetKiB: memory.peakWorkingSetSize,
        })),
        main: {
          privateKiB: mainMemory.private,
          heapUsedBytes: mainHeap.heapUsed,
          externalBytes: mainHeap.external,
          arrayBuffersBytes: mainHeap.arrayBuffers,
        },
      });
    } catch (error) {
      // 无法写入就停止采样，防止诊断自身持续输出错误。
      stop();
      console.warn('[桌面内存] 采样失败，已停止诊断。', error);
    } finally {
      sampling = false;
    }
  };
  app.once('before-quit', stop);
  const timer = setInterval(() => void sample(), 10_000);
  timer.unref();
  void sample();
}
