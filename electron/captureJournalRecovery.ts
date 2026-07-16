import { access, readdir, stat } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { join } from 'node:path';

import { buildTranscriptJsonPayload } from '../src/utils/transcriptSchema';
import type { PersistedMeeting } from './db';
import type {
  CaptureJournalEntry,
  CaptureJournalManifest,
  CaptureJournalSource,
} from './captureJournal';
import { readCaptureJournalManifest } from './captureJournal';

type RecoveryGapReason = 'missing_artifact' | 'byte_count_mismatch';

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

type RecoveryMeetingIntegrity = {
  recovery_source: 'capture_journal';
  journal_lifecycle_state: CaptureJournalManifest['lifecycleState'];
  gap_detected: boolean;
  recovered_at: string;
  recovered_sources: Record<CaptureJournalSource, RecoverySourceSummary>;
  recovery_gaps: RecoveryGap[];
};

type TimedSegment = {
  path: string;
  startSec: number;
  endSec: number;
  chunkIndex?: number;
};

type RecoveryDependencies = {
  getMeeting: (meetingId: string) => PersistedMeeting | null | undefined;
  saveMeeting: (meeting: PersistedMeeting) => unknown;
  stitchWavSegments: (
    segments: TimedSegment[],
    outputTag: string,
  ) => Promise<string | null>;
  nowMs?: number;
};

export type CaptureJournalRecoveryResult = {
  recoveredCount: number;
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

const buildSourceSegments = async (
  rootDir: string,
  entries: CaptureJournalEntry[],
): Promise<{ segments: TimedSegment[]; gaps: RecoveryGap[] }> => {
  const segments: TimedSegment[] = [];
  const gaps: RecoveryGap[] = [];

  for (const entry of [...entries].sort((left, right) => left.sequence - right.sequence)) {
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
}): PersistedMeeting => {
  const recoveredDurationSeconds = getRecoveredDurationSeconds(params.manifest);
  const startedAtMs = params.manifest.startedAtMs;
  const endedAtMs =
    params.manifest.endedAtMs ??
    startedAtMs + Math.round(recoveredDurationSeconds * 1000);

  return {
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
  };
};

export const recoverInterruptedCaptureJournals = async (
  rootDir: string,
  deps: RecoveryDependencies,
): Promise<CaptureJournalRecoveryResult> => {
  const result: CaptureJournalRecoveryResult = {
    recoveredCount: 0,
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
      manifest = await readCaptureJournalManifest(rootDir, meetingId);
    } catch {
      result.skippedInvalidManifestCount += 1;
      continue;
    }

    if (manifest.lifecycleState === 'sealed') {
      result.skippedSealedCount += 1;
      continue;
    }

    if (deps.getMeeting(manifest.meetingId)) {
      result.skippedExistingCount += 1;
      continue;
    }

    const micEntries = manifest.entries.filter((entry) => entry.source === 'mic');
    const systemEntries = manifest.entries.filter(
      (entry) => entry.source === 'system',
    );

    const [micRecovery, systemRecovery] = await Promise.all([
      buildSourceSegments(rootDir, micEntries),
      buildSourceSegments(rootDir, systemEntries),
    ]);

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

    const integrity: RecoveryMeetingIntegrity = {
      recovery_source: 'capture_journal',
      journal_lifecycle_state: manifest.lifecycleState,
      gap_detected:
        micRecovery.gaps.length > 0 || systemRecovery.gaps.length > 0,
      recovered_at: new Date(nowMs).toISOString(),
      recovered_sources: {
        mic: {
          acknowledgedChunkCount: micEntries.length,
          recoveredChunkCount: micRecovery.segments.length,
          gapCount: micRecovery.gaps.length,
          recoveredAudioPath: micAudioPath,
        },
        system: {
          acknowledgedChunkCount: systemEntries.length,
          recoveredChunkCount: systemRecovery.segments.length,
          gapCount: systemRecovery.gaps.length,
          recoveredAudioPath: systemAudioPath,
        },
      },
      recovery_gaps: [...micRecovery.gaps, ...systemRecovery.gaps],
    };

    deps.saveMeeting(
      buildRecoveredMeeting({
        manifest,
        nowMs,
        micAudioPath,
        systemAudioPath,
        integrity,
      }),
    );
    result.recoveredCount += 1;
  }

  return result;
};
