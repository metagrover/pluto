import type { LiveTranscriptSegment } from '../../components/features/recordingWorkspaceModel';
import { createAudioResampler } from '../../utils/audioResampler';
import type { LiveSource } from './contracts';
import { decodeJournalAudio } from './decodeJournalAudio';
import { createEouRendererSession } from './eouRendererSession';
import type { LiveEchoEvidenceWindow } from './liveEchoEvidence';

export type LiveJournalAudio = { latestEndSeconds: number } & (
  | { kind: 'waiting' }
  | { kind: 'gap'; endSeconds: number }
  | {
      kind: 'audio';
      data: Uint8Array;
      startSeconds: number;
      endSeconds: number;
    }
);
export type LiveRecoveryStatus = 'active' | 'catching_up' | 'reconnecting';
type SessionOptions = Parameters<typeof createEouRendererSession>[0];
type ClockSpan = {
  inputStart: number;
  inputEnd: number;
  start: number;
  end: number;
};
const SOURCES: LiveSource[] = ['mic', 'system'];

/** The capture journal is the queue. Restarts only replace the inference session. */
export function createDurableEouSession(
  options: Omit<SessionOptions, 'sampleRates' | 'onUnavailable'> & {
    readAudio(
      source: LiveSource,
      fromSeconds: number,
    ): Promise<LiveJournalAudio>;
    onStatus(status: LiveRecoveryStatus): void;
    onUnavailable(code: string): void;
    decodeAudio?: typeof decodeJournalAudio;
    stallTimeoutMs?: number;
    startTimeoutMs?: number;
    pollMs?: number;
    retryMs?: number;
  },
) {
  let closed = false;
  let started = false;
  let epoch = 0;
  let nextGeneration = options.generation;
  let current: ReturnType<typeof createEouRendererSession> | null = null;
  let running: Promise<void> | null = null;
  let status: LiveRecoveryStatus = 'active';
  let latestSegments: LiveTranscriptSegment[] = [];
  let latestEvidence: LiveEchoEvidenceWindow[] = [];
  const retainedEvidence = new Map<string, LiveEchoEvidenceWindow>();
  const confirmed = new Map<string, LiveTranscriptSegment>();
  const noOverlap = { mic: false, system: false };
  const waiters = new Set<() => void>();
  const publishStatus = (next: LiveRecoveryStatus) => {
    status = next;
    if (!closed) options.onStatus(next);
  };
  const wait = (ms: number) =>
    new Promise<void>((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        waiters.delete(finish);
        resolve();
      };
      const timer = setTimeout(finish, ms);
      waiters.add(finish);
      if (closed) finish();
    });
  const wake = () => {
    for (const finish of [...waiters]) finish();
  };
  const bounded = async <T>(work: Promise<T>, ms: number): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        work,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('parakeet_progress_timeout')),
            ms,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };

  const run = async () => {
    let failures = 0;
    while (!closed) {
      const ownedEpoch = ++epoch;
      const epochStartedAt = Date.now();
      const cutoffs = { mic: 0, system: 0 };
      for (const segment of confirmed.values()) {
        const source = segment.source as LiveSource;
        cutoffs[source] = Math.max(
          cutoffs[source],
          (segment.endTimestampMs ?? segment.timestampMs) / 1000,
        );
      }
      const cursors = {
        mic: Math.max(0, cutoffs.mic - (noOverlap.mic ? 0 : 1)),
        system: Math.max(0, cutoffs.system - (noOverlap.system ? 0 : 1)),
      };
      const rates = { mic: 16000, system: 16000 };
      const spans: Record<LiveSource, ClockSpan[]> = { mic: [], system: [] };
      const behind = { mic: false, system: false };
      const mappedCache = new WeakMap<
        LiveTranscriptSegment,
        LiveTranscriptSegment | null
      >();
      let failure: string | null = null;
      const owns = () => epoch === ownedEpoch;
      const mapTime = (source: LiveSource, ms: number) => {
        const seconds = ms / 1000;
        const clock = spans[source];
        let low = 0;
        let high = clock.length;
        while (low < high) {
          const middle = (low + high) >>> 1;
          if (seconds < clock[middle].inputEnd - 0.000001) high = middle;
          else low = middle + 1;
        }
        const span = clock[low] ?? clock.at(-1);
        if (!span) return ms;
        return (
          (span.start +
            ((seconds - span.inputStart) * (span.end - span.start)) /
              (span.inputEnd - span.inputStart)) *
          1000
        );
      };
      const session = createEouRendererSession({
        ...options,
        generation: nextGeneration++,
        sampleRates: { mic: () => rates.mic, system: () => rates.system },
        onUnavailable: (code) => {
          failure = code;
          wake();
        },
        onSegments: (segments, evidence, reason) => {
          if (!owns()) return;
          const mapped: LiveTranscriptSegment[] = [];
          for (const segment of segments) {
            if (mappedCache.has(segment)) {
              const cached = mappedCache.get(segment);
              if (cached) mapped.push(cached);
              continue;
            }
            const source = segment.source as LiveSource;
            const cutoffMs = cutoffs[source] * 1000;
            let row = {
              ...segment,
              timestampMs: mapTime(source, segment.timestampMs),
              endTimestampMs: mapTime(
                source,
                segment.endTimestampMs ?? segment.timestampMs,
              ),
              wordTimings: segment.wordTimings?.map((word) => ({
                ...word,
                timestampMs: mapTime(source, word.timestampMs),
                endTimestampMs: mapTime(source, word.endTimestampMs),
              })),
            };
            if (row.endTimestampMs <= cutoffMs + 0.001) {
              mappedCache.set(segment, null);
              continue;
            }
            if (row.timestampMs < cutoffMs - 0.001) {
              if (!row.wordTimings?.length) {
                // Without word boundaries, resume exactly at the stable cutoff.
                noOverlap[source] = true;
                failure = 'parakeet_overlap_unaligned';
                continue;
              }
              const words = row.wordTimings.filter(
                (word) => word.endTimestampMs > cutoffMs + 0.001,
              );
              if (!words.length) continue;
              const text = words.map((word) => word.text).join(' ');
              row = {
                ...row,
                text,
                rawText: text,
                wordTimings: words,
                timestampMs: words[0].timestampMs,
                endTimestampMs: words.at(-1)!.endTimestampMs,
              };
            }
            mappedCache.set(segment, row);
            mapped.push(row);
          }
          if (failure) return;
          latestSegments = [...confirmed.values(), ...mapped].sort(
            (a, b) => a.timestampMs - b.timestampMs,
          );
          // The inference clock is remapped to journal time; echo windows need the same map.
          latestEvidence = [
            ...retainedEvidence.values(),
            ...evidence.map((window) => ({
              ...window,
              micStartMs: mapTime('mic', window.micStartMs),
              micEndMs: mapTime('mic', window.micEndMs),
              systemStartMs: mapTime('system', window.systemStartMs),
              systemEndMs: mapTime('system', window.systemEndMs),
            })),
          ];
          options.onSegments(latestSegments, latestEvidence, reason);
          publishStatus(behind.mic || behind.system ? 'catching_up' : 'active');
        },
      });
      current = session;
      const check = () => {
        if (failure) throw new Error(failure);
      };
      const feed = async (source: LiveSource) => {
        while (!closed && owns()) {
          check();
          const chunk = await bounded(
            options.readAudio(source, cursors[source]),
            options.stallTimeoutMs ?? 30000,
          );
          if (closed || !owns()) return;
          check();
          behind[source] = chunk.latestEndSeconds - cursors[source] > 8;
          publishStatus(behind.mic || behind.system ? 'catching_up' : 'active');
          if (chunk.kind === 'waiting') {
            await wait(options.pollMs ?? 500);
            continue;
          }
          if (chunk.kind === 'gap') {
            cursors[source] = chunk.endSeconds;
            continue;
          }
          const decoded = await bounded(
            (options.decodeAudio ?? decodeJournalAudio)(chunk.data),
            options.stallTimeoutMs ?? 30000,
          );
          if (closed || !owns()) return;
          if (spans[source].length && rates[source] !== decoded.sampleRate) {
            decoded.samples = createAudioResampler({
              inputSampleRate: decoded.sampleRate,
              outputSampleRate: rates[source],
            }).process(decoded.samples);
            decoded.sampleRate = rates[source];
          }
          rates[source] = decoded.sampleRate;
          const start = Math.max(chunk.startSeconds, cursors[source]);
          const offset = Math.round(
            ((start - chunk.startSeconds) /
              (chunk.endSeconds - chunk.startSeconds)) *
              decoded.samples.length,
          );
          const samples = decoded.samples.subarray(offset);
          if (!samples.length) throw new Error('parakeet_journal_empty');
          const inputStart = spans[source].at(-1)?.inputEnd ?? start;
          spans[source].push({
            inputStart,
            inputEnd: inputStart + samples.length / rates[source],
            start,
            end: chunk.endSeconds,
          });
          const frameLength = Math.round(rates[source] * 0.32);
          for (
            let i = 0;
            i < samples.length && !closed && owns();
            i += frameLength
          ) {
            check();
            session.append(source, samples.slice(i, i + frameLength), {
              captureStartSeconds: inputStart + i / rates[source],
            });
            await bounded(session.drain(), options.stallTimeoutMs ?? 30000);
            check();
          }
          if (!closed && owns()) {
            cursors[source] = chunk.endSeconds;
          }
        }
      };
      let workers: Promise<void>[] = [];
      try {
        await bounded(session.start(), options.startTimeoutMs ?? 120000);
        check();
        if (!closed) {
          workers = SOURCES.map(feed);
          await Promise.all(workers);
        }
      } catch (error) {
        if (!closed) {
          if (Date.now() - epochStartedAt > 60000) failures = 0;
          publishStatus('reconnecting');
          options.onUnavailable(
            error instanceof Error
              ? error.message
              : 'parakeet_live_unavailable',
          );
        }
      } finally {
        if (!closed) {
          for (const segment of latestSegments)
            if (segment.confirmed) confirmed.set(segment.id, segment);
          for (const window of latestEvidence)
            retainedEvidence.set(
              `${window.micStartMs}:${window.micEndMs}:${window.systemStartMs}:${window.systemEndMs}`,
              window,
            );
          ++epoch; // Fence pending reads, callbacks and the other source before replacement.
          wake();
          await session.cancel();
          await Promise.allSettled(workers);
        }
      }
      if (!closed)
        await wait(
          Math.min(
            15000,
            (options.retryMs ?? 1000) * 2 ** Math.min(failures++, 4),
          ),
        );
    }
  };

  return {
    start(): Promise<void> {
      if (started) throw new Error('parakeet_session_invalid');
      started = true;
      running = run();
      return Promise.resolve();
    },
    async finish(): Promise<void> {
      closed = true;
      wake();
      try {
        await current?.finish({ timeoutMs: options.finishTimeoutMs ?? 8000 });
      } finally {
        ++epoch;
        await current?.cancel();
      }
    },
    async cancel(): Promise<void> {
      closed = true;
      ++epoch;
      wake();
      await current?.cancel();
    },
    status: () => (closed ? 'finished' : status),
    // Exposed for deterministic lifecycle checks; capture never awaits this loop.
    settled: () => running ?? Promise.resolve(),
  };
}
