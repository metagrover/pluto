import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { access, readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

import {
  type CaptureActivityEvidence,
  parseCaptureActivityEvidence,
} from '../src/utils/transcriptActivityEvidence.ts';
import { buildTranscriptJsonPayload } from '../src/utils/transcriptSchema.ts';
import type {
  TranscriptTrustCauseCode,
  TranscriptTrustEnvelopeV2,
} from '../src/utils/transcriptTrustState.ts';
import type {
  CaptureJournalEntry,
  CaptureJournalManifest,
  CaptureJournalSource,
} from './captureJournal.ts';
import { readCaptureJournalManifest } from './captureJournal.ts';
import type { PersistedMeeting } from './db.ts';

type RecoveryGapReason =
  | 'missing_artifact'
  | 'byte_count_mismatch'
  | 'checksum_mismatch';

type RecoveryGap = {
  source: CaptureJournalSource;
  sequence: number;
  reason: RecoveryGapReason;
};

type RecoverySourceSummary = {
  acknowledgedChunkCount: number;
  recoveredChunkCount: number;
  gapCount: number;
  recoveredAudioPath: string | null;
};

type RecoveryMeetingIntegrity = TranscriptTrustEnvelopeV2;

type RecoveryActivityEvidence = {
  evidenceProvenance: TranscriptTrustEnvelopeV2['evidenceProvenance'];
  activityEvidence?: CaptureActivityEvidence;
  causes: Array<{ code: TranscriptTrustCauseCode }>;
};

type TimedSegment = {
  path: string;
  startSec: number;
  endSec: number;
  chunkIndex?: number;
};

type RecoveryDependencies = {
  getMeeting: (meetingId: string) => PersistedMeeting | null | undefined;
  saveMeeting: (meeting: PersistedMeeting) => unknown | Promise<unknown>;
  stitchWavSegments: (
    segments: TimedSegment[],
    outputTag: string,
  ) => Promise<string | null>;
  nowMs?: number;
};

export type CaptureJournalRecoveryResult = {
  recoveredCount: number;
  failedRecoveryCount: number;
  skippedExistingCount: number;
  skippedSealedCount: number;
  skippedEmptyCount: number;
  skippedInvalidManifestCount: number;
};

const manifestExists = async (rootDir: string, meetingId: string) => {
  try {
    await access(join(rootDir, meetingId, 'capture-journal', 'manifest.json'));
    return true;
  } catch {
    return false;
  }
};

const listCaptureJournalMeetingIds = async (rootDir: string) => {
  const entries = await readdir(rootDir, { withFileTypes: true });
  const meetingIds: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (await manifestExists(rootDir, entry.name)) {
      meetingIds.push(entry.name);
    }
  }
  return meetingIds.sort();
};

const computeChecksum = (data: Buffer) =>
  createHash('sha256').update(data).digest('hex');

const readManifestForRecovery = async (rootDir: string, meetingId: string) => {
  const manifestPath = join(
    rootDir,
    meetingId,
    'capture-journal',
    'manifest.json',
  );
  const rawManifest = JSON.parse(
    await readFile(manifestPath, 'utf8'),
  ) as CaptureJournalManifest;

  try {
    return await readCaptureJournalManifest(rootDir, meetingId);
  } catch (error) {
    if (rawManifest.schemaVersion !== 2) throw error;
    if (
      rawManifest.activityEvidence === undefined &&
      (error as Error).message === 'capture_activity_missing'
    ) {
      return rawManifest;
    }
    if (rawManifest.activityEvidence === undefined) throw error;
    const parsed = await parseCaptureActivityEvidence(
      rawManifest.activityEvidence,
    );
    if (parsed.ok || (error as Error).message !== parsed.reason) throw error;

    // Manifest validation reaches activity evidence only after validating the
    // journal identity, paths, and entry structure. Recovery may therefore
    // salvage audio while classifying an invalid evidence envelope below.
    return rawManifest;
  }
};

