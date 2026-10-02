export type RendererCaptureCounters = {
  bytesReceived: number;
  samplesAccepted: number;
  samplesPackaged: number;
  samplesTrimmed: number;
};

type NativeHealth = {
  framesWritten: number;
  tapGeneration: number;
  retries: number;
};

type CaptureEvent =
  | 'sample'
  | 'native_started'
  | 'native_failed'
  | 'native_stalled'
  | 'native_restart'
  | 'native_route_change'
  | 'native_format_change'
  | 'native_write_failed'
  | 'raw_write_failed'
  | 'repair_write_failed'
  | 'stopped'
  | 'owner_destroyed';

const counter = (value: unknown): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;

/** Bounded, content-free evidence. No audio, identity, exception text or paths. */
export const createCaptureDiagnostics = (input: {
  persist: (report: unknown) => Promise<unknown>;
  now?: () => number;
}) => {
  const now = input.now ?? (() => performance.now());
  const started = now();
  let native: NativeHealth | null = null;
  let nativeReportedAtMs: number | null = null;
  let nativeRun = 0;
  let bytesReceived = 0;
  let bytesForwarded = 0;
  let renderer: RendererCaptureCounters | null = null;
  const writes = {
    mic: {
      rawBytes: 0,
      completed: 0,
      failures: 0,
      maxWriteMs: 0,
      pending: 0,
      pendingSinceMs: null as number | null,
    },
    system: {
      rawBytes: 0,
      completed: 0,
      failures: 0,
      maxWriteMs: 0,
      pending: 0,
      pendingSinceMs: null as number | null,
    },
  };
  const events: Array<Record<string, unknown>> = [];
  const faults: Array<Record<string, unknown>> = [];
  let lastSampleAt = Number.NEGATIVE_INFINITY;
  let stderrPending = '';
  let flushes = 0;
  let writing = Promise.resolve();
  const snapshot = () => ({
    schemaVersion: 1,
    clock: 'session_relative_milliseconds',
    events: [...events],
    faults: [...faults],
  });
  const record = (event: CaptureEvent, force = false) => {
    const elapsedMs = Math.round(now() - started);
    if (!force && event === 'sample' && elapsedMs - lastSampleAt < 4000) return;
    if (event === 'sample') lastSampleAt = elapsedMs;
    events.push({
      elapsedMs,
      event,
      nativeRun,
      native,
      nativeReportedAtMs,
      bytesReceived,
      bytesForwarded,
      renderer: renderer && { ...renderer },
      writes: { mic: { ...writes.mic }, system: { ...writes.system } },
    });
    if (events.length > 120) events.shift();
    if (
      event !== 'sample' &&
      event !== 'native_started' &&
      event !== 'stopped'
    ) {
      faults.push(events[events.length - 1]);
      // Preserve the first failures and the latest ones across long meetings.
      if (faults.length > 32) faults.splice(16, 1);
    }
  };
  const flush = (final = false) => {
    // At most four fault writes, plus stop; never await diagnostic IO in capture.
    if (!final && flushes >= 4) return writing;
    flushes += 1;
    const report = snapshot();
    writing = writing
      .then(() => input.persist(report))
      .then(
        () => undefined,
        () => undefined,
      );
    return writing;
  };
  const event = (value: CaptureEvent) => {
    record(value);
    if (
      [
        'native_failed',
        'native_stalled',
        'native_write_failed',
        'raw_write_failed',
        'repair_write_failed',
      ].includes(value)
    )
      void flush();
  };
  return {
    nativeStarted() {
      nativeRun += 1;
      native = null;
      nativeReportedAtMs = null;
      stderrPending = '';
      record('native_started');
    },
    received(bytes: number) {
      bytesReceived += bytes;
    },
    forwarded(bytes: number) {
      bytesForwarded += bytes;
    },
    renderer(value: unknown) {
      if (!value || typeof value !== 'object') return;
      const source = value as Record<string, unknown>;
      const values = [
        'bytesReceived',
        'samplesAccepted',
        'samplesPackaged',
        'samplesTrimmed',
      ].map((key) => counter(source[key]));
      if (values.some((value) => value === null)) return;
      renderer = {
        bytesReceived: values[0]!,
        samplesAccepted: values[1]!,
        samplesPackaged: values[2]!,
        samplesTrimmed: values[3]!,
      };
      record('sample', true);
    },
    writeStarted(source: 'mic' | 'system') {
      if (writes[source].pending++ === 0)
        writes[source].pendingSinceMs = Math.round(now() - started);
    },
    written(
      source: 'mic' | 'system',
      kind: 'raw' | 'complete',
      bytes: number,
      elapsedMs: number,
    ) {
      const state = writes[source];
      state.pending = Math.max(0, state.pending - 1);
      if (state.pending === 0) state.pendingSinceMs = null;
      if (kind === 'raw') state.rawBytes += bytes;
      else state.completed += 1;
      state.maxWriteMs = Math.max(state.maxWriteMs, Math.round(elapsedMs));
    },
    writeFailed(source: 'mic' | 'system', kind: 'raw' | 'complete') {
      writes[source].pending = Math.max(0, writes[source].pending - 1);
      if (writes[source].pending === 0) writes[source].pendingSinceMs = null;
      writes[source].failures += 1;
      event(kind === 'raw' ? 'raw_write_failed' : 'repair_write_failed');
    },
    stderr(chunk: string) {
      // Only our numeric protocol is retained. General native stderr is discarded.
      stderrPending = (stderrPending + chunk).slice(-8192);
      const lines = stderrPending.split('\n');
      stderrPending = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('[AudioCapHealth] ')) continue;
        try {
          const data = JSON.parse(line.slice(17));
          const framesWritten = counter(data.framesWritten);
          const tapGeneration = counter(data.tapGeneration);
          const retries = counter(data.retries);
          if (
            framesWritten === null ||
            tapGeneration === null ||
            retries === null
          )
            continue;
          native = { framesWritten, tapGeneration, retries };
          nativeReportedAtMs = Math.round(now() - started);
          const eventsByName: Record<string, CaptureEvent> = {
            stalled: 'native_stalled',
            restart: 'native_restart',
            route_change: 'native_route_change',
            format_change: 'native_format_change',
            write_failed: 'native_write_failed',
          };
          const name =
            typeof data.event === 'string' &&
            Object.hasOwn(eventsByName, data.event)
              ? eventsByName[data.event]
              : undefined;
          if (name) event(name);
          else if (data.event === 'heartbeat') record('sample');
        } catch {
          /* Malformed diagnostics cannot interrupt capture. */
        }
      }
    },
    event,
    async stop(reason: 'stopped' | 'owner_destroyed' = 'stopped') {
      record(reason);
      await flush(true);
    },
    snapshot,
  };
};
