import type {
  AttributionSegment,
  SpeakerActivityWindow,
} from '../utils/speakerAttribution.ts';
import {
  type TranscriptIntegrityEvidence,
  type TranscriptIntegrityReason,
  reconcileCanonicalTranscript,
  validateTranscriptIntegrity,
} from '../utils/transcriptIntegrity.ts';

type RawWhisperSegment = {
  start: number;
  end: number;
  text: string;
  words?: Array<{ word: string; start: number; end: number }>;
};

type TranscriptionResult = {
  segments?: RawWhisperSegment[];
  meta?: Record<string, unknown>;
};

type CanonicalSource = 'mic' | 'mix' | 'system';

export type RecordingTranscribe = (
  audioPath: string,
  options: { meetingId: string; canonicalSource: CanonicalSource },
) => Promise<TranscriptionResult>;

type SourceResult = {
  attempts: number;
  result: TranscriptionResult | null;
};

const transcribeWithRetry = async (
  transcribe: RecordingTranscribe,
  audioPath: string,
  meetingId: string,
  canonicalSource: CanonicalSource,
): Promise<SourceResult> => {
  if (!audioPath) return { attempts: 0, result: null };
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      return {
        attempts: attempt,
        result: await transcribe(audioPath, { meetingId, canonicalSource }),
      };
    } catch {
      if (attempt === 2) return { attempts: attempt, result: null };
    }
  }
  return { attempts: 2, result: null };
};

const probeDuration = async (
  probe: (audioPath: string) => Promise<number | null>,
  audioPath: string,
): Promise<number | null> => {
  if (!audioPath) return null;
  return probe(audioPath).catch(() => null);
};

const toSegments = (
  result: TranscriptionResult | null,
  speaker: 'Me' | 'Them' | 'Unknown',
  source: CanonicalSource,
): AttributionSegment[] =>
  (result?.segments || [])
    .filter(
      (segment) =>
        Number.isFinite(segment.start) &&
        Number.isFinite(segment.end) &&
        segment.end > segment.start &&
        segment.text.trim().length > 0,
    )
    .map((segment, index) => ({
      id: `${source}-${index}-${segment.start}`,
      startTime: segment.start,
      endTime: segment.end,
      text: segment.text.trim(),
      speaker,
      words: segment.words,
    }));

type TimelineInterval = { start: number; end: number };

const mergeIntervals = (intervals: TimelineInterval[]): TimelineInterval[] => {
  const sorted = intervals
    .filter((interval) => interval.end > interval.start)
    .sort((left, right) => left.start - right.start);
  const merged: TimelineInterval[] = [];
  for (const interval of sorted) {
    const prior = merged.at(-1);
    if (!prior || interval.start > prior.end) {
      merged.push({ ...interval });
    } else {
      prior.end = Math.max(prior.end, interval.end);
    }
  }
  return merged;
};

const speakerActivityIntervals = (
  windows: SpeakerActivityWindow[],
  speaker: 'Me' | 'Them',
) =>
  mergeIntervals(
    windows
      .filter((window) => window.speaker === speaker)
      .map((window) => ({ start: window.startTime, end: window.endTime })),
  );

const activitySeconds = (
  windows: SpeakerActivityWindow[],
  speaker: 'Me' | 'Them',
) =>
  speakerActivityIntervals(windows, speaker).reduce(
    (total, interval) => total + interval.end - interval.start,
    0,
  );

const coveredActivitySeconds = (
  windows: SpeakerActivityWindow[],
  segments: AttributionSegment[],
  speaker: 'Me' | 'Them',
) => {
  const activity = speakerActivityIntervals(windows, speaker);
  const transcript = mergeIntervals(
    segments
      .filter((segment) => segment.speaker === speaker)
      .map((segment) => ({
        start: segment.startTime,
        end: segment.endTime,
      })),
  );

  return activity.reduce(
    (total, active) =>
      total +
      transcript.reduce(
        (covered, segment) =>
          covered +
          Math.max(
            0,
            Math.min(active.end, segment.end) -
              Math.max(active.start, segment.start),
          ),
        0,
      ),
    0,
  );
};

export type RecordingTranscriptValidationResult = {
  status: 'validated' | 'needs_attention';
  reasons: TranscriptIntegrityReason[];
  segments: AttributionSegment[];
  evidence: TranscriptIntegrityEvidence;
  attempts: Record<CanonicalSource, number>;
  transcriptionMeta: Partial<Record<CanonicalSource, Record<string, unknown>>>;
  sourceSegmentCounts: Record<CanonicalSource, number>;
};

