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
import { collapseCrossChannelWordBleed } from './finalTranscription/collapseCrossChannelWordBleed.ts';
import {
  CROSS_CHANNEL_SKEW_POLICY_VERSION,
  type CrossChannelReconciliationMetadata,
} from './finalTranscription/crossChannelSkew.ts';

type RawWhisperSegment = {
  start: number;
  end: number;
  text: string;
  words?: Array<{ word: string; start: number; end: number }>;
};

type TranscriptionResult = {
  segments?: RawWhisperSegment[];
  meta?: Record<string, unknown>;
  vad?: {
    status?: 'speech' | 'no_speech' | 'failed';
    speechSeconds?: number;
  };
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
    } catch (error) {
      if (
        error instanceof Error &&
        (error.name === 'AbortError' || error.message === 'parakeet_cancelled')
      ) {
        throw error;
      }
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

const segmentSeconds = (segments: AttributionSegment[]) =>
  mergeIntervals(
    segments.map((segment) => ({
      start: segment.startTime,
      end: segment.endTime,
    })),
  ).reduce((total, interval) => total + interval.end - interval.start, 0);

const hasSuccessfulSourceResult = (
  source: SourceResult,
  segments: AttributionSegment[],
) =>
  segments.length > 0 ||
  source.result?.vad?.status === 'speech' ||
  source.result?.vad?.status === 'no_speech';

const hasExplicitVadProof = (source: SourceResult) =>
  source.result?.vad?.status === 'speech' ||
  source.result?.vad?.status === 'no_speech';

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
  sourceOutcomes: Record<
    CanonicalSource,
    'speech' | 'no_speech' | 'failed' | 'unknown'
  >;
  reconciliation: CrossChannelReconciliationMetadata;
};

const emptyCrossChannelReconciliation =
  (): CrossChannelReconciliationMetadata => ({
    policyVersion: CROSS_CHANNEL_SKEW_POLICY_VERSION,
    skewApplied: false,
    estimatedOffsetMs: 0,
    anchorCount: 0,
    confidence: 0,
    droppedMicWordCount: 0,
    collapsedSequenceCount: 0,
  });

const sourceOutcome = (
  source: SourceResult,
  segments: AttributionSegment[],
): 'speech' | 'no_speech' | 'failed' | 'unknown' => {
  if (!source.result || source.result.vad?.status === 'failed') return 'failed';
  if (source.result.vad?.status === 'no_speech') return 'no_speech';
  if (source.result.vad?.status === 'speech' || segments.length > 0)
    return 'speech';
  return 'unknown';
};

