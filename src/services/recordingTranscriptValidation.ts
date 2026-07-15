import {
  type AttributionSegment,
  type SpeakerActivityWindow,
} from '../utils/speakerAttribution';
import {
  type TranscriptIntegrityEvidence,
  type TranscriptIntegrityReason,
  reconcileCanonicalTranscript,
  validateTranscriptIntegrity,
} from '../utils/transcriptIntegrity';

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

const overlapSeconds = (
  left: Pick<AttributionSegment, 'startTime' | 'endTime'>,
  right: Pick<AttributionSegment, 'startTime' | 'endTime'>,
) =>
  Math.max(
    0,
    Math.min(left.endTime, right.endTime) -
      Math.max(left.startTime, right.startTime),
  );

const activitySeconds = (
  windows: SpeakerActivityWindow[],
  speaker: 'Me' | 'Them',
) =>
  windows
    .filter((window) => window.speaker === speaker)
    .reduce(
      (total, window) =>
        total + Math.max(0, window.endTime - window.startTime),
      0,
    );

const coveredActivitySeconds = (
  windows: SpeakerActivityWindow[],
  segments: AttributionSegment[],
  speaker: 'Me' | 'Them',
) =>
  windows
    .filter((window) => window.speaker === speaker)
    .reduce((total, window) => {
      const covered = segments
        .filter((segment) => segment.speaker === speaker)
        .reduce(
          (windowTotal, segment) =>
            windowTotal + overlapSeconds(window, segment),
          0,
        );
      return total + Math.min(window.endTime - window.startTime, covered);
    }, 0);

export type RecordingTranscriptValidationResult = {
  status: 'validated' | 'needs_attention';
  reasons: TranscriptIntegrityReason[];
  segments: AttributionSegment[];
  evidence: TranscriptIntegrityEvidence;
  attempts: Record<CanonicalSource, number>;
  transcriptionMeta: Partial<Record<CanonicalSource, Record<string, unknown>>>;
};

export const runRecordingTranscriptValidation = async (input: {
  meetingId: string;
  recordingDurationSeconds: number;
  micAudioPath: string;
  mixAudioPath: string;
  systemAudioPath: string;
  provisionalSegments: AttributionSegment[];
  activityWindows: SpeakerActivityWindow[];
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
      input.probeDuration(input.micAudioPath).catch(() => null),
      input.probeDuration(input.mixAudioPath).catch(() => null),
      input.probeDuration(input.systemAudioPath).catch(() => null),
    ]);

  const micSegments = toSegments(mic.result, 'Me', 'mic');
  const mixedSegments = toSegments(mix.result, 'Unknown', 'mix');
  const systemSegments = toSegments(system.result, 'Them', 'system');
  const reconciliation = reconcileCanonicalTranscript({
    mixedSegments,
    micSegments,
    systemSegments,
    provisionalSegments: input.provisionalSegments,
    activityWindows: input.activityWindows,
  });
  const micActivitySeconds = activitySeconds(input.activityWindows, 'Me');
  const systemActivitySeconds = activitySeconds(
    input.activityWindows,
    'Them',
  );
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
  const requiredSourcesSucceeded = Boolean(
    mic.result &&
      mix.result &&
      system.result &&
      micDuration != null &&
      mixDuration != null &&
      systemDuration != null,
  );
  const validation = validateTranscriptIntegrity({
    recordingDurationSeconds: input.recordingDurationSeconds,
    micAudioDurationSeconds: micDuration ?? 0,
    systemAudioDurationSeconds: systemDuration ?? 0,
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
  };
};
