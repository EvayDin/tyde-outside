import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  appendMemorySample,
  startMemoryDiagnostics,
} from '../apps/electron/src/main/memory-diagnostics.ts';

test('memory diagnostics retains at most two bounded logs with complete JSON lines', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tyde-memory-log-'));
  try {
    const path = join(root, 'memory.jsonl');
    for (let index = 0; index < 5; index++)
      appendMemorySample(path, { index, padding: 'x'.repeat(600_000) });
    assert.deepEqual((await readdir(root)).sort(), ['memory.jsonl', 'memory.jsonl.previous']);
    for (const [file, index] of [
      [path, 4],
      [`${path}.previous`, 3],
    ]) {
      assert.ok((await stat(file)).size <= 1024 * 1024);
      assert.equal(JSON.parse(await readFile(file, 'utf8')).index, index);
    }
    assert.throws(() => appendMemorySample(path, { padding: 'x'.repeat(1024 * 1024) }));
    assert.equal(JSON.parse(await readFile(path, 'utf8')).index, 4);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('memory diagnostics is opt-in, excluded from packaged apps, and stops during pending sampling', async () => {
  const previousFlag = process.env.TYDE_MEMORY_DIAGNOSTICS;
  const previousMemoryInfo = process.getProcessMemoryInfo;
  const root = await mkdtemp(join(tmpdir(), 'tyde-memory-lifecycle-'));
  try {
    const app = Object.assign(new EventEmitter(), {
      isPackaged: false,
      getPath: () => root,
      getAppMetrics: () => [
        { pid: 1, type: 'Browser', memory: { workingSetSize: 10, peakWorkingSetSize: 20 } },
      ],
    });
    process.env.TYDE_MEMORY_DIAGNOSTICS = '0';
    startMemoryDiagnostics(app);
    assert.equal(app.listenerCount('before-quit'), 0);
    process.env.TYDE_MEMORY_DIAGNOSTICS = '1';
    app.isPackaged = true;
    startMemoryDiagnostics(app);
    assert.equal(app.listenerCount('before-quit'), 0);
    app.isPackaged = false;
    let finishSample;
    process.getProcessMemoryInfo = () =>
      new Promise((resolve) => {
        finishSample = resolve;
      });
    startMemoryDiagnostics(app);
    assert.equal(app.listenerCount('before-quit'), 1);
    app.emit('before-quit');
    finishSample({ private: 100 });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(app.listenerCount('before-quit'), 0);
    assert.deepEqual(await readdir(root), []);
  } finally {
    if (previousFlag === undefined) delete process.env.TYDE_MEMORY_DIAGNOSTICS;
    else process.env.TYDE_MEMORY_DIAGNOSTICS = previousFlag;
    if (previousMemoryInfo === undefined) delete process.getProcessMemoryInfo;
    else process.getProcessMemoryInfo = previousMemoryInfo;
    await rm(root, { recursive: true, force: true });
  }
});
