import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runControlledCapture } from '../../scripts/lib/phi_notes_capture.mjs';

const roots: string[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true });
});
const fixture = (ready = true) => {
  vi.useFakeTimers();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phi-capture-unit-'));
  roots.push(root);
  let recording = false;
  const executeJavaScript = vi.fn(async (code: string) => {
    if (code.includes('START_RECORDING')) {
      recording = true;
      return true;
    }
    if (code.includes('STOP_RECORDING')) {
      recording = false;
      return true;
    }
    if (code.includes('transcript:'))
      return { active: recording, transcript: 'Synthetic', health: [] };
    if (code.includes('!document.querySelector')) return !recording;
    return true;
  });
  const invoke = vi.fn(async (channel: string) => {
    if (channel === 'RECORDING_READINESS_PREPARE') return { ready };
    if (channel === 'GET_MEETINGS') return [{ id: 'captured' }];
    if (channel === 'GET_MEETING')
      return {
        id: 'captured',
        finalization_status: 'finalized',
        transcript_status: 'validated',
      };
    return undefined;
  });
  const window = { webContents: { executeJavaScript, reload: vi.fn() } };
  const events = () =>
    fs
      .readFileSync(path.join(root, 'capture-events.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
  const player = Object.assign(new EventEmitter(), { kill: vi.fn() });
  const playAudio = vi.fn(() => player);
  return { root, window, invoke, events, playAudio, player };
};

describe('controlled capture harness', () => {
  it('never treats a saved needs-attention recording as success', async () => {
    const f = fixture();
    const invoke = f.invoke.getMockImplementation()!;
    f.invoke.mockImplementation(async (channel) =>
      channel === 'GET_MEETING'
        ? {
            id: 'captured',
            finalization_status: 'needs_attention',
            transcript_status: 'needs_attention',
          }
        : invoke(channel),
    );
    const run = runControlledCapture({
      ...f,
      seconds: 30,
      workload: 'control',
    });
    const rejected = expect(run).rejects.toThrow(
      'capture_finalization_not_finalized',
    );
    await vi.advanceTimersByTimeAsync(32_000);
    await rejected;
    expect(f.events().at(-1)?.event).toBe('failed');
    expect(f.player.kill).toHaveBeenCalledWith('SIGTERM');
  });
  it('records all four notes jobs and all eight Ask attempts in a mixed rehearsal', async () => {
    const f = fixture();
    const run = runControlledCapture({ ...f, seconds: 240, workload: 'mixed' });
    await vi.advanceTimersByTimeAsync(242_000);
    await run;
    expect(
      f.events().filter((e) => e.event === 'notes_requested'),
    ).toHaveLength(4);
    expect(f.events().filter((e) => e.event === 'notes_terminal')).toHaveLength(
      4,
    );
    expect(f.events().filter((e) => e.event === 'ask_requested')).toHaveLength(
      8,
    );
    expect(f.events().filter((e) => e.event === 'ask_terminal')).toHaveLength(
      8,
    );
  });
  it('rejects readiness failure before requesting capture', async () => {
    const f = fixture(false);
    await expect(
      runControlledCapture({ ...f, seconds: 30, workload: 'control' }),
    ).rejects.toThrow('recording_readiness_failed');
    expect(f.events().map((e) => e.event)).not.toContain('recording_requested');
    expect(f.events().at(-1)?.event).toBe('failed');
  });
  it('samples a real-lifecycle adapter for the requested duration and never labels unscored gates passed', async () => {
    const f = fixture();
    const run = runControlledCapture({
      ...f,
      seconds: 30,
      workload: 'control',
    });
    await vi.advanceTimersByTimeAsync(32_000);
    await run;
    expect(f.events().filter((e) => e.event === 'capture_sample')).toHaveLength(
      30,
    );
    expect(f.events().at(-1)?.acceptance).toMatch(/^incomplete_/);
    expect(
      fs.statSync(path.join(f.root, 'capture-events.jsonl')).mode & 0o777,
    ).toBe(0o600);
    expect(f.invoke).not.toHaveBeenCalledWith(
      'GENERATE_MEETING_NOTES',
      expect.anything(),
    );
  });
  it('stops capture and preserves the error when renderer sampling fails', async () => {
    const f = fixture();
    const evaluate =
      f.window.webContents.executeJavaScript.getMockImplementation()!;
    f.window.webContents.executeJavaScript.mockImplementation(async (code) => {
      if (code.includes('transcript:')) throw new Error('renderer_failure');
      return evaluate(code);
    });
    await expect(
      runControlledCapture({ ...f, seconds: 30, workload: 'control' }),
    ).rejects.toThrow('renderer_failure');
    expect(f.events().map((e) => e.event)).toContain('cleanup_stop_requested');
  });
});
