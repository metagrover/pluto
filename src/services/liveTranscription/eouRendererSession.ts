import type { LiveTranscriptSegment } from '../../components/features/recordingWorkspaceModel';
import type { LiveSource } from './contracts';
import {
  type EouPcmChunker,
  type EouRendererFrame,
  createEouPcmChunker,
} from './eouPcmChunker';
import {
  type ParakeetEouUpdate,
  createEouTranscriptProjection,
} from './eouTranscriptProjection';
import {
  type LiveEchoEvidenceWindow,
  createLiveEchoEvidence,
} from './liveEchoEvidence';

export type EouRendererTransport = {
  invoke(channel: string, payload: unknown): Promise<unknown>;
  onUpdate(listener: (payload: unknown) => void): () => void;
  onUnavailable(listener: (payload: unknown) => void): () => void;
};

type SessionStatus =
  | 'idle'
  | 'starting'
  | 'ready'
  | 'finishing'
  | 'finished'
  | 'unavailable';

const SOURCES: readonly LiveSource[] = ['mic', 'system'];
const DEFAULT_MAX_OUTSTANDING = 48;
const DEFAULT_MAX_RETAINED_AUDIO_SECONDS_PER_SOURCE = 20;
const DEFAULT_MAX_RETAINED_PCM_BYTES = 8 * 1024 * 1024; // 8 MiB
const DEFAULT_FINISH_TIMEOUT_MS = 8_000;
const MEETING_ID_PATTERN =
  /^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,126}[A-Za-z0-9])?$/;

