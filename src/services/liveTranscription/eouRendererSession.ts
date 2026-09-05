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
  | 'ready'
  | 'finishing'
  | 'finished'
  | 'unavailable';

type SourceDispatch = {
  outstanding: number;
  tail: Promise<void>;
};

const SOURCES: readonly LiveSource[] = ['mic', 'system'];
const MAX_OUTSTANDING = 4;
const MEETING_ID_PATTERN =
  /^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,126}[A-Za-z0-9])?$/;

export function createEouRendererSession(options: {
  meetingId: string;
  generation: number;
  sampleRates: Record<LiveSource, number | (() => number)>;
  transport: EouRendererTransport;
  nowSeconds?: () => number;
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
    options.generation <= 0
  ) {
    throw new Error('parakeet_request_invalid');
  }
  const projection = createEouTranscriptProjection();
  projection.reset(options.generation);
  const echoEvidence = createLiveEchoEvidence();
  let lastProjectedSegments: LiveTranscriptSegment[] = [];
  let currentStatus: SessionStatus = 'idle';
  let accepting = false;
  let detachListeners: () => void = () => undefined;
  const dispatch: Record<LiveSource, SourceDispatch> = {
    mic: { outstanding: 0, tail: Promise.resolve() },
    system: { outstanding: 0, tail: Promise.resolve() },
  };
  const sourceOffsetsSeconds: Record<LiveSource, number | null> = {
    mic: null,
    system: null,
  };

  const fail = (code: string): void => {
    if (currentStatus === 'unavailable' || currentStatus === 'finished') return;
    currentStatus = 'unavailable';
    accepting = false;
    echoEvidence.reset();
    lastProjectedSegments = [];
    detachListeners();
    options.onUnavailable(code);
    void options.transport
      .invoke('PARAKEET_EOU_CANCEL', {
        meetingId: options.meetingId,
        generation: options.generation,
      })
      .catch(() => undefined);
  };

  const sendFrame = (frame: EouRendererFrame): void => {
    if (currentStatus !== 'ready' && currentStatus !== 'finishing') return;
    const source = dispatch[frame.source];
    if (source.outstanding >= MAX_OUTSTANDING) {
      fail('parakeet_backpressure');
      return;
    }
    const sourceOffset = sourceOffsetsSeconds[frame.source];
    if (sourceOffset !== null) {
      const evidenceChanged = echoEvidence.append({
        source: frame.source,
        sampleRate: frame.sampleRate,
        samples: frame.samples,
        startTimeMs: (sourceOffset + frame.audioStartSeconds) * 1_000,
        endTimeMs: (sourceOffset + frame.audioEndSeconds) * 1_000,
      });
      // Acoustic corroboration can arrive after the final ASR revision. Refresh
      // its presentation when support changes, without waiting for more speech.
      if (evidenceChanged && lastProjectedSegments.length > 0) {
        options.onSegments(
          lastProjectedSegments,
          echoEvidence.snapshot(),
          'echo_evidence',
        );
      }
    }
    source.outstanding += 1;
    const operation = source.tail.then(async () => {
      if (currentStatus === 'unavailable') return;
      try {
        await options.transport.invoke('PARAKEET_EOU_APPEND', {
          meetingId: options.meetingId,
          generation: options.generation,
          ...frame,
        });
      } catch {
        fail('parakeet_live_unavailable');
      }
    });
    source.tail = operation.finally(() => {
      source.outstanding = Math.max(0, source.outstanding - 1);
    });
  };

  const chunkers: Partial<Record<LiveSource, EouPcmChunker>> = {};
  const chunkerFor = (source: LiveSource): EouPcmChunker => {
    const existing = chunkers[source];
    if (existing) return existing;
    const configured = options.sampleRates[source];
    const sampleRate =
      typeof configured === 'function' ? configured() : configured;
    const created = createEouPcmChunker({
      source,
      sampleRate,
      onFrame: sendFrame,
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

  return {
    async start(): Promise<void> {
      if (currentStatus !== 'idle') throw new Error('parakeet_session_invalid');
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
      currentStatus = 'ready';
      accepting = true;
    },
    append(source: LiveSource, samples: Float32Array): void {
      if (!accepting || currentStatus !== 'ready') return;
      try {
        if (sourceOffsetsSeconds[source] === null) {
          const nowSeconds = options.nowSeconds?.() ?? 0;
          const configuredSampleRate = options.sampleRates[source];
          const sampleRate =
            typeof configuredSampleRate === 'function'
              ? configuredSampleRate()
              : configuredSampleRate;
          const offset = Math.max(0, nowSeconds - samples.length / sampleRate);
          if (
            !Number.isFinite(nowSeconds) ||
            nowSeconds < 0 ||
            !Number.isFinite(offset)
          ) {
            throw new Error('parakeet_request_invalid');
          }
          sourceOffsetsSeconds[source] = offset;
        }
        chunkerFor(source).append(samples);
      } catch {
        fail('parakeet_request_invalid');
      }
    },
    async drain(): Promise<void> {
      await Promise.all(SOURCES.map((source) => dispatch[source].tail));
    },
    async finish(): Promise<void> {
      if (currentStatus !== 'ready') {
        if (currentStatus === 'unavailable') return;
        throw new Error('parakeet_session_invalid');
      }
      accepting = false;
      currentStatus = 'finishing';
      for (const source of SOURCES) chunkers[source]?.flush();
      await Promise.all(SOURCES.map((source) => dispatch[source].tail));
      if (isUnavailable()) return;
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