const getRecoveryActivityEvidence = async (
  manifest: CaptureJournalManifest,
): Promise<RecoveryActivityEvidence> => {
  if (manifest.schemaVersion === 1) {
    return {
      evidenceProvenance: { kind: 'legacy_provisional_segments' },
      causes: [{ code: 'capture_activity_missing' }],
    };
  }
  if (manifest.activityEvidence === undefined) {
    return {
      evidenceProvenance: { kind: 'missing' },
      causes: [{ code: 'capture_activity_missing' }],
    };
  }

  const parsed = await parseCaptureActivityEvidence(manifest.activityEvidence);
  if (parsed.ok) {
    return {
      evidenceProvenance: {
        kind: 'sealed_capture_activity_v2',
        digestSha256: parsed.evidence.digestSha256,
      },
      activityEvidence: parsed.evidence,
      causes: [],
    };
  }
  if (parsed.reason === 'unsupported') {
    return {
      evidenceProvenance: { kind: 'unsupported', sourceVersion: 'unknown' },
      causes: [{ code: 'capture_activity_unsupported' }],
    };
  }
  return {
    evidenceProvenance: { kind: 'corrupt' },
    causes: [{ code: 'capture_activity_corrupt' }],
  };
};

const buildSourceSegments = async (
  rootDir: string,
  entries: CaptureJournalEntry[],
): Promise<{ segments: TimedSegment[]; gaps: RecoveryGap[] }> => {
  const segments: TimedSegment[] = [];
  const gaps: RecoveryGap[] = [];

  for (const entry of [...entries].sort(
    (left, right) => left.sequence - right.sequence,
  )) {
    const absolutePath = join(rootDir, entry.relativePath);
    try {
      await access(absolutePath, fsConstants.R_OK);
      const fileStats = await stat(absolutePath);
      if (fileStats.size !== entry.byteCount) {
        gaps.push({
          source: entry.source,
          sequence: entry.sequence,
          reason: 'byte_count_mismatch',
        });
        continue;
      }
      const fileData = await readFile(absolutePath);
      if (computeChecksum(fileData) !== entry.checksumSha256) {
        gaps.push({
          source: entry.source,
          sequence: entry.sequence,
          reason: 'checksum_mismatch',
        });
        continue;
      }
      segments.push({
        path: absolutePath,
        startSec: entry.chunkStartSec,
        endSec: entry.chunkEndSec,
        chunkIndex: entry.sequence,
      });
    } catch {
      gaps.push({
        source: entry.source,
        sequence: entry.sequence,
        reason: 'missing_artifact',
      });
    }
  }

  return { segments, gaps };
};

const getRecoveredDurationSeconds = (manifest: CaptureJournalManifest) => {
  return manifest.entries.reduce(
    (maxSeconds, entry) => Math.max(maxSeconds, entry.chunkEndSec),
    0,
  );
};

const buildRecoveredMeeting = (params: {
  manifest: CaptureJournalManifest;
  nowMs: number;
  micAudioPath: string | null;
  systemAudioPath: string | null;
  integrity: RecoveryMeetingIntegrity;
  existingMeeting?: PersistedMeeting | null;
}): PersistedMeeting => {
  const recoveredDurationSeconds = getRecoveredDurationSeconds(params.manifest);
  const startedAtMs = params.manifest.startedAtMs;
  const endedAtMs =
    params.manifest.endedAtMs ??
    startedAtMs + Math.round(recoveredDurationSeconds * 1000);

  const recoveredMeeting: PersistedMeeting = {
    id: params.manifest.meetingId,
    title: 'Recovered recording',
    meeting_type: 'Recording',
    started_at: new Date(startedAtMs).toISOString(),
    ended_at: new Date(Math.max(startedAtMs, endedAtMs)).toISOString(),
    duration_seconds: Math.max(0, Math.round(recoveredDurationSeconds)),
    audio_path: params.micAudioPath,
    system_audio_path: params.systemAudioPath,
    mixed_audio_path: null,
    transcript_status: 'needs_attention',
    transcript_integrity_json: JSON.stringify(params.integrity),
    transcript_validated_at: null,
    transcript_json: JSON.stringify(
      buildTranscriptJsonPayload([], {
        canonicalSource: 'mic',
        postHydrationBleedPass: false,
        lifecycleStatus: 'needs_attention',
      }),
    ),
    user_notes: '',
    enhanced_notes: null,
    analysis_json: null,
    value_signals_json: null,
    folder_id: null,
    is_favorite: false,
    end_reason: 'interrupted',
    created_at: new Date(params.nowMs).toISOString(),
    finalization_status: 'finalized',
    finalization_error_category: null,
  };
  if (!params.existingMeeting) return recoveredMeeting;

  return {
    ...params.existingMeeting,
    ...recoveredMeeting,
    title: params.existingMeeting.title || recoveredMeeting.title,
    user_notes:
      params.existingMeeting.user_notes ?? recoveredMeeting.user_notes,
    end_reason:
      params.existingMeeting.end_reason || recoveredMeeting.end_reason,
    created_at:
      params.existingMeeting.created_at ?? recoveredMeeting.created_at,
    folder_id: params.existingMeeting.folder_id,
    is_favorite: params.existingMeeting.is_favorite,
  };
};

