import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { runSleepWake } from '../../scripts/lib/phi_notes_sleep_wake.mjs';

const roots: string[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true });
});
const fixture = (corruptPrior = false) => {
  vi.useFakeTimers();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phi-sleep-unit-'));
  roots.push(root);
  fs.writeFileSync(path.join(root, 'sleep-cue'), 'unit-test-only');
  const powerMonitor = new EventEmitter();
  const metadata = {
    model: 'phi4-mini:3.8b',
    pipeline_version: 'notes-v30-source-first',
    source_provenance: { source_revision: 'r1' },
  };
  const meeting = {
    id: 'synthetic',
    analysis_json: JSON.stringify({ generation_metadata: metadata }),
    analysis_run_json: JSON.stringify({
      run_id: 'prior',
      notes_status: 'published',
      source_revision: 'r1',
    }),
  };
  const get = vi.fn(async () => ({ ...meeting }));
  const invoke = vi.fn(async () => {});
  let interrupt: (error: Error) => void;
  const generate = vi.fn(async (id: string) => {
    if (id.endsWith('explicit-retry')) {
      meeting.analysis_run_json = JSON.stringify({
        run_id: 'retry',
        notes_status: 'published',
        source_revision: 'r1',
      });
      return;
    }
    meeting.analysis_run_json = JSON.stringify({
      run_id: 'running',
      notes_status: 'running',
      source_revision: 'r1',
    });
    await new Promise<void>((_resolve, reject) => {
      interrupt = reject;
    });
  });
  const pauseTelemetry = vi.fn(async () => {});
  const sleepNow = vi.fn(async () => {
    powerMonitor.emit('suspend');
    vi.setSystemTime(Date.now() + 15_000);
    powerMonitor.emit('resume');
    meeting.analysis_run_json = JSON.stringify({
      run_id: 'running',
      notes_status: 'failed',
      source_revision: 'r1',
    });
    if (corruptPrior) meeting.analysis_json = '{}';
    interrupt(new Error('interrupted'));
  });
  return {
    root,
    powerMonitor,
    get,
    invoke,
    generate,
    pauseTelemetry,
    sleepNow,
  };
};

it('requires real event-adapter suspend/resume and a provenance-valid retry', async () => {
  const f = fixture();
  await runSleepWake(f);
  const rows = fs
    .readFileSync(path.join(f.root, 'sleep-wake-events.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  expect(rows.at(-1)).toMatchObject({
    event: 'sleep_wake_verified',
    suspendedMs: 15_000,
    retryRunId: 'retry',
  });
  expect(f.pauseTelemetry).toHaveBeenCalledWith(true);
  expect(f.pauseTelemetry).toHaveBeenLastCalledWith(false);
  expect(f.powerMonitor.listenerCount('resume')).toBe(0);
});

it('does not hide a stale publication behind a subsequent successful retry', async () => {
  const f = fixture(true);
  await expect(runSleepWake(f)).rejects.toThrow(
    'interrupted_notes_replaced_prior_publication',
  );
  expect(f.generate).toHaveBeenCalledTimes(1);
});