export function createEouRendererSession(options: {
  meetingId: string;
  generation: number;
  sampleRates: Record<LiveSource, number | (() => number)>;
  transport: EouRendererTransport;
  nowSeconds?: () => number;
  maxOutstanding?: number;
  maxRetainedAudioSecondsPerSource?: number;
  maxRetainedPcmBytes?: number;
  finishTimeoutMs?: number;
  onSegments(
    segments: LiveTranscriptSegment[],
    echoEvidence: LiveEchoEvidenceWindow[],
    reason: 'recognition' | 'echo_evidence',
  ): void;
  onUnavailable(code: string): void;
}) {
  if (
    !MEETING_ID_PATTERN.test(options.meetingId) ||
    options.meetingId.includes('..') ||
    !Number.isSafeInteger(options.generation) ||
    options.generation <= 0 ||
    (options.maxRetainedAudioSecondsPerSource !== undefined &&
      (!Number.isFinite(options.maxRetainedAudioSecondsPerSource) ||
        options.maxRetainedAudioSecondsPerSource <= 0)) ||
    (options.maxRetainedPcmBytes !== undefined &&
      (!Number.isSafeInteger(options.maxRetainedPcmBytes) ||
        options.maxRetainedPcmBytes <= 0)) ||
    (options.finishTimeoutMs !== undefined &&
      (!Number.isFinite(options.finishTimeoutMs) ||
        options.finishTimeoutMs <= 0))
  ) {
    throw new Error('parakeet_request_invalid');
  }
  const maxRetainedAudioSecondsPerSource =
    options.maxRetainedAudioSecondsPerSource ??
    (options.maxOutstanding !== undefined &&
    options.maxOutstanding !== DEFAULT_MAX_OUTSTANDING
      ? options.maxOutstanding * 0.32
      : DEFAULT_MAX_RETAINED_AUDIO_SECONDS_PER_SOURCE);
  const maxRetainedPcmBytes =
    options.maxRetainedPcmBytes ?? DEFAULT_MAX_RETAINED_PCM_BYTES;
  const finishTimeoutMs = options.finishTimeoutMs ?? DEFAULT_FINISH_TIMEOUT_MS;

  const projection = createEouTranscriptProjection();
  projection.reset(options.generation);
  const echoEvidence = createLiveEchoEvidence();
  let lastProjectedSegments: LiveTranscriptSegment[] = [];
  let currentStatus: SessionStatus = 'idle';
  let accepting = false;
  let startPromise: Promise<void> | null = null;
  let detachListeners: () => void = () => undefined;

  type PerSourceQueue = {
    frames: EouRendererFrame[];
    inFlight: EouRendererFrame | null;
    isPumping: boolean;
    drainWaiters: Array<{ resolve: () => void; reject: (err: Error) => void }>;
  };

  const queues: Record<LiveSource, PerSourceQueue> = {
    mic: { frames: [], inFlight: null, isPumping: false, drainWaiters: [] },
    system: { frames: [], inFlight: null, isPumping: false, drainWaiters: [] },
  };
  const sourceOffsetsSeconds: Record<LiveSource, number | null> = {
    mic: null,
    system: null,
  };

  const chunkers: Partial<Record<LiveSource, EouPcmChunker>> = {};

  const getSampleRate = (source: LiveSource): number => {
    const configured = options.sampleRates[source];
    const sampleRate =
      typeof configured === 'function' ? configured() : configured;
    if (
      !Number.isSafeInteger(sampleRate) ||
      sampleRate < 8_000 ||
      sampleRate > 192_000
    ) {
      throw new Error('parakeet_request_invalid');
    }
    return sampleRate;
  };

  const getSourceRetainedSamples = (source: LiveSource): number => {
    const q = queues[source];
    const queuedSamples = q.frames.reduce(
      (acc, f) => acc + f.samples.length,
      0,
    );
    const inFlightSamples = q.inFlight ? q.inFlight.samples.length : 0;
    const chunker = chunkers[source];
    const unframedSamples = chunker ? chunker.bufferedSamples() : 0;
    return queuedSamples + inFlightSamples + unframedSamples;
  };

  const getSourceRetainedDurationSeconds = (source: LiveSource): number => {
    const rate = getSampleRate(source);
    return getSourceRetainedSamples(source) / rate;
  };

  const getTotalRetainedBytes = (): number => {
    const micSamples = getSourceRetainedSamples('mic');
    const systemSamples = getSourceRetainedSamples('system');
    return (micSamples + systemSamples) * Float32Array.BYTES_PER_ELEMENT;
  };

  const fail = (code: string): void => {
    if (currentStatus === 'unavailable' || currentStatus === 'finished') return;
    currentStatus = 'unavailable';
    accepting = false;
    const error = new Error(code);
    for (const source of SOURCES) {
      queues[source].frames.length = 0;
      queues[source].inFlight = null;
      for (const waiter of queues[source].drainWaiters.splice(0)) {
        waiter.reject(error);
      }
      chunkers[source]?.reset();
    }
    echoEvidence.reset();
    lastProjectedSegments = [];
    detachListeners();
    options.onUnavailable(code);
    void options.transport
      .invoke('PARAKEET_EOU_CANCEL', {
        meetingId: options.meetingId,
        generation: options.generation,
        code,
      })
      .catch(() => undefined);
  };

  const wakePump = (source: LiveSource): void => {
    const q = queues[source];
    if (q.isPumping) return;
    if (currentStatus !== 'ready' && currentStatus !== 'finishing') return;
    if (q.frames.length === 0) {
      if (q.inFlight === null) {
        for (const waiter of q.drainWaiters.splice(0)) waiter.resolve();
      }
      return;
    }

    q.isPumping = true;
    void (async () => {
      try {
        while (
          q.frames.length > 0 &&
          (currentStatus === 'ready' || currentStatus === 'finishing')
        ) {
          const frame = q.frames[0];
          q.inFlight = frame;

          const sourceOffset = sourceOffsetsSeconds[frame.source];
          if (sourceOffset !== null) {
            const evidenceChanged = echoEvidence.append({
              source: frame.source,
              sampleRate: frame.sampleRate,
              samples: frame.samples,
              startTimeMs: (sourceOffset + frame.audioStartSeconds) * 1_000,
              endTimeMs: (sourceOffset + frame.audioEndSeconds) * 1_000,
            });
            if (evidenceChanged && lastProjectedSegments.length > 0) {
              options.onSegments(
                lastProjectedSegments,
                echoEvidence.snapshot(),
                'echo_evidence',
              );
            }
          }

          try {
            await options.transport.invoke('PARAKEET_EOU_APPEND', {
              meetingId: options.meetingId,
              generation: options.generation,
              ...frame,
            });
          } catch {
            fail('parakeet_live_unavailable');
            return;
          }

          if (isUnavailable()) return;

          q.frames.shift();
          q.inFlight = null;

          if (q.frames.length === 0) {
            for (const waiter of q.drainWaiters.splice(0)) waiter.resolve();
          }
        }
      } finally {
        q.isPumping = false;
        if (
          q.frames.length > 0 &&
          (currentStatus === 'ready' || currentStatus === 'finishing')
        ) {
          wakePump(source);
        } else if (q.frames.length === 0 && q.inFlight === null) {
          for (const waiter of q.drainWaiters.splice(0)) waiter.resolve();
        }
      }
    })();
  };

  const chunkerFor = (source: LiveSource): EouPcmChunker => {
    const existing = chunkers[source];
    if (existing) return existing;
    const sampleRate = getSampleRate(source);
    const created = createEouPcmChunker({
      source,
      sampleRate,
      onFrame: (frame) => {
        queues[frame.source].frames.push(frame);
        if (currentStatus === 'ready' || currentStatus === 'finishing') {
          wakePump(frame.source);
        }
      },
    });
    chunkers[source] = created;
    return created;
  };

  const unsubscribeUpdate = options.transport.onUpdate((payload) => {
    if (
      (currentStatus !== 'ready' && currentStatus !== 'finishing') ||
      !isUpdatePayload(payload, options)
    )
      return;
    try {
      lastProjectedSegments = projection.apply(
        payload.event,
        sourceOffsetsSeconds[payload.event.source] ?? 0,
      );
      options.onSegments(
        lastProjectedSegments,
        echoEvidence.snapshot(),
        'recognition',
      );
    } catch (error) {
      fail(
        error instanceof Error && error.message === 'parakeet_prefix_mutated'
          ? error.message
          : 'parakeet_event_invalid',
      );
    }
  });
  const unsubscribeUnavailable = options.transport.onUnavailable((payload) => {
    if (!isUnavailablePayload(payload, options)) return;
    fail(payload.code);
  });
  detachListeners = (): void => {
    unsubscribeUpdate();
    unsubscribeUnavailable();
  };
  const isUnavailable = (): boolean => currentStatus === 'unavailable';

  const ensureSourceOffset = (
    source: LiveSource,
    samplesLength: number,
  ): void => {
    if (sourceOffsetsSeconds[source] === null) {
      const nowSeconds = options.nowSeconds?.() ?? 0;
      const sampleRate = getSampleRate(source);
      const offset = Math.max(0, nowSeconds - samplesLength / sampleRate);
      if (
        !Number.isFinite(nowSeconds) ||
        nowSeconds < 0 ||
        !Number.isFinite(offset)
      ) {
        throw new Error('parakeet_request_invalid');
      }
      sourceOffsetsSeconds[source] = offset;
    }
  };

  const drainAll = async (): Promise<void> => {
    if (currentStatus === 'unavailable') return;
    if (currentStatus === 'starting' && startPromise) {
      try {
        await startPromise;
      } catch {
        if (isUnavailable()) return;
        throw new Error('parakeet_session_invalid');
      }
    }
    if (isUnavailable()) return;
    const promises: Promise<void>[] = [];
    for (const source of SOURCES) {
      const q = queues[source];
      if (q.frames.length > 0 || q.inFlight !== null) {
        promises.push(
          new Promise<void>((resolve, reject) => {
            q.drainWaiters.push({ resolve, reject });
          }),
        );
      }
    }
    await Promise.all(promises);
  };

  return {
    start(): Promise<void> {
      if (currentStatus !== 'idle') throw new Error('parakeet_session_invalid');
      currentStatus = 'starting';
      startPromise = (async () => {
        try {
          await options.transport.invoke('PARAKEET_EOU_START', {
            meetingId: options.meetingId,
            generation: options.generation,
          });
        } catch {
          fail('parakeet_live_unavailable');
          throw new Error('parakeet_live_unavailable');
        }
        if (isUnavailable()) {
          throw new Error('parakeet_live_unavailable');
        }
        if (currentStatus === 'starting') {
          currentStatus = 'ready';
          accepting = true;
        }
        for (const source of SOURCES) {
          wakePump(source);
        }
      })();
      return startPromise;
    },
    append(source: LiveSource, samples: Float32Array): void {
      if (
        currentStatus !== 'starting' &&
        (!accepting || currentStatus !== 'ready')
      ) {
        return;
      }
      try {
        if (!(samples instanceof Float32Array) || samples.length === 0) {
          throw new Error('parakeet_request_invalid');
        }
        for (const sample of samples) {
          if (!Number.isFinite(sample)) {
            throw new Error('parakeet_request_invalid');
          }
        }
        const sampleRate = getSampleRate(source);

        const incomingSamples = samples.length;
        const incomingDurationSeconds = incomingSamples / sampleRate;
        const incomingBytes = incomingSamples * Float32Array.BYTES_PER_ELEMENT;

        const currentSourceDuration = getSourceRetainedDurationSeconds(source);
        const currentTotalBytes = getTotalRetainedBytes();

        if (
          currentSourceDuration + incomingDurationSeconds >
            maxRetainedAudioSecondsPerSource ||
          currentTotalBytes + incomingBytes > maxRetainedPcmBytes
        ) {
          fail('parakeet_backpressure');
          return;
        }

        ensureSourceOffset(source, samples.length);
        chunkerFor(source).append(samples);
      } catch {
        fail('parakeet_request_invalid');
      }
    },
    drain: drainAll,
    async finish(finishOptions?: { timeoutMs?: number }): Promise<void> {
      if (currentStatus === 'finished' || currentStatus === 'unavailable')
        return;
      if (currentStatus !== 'ready' && currentStatus !== 'starting') {
        throw new Error('parakeet_session_invalid');
      }
      accepting = false;
      currentStatus = 'finishing';

      const timeout = finishOptions?.timeoutMs ?? finishTimeoutMs;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const timeoutPromise = new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => resolve('timeout'), timeout);
      });

      const finishWork = (async (): Promise<'completed'> => {
        if (startPromise) {
          try {
            await startPromise;
          } catch {
            if (isUnavailable()) return 'completed';
            throw new Error('parakeet_session_invalid');
          }
        }
        if (isUnavailable()) return 'completed';

        for (const source of SOURCES) {
          chunkers[source]?.flush();
        }
        for (const source of SOURCES) {
          wakePump(source);
        }
        await drainAll();
        if (isUnavailable()) return 'completed';

        try {
          await options.transport.invoke('PARAKEET_EOU_FINISH', {
            meetingId: options.meetingId,
            generation: options.generation,
          });
          currentStatus = 'finished';
          detachListeners();
        } catch {
          fail('parakeet_live_unavailable');
        }
        return 'completed';
      })();

      try {
        const outcome = await Promise.race([finishWork, timeoutPromise]);
        if (outcome === 'timeout') {
          fail('parakeet_timeout');
        }
      } catch {
        fail('parakeet_live_unavailable');
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
    cancel(): void {
      fail('parakeet_cancelled');
    },
    status(): SessionStatus {
      return currentStatus;
    },
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const isUpdatePayload = (
  payload: unknown,
  identity: { meetingId: string; generation: number },
): payload is {
  meetingId: string;
  generation: number;
  event: ParakeetEouUpdate;
} =>
  isRecord(payload) &&
  payload.meetingId === identity.meetingId &&
  payload.generation === identity.generation &&
  isRecord(payload.event) &&
  payload.event.generation === identity.generation &&
  (payload.event.source === 'mic' || payload.event.source === 'system') &&
  payload.event.streamId ===
    `eou-${identity.meetingId}-${payload.event.source}`;

const isUnavailablePayload = (
  payload: unknown,
  identity: { meetingId: string; generation: number },
): payload is { meetingId: string; generation: number; code: string } =>
  isRecord(payload) &&
  payload.meetingId === identity.meetingId &&
  payload.generation === identity.generation &&
  typeof payload.code === 'string' &&
  payload.code.length > 0;