export const recoverInterruptedCaptureJournals = async (
  rootDir: string,
  deps: RecoveryDependencies,
): Promise<CaptureJournalRecoveryResult> => {
  const result: CaptureJournalRecoveryResult = {
    recoveredCount: 0,
    failedRecoveryCount: 0,
    skippedExistingCount: 0,
    skippedSealedCount: 0,
    skippedEmptyCount: 0,
    skippedInvalidManifestCount: 0,
  };

  const nowMs = deps.nowMs ?? Date.now();
  const meetingIds = await listCaptureJournalMeetingIds(rootDir);

  for (const meetingId of meetingIds) {
    let manifest: CaptureJournalManifest;
    try {
      manifest = await readManifestForRecovery(rootDir, meetingId);
    } catch {
      result.skippedInvalidManifestCount += 1;
      continue;
    }

    const existingMeeting = deps.getMeeting(manifest.meetingId);
    const isRecoveryRequiredMeeting =
      existingMeeting?.finalization_status === 'recovery_required';
    if (
      manifest.lifecycleState === 'sealed' &&
      existingMeeting &&
      !isRecoveryRequiredMeeting
    ) {
      result.skippedSealedCount += 1;
      continue;
    }

    if (existingMeeting && !isRecoveryRequiredMeeting) {
      result.skippedExistingCount += 1;
      continue;
    }

    try {
      const micEntries = manifest.entries.filter(
        (entry) => entry.source === 'mic',
      );
      const systemEntries = manifest.entries.filter(
        (entry) => entry.source === 'system',
      );

      const [micRecovery, systemRecovery] = await Promise.all([
        buildSourceSegments(rootDir, micEntries),
        buildSourceSegments(rootDir, systemEntries),
      ]);
      const activityEvidence = await getRecoveryActivityEvidence(manifest);

      const micAudioPath =
        micRecovery.segments.length > 0
          ? await deps.stitchWavSegments(
              micRecovery.segments,
              `${manifest.meetingId}-mic-recovered`,
            )
          : null;
      const systemAudioPath =
        systemRecovery.segments.length > 0
          ? await deps.stitchWavSegments(
              systemRecovery.segments,
              `${manifest.meetingId}-system-recovered`,
            )
          : null;

      if (!micAudioPath && !systemAudioPath) {
        result.skippedEmptyCount += 1;
        continue;
      }

      const micHasGap = micRecovery.gaps.length > 0;
      const systemHasGap = systemRecovery.gaps.length > 0;
      const gapDetected = micHasGap || systemHasGap;
      const sourceScope =
        micHasGap && systemHasGap
          ? ('multiple' as const)
          : micHasGap
            ? ('mic' as const)
            : systemHasGap
              ? ('system' as const)
              : ('multiple' as const);
      const integrity: RecoveryMeetingIntegrity = {
        schemaVersion: 2,
        state: 'needs_attention',
        causes: [
          ...(gapDetected
            ? [{ code: 'capture_gap_detected' as const, sourceScope }]
            : [{ code: 'recovered_awaiting_validation' as const }]),
          ...activityEvidence.causes,
        ],
        evidenceProvenance: activityEvidence.evidenceProvenance,
        ...(activityEvidence.activityEvidence
          ? { activityEvidence: activityEvidence.activityEvidence }
          : {}),
        recovery: {
          source: 'capture_journal',
          gapDetected,
          sourceScope,
          acknowledgedChunkCount: micEntries.length + systemEntries.length,
          recoveredChunkCount:
            micRecovery.segments.length + systemRecovery.segments.length,
        },
      };

      await deps.saveMeeting(
        buildRecoveredMeeting({
          manifest,
          nowMs,
          micAudioPath,
          systemAudioPath,
          integrity,
          existingMeeting,
        }),
      );
      result.recoveredCount += 1;
    } catch {
      result.failedRecoveryCount += 1;
    }
  }

  return result;
};