export const runRecordingTranscriptValidation = async (input: {
  meetingId: string;
  recordingDurationSeconds: number;
  micAudioPath: string;
  mixAudioPath: string;
  systemAudioPath: string;
  provisionalSegments: AttributionSegment[];
  activityWindows: SpeakerActivityWindow[];
  canonicalMode?: 'full_mix' | 'recovered_channels';
  transcribe: RecordingTranscribe;
  probeDuration: (audioPath: string) => Promise<number | null>;
}): Promise<RecordingTranscriptValidationResult> => {
  const [mic, mix, system, micDuration, mixDuration, systemDuration] =
    await Promise.all([
      transcribeWithRetry(
        input.transcribe,
        input.micAudioPath,
        input.meetingId,
        'mic',
      ),
      transcribeWithRetry(
        input.transcribe,
        input.mixAudioPath,
        input.meetingId,
        'mix',
      ),
      transcribeWithRetry(
        input.transcribe,
        input.systemAudioPath,
        input.meetingId,
        'system',
      ),
      probeDuration(input.probeDuration, input.micAudioPath),
      probeDuration(input.probeDuration, input.mixAudioPath),
      probeDuration(input.probeDuration, input.systemAudioPath),
    ]);

  const micSegments = toSegments(mic.result, 'Me', 'mic');
  const mixedSegments = toSegments(mix.result, 'Unknown', 'mix');
  const systemSegments = toSegments(system.result, 'Them', 'system');
  const recoveredChannelSegments = [...micSegments, ...systemSegments].sort(
    (left, right) => left.startTime - right.startTime,
  );
  const reconciliation = reconcileCanonicalTranscript({
    mixedSegments:
      input.canonicalMode === 'recovered_channels'
        ? recoveredChannelSegments
        : mixedSegments,
    micSegments,
    systemSegments,
    provisionalSegments: input.provisionalSegments,
    activityWindows: input.activityWindows,
  });
  const micActivitySeconds = activitySeconds(input.activityWindows, 'Me');
  const systemActivitySeconds = activitySeconds(input.activityWindows, 'Them');
  const localTranscriptCoveredSeconds = coveredActivitySeconds(
    input.activityWindows,
    reconciliation.segments,
    'Me',
  );
  const remoteTranscriptCoveredSeconds = coveredActivitySeconds(
    input.activityWindows,
    reconciliation.segments,
    'Them',
  );
  const recoveredChannels = input.canonicalMode === 'recovered_channels';
  const micRequired = micActivitySeconds > 0;
  const systemRequired = systemActivitySeconds > 0;
  const requiredSourcesSucceeded = recoveredChannels
    ? Boolean(
        (!micRequired || (mic.result && micDuration != null)) &&
          (!systemRequired || (system.result && systemDuration != null)) &&
          micSegments.length + systemSegments.length > 0,
      )
    : Boolean(
        mic.result &&
          mix.result &&
          system.result &&
          micDuration != null &&
          mixDuration != null &&
          systemDuration != null &&
          micSegments.length + mixedSegments.length + systemSegments.length > 0,
      );
  const validation = validateTranscriptIntegrity({
    recordingDurationSeconds: input.recordingDurationSeconds,
    micAudioDurationSeconds:
      recoveredChannels && !micRequired
        ? input.recordingDurationSeconds
        : (micDuration ?? 0),
    systemAudioDurationSeconds:
      recoveredChannels && !systemRequired
        ? input.recordingDurationSeconds
        : (systemDuration ?? 0),
    micActivitySeconds,
    systemActivitySeconds,
    localTranscriptCoveredSeconds,
    remoteTranscriptCoveredSeconds,
    unresolvedAmbiguousSeconds:
      reconciliation.evidence.unresolvedAmbiguousSeconds,
    requiredSourcesSucceeded,
  });
  const evidence: TranscriptIntegrityEvidence = {
    micActivitySeconds,
    systemActivitySeconds,
    localTranscriptCoveredSeconds,
    remoteTranscriptCoveredSeconds,
    unexplainedMicSeconds: Math.max(
      0,
      micActivitySeconds - localTranscriptCoveredSeconds,
    ),
    unexplainedSystemSeconds: Math.max(
      0,
      systemActivitySeconds - remoteTranscriptCoveredSeconds,
    ),
    collapsedPassThroughSeconds:
      reconciliation.evidence.collapsedPassThroughSeconds,
    unresolvedAmbiguousSeconds:
      reconciliation.evidence.unresolvedAmbiguousSeconds,
  };

  return {
    status: validation.status,
    reasons: validation.reasons,
    segments: reconciliation.segments,
    evidence,
    attempts: {
      mic: mic.attempts,
      mix: mix.attempts,
      system: system.attempts,
    },
    transcriptionMeta: {
      ...(mic.result?.meta ? { mic: mic.result.meta } : {}),
      ...(mix.result?.meta ? { mix: mix.result.meta } : {}),
      ...(system.result?.meta ? { system: system.result.meta } : {}),
    },
    sourceSegmentCounts: {
      mic: micSegments.length,
      mix: mixedSegments.length,
      system: systemSegments.length,
    },
  };
};
