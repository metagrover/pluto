import { expect, it, vi } from 'vitest';
import { createCaptureDiagnostics } from '../../electron/captureDiagnostics';

const health = (event = 'heartbeat', framesWritten = 48000) =>
  `[AudioCapHealth] ${JSON.stringify({ event, framesWritten, tapGeneration: 1, retries: 0 })}\n`;
const renderer = {
  bytesReceived: 192000,
  samplesAccepted: 48000,
  samplesPackaged: 48000,
  samplesTrimmed: 0,
};

it('retains only numeric native/renderer counters and enum events from split stderr', async () => {
  const persist = vi.fn(async () => undefined);
  const diagnostics = createCaptureDiagnostics({ persist });
  diagnostics.nativeStarted();
  diagnostics.received(192000);
  diagnostics.forwarded(192000);
  const message = health();
  diagnostics.stderr(`private path and transcript\n${message.slice(0, 20)}`);
  diagnostics.stderr(message.slice(20));
  diagnostics.renderer({ ...renderer, transcript: 'private content' });
  diagnostics.written('system', 'raw', 192044, 12);
  diagnostics.written('system', 'complete', 0, 8);
  expect(persist).not.toHaveBeenCalled();
  await diagnostics.stop();
  const report = JSON.stringify(persist.mock.calls[0]);
  expect(report).not.toContain('private');
  expect(report).not.toContain('transcript');
  expect(report).toContain('framesWritten');
  expect(report).toContain('192044');
  expect(report).toContain('"completed":1');
});

it('bounds retention, fault writes, and malformed/hostile input', async () => {
  let now = 0;
  const persist = vi.fn(async () => undefined);
  const diagnostics = createCaptureDiagnostics({ persist, now: () => now });
  diagnostics.stderr(`[AudioCapHealth] null\n${health('__proto__')}`);
  diagnostics.stderr(
    '[AudioCapHealth] {"framesWritten":-1,"tapGeneration":1,"retries":0,"event":"write_failed"}\n',
  );
  diagnostics.renderer({
    ...renderer,
    samplesAccepted: Number.POSITIVE_INFINITY,
  });
  for (let i = 0; i < 200; i += 1) {
    now += 5000;
    diagnostics.renderer(renderer);
  }
  expect(diagnostics.snapshot().events).toHaveLength(120);
  expect(diagnostics.snapshot().faults.length).toBeLessThanOrEqual(32);
  for (let i = 0; i < 20; i += 1) diagnostics.writeFailed('system', 'raw');
  await diagnostics.stop();
  expect(persist).toHaveBeenCalledTimes(5);
  expect(diagnostics.snapshot().events).toHaveLength(120);
  expect(JSON.stringify(diagnostics.snapshot())).not.toContain('__proto__');
});

it('preserves stage evidence for native stall, delivery loss, trimming and disk failure', async () => {
  let now = 0;
  const diagnostics = createCaptureDiagnostics({
    persist: async () => undefined,
    now: () => now,
  });
  diagnostics.nativeStarted();
  diagnostics.stderr(health());
  diagnostics.received(192000);
  diagnostics.forwarded(192000);
  diagnostics.renderer(renderer);
  now = 5000;
  diagnostics.stderr(health('stalled'));
  now = 10000;
  diagnostics.stderr(health('heartbeat', 96000));
  diagnostics.received(192000);
  diagnostics.forwarded(192000);
  diagnostics.renderer(renderer); // IPC delivery was withheld.
  now = 15000;
  diagnostics.renderer({
    ...renderer,
    bytesReceived: 384000,
    samplesAccepted: 96000,
    samplesTrimmed: 12000,
  });
  diagnostics.writeFailed('system', 'complete');
  await diagnostics.stop();
  const events = diagnostics.snapshot().events;
  expect(events.some((event) => event.event === 'native_stalled')).toBe(true);
  expect(
    events.some(
      (event) =>
        event.bytesForwarded === 384000 &&
        (event.renderer as typeof renderer)?.samplesAccepted === 48000,
    ),
  ).toBe(true);
  expect(
    events.some(
      (event) => (event.renderer as typeof renderer)?.samplesTrimmed === 12000,
    ),
  ).toBe(true);
  expect(events.some((event) => event.event === 'repair_write_failed')).toBe(
    true,
  );
});

it('diagnostic IO failure never escapes into audio capture', async () => {
  const diagnostics = createCaptureDiagnostics({
    persist: async () => {
      throw new Error('disk_full');
    },
  });
  diagnostics.stderr(health('write_failed'));
  await expect(diagnostics.stop()).resolves.toBeUndefined();
});

it('retains pending disk-write evidence even when renderer snapshots stop arriving', () => {
  let now = 0;
  const diagnostics = createCaptureDiagnostics({
    persist: async () => undefined,
    now: () => now,
  });
  diagnostics.nativeStarted();
  diagnostics.renderer(renderer);
  diagnostics.writeStarted('system');
  now = 5000;
  diagnostics.received(192000);
  diagnostics.forwarded(192000);
  diagnostics.stderr(health());
  const last = diagnostics.snapshot().events.at(-1)!;
  expect((last.writes as { system: { pending: number } }).system.pending).toBe(
    1,
  );
  expect(last.bytesForwarded).toBe(192000);
  expect(last.elapsedMs).toBe(5000);
});