export const runRecordingTranscriptValidation = async (input: {
  meetingId: string;
  recordingDurationSeconds: number;
  micAudioPath: string;
  mixAudioPath: string;
  systemAudioPath: string;
  provisionalSegments: AttributionSegment[];
  checkpointSourceSegments?: AttributionSegment[];
  activityWindows: SpeakerActivityWindow[];
  canonicalMode?: 'full_mix' | 'recovered_channels' | 'checkpointed';
  transcriptionScheduling?: 'parallel' | 'sequential_channels';
  checkpointEvidenceVerified?: boolean;
  transcribe: RecordingTranscribe;
  probeDuration: (audioPath: string) => Promise<number | null>;
}): Promise<RecordingTranscriptValidationResult> => {
  if (input.canonicalMode === 'checkpointed') {
    const coverageSegments = input.checkpointSourceSegments?.length
      ? input.checkpointSourceSegments
      : input.provisionalSegments;
    const micActivitySeconds = activitySeconds(input.activityWindows, 'Me');
    const systemActivitySeconds = activitySeconds(
      input.activityWindows,
      'Them',
    );
    const localTranscriptCoveredSeconds = coveredActivitySeconds(
      input.activityWindows,
      coverageSegments,
      'Me',
    );
    const remoteTranscriptCoveredSeconds = coveredActivitySeconds(
      input.activityWindows,
      coverageSegments,
      'Them',
    );
    const validation = validateTranscriptIntegrity({
      recordingDurationSeconds: input.recordingDurationSeconds,
      micAudioDurationSeconds: input.recordingDurationSeconds,
      systemAudioDurationSeconds: input.recordingDurationSeconds,
      micActivitySeconds,
      systemActivitySeconds,
      localTranscriptCoveredSeconds,
      remoteTranscriptCoveredSeconds,
      unresolvedAmbiguousSeconds: 0,
      requiredSourcesSucceeded: input.checkpointEvidenceVerified === true,
    });
    return {
      status: validation.status,
      reasons: validation.reasons,
      segments: [...input.provisionalSegments].sort(
        (left, right) => left.startTime - right.startTime,
      ),
      evidence: {
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
        collapsedPassThroughSeconds: 0,
        unresolvedAmbiguousSeconds: 0,
      },
      attempts: { mic: 0, mix: 0, system: 0 },
      transcriptionMeta: {},
      sourceSegmentCounts: {
        mic: coverageSegments.filter((segment) => segment.speaker === 'Me')
          .length,
        mix: 0,
        system: coverageSegments.filter((segment) => segment.speaker === 'Them')
          .length,
      },
      sourceOutcomes: {
        mic: coverageSegments.some((segment) => segment.speaker === 'Me')
          ? 'speech'
          : 'unknown',
        mix: 'unknown',
        system: coverageSegments.some((segment) => segment.speaker === 'Them')
          ? 'speech'
          : 'unknown',
      },
      reconciliation: emptyCrossChannelReconciliation(),
    };
  }
  let mic: SourceResult;
  let mix: SourceResult;
  let system: SourceResult;
  if (input.transcriptionScheduling === 'sequential_channels') {
    mic = await transcribeWithRetry(
      input.transcribe,
      input.micAudioPath,
      input.meetingId,
      'mic',
    );
    system = await transcribeWithRetry(
      input.transcribe,
      input.systemAudioPath,
      input.meetingId,
      'system',
    );
    mix = { attempts: 0, result: null };
  } else {
    [mic, mix, system] = await Promise.all([
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
    ]);
  }
  const [micDuration, mixDuration, systemDuration] = await Promise.all([
    probeDuration(input.probeDuration, input.micAudioPath),
    probeDuration(input.probeDuration, input.mixAudioPath),
    probeDuration(input.probeDuration, input.systemAudioPath),
  ]);

  const rawMicSegments = toSegments(mic.result, 'Me', 'mic');
  const mixedSegments = toSegments(mix.result, 'Unknown', 'mix');
  const rawSystemSegments = toSegments(system.result, 'Them', 'system');
  const collapsedChannels =
    input.canonicalMode === 'recovered_channels'
      ? collapseCrossChannelWordBleed({
          micSegments: rawMicSegments,
          systemSegments: rawSystemSegments,
        })
      : {
          micSegments: rawMicSegments,
          systemSegments: rawSystemSegments,
          reconciliation: emptyCrossChannelReconciliation(),
        };
  const micSegments = collapsedChannels.micSegments;
  const systemSegments = collapsedChannels.systemSegments;
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
  const micSpeechSeconds = segmentSeconds(micSegments);
  const systemSpeechSeconds = segmentSeconds(systemSegments);
  // Preserved channel transcripts are the coverage proof. Canonical speaker
  // arbitration may relabel or deduplicate those words, but it cannot erase
  // the fact that ASR accounted for speech on the original source channel.
  const asrConfirmedLocalCoveredSeconds = micSpeechSeconds;
  const asrConfirmedRemoteCoveredSeconds = systemSpeechSeconds;
  const candidateLocalCoveredSeconds = coveredActivitySeconds(
    input.activityWindows,
    reconciliation.segments,
    'Me',
  );
  const candidateRemoteCoveredSeconds = coveredActivitySeconds(
    input.activityWindows,
    reconciliation.segments,
    'Them',
  );
  const micVadVerified = hasExplicitVadProof(mic);
  const systemVadVerified = hasExplicitVadProof(system);
  const micNoSpeechVerified = mic.result?.vad?.status === 'no_speech';
  const systemNoSpeechVerified = system.result?.vad?.status === 'no_speech';
  const recoveredChannels = input.canonicalMode === 'recovered_channels';
  const micRequired = micActivitySeconds > 0;
  const systemRequired = systemActivitySeconds > 0;
  const requiredSourcesSucceeded = recoveredChannels
    ? Boolean(
        (!micRequired ||
          (mic.result &&
            micDuration != null &&
            hasSuccessfulSourceResult(mic, micSegments))) &&
          (!systemRequired ||
            (system.result &&
              systemDuration != null &&
              hasSuccessfulSourceResult(system, systemSegments))),
      )
    : Boolean(
        mic.result &&
          mix.result &&
          system.result &&
          micDuration != null &&
          mixDuration != null &&
          systemDuration != null &&
          hasSuccessfulSourceResult(mic, micSegments) &&
          hasSuccessfulSourceResult(mix, mixedSegments) &&
          hasSuccessfulSourceResult(system, systemSegments),
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
    micActivitySeconds: micNoSpeechVerified ? 0 : micActivitySeconds,
    systemActivitySeconds: systemNoSpeechVerified ? 0 : systemActivitySeconds,
    localTranscriptCoveredSeconds: micVadVerified
      ? asrConfirmedLocalCoveredSeconds
      : candidateLocalCoveredSeconds,
    remoteTranscriptCoveredSeconds: systemVadVerified
      ? asrConfirmedRemoteCoveredSeconds
      : candidateRemoteCoveredSeconds,
    collapsedPassThroughSeconds:
      reconciliation.evidence.collapsedPassThroughSeconds,
    unresolvedAmbiguousSeconds:
      reconciliation.evidence.unresolvedAmbiguousSeconds,
    requiredSourcesSucceeded,
  });
  const evidence: TranscriptIntegrityEvidence = {
    micActivitySeconds,
    systemActivitySeconds,
    localTranscriptCoveredSeconds: candidateLocalCoveredSeconds,
    remoteTranscriptCoveredSeconds: candidateRemoteCoveredSeconds,
    unexplainedMicSeconds: micNoSpeechVerified
      ? 0
      : micVadVerified
        ? Math.max(
            0,
            micActivitySeconds -
              asrConfirmedLocalCoveredSeconds -
              reconciliation.evidence.collapsedPassThroughSeconds,
          )
        : Math.max(0, micActivitySeconds - candidateLocalCoveredSeconds),
    unexplainedSystemSeconds: systemNoSpeechVerified
      ? 0
      : systemVadVerified
        ? Math.max(0, systemActivitySeconds - asrConfirmedRemoteCoveredSeconds)
        : Math.max(0, systemActivitySeconds - candidateRemoteCoveredSeconds),
    rejectedMicCandidateSeconds: micVadVerified
      ? Math.max(0, micActivitySeconds - micSpeechSeconds)
      : 0,
    rejectedSystemCandidateSeconds: systemVadVerified
      ? Math.max(0, systemActivitySeconds - systemSpeechSeconds)
      : 0,
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
    sourceOutcomes: {
      mic: sourceOutcome(mic, micSegments),
      mix: sourceOutcome(mix, mixedSegments),
      system: sourceOutcome(system, systemSegments),
    },
    reconciliation: collapsedChannels.reconciliation,
  };
};
