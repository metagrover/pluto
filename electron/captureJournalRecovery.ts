import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { access, readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

import {
  type TranscriptAcceptanceFrame,
  type TranscriptCheckpointCandidate,
  finalizeTranscriptCheckpoints,
} from '../src/services/transcriptCheckpointFinalization.ts';
import { resolveCrossChannelDuplicates } from '../src/utils/speakerAttribution.ts';
import {
  type CaptureActivityEvidence,
  parseCaptureActivityEvidence,
} from '../src/utils/transcriptActivityEvidence.ts';
import { canonicalizeTranscriptCheckpointConfig } from '../src/utils/transcriptCheckpointConfig.ts';
import { buildTranscriptJsonPayload } from '../src/utils/transcriptSchema.ts';
import type {
  TranscriptTrustCauseCode,
  TranscriptTrustEnvelopeV2,
} from '../src/utils/transcriptTrustState.ts';
import type {
  CaptureJournalEntry,
  CaptureJournalManifest,
  CaptureJournalManifestV3,
  CaptureJournalManifestV4,
  CaptureJournalSource,
} from './captureJournal.ts';
import {
  appendCaptureTranscriptAcceptanceFrame,
  appendCaptureTranscriptCheckpoint,
  completeCaptureJournalCapturedChunk,
  getCaptureJournalAudioKey,
  readCaptureJournalManifest,
  readCaptureJournalSidecar,
  replaceCaptureTranscriptCheckpoint,
  sealCaptureJournal,
  stopCaptureJournal,
} from './captureJournal.ts';
import { EncryptedArtifactStore } from './crypto/encryptedArtifactStore.ts';
import {
  materializeEncryptedJournalSource,
  repairEncryptedJournalRawChunk,
} from './crypto/encryptedAudioPipeline.ts';
import type { PersistedMeeting } from './db.ts';
import { normalizeCheckpointWords } from './recoveryTranscriptionAudio.ts';

type RecoveryGapReason =
  | 'missing_artifact'
  | 'byte_count_mismatch'
  | 'checksum_mismatch';

type RecoveryGap = {
  source: CaptureJournalSource;
  sequence: number;
  reason: RecoveryGapReason;
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
  minimumStartedAtMs?: number;
  getMeeting: (meetingId: string) => PersistedMeeting | null | undefined;
  saveMeeting: (meeting: PersistedMeeting) => unknown | Promise<unknown>;
  stitchWavSegments: (
    segments: TimedSegment[],
    outputTag: string,
  ) => Promise<string | null>;
  mixWavSources?: (
    inputPaths: string[],
    outputTag: string,
    meetingId?: string,
  ) => Promise<string | null>;
  nowMs?: number;
  repairRawChunk?: (inputPath: string) => Promise<Buffer | null>;
  transcribeChunk?: (
    inputPath: string,
    config: {
      backend: string;
      preset: string;
      model: string;
      device: string;
      computeType: string;
      languageMode: 'fixed' | 'detected';
      requestedLanguage: string | null;
    },
    journalDurationSeconds: number,
    encryptedContext?: {
      meetingId: string;
      generation: string;
      keyId: string;
      meetingKey: Buffer;
      source: CaptureJournalSource;
    },
  ) => Promise<{
    detectedLanguage?: string | null;
    providerLabel?: string;
    segments: Array<{
      start: number;
      end: number;
      text: string;
      words?: Array<{ word: string; start: number; end: number }>;
    }>;
  }>;
  transcriptionConfig?: {
    backend: string;
    preset: string;
    model: string;
    device: string;
    computeType: string;
    languageMode: 'fixed' | 'detected';
    requestedLanguage: string | null;
    pipelineVersion: 'live_chunk_v1';
  };
};

type RecoveryTranscriptionConfig = NonNullable<
  RecoveryDependencies['transcriptionConfig']
>;

const getAcceptedRecoveryCheckpointConfigKeys = (
  config: RecoveryTranscriptionConfig,
): string[] => {
  const configs = [
    config,
    ...(isLegacyPreviewCheckpointConfig(config) &&
    (config.model === 'base' || config.model === 'tiny')
      ? [{ ...config, model: 'medium' }]
      : []),
  ];
  return configs.map((candidate) =>
    computeChecksum(
      Buffer.from(canonicalizeTranscriptCheckpointConfig(candidate)),
    ),
  );
};

export const isLegacyPreviewCheckpointConfig = (
  config: Pick<
    RecoveryTranscriptionConfig,
    'backend' | 'device' | 'computeType'
  >,
): boolean =>
  // Read-only compatibility for capture journals written before Parakeet.
  config.backend === 'mlx_preview' &&
  config.device === 'mlx' &&
  config.computeType === 'float16';

export type CaptureJournalRecoveryResult = {
  skippedBeforeCutoffCount?: number;
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

const measureCoveredActivitySeconds = (
  segments: unknown[],
  activityWindows: Array<{ startTime: number; endTime: number }>,
  chunkStartSec: number,
  chunkEndSec: number,
) => {
  const intersections: Array<{ start: number; end: number }> = [];
  for (const segment of segments) {
    if (!segment || typeof segment !== 'object') continue;
    const relativeStart = Number((segment as { start?: unknown }).start);
    const relativeEnd = Number((segment as { end?: unknown }).end);
    if (
      !Number.isFinite(relativeStart) ||
      !Number.isFinite(relativeEnd) ||
      relativeEnd <= relativeStart
    ) {
      continue;
    }
    const segmentStart = Math.max(chunkStartSec, chunkStartSec + relativeStart);
    const segmentEnd = Math.min(chunkEndSec, chunkStartSec + relativeEnd);
    for (const window of activityWindows) {
      const start = Math.max(segmentStart, window.startTime);
      const end = Math.min(segmentEnd, window.endTime);
      if (end > start) intersections.push({ start, end });
    }
  }
  intersections.sort((left, right) => left.start - right.start);
  let coveredSeconds = 0;
  let unionStart = 0;
  let unionEnd = 0;
  for (const intersection of intersections) {
    if (intersection.start > unionEnd) {
      coveredSeconds += Math.max(0, unionEnd - unionStart);
      unionStart = intersection.start;
      unionEnd = intersection.end;
    } else {
      unionEnd = Math.max(unionEnd, intersection.end);
    }
  }
  return coveredSeconds + Math.max(0, unionEnd - unionStart);
};

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
  if (manifest.schemaVersion === 3 || manifest.schemaVersion === 4) {
    return manifest.intervals.reduce(
      (maxSeconds, interval) => Math.max(maxSeconds, interval.chunkEndSec),
      0,
    );
  }
  return manifest.entries.reduce(
    (maxSeconds, entry) => Math.max(maxSeconds, entry.chunkEndSec),
    0,
  );
};

const buildV3SourceSegments = async (
  rootDir: string,
  manifest: CaptureJournalManifestV3,
  source: CaptureJournalSource,
): Promise<{ segments: TimedSegment[]; gaps: RecoveryGap[] }> => {
  const segments: TimedSegment[] = [];
  const gaps: RecoveryGap[] = [];
  for (const interval of manifest.intervals) {
    const disposition = interval.sources[source];
    if (
      disposition.disposition === 'verified_silence' ||
      disposition.disposition === 'source_unavailable'
    ) {
      continue;
    }
    if (disposition.disposition !== 'captured') {
      gaps.push({
        source,
        sequence: interval.sequence,
        reason: 'missing_artifact',
      });
      continue;
    }
    const absolutePath = join(rootDir, disposition.repairRelativePath);
    try {
      const fileData = await readFile(absolutePath);
      if (computeChecksum(fileData) !== disposition.repairChecksumSha256) {
        gaps.push({
          source,
          sequence: interval.sequence,
          reason: 'checksum_mismatch',
        });
        continue;
      }
      segments.push({
        path: absolutePath,
        startSec: interval.chunkStartSec,
        endSec: interval.chunkEndSec,
        chunkIndex: interval.sequence,
      });
    } catch {
      gaps.push({
        source,
        sequence: interval.sequence,
        reason: 'missing_artifact',
      });
    }
  }
  return { segments, gaps };
};

const buildV4SourceSegments = (
  rootDir: string,
  manifest: CaptureJournalManifestV4,
  source: CaptureJournalSource,
): { segments: TimedSegment[]; gaps: RecoveryGap[] } => {
  const segments: TimedSegment[] = [];
  const gaps: RecoveryGap[] = [];
  for (const interval of manifest.intervals) {
    const disposition = interval.sources[source];
    if (
      disposition.disposition === 'verified_silence' ||
      disposition.disposition === 'source_unavailable'
    ) {
      continue;
    }
    if (disposition.disposition !== 'captured') {
      gaps.push({
        source,
        sequence: interval.sequence,
        reason: 'missing_artifact',
      });
      continue;
    }
    segments.push({
      path: join(rootDir, disposition.repairRelativePath),
      startSec: interval.chunkStartSec,
      endSec: interval.chunkEndSec,
      chunkIndex: interval.sequence,
    });
  }
  return { segments, gaps };
};

export const stitchSealedCaptureJournalSource = async (
  rootDir: string,
  meetingId: string,
  source: CaptureJournalSource,
  stitchWavSegments: RecoveryDependencies['stitchWavSegments'],
  outputTag: string,
  signal?: AbortSignal,
): Promise<string | null> => {
  const manifest = await readCaptureJournalManifest(rootDir, meetingId);
  if (
    (manifest.schemaVersion !== 3 && manifest.schemaVersion !== 4) ||
    manifest.lifecycleState !== 'sealed'
  ) {
    return null;
  }
  if (manifest.schemaVersion === 4) {
    const meetingKey = await getCaptureJournalAudioKey(manifest.meetingId);
    if (!meetingKey) throw new Error('audio_key_unavailable');
    return await materializeEncryptedJournalSource({
      rootDir,
      manifest,
      source,
      meetingKey,
      signal,
    });
  }
  const recovery = await buildV3SourceSegments(rootDir, manifest, source);
  if (recovery.gaps.length > 0) {
    throw new Error(`sealed_capture_${source}_artifact_gap`);
  }
  if (recovery.segments.length === 0) return null;
  return await stitchWavSegments(recovery.segments, outputTag);
};

const repairV3TranscriptGaps = async (
  rootDir: string,
  initialManifest: CaptureJournalManifestV3 | CaptureJournalManifestV4,
  transcribeChunk: NonNullable<RecoveryDependencies['transcribeChunk']>,
  fallbackConfig?: RecoveryDependencies['transcriptionConfig'],
  meetingKey?: Buffer,
): Promise<CaptureJournalManifestV3 | CaptureJournalManifestV4> => {
  let manifest: CaptureJournalManifestV3 | CaptureJournalManifestV4 =
    initialManifest;
  const templateRef = manifest.transcriptCheckpoints[0];
  const templateSidecar = templateRef
    ? (JSON.parse(
        (
          await readCaptureJournalSidecar(
            rootDir,
            manifest.meetingId,
            templateRef.relativePath,
            templateRef.transcriptChecksumSha256,
            { meetingKey },
          )
        ).toString('utf8'),
      ) as { transcriptionConfig: NonNullable<typeof fallbackConfig> })
    : fallbackConfig
      ? { transcriptionConfig: fallbackConfig }
      : null;
  if (!templateSidecar) return manifest;
  const targetConfig =
    !isLegacyPreviewCheckpointConfig(templateSidecar.transcriptionConfig) &&
    fallbackConfig
      ? fallbackConfig
      : templateSidecar.transcriptionConfig;
  const configKey = computeChecksum(
    Buffer.from(canonicalizeTranscriptCheckpointConfig(targetConfig)),
  );
  const acceptedConfigKeys = new Set(
    getAcceptedRecoveryCheckpointConfigKeys(targetConfig),
  );
  for (const interval of manifest.intervals) {
    const acceptedSpeechSources = await readAcceptedSpeechSources(
      rootDir,
      manifest,
      interval,
      meetingKey,
    );
    const inspections = new Map<
      CaptureJournalSource,
      {
        existing:
          | (
              | CaptureJournalManifestV3
              | CaptureJournalManifestV4
            )['transcriptCheckpoints'][number]
          | undefined;
        structurallyReusable: boolean;
        emptyWithActivity: boolean;
      }
    >();
    for (const source of ['mic', 'system'] as const) {
      const disposition = interval.sources[source];
      if (disposition.disposition !== 'captured') continue;
      const existing = manifest.transcriptCheckpoints.find(
        (checkpoint) =>
          checkpoint.source === source &&
          checkpoint.sequence === interval.sequence,
      );
      let structurallyReusable = false;
      let emptyWithActivity = false;
      if (existing) {
        try {
          const bytes = await readCaptureJournalSidecar(
            rootDir,
            manifest.meetingId,
            existing.relativePath,
            existing.transcriptChecksumSha256,
            { meetingKey },
          );
          const sidecar = JSON.parse(bytes.toString('utf8')) as {
            transcriptionConfig: Record<string, unknown>;
            segments: unknown[];
          };
          const sourceActivityWindows =
            manifest.activityEvidence?.windows.filter(
              (window) =>
                window.speaker === (source === 'mic' ? 'Me' : 'Them') &&
                window.endTime > interval.chunkStartSec &&
                window.startTime < interval.chunkEndSec,
            ) ?? [];
          const activeSeconds = sourceActivityWindows.reduce(
            (total, window) =>
              total +
              Math.max(
                0,
                Math.min(window.endTime, interval.chunkEndSec) -
                  Math.max(window.startTime, interval.chunkStartSec),
              ),
            0,
          );
          const coveredSeconds = measureCoveredActivitySeconds(
            sidecar.segments,
            sourceActivityWindows,
            interval.chunkStartSec,
            interval.chunkEndSec,
          );
          const underCovered =
            activeSeconds >= 3 &&
            coveredSeconds / Math.max(activeSeconds, 0.001) < 0.35;
          emptyWithActivity =
            sidecar.segments.length === 0 && sourceActivityWindows.length > 0;
          const recomputedConfigKey = computeChecksum(
            Buffer.from(
              canonicalizeTranscriptCheckpointConfig(
                sidecar.transcriptionConfig,
              ),
            ),
          );
          structurallyReusable =
            acceptedConfigKeys.has(existing.transcriptionConfigKey) &&
            recomputedConfigKey === existing.transcriptionConfigKey &&
            !underCovered;
        } catch {
          structurallyReusable = false;
        }
      }
      inspections.set(source, {
        existing,
        structurallyReusable,
        emptyWithActivity,
      });
    }
    const stableAcceptedSpeechSources = new Set(
      [...acceptedSpeechSources].filter(
        (source) => inspections.get(source)?.structurallyReusable,
      ),
    );
    for (const source of ['mic', 'system'] as const) {
      const disposition = interval.sources[source];
      if (disposition.disposition !== 'captured') continue;
      const inspection = inspections.get(source);
      if (!inspection) continue;
      const correlatedSpeechAccepted = stableAcceptedSpeechSources.has(
        source === 'mic' ? 'system' : 'mic',
      );
      const reusable =
        inspection.structurallyReusable &&
        (!inspection.emptyWithActivity || correlatedSpeechAccepted);
      const existing = inspection.existing;
      if (
        reusable ||
        (existing?.repairAttempted &&
          acceptedConfigKeys.has(existing.transcriptionConfigKey))
      )
        continue;
      const inputPath = join(rootDir, disposition.repairRelativePath);
      const journalDurationSeconds =
        interval.chunkEndSec - interval.chunkStartSec;
      const result =
        manifest.schemaVersion === 4 && meetingKey
          ? await transcribeChunk(
              inputPath,
              targetConfig,
              journalDurationSeconds,
              {
                meetingId: manifest.meetingId,
                generation: manifest.generation,
                keyId: manifest.keyId,
                meetingKey,
                source,
              },
            )
          : await transcribeChunk(
              inputPath,
              targetConfig,
              journalDurationSeconds,
            );
      const normalizedSegments = normalizeCheckpointWords(
        result.segments,
        interval.chunkEndSec - interval.chunkStartSec,
      );
      const receipt = {
        meetingId: manifest.meetingId,
        generation: manifest.generation,
        manifestRevision: manifest.revision,
        source,
        sequence: interval.sequence,
        checksumSha256: disposition.repairChecksumSha256,
        chunkStartSec: interval.chunkStartSec,
        chunkEndSec: interval.chunkEndSec,
        repairAudioRelativePath: disposition.repairRelativePath,
      };
      const checkpointArgs = {
        receipt,
        expectedManifestRevision: manifest.revision,
        transcriptionConfigKey: configKey,
        sidecar: {
          schemaVersion: 1 as const,
          meetingId: manifest.meetingId,
          source,
          sequence: interval.sequence,
          chunkChecksumSha256: disposition.repairChecksumSha256,
          chunkStartSec: interval.chunkStartSec,
          chunkEndSec: interval.chunkEndSec,
          transcriptionConfig: targetConfig,
          backendResult: {
            detectedLanguage: result.detectedLanguage ?? null,
            providerLabel: result.providerLabel ?? 'local',
          },
          segments: normalizedSegments,
        },
        meetingKey,
      };
      const saved = existing
        ? await replaceCaptureTranscriptCheckpoint(rootDir, {
            ...checkpointArgs,
            expectedPriorTranscriptChecksumSha256:
              existing.transcriptChecksumSha256,
          })
        : await appendCaptureTranscriptCheckpoint(rootDir, checkpointArgs);
      manifest = saved.manifest;
      if (normalizedSegments.length > 0) {
        stableAcceptedSpeechSources.add(source);
      } else {
        stableAcceptedSpeechSources.delete(source);
      }
    }
  }

  for (const interval of manifest.intervals) {
    const existingFrame = manifest.acceptanceFrames.find(
      (frame) => frame.sequence === interval.sequence,
    );
    const activityInputs = {
      chunkStartSec: interval.chunkStartSec,
      chunkEndSec: interval.chunkEndSec,
      evidence: manifest.activityEvidence
        ? {
            clock: manifest.activityEvidence.clock,
            thresholds: manifest.activityEvidence.thresholds,
            algorithmVersion: manifest.activityEvidence.algorithmVersion,
            serializationVersion:
              manifest.activityEvidence.serializationVersion,
            windows: manifest.activityEvidence.windows.filter(
              (window) =>
                window.endTime > interval.chunkStartSec &&
                window.startTime < interval.chunkEndSec,
            ),
          }
        : null,
    };
    const currentMicDigest =
      manifest.transcriptCheckpoints.find(
        (checkpoint) =>
          checkpoint.source === 'mic' &&
          checkpoint.sequence === interval.sequence,
      )?.transcriptChecksumSha256 ?? null;
    const currentSystemDigest =
      manifest.transcriptCheckpoints.find(
        (checkpoint) =>
          checkpoint.source === 'system' &&
          checkpoint.sequence === interval.sequence,
      )?.transcriptChecksumSha256 ?? null;
    let existingFrameEvidenceValid = false;
    if (existingFrame) {
      try {
        const existingFrameBytes = await readCaptureJournalSidecar(
          rootDir,
          manifest.meetingId,
          existingFrame.relativePath,
          existingFrame.acceptedChecksumSha256,
          { meetingKey },
        );
        const existingFrameSidecar = JSON.parse(
          existingFrameBytes.toString('utf8'),
        ) as { arbitrationVersion?: unknown; activityInputs?: unknown };
        existingFrameEvidenceValid =
          existingFrame.arbitrationVersion === 'chunk_arbitration_v1' &&
          existingFrameSidecar.arbitrationVersion === 'chunk_arbitration_v1' &&
          computeChecksum(
            Buffer.from(JSON.stringify(existingFrameSidecar.activityInputs)),
          ) === existingFrame.activityEvidenceDigestSha256 &&
          acceptanceEvidenceMatchesSealedManifest(
            existingFrameSidecar.activityInputs,
            manifest,
            interval,
          );
      } catch {
        existingFrameEvidenceValid = false;
      }
    }
    if (
      existingFrame?.micCheckpointChecksumSha256 === currentMicDigest &&
      existingFrame?.systemCheckpointChecksumSha256 === currentSystemDigest &&
      existingFrameEvidenceValid
    ) {
      continue;
    }
    const frameSegments: Array<{
      source: CaptureJournalSource;
      start: number;
      end: number;
      text: string;
      words?: Array<{ word: string; start: number; end: number }>;
    }> = [];
    const checkpointDigests: Record<CaptureJournalSource, string | null> = {
      mic: null,
      system: null,
    };
    for (const source of ['mic', 'system'] as const) {
      const checkpoint = manifest.transcriptCheckpoints.find(
        (candidate) =>
          candidate.source === source &&
          candidate.sequence === interval.sequence,
      );
      if (!checkpoint) continue;
      checkpointDigests[source] = checkpoint.transcriptChecksumSha256;
      const bytes = await readCaptureJournalSidecar(
        rootDir,
        manifest.meetingId,
        checkpoint.relativePath,
        checkpoint.transcriptChecksumSha256,
        { meetingKey },
      );
      const sidecar = JSON.parse(bytes.toString('utf8')) as {
        segments: Array<{
          start: number;
          end: number;
          text: string;
          words?: Array<{ word: string; start: number; end: number }>;
        }>;
      };
      frameSegments.push(
        ...sidecar.segments.map((segment) => ({
          source,
          start: segment.start + interval.chunkStartSec,
          end: segment.end + interval.chunkStartSec,
          text: segment.text,
          ...(segment.words
            ? {
                words: segment.words.map((word) => ({
                  word: word.word,
                  start: word.start + interval.chunkStartSec,
                  end: word.end + interval.chunkStartSec,
                })),
              }
            : {}),
        })),
      );
    }
    const reconciled = resolveCrossChannelDuplicates(
      frameSegments.map((segment, index) => ({
        id: `${segment.source}-${interval.sequence}-${index}`,
        startTime: segment.start,
        endTime: segment.end,
        text: segment.text,
        speaker: segment.source === 'mic' ? 'Me' : 'Them',
        ...(segment.words ? { words: segment.words } : {}),
      })),
    ).segments;
    frameSegments.splice(
      0,
      frameSegments.length,
      ...reconciled.map((segment) => ({
        source: (segment.speaker === 'Me'
          ? 'mic'
          : 'system') as CaptureJournalSource,
        start: segment.startTime,
        end: segment.endTime,
        text: segment.text,
        ...(segment.words ? { words: segment.words } : {}),
      })),
    );
    const activityEvidenceDigestSha256 = computeChecksum(
      Buffer.from(JSON.stringify(activityInputs)),
    );
    const saved = await appendCaptureTranscriptAcceptanceFrame(rootDir, {
      meetingId: manifest.meetingId,
      generation: manifest.generation,
      expectedRevision: manifest.revision,
      sequence: interval.sequence,
      micCheckpointChecksumSha256: checkpointDigests.mic,
      systemCheckpointChecksumSha256: checkpointDigests.system,
      activityEvidenceDigestSha256,
      sidecar: {
        schemaVersion: 1,
        meetingId: manifest.meetingId,
        sequence: interval.sequence,
        arbitrationVersion: 'chunk_arbitration_v1',
        activityInputs,
        segments: frameSegments,
      },
      meetingKey,
      ...(existingFrame
        ? {
            expectedPriorAcceptedChecksumSha256:
              existingFrame.acceptedChecksumSha256,
          }
        : {}),
    });
    manifest = saved.manifest;
  }
  return manifest;
};

export const repairStoppingCaptureJournalTranscript = async (
  rootDir: string,
  args: {
    meetingId: string;
    transcribeChunk: NonNullable<RecoveryDependencies['transcribeChunk']>;
    transcriptionConfig: NonNullable<
      RecoveryDependencies['transcriptionConfig']
    >;
  },
) => {
  const manifest = await readCaptureJournalManifest(rootDir, args.meetingId);
  if (
    (manifest.schemaVersion !== 3 && manifest.schemaVersion !== 4) ||
    manifest.lifecycleState !== 'stopping'
  ) {
    throw new Error('capture_journal_not_stopping');
  }
  const meetingKey =
    manifest.schemaVersion === 4
      ? await getCaptureJournalAudioKey(manifest.meetingId)
      : undefined;
  if (manifest.schemaVersion === 4 && !meetingKey) {
    throw new Error('audio_key_unavailable');
  }
  return await repairV3TranscriptGaps(
    rootDir,
    manifest,
    args.transcribeChunk,
    args.transcriptionConfig,
    meetingKey ?? undefined,
  );
};

const acceptanceEvidenceMatchesSealedManifest = (
  activityInputs: unknown,
  manifest: CaptureJournalManifestV3 | CaptureJournalManifestV4,
  interval: (
    | CaptureJournalManifestV3
    | CaptureJournalManifestV4
  )['intervals'][number],
) => {
  if (
    !manifest.activityEvidence ||
    !activityInputs ||
    typeof activityInputs !== 'object'
  ) {
    return false;
  }
  const evidence = (activityInputs as { evidence?: unknown }).evidence;
  if (!evidence || typeof evidence !== 'object') return false;
  const embedded = evidence as {
    clock?: unknown;
    thresholds?: unknown;
    algorithmVersion?: unknown;
    serializationVersion?: unknown;
    windows?: unknown;
  };
  if (
    JSON.stringify(embedded.clock) !==
      JSON.stringify(manifest.activityEvidence.clock) ||
    JSON.stringify(embedded.thresholds) !==
      JSON.stringify(manifest.activityEvidence.thresholds) ||
    embedded.algorithmVersion !== manifest.activityEvidence.algorithmVersion ||
    embedded.serializationVersion !==
      manifest.activityEvidence.serializationVersion ||
    !Array.isArray(embedded.windows)
  ) {
    return false;
  }
  return embedded.windows.every(
    (window) =>
      window !== null &&
      typeof window === 'object' &&
      Number((window as { endTime?: unknown }).endTime) >
        interval.chunkStartSec &&
      Number((window as { startTime?: unknown }).startTime) <
        interval.chunkEndSec &&
      manifest.activityEvidence?.windows.some(
        (sealed) => JSON.stringify(sealed) === JSON.stringify(window),
      ),
  );
};

async function readAcceptedSpeechSources(
  rootDir: string,
  manifest: CaptureJournalManifestV3 | CaptureJournalManifestV4,
  interval: (
    | CaptureJournalManifestV3
    | CaptureJournalManifestV4
  )['intervals'][number],
  meetingKey?: Buffer,
): Promise<Set<CaptureJournalSource>> {
  const frame = manifest.acceptanceFrames.find(
    (candidate) => candidate.sequence === interval.sequence,
  );
  if (!frame || frame.arbitrationVersion !== 'chunk_arbitration_v1') {
    return new Set();
  }
  for (const source of ['mic', 'system'] as const) {
    const disposition = interval.sources[source];
    const supplied =
      source === 'mic'
        ? frame.micCheckpointChecksumSha256
        : frame.systemCheckpointChecksumSha256;
    if (disposition.disposition === 'captured') {
      const checkpointMatches = manifest.transcriptCheckpoints.some(
        (checkpoint) =>
          checkpoint.source === source &&
          checkpoint.sequence === interval.sequence &&
          checkpoint.transcriptChecksumSha256 === supplied,
      );
      if (!checkpointMatches) return new Set();
    } else if (supplied !== null) {
      return new Set();
    }
  }
  try {
    const bytes = await readCaptureJournalSidecar(
      rootDir,
      manifest.meetingId,
      frame.relativePath,
      frame.acceptedChecksumSha256,
      { meetingKey },
    );
    const sidecar = JSON.parse(bytes.toString('utf8')) as {
      arbitrationVersion?: unknown;
      activityInputs?: unknown;
      segments?: Array<{ source?: unknown; text?: unknown }>;
    };
    const evidenceMatches =
      sidecar.arbitrationVersion === 'chunk_arbitration_v1' &&
      computeChecksum(Buffer.from(JSON.stringify(sidecar.activityInputs))) ===
        frame.activityEvidenceDigestSha256 &&
      acceptanceEvidenceMatchesSealedManifest(
        sidecar.activityInputs,
        manifest,
        interval,
      );
    if (!evidenceMatches || !Array.isArray(sidecar.segments)) return new Set();
    return new Set(
      sidecar.segments.flatMap((segment) =>
        (segment.source === 'mic' || segment.source === 'system') &&
        typeof segment.text === 'string' &&
        segment.text.trim()
          ? [segment.source]
          : [],
      ),
    );
  } catch {
    return new Set();
  }
}

const readV3AcceptedSegments = async (
  rootDir: string,
  manifest: CaptureJournalManifestV3 | CaptureJournalManifestV4,
  expectedConfigKeys?: string | string[],
  options: { allowCaptureFailures?: boolean; meetingKey?: Buffer } = {},
) => {
  const configKeys = new Set(
    manifest.transcriptCheckpoints.map(
      (checkpoint) => checkpoint.transcriptionConfigKey,
    ),
  );
  const checkpoints: TranscriptCheckpointCandidate[] = [];
  for (const reference of manifest.transcriptCheckpoints) {
    const interval = manifest.intervals.find(
      (candidate) => candidate.sequence === reference.sequence,
    );
    const disposition = interval?.sources[reference.source];
    const bytes = await readCaptureJournalSidecar(
      rootDir,
      manifest.meetingId,
      reference.relativePath,
      reference.transcriptChecksumSha256,
      { meetingKey: options.meetingKey },
    );
    const sidecar = JSON.parse(bytes.toString('utf8')) as {
      schemaVersion: number;
      meetingId: string;
      source: CaptureJournalSource;
      sequence: number;
      chunkChecksumSha256: string;
      chunkStartSec: number;
      chunkEndSec: number;
      transcriptionConfig?: unknown;
      segments: Array<{
        start: number;
        end: number;
        text: string;
        words?: Array<{ word: string; start: number; end: number }>;
      }>;
    };
    const recomputedConfigKey = computeChecksum(
      Buffer.from(
        canonicalizeTranscriptCheckpointConfig(
          sidecar.transcriptionConfig as Record<string, unknown>,
        ),
      ),
    );
    let audioChecksumVerified = false;
    if (disposition?.disposition === 'captured') {
      try {
        const audioBytes = await readFile(
          join(rootDir, disposition.repairRelativePath),
        );
        const plaintext =
          manifest.schemaVersion === 4
            ? EncryptedArtifactStore.open(audioBytes, options.meetingKey!, {
                meetingId: manifest.meetingId,
                generation: manifest.generation,
                keyId: manifest.keyId,
                artifactKind: 'repair',
                source: reference.source,
                sequence: reference.sequence,
              }).plaintext
            : audioBytes;
        audioChecksumVerified =
          Boolean(options.meetingKey || manifest.schemaVersion === 3) &&
          computeChecksum(plaintext) === disposition.repairChecksumSha256;
      } catch {
        audioChecksumVerified = false;
      }
    }
    checkpoints.push({
      reference,
      repairAttempted: reference.repairAttempted,
      evidence: {
        audioChecksumVerified,
        sidecarChecksumVerified: true,
        pathSafe: true,
      },
      sidecar: {
        ...sidecar,
        transcriptionConfigKey: recomputedConfigKey,
      },
    });
  }
  const acceptanceFrames: TranscriptAcceptanceFrame[] = [];
  for (const frame of [...manifest.acceptanceFrames].sort(
    (left, right) => left.sequence - right.sequence,
  )) {
    const interval = manifest.intervals.find(
      (candidate) => candidate.sequence === frame.sequence,
    );
    if (!interval) throw new Error('Transcript acceptance interval missing');
    for (const source of ['mic', 'system'] as const) {
      const disposition = interval.sources[source];
      const supplied =
        source === 'mic'
          ? frame.micCheckpointChecksumSha256
          : frame.systemCheckpointChecksumSha256;
      if (disposition.disposition === 'captured') {
        const checkpoint = manifest.transcriptCheckpoints.find(
          (candidate) =>
            candidate.source === source &&
            candidate.sequence === frame.sequence &&
            candidate.transcriptChecksumSha256 === supplied,
        );
        if (!checkpoint) {
          throw new Error('Transcript acceptance checkpoint mismatch');
        }
      } else if (supplied !== null) {
        throw new Error('Unexpected transcript acceptance checkpoint');
      }
    }
    const bytes = await readCaptureJournalSidecar(
      rootDir,
      manifest.meetingId,
      frame.relativePath,
      frame.acceptedChecksumSha256,
      { meetingKey: options.meetingKey },
    );
    const sidecar = JSON.parse(bytes.toString('utf8')) as {
      meetingId?: unknown;
      sequence?: unknown;
      activityInputs?: unknown;
      segments?: Array<{
        source?: unknown;
        start?: unknown;
        end?: unknown;
        text?: unknown;
        words?: Array<{ word: string; start: number; end: number }>;
      }>;
    };
    if (
      sidecar.meetingId !== manifest.meetingId ||
      sidecar.sequence !== frame.sequence ||
      !Array.isArray(sidecar.segments)
    ) {
      throw new Error('Invalid transcript acceptance frame');
    }
    for (const segment of sidecar.segments) {
      if (
        (segment.source !== 'mic' && segment.source !== 'system') ||
        typeof segment.start !== 'number' ||
        typeof segment.end !== 'number' ||
        !Number.isFinite(segment.start) ||
        !Number.isFinite(segment.end) ||
        segment.start < interval.chunkStartSec ||
        segment.end <= segment.start ||
        segment.end > interval.chunkEndSec + 0.25 ||
        typeof segment.text !== 'string' ||
        !segment.text.trim()
      ) {
        throw new Error('Invalid transcript acceptance segment');
      }
      for (const word of segment.words ?? []) {
        if (
          typeof word.word !== 'string' ||
          !word.word.trim() ||
          !Number.isFinite(word.start) ||
          !Number.isFinite(word.end) ||
          word.start < segment.start ||
          word.end <= word.start ||
          word.end > segment.end
        ) {
          throw new Error('Invalid transcript acceptance word');
        }
      }
    }
    acceptanceFrames.push({
      sequence: frame.sequence,
      micCheckpointChecksumSha256: frame.micCheckpointChecksumSha256,
      systemCheckpointChecksumSha256: frame.systemCheckpointChecksumSha256,
      arbitrationVersion: frame.arbitrationVersion,
      activityEvidenceDigestSha256: frame.activityEvidenceDigestSha256,
      evidenceMatches:
        computeChecksum(Buffer.from(JSON.stringify(sidecar.activityInputs))) ===
          frame.activityEvidenceDigestSha256 &&
        acceptanceEvidenceMatchesSealedManifest(
          sidecar.activityInputs,
          manifest,
          interval,
        ),
      segments: sidecar.segments.map((segment) => ({
        source: segment.source as CaptureJournalSource,
        start: segment.start as number,
        end: segment.end as number,
        text: String(segment.text),
        ...(segment.words ? { words: segment.words } : {}),
      })),
    });
  }
  if (manifest.acceptanceFrames.length !== manifest.intervals.length) {
    throw new Error('Transcript acceptance frame missing');
  }
  const acceptedConfigKeys = Array.isArray(expectedConfigKeys)
    ? expectedConfigKeys
    : expectedConfigKeys
      ? [expectedConfigKeys]
      : [];
  if (acceptedConfigKeys.length === 0 && configKeys.size !== 1) {
    throw new Error('Transcript checkpoint configuration mismatch');
  }
  const finalized = finalizeTranscriptCheckpoints({
    meetingId: manifest.meetingId,
    expectedConfigKey: acceptedConfigKeys[0] ?? [...configKeys][0] ?? '',
    acceptedConfigKeys:
      acceptedConfigKeys.length > 0 ? acceptedConfigKeys : undefined,
    intervals: manifest.intervals.map((interval) => ({
      sequence: interval.sequence,
      start: interval.chunkStartSec,
      end: interval.chunkEndSec,
      sources: Object.fromEntries(
        (['mic', 'system'] as const).map((source) => {
          const disposition = interval.sources[source];
          if (disposition.disposition === 'captured') {
            return [
              source,
              {
                disposition: 'captured' as const,
                checksumSha256: disposition.repairChecksumSha256,
              },
            ];
          }
          if (disposition.disposition === 'source_unavailable') {
            return [
              source,
              {
                disposition: 'source_unavailable' as const,
                reason: disposition.reason,
              },
            ];
          }
          if (disposition.disposition === 'verified_silence') {
            return [source, disposition];
          }
          if (disposition.disposition === 'raw_durable') {
            return [
              source,
              {
                disposition: 'conversion_failed' as const,
                reason: 'repair_audio_unavailable',
              },
            ];
          }
          return [
            source,
            {
              disposition: 'missing' as const,
              reason:
                'reason' in disposition
                  ? disposition.reason
                  : 'capture_incomplete',
            },
          ];
        }),
      ) as {
        mic:
          | { disposition: 'captured'; checksumSha256: string }
          | { disposition: 'verified_silence' }
          | { disposition: 'source_unavailable'; reason: string }
          | { disposition: 'missing'; reason: string }
          | { disposition: 'conversion_failed'; reason: string };
        system:
          | { disposition: 'captured'; checksumSha256: string }
          | { disposition: 'verified_silence' }
          | { disposition: 'source_unavailable'; reason: string }
          | { disposition: 'missing'; reason: string }
          | { disposition: 'conversion_failed'; reason: string };
      },
    })),
    checkpoints,
    acceptanceFrames,
    arbitrationVersion: 'chunk_arbitration_v1',
    speechActivity: manifest.intervals.flatMap((interval) =>
      (['mic', 'system'] as const).map((source) => ({
        source,
        sequence: interval.sequence,
        speechDetected:
          manifest.activityEvidence?.windows.some(
            (window) =>
              window.speaker === (source === 'mic' ? 'Me' : 'Them') &&
              window.endTime > interval.chunkStartSec &&
              window.startTime < interval.chunkEndSec,
          ) ?? false,
      })),
    ),
  });
  const unresolvedFailures = finalized.failures.filter((failure) => {
    const interval = manifest.intervals.find(
      (candidate) => candidate.sequence === failure.sequence,
    );
    return interval?.sources[failure.source].disposition === 'captured';
  });
  if (
    finalized.transcriptionRequests.length > 0 ||
    (options.allowCaptureFailures
      ? unresolvedFailures.length > 0
      : finalized.failures.length > 0)
  ) {
    throw new Error('Transcript checkpoint repair required');
  }
  return {
    segments: finalized.segments.map((segment) => ({
      id: segment.id,
      startTime: segment.start,
      endTime: segment.end,
      text: segment.text,
      speaker: segment.speaker,
      ...(segment.words ? { words: segment.words } : {}),
    })),
    sourceCoverageSegments: checkpoints.flatMap((checkpoint) =>
      checkpoint.sidecar.segments.map((segment, index) => ({
        id: `${checkpoint.reference.source}-${checkpoint.reference.sequence}-${index}`,
        startTime: checkpoint.sidecar.chunkStartSec + segment.start,
        endTime: checkpoint.sidecar.chunkStartSec + segment.end,
        speaker:
          checkpoint.reference.source === 'mic'
            ? ('Me' as const)
            : ('Them' as const),
      })),
    ),
  };
};

export const verifySealedCaptureJournalTranscriptEvidence = async (
  rootDir: string,
  meetingId: string,
  expectedConfigKeys?: string | string[],
): Promise<{
  generation: string;
  revision: number;
  segmentCount: number;
  sourceCoverageSegments: Array<{
    id: string;
    startTime: number;
    endTime: number;
    speaker: 'Me' | 'Them';
  }>;
}> => {
  const manifest = await readCaptureJournalManifest(rootDir, meetingId);
  if (
    (manifest.schemaVersion !== 3 && manifest.schemaVersion !== 4) ||
    manifest.lifecycleState !== 'sealed'
  ) {
    throw new Error(
      'Capture journal transcript evidence is not sealed v3 or v4',
    );
  }
  const meetingKey =
    manifest.schemaVersion === 4
      ? await getCaptureJournalAudioKey(manifest.meetingId)
      : undefined;
  if (manifest.schemaVersion === 4 && !meetingKey) {
    throw new Error('audio_key_unavailable');
  }
  const evidence = await readV3AcceptedSegments(
    rootDir,
    manifest,
    expectedConfigKeys,
    { meetingKey: meetingKey ?? undefined },
  );
  return {
    generation: manifest.generation,
    revision: manifest.revision,
    segmentCount: evidence.segments.length,
    sourceCoverageSegments: evidence.sourceCoverageSegments,
  };
};

const buildRecoveredMeeting = (params: {
  manifest: CaptureJournalManifest;
  nowMs: number;
  micAudioPath: string | null;
  systemAudioPath: string | null;
  integrity: RecoveryMeetingIntegrity;
  acceptedSegments?: Awaited<
    ReturnType<typeof readV3AcceptedSegments>
  >['segments'];
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
      buildTranscriptJsonPayload(params.acceptedSegments ?? [], {
        canonicalSource:
          params.manifest.schemaVersion === 3 ||
          params.manifest.schemaVersion === 4
            ? 'recovered_channels'
            : 'mic',
        postHydrationBleedPass: false,
        lifecycleStatus: 'needs_attention',
      }),
    ),
    user_notes: '',
    enhanced_notes: null,
    analysis_json: null,
    value_signals_json: null,
    capture_journal_generation:
      params.manifest.schemaVersion === 3 || params.manifest.schemaVersion === 4
        ? params.manifest.generation
        : null,
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

    if (
      deps.minimumStartedAtMs !== undefined &&
      manifest.startedAtMs < deps.minimumStartedAtMs
    ) {
      result.skippedBeforeCutoffCount =
        (result.skippedBeforeCutoffCount ?? 0) + 1;
      continue;
    }

    const existingMeeting = deps.getMeeting(manifest.meetingId);
    const isRecoveryRequiredMeeting =
      existingMeeting?.finalization_status === 'recovery_required';
    const isResumableSealedMeeting = Boolean(
      (manifest.schemaVersion === 3 || manifest.schemaVersion === 4) &&
        manifest.lifecycleState === 'sealed' &&
        existingMeeting?.transcript_status === 'provisional' &&
        existingMeeting.capture_journal_generation === manifest.generation &&
        existingMeeting.finalization_status !== 'recovery_required' &&
        (!existingMeeting.audio_path ||
          !existingMeeting.system_audio_path ||
          !existingMeeting.mixed_audio_path),
    );
    if (
      manifest.lifecycleState === 'sealed' &&
      existingMeeting &&
      !isRecoveryRequiredMeeting &&
      !isResumableSealedMeeting
    ) {
      result.skippedSealedCount += 1;
      continue;
    }

    if (
      existingMeeting &&
      !isRecoveryRequiredMeeting &&
      !isResumableSealedMeeting
    ) {
      result.skippedExistingCount += 1;
      continue;
    }

    if (
      (manifest.schemaVersion === 3 || manifest.schemaVersion === 4) &&
      !existingMeeting &&
      manifest.activityEvidence === undefined &&
      manifest.intervals.length === 0 &&
      manifest.entries.length === 0 &&
      manifest.transcriptCheckpoints.length === 0 &&
      manifest.acceptanceFrames.length === 0
    ) {
      result.skippedEmptyCount += 1;
      continue;
    }

    try {
      const meetingKey =
        manifest.schemaVersion === 4
          ? ((await getCaptureJournalAudioKey(manifest.meetingId)) ?? undefined)
          : undefined;
      if (manifest.schemaVersion === 4 && !meetingKey) {
        throw new Error('audio_key_unavailable');
      }
      if (manifest.schemaVersion === 3 || manifest.schemaVersion === 4) {
        if (
          manifest.lifecycleState === 'recording' &&
          (manifest.schemaVersion === 4 || deps.repairRawChunk)
        ) {
          for (const interval of manifest.intervals) {
            for (const source of ['mic', 'system'] as const) {
              const disposition = interval.sources[source];
              if (disposition.disposition !== 'raw_durable') continue;
              const rawPath = join(rootDir, disposition.rawRelativePath);
              let repairData: Buffer | null;
              if (manifest.schemaVersion === 4) {
                repairData = await repairEncryptedJournalRawChunk({
                  filePath: rawPath,
                  manifest,
                  source,
                  sequence: interval.sequence,
                  expectedPlaintextSha256: disposition.rawChecksumSha256,
                  meetingKey: meetingKey!,
                });
              } else {
                const rawBytes = await readFile(rawPath);
                if (
                  computeChecksum(rawBytes) !== disposition.rawChecksumSha256
                ) {
                  continue;
                }
                repairData = await deps.repairRawChunk!(rawPath);
              }
              if (!repairData) continue;
              const completed = await completeCaptureJournalCapturedChunk(
                rootDir,
                {
                  meetingId: manifest.meetingId,
                  generation: manifest.generation,
                  expectedRevision: manifest.revision,
                  source,
                  sequence: interval.sequence,
                  rawChecksumSha256: disposition.rawChecksumSha256,
                  repairData,
                  meetingKey,
                },
              );
              manifest = completed.manifest;
            }
          }
        }
        if (manifest.lifecycleState === 'recording') {
          manifest = await stopCaptureJournal(rootDir, {
            meetingId: manifest.meetingId,
            generation: manifest.generation,
            expectedRevision: manifest.revision,
            meetingKey,
          });
        }
        if (manifest.lifecycleState === 'stopping' && deps.transcribeChunk) {
          manifest = await repairV3TranscriptGaps(
            rootDir,
            manifest,
            deps.transcribeChunk,
            deps.transcriptionConfig,
            meetingKey,
          );
        }
      }
      const micEntries = manifest.entries.filter(
        (entry) => entry.source === 'mic',
      );
      const systemEntries = manifest.entries.filter(
        (entry) => entry.source === 'system',
      );

      const [micRecovery, systemRecovery, acceptedEvidence] =
        manifest.schemaVersion === 3 || manifest.schemaVersion === 4
          ? await Promise.all([
              manifest.schemaVersion === 4
                ? buildV4SourceSegments(rootDir, manifest, 'mic')
                : buildV3SourceSegments(rootDir, manifest, 'mic'),
              manifest.schemaVersion === 4
                ? buildV4SourceSegments(rootDir, manifest, 'system')
                : buildV3SourceSegments(rootDir, manifest, 'system'),
              isResumableSealedMeeting ||
              (manifest.lifecycleState === 'sealed' &&
                manifest.acceptanceFrames.length !== manifest.intervals.length)
                ? Promise.resolve({
                    segments: [],
                    sourceCoverageSegments: [],
                  })
                : // Checkpoints are authoritative for an interrupted recording.
                  // readV3AcceptedSegments still enforces that every accepted
                  // checkpoint uses one internally consistent configuration.
                  readV3AcceptedSegments(
                    rootDir,
                    manifest,
                    deps.transcriptionConfig
                      ? getAcceptedRecoveryCheckpointConfigKeys(
                          deps.transcriptionConfig,
                        )
                      : undefined,
                    { allowCaptureFailures: true, meetingKey },
                  ),
            ])
          : await Promise.all([
              buildSourceSegments(rootDir, micEntries),
              buildSourceSegments(rootDir, systemEntries),
              Promise.resolve({ segments: [], sourceCoverageSegments: [] }),
            ]);
      if (
        (manifest.schemaVersion === 3 || manifest.schemaVersion === 4) &&
        manifest.lifecycleState === 'stopping'
      ) {
        manifest = await sealCaptureJournal(rootDir, {
          meetingId: manifest.meetingId,
          endedAtMs:
            manifest.endedAtMs ??
            manifest.startedAtMs +
              Math.round(getRecoveredDurationSeconds(manifest) * 1000),
          meetingKey,
        });
      }
      const activityEvidence = await getRecoveryActivityEvidence(manifest);
      let resumableMeeting = existingMeeting;
      const persistResumableStage = async (
        patch: Partial<PersistedMeeting>,
      ) => {
        if (!resumableMeeting) {
          throw new Error('sealed_capture_meeting_missing');
        }
        resumableMeeting = {
          ...resumableMeeting,
          ...patch,
          finalization_status: 'processing',
          finalization_error_category: null,
        };
        await deps.saveMeeting(resumableMeeting);
      };

      const micAudioPath =
        (isResumableSealedMeeting && resumableMeeting?.audio_path) ||
        (micRecovery.segments.length > 0
          ? manifest.schemaVersion === 4
            ? await materializeEncryptedJournalSource({
                rootDir,
                manifest,
                source: 'mic',
                meetingKey: meetingKey!,
              })
            : await deps.stitchWavSegments(
                micRecovery.segments,
                `${manifest.meetingId}-mic-recovered`,
              )
          : null);
      if (
        isResumableSealedMeeting &&
        micAudioPath &&
        !resumableMeeting?.audio_path
      ) {
        await persistResumableStage({ audio_path: micAudioPath });
      }
      const systemAudioPath =
        (isResumableSealedMeeting && resumableMeeting?.system_audio_path) ||
        (systemRecovery.segments.length > 0
          ? manifest.schemaVersion === 4
            ? await materializeEncryptedJournalSource({
                rootDir,
                manifest,
                source: 'system',
                meetingKey: meetingKey!,
              })
            : await deps.stitchWavSegments(
                systemRecovery.segments,
                `${manifest.meetingId}-system-recovered`,
              )
          : null);
      if (
        isResumableSealedMeeting &&
        systemAudioPath &&
        !resumableMeeting?.system_audio_path
      ) {
        await persistResumableStage({ system_audio_path: systemAudioPath });
      }

      if (!micAudioPath && !systemAudioPath) {
        result.skippedEmptyCount += 1;
        continue;
      }

      if (isResumableSealedMeeting) {
        if (
          !resumableMeeting ||
          !micAudioPath ||
          !systemAudioPath ||
          !deps.mixWavSources
        ) {
          throw new Error('sealed_capture_materialization_incomplete');
        }
        const mixedAudioPath =
          resumableMeeting.mixed_audio_path ||
          (manifest.schemaVersion === 4
            ? await deps.mixWavSources(
                [micAudioPath, systemAudioPath],
                `${manifest.meetingId}-mix-recovered`,
                manifest.meetingId,
              )
            : await deps.mixWavSources(
                [micAudioPath, systemAudioPath],
                `${manifest.meetingId}-mix-recovered`,
              ));
        if (!mixedAudioPath) {
          throw new Error('sealed_capture_mix_failed');
        }
        await persistResumableStage({
          audio_path: micAudioPath,
          system_audio_path: systemAudioPath,
          mixed_audio_path: mixedAudioPath,
        });
        result.recoveredCount += 1;
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
          journalSchemaVersion: manifest.schemaVersion,
          checkpointEvidenceVerified:
            manifest.schemaVersion === 3 || manifest.schemaVersion === 4,
          gapDetected,
          sourceScope,
          acknowledgedChunkCount:
            manifest.schemaVersion === 3 || manifest.schemaVersion === 4
              ? manifest.intervals.length * manifest.expectedSources.length
              : micEntries.length + systemEntries.length,
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
          acceptedSegments: acceptedEvidence.segments,
          existingMeeting,
        }),
      );
      result.recoveredCount += 1;
    } catch (error) {
      console.warn('[Pluto] Capture-journal recovery failed', {
        meetingId,
        reason: error instanceof Error ? error.message : 'unknown',
      });
      result.failedRecoveryCount += 1;
    }
  }

  return result;
};
