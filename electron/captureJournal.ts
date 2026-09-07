import { createHash, randomUUID } from 'node:crypto';
import {
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, posix, resolve, sep } from 'node:path';
import {
  type CaptureActivityEvidence,
  parseCaptureActivityEvidence,
} from '../src/utils/transcriptActivityEvidence.ts';
import { canonicalizeTranscriptCheckpointConfig } from '../src/utils/transcriptCheckpointConfig.ts';
import { EncryptedArtifactStore } from './crypto/encryptedArtifactStore.ts';

export type CaptureJournalSource = 'mic' | 'system';
export type CaptureJournalLifecycleState = 'recording' | 'sealed';
export type CaptureJournalLifecycleStateV3 =
  | 'recording'
  | 'stopping'
  | 'sealed';

export type CaptureJournalStickyFailure = {
  code:
    | 'crypto_error'
    | 'checksum_mismatch'
    | 'authentication_failed'
    | 'key_missing'
    | 'envelope_truncated'
    | 'tag_mismatch';
  message: string;
  occurredAtMs: number;
};

export type CaptureJournalEntry = {
  source: CaptureJournalSource;
  sequence: number;
  chunkStartSec: number;
  chunkEndSec: number;
  format: string;
  byteCount: number;
  checksumSha256: string;
  ciphertextSha256?: string;
  relativePath: string;
};

type CaptureJournalManifestBase = {
  meetingId: string;
  artifactRootRelativePath: string;
  manifestRelativePath: string;
  lifecycleState: CaptureJournalLifecycleState | CaptureJournalLifecycleStateV3;
  startedAtMs: number;
  endedAtMs: number | null;
  entries: CaptureJournalEntry[];
};

export type CaptureJournalManifestV1 = CaptureJournalManifestBase & {
  schemaVersion: 1;
};

export type CaptureJournalManifestV2 = CaptureJournalManifestBase & {
  schemaVersion: 2;
  activityEvidence?: CaptureActivityEvidence;
};

export type CaptureIntervalSourceDisposition =
  | { disposition: 'pending' }
  | {
      disposition: 'raw_durable';
      rawChecksumSha256: string;
      rawRelativePath: string;
      rawCiphertextSha256?: string;
      decodeDependency?: {
        anchorSequence: number;
        initializationChecksumSha256: string;
      };
    }
  | {
      disposition: 'captured';
      rawChecksumSha256: string;
      rawRelativePath: string;
      rawCiphertextSha256?: string;
      repairChecksumSha256: string;
      repairRelativePath: string;
      repairCiphertextSha256?: string;
    }
  | {
      disposition: 'verified_silence' | 'source_unavailable' | 'missing';
      reason: string;
    };

export type CaptureIntervalLedgerEntry = {
  sequence: number;
  chunkStartSec: number;
  chunkEndSec: number;
  sources: Record<CaptureJournalSource, CaptureIntervalSourceDisposition>;
};

export type CaptureAudioReceipt = {
  /** Issued only after repair WAV and manifest mutation have both been synced. */
  durable?: true;
  meetingId: string;
  generation: string;
  manifestRevision: number;
  source: CaptureJournalSource;
  sequence: number;
  checksumSha256: string;
  chunkStartSec: number;
  chunkEndSec: number;
  repairAudioRelativePath: string | null;
};

export type CaptureTranscriptCheckpointRef = {
  source: CaptureJournalSource;
  sequence: number;
  chunkChecksumSha256: string;
  chunkStartSec: number;
  chunkEndSec: number;
  transcriptionConfigKey: string;
  transcriptChecksumSha256: string;
  revision: number;
  repairAttempted?: boolean;
  disposition:
    | 'transcribed'
    | 'verified_silence'
    | 'conversion_failed'
    | 'transcription_failed'
    | 'cancelled';
  relativePath: string;
};

export type CaptureTranscriptAcceptanceFrame = {
  sequence: number;
  micCheckpointChecksumSha256: string | null;
  systemCheckpointChecksumSha256: string | null;
  arbitrationVersion: 'chunk_arbitration_v1';
  activityEvidenceDigestSha256: string;
  acceptedChecksumSha256: string;
  relativePath: string;
  revision?: number;
};

export type CaptureJournalManifestV3 = CaptureJournalManifestBase & {
  schemaVersion: 3;
  lifecycleState: CaptureJournalLifecycleStateV3;
  generation: string;
  revision: number;
  expectedSources: CaptureJournalSource[];
  sourceAvailability: Record<
    CaptureJournalSource,
    'available' | 'unavailable_at_start' | 'failed_during_capture'
  >;
  intervals: CaptureIntervalLedgerEntry[];
  transcriptCheckpoints: CaptureTranscriptCheckpointRef[];
  acceptanceFrames: CaptureTranscriptAcceptanceFrame[];
  stoppingWatermarks?: Record<CaptureJournalSource, number>;
  activityEvidence?: CaptureActivityEvidence;
};

export type CaptureJournalManifestV4 = CaptureJournalManifestBase & {
  schemaVersion: 4;
  keyId: string;
  envelopeVersion: number;
  lifecycleState: CaptureJournalLifecycleStateV3;
  generation: string;
  revision: number;
  expectedSources: CaptureJournalSource[];
  sourceAvailability: Record<
    CaptureJournalSource,
    'available' | 'unavailable_at_start' | 'failed_during_capture'
  >;
  intervals: CaptureIntervalLedgerEntry[];
  transcriptCheckpoints: CaptureTranscriptCheckpointRef[];
  acceptanceFrames: CaptureTranscriptAcceptanceFrame[];
  stoppingWatermarks?: Record<CaptureJournalSource, number>;
  activityEvidence?: CaptureActivityEvidence;
  stickyFailure?: CaptureJournalStickyFailure | null;
};

export type CaptureJournalLocator = {
  schemaVersion: 4;
  envelopeVersion: number;
  meetingId: string;
  keyId: string;
  generation: string;
  encryptedManifestRelativePath: string;
  ciphertextSha256: string;
  plaintextSha256: string;
};

export type CaptureJournalManifest =
  | CaptureJournalManifestV1
  | CaptureJournalManifestV2
  | CaptureJournalManifestV3
  | CaptureJournalManifestV4;

export type AudioKeyProvider = (
  meetingId: string,
) => Buffer | null | Promise<Buffer | null>;

let registeredAudioKeyProvider: AudioKeyProvider | null = null;

export const setCaptureJournalAudioKeyProvider = (
  provider: AudioKeyProvider | null,
) => {
  registeredAudioKeyProvider = provider;
};

export const getCaptureJournalAudioKey = async (
  meetingId: string,
): Promise<Buffer | null> => {
  if (registeredAudioKeyProvider) {
    return await registeredAudioKeyProvider(meetingId);
  }
  return null;
};

export type CreateCaptureJournalArgs = {
  meetingId: string;
  startedAtMs: number;
  schemaVersion?: 2 | 3 | 4;
  keyId?: string;
  meetingKey?: Buffer;
  expectedSources?: CaptureJournalSource[];
  sourceAvailability?: Partial<CaptureJournalManifestV3['sourceAvailability']>;
};

type AppendCaptureJournalChunkArgs = {
  meetingId: string;
  source: CaptureJournalSource;
  sequence: number;
  chunkStartSec: number;
  chunkEndSec: number;
  format: string;
  data: Buffer | Uint8Array;
  meetingKey?: Buffer;
};

type SealCaptureJournalArgs = {
  meetingId: string;
  endedAtMs: number;
  meetingKey?: Buffer;
};

export type StopCaptureJournalArgs = V3MutationIdentity & {
  meetingKey?: Buffer;
};

type UpdateCaptureJournalActivityEvidenceArgs = {
  meetingId: string;
  activityEvidence: CaptureActivityEvidence;
  meetingKey?: Buffer;
};

type V3MutationIdentity = {
  meetingId: string;
  generation: string;
  expectedRevision: number;
};

export type AuthorizeCaptureJournalIntervalArgs = V3MutationIdentity & {
  sequence: number;
  chunkStartSec: number;
  chunkEndSec: number;
  meetingKey?: Buffer;
};

export type PersistCaptureJournalRawChunkArgs = V3MutationIdentity & {
  source: CaptureJournalSource;
  sequence: number;
  format: string;
  data: Buffer | Uint8Array;
  meetingKey?: Buffer;
  decodeDependency?: {
    anchorSequence: number;
    initializationChecksumSha256: string;
  };
};

export type CompleteCaptureJournalCapturedChunkArgs = V3MutationIdentity & {
  source: CaptureJournalSource;
  sequence: number;
  rawChecksumSha256: string;
  repairData?: Buffer | Uint8Array;
  repairPath?: string;
  meetingKey?: Buffer;
};

export type CaptureTranscriptCheckpointV1 = {
  schemaVersion: 1;
  meetingId: string;
  source: CaptureJournalSource;
  sequence: number;
  chunkChecksumSha256: string;
  chunkStartSec: number;
  chunkEndSec: number;
  transcriptionConfig: {
    backend: string;
    preset: string;
    model: string;
    device: string;
    computeType: string;
    languageMode: 'fixed' | 'detected';
    requestedLanguage: string | null;
    pipelineVersion: 'live_chunk_v1';
  };
  backendResult: {
    detectedLanguage: string | null;
    providerLabel: string;
  };
  segments: Array<{
    start: number;
    end: number;
    text: string;
    words?: Array<{ word: string; start: number; end: number }>;
  }>;
};

export type AppendCaptureTranscriptCheckpointArgs = {
  receipt: CaptureAudioReceipt;
  expectedManifestRevision: number;
  transcriptionConfigKey: string;
  sidecar: CaptureTranscriptCheckpointV1;
  disposition?: CaptureTranscriptCheckpointRef['disposition'];
};

export type ReplaceCaptureTranscriptCheckpointArgs =
  AppendCaptureTranscriptCheckpointArgs & {
    expectedPriorTranscriptChecksumSha256: string;
  };

export type PromoteCaptureTranscriptCheckpointArgs =
  ReplaceCaptureTranscriptCheckpointArgs & {
    expectedPriorAcceptedChecksumSha256: string;
    acceptance: Omit<
      AppendCaptureTranscriptAcceptanceFrameArgs,
      'meetingId' | 'generation' | 'expectedRevision'
    >;
  };

export type AppendCaptureTranscriptAcceptanceFrameArgs = V3MutationIdentity & {
  sequence: number;
  micCheckpointChecksumSha256: string | null;
  systemCheckpointChecksumSha256: string | null;
  activityEvidenceDigestSha256: string;
  sidecar: CaptureTranscriptAcceptanceFrameV1;
  expectedPriorAcceptedChecksumSha256?: string;
};

export type CaptureTranscriptAcceptanceFrameV1 = {
  schemaVersion: 1;
  meetingId: string;
  sequence: number;
  arbitrationVersion: 'chunk_arbitration_v1';
  activityInputs: unknown;
  segments: Array<{
    source: CaptureJournalSource;
    start: number;
    end: number;
    text: string;
    words?: Array<{ word: string; start: number; end: number }>;
  }>;
};

export type CaptureJournalDurability = {
  syncFile: (path: string) => Promise<void>;
  syncDirectory: (path: string) => Promise<void>;
};

const MANIFEST_FILE = 'manifest.json';

const getArtifactRootRelativePath = (meetingId: string) =>
  `${meetingId}/capture-journal`;

const getArtifactRootPath = (rootDir: string, meetingId: string) =>
  join(rootDir, getArtifactRootRelativePath(meetingId));

const getManifestPath = (rootDir: string, meetingId: string) =>
  join(getArtifactRootPath(rootDir, meetingId), MANIFEST_FILE);

const normalizeMeetingId = (meetingId: string) => {
  const normalized = String(meetingId || '').trim();
  if (!normalized) throw new Error('Capture journal requires a meeting ID');
  if (
    normalized === '.' ||
    normalized === '..' ||
    normalized.includes('/') ||
    normalized.includes('\\') ||
    normalized.includes('\0')
  ) {
    throw new Error(
      `Invalid capture journal meeting ID: ${JSON.stringify(normalized)}`,
    );
  }
  return normalized;
};

const normalizeTimestampMs = (value: number) =>
  Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;

const normalizeSequence = (value: number) => {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Invalid capture journal sequence: ${value}`);
  }
  return value;
};

const normalizeSeconds = (value: number) =>
  Number.isFinite(value) ? Math.max(0, value) : 0;

const toBuffer = (data: Buffer | Uint8Array) =>
  Buffer.isBuffer(data) ? data : Buffer.from(data);

const formatToExtension = (format: string) => {
  const normalized = String(format || 'bin')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'bin';
};

const padSequence = (sequence: number) => String(sequence).padStart(6, '0');

const computeChecksum = (data: Buffer) =>
  createHash('sha256').update(data).digest('hex');
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

const assertChecksum = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    return invalidManifest(field);
  }
  return value;
};

const assertSafeRelativePath = (
  value: unknown,
  artifactRootRelativePath: string,
  expectedDirectory: string,
): string => {
  if (
    typeof value !== 'string' ||
    value.includes('\\') ||
    value.includes('\0')
  ) {
    return invalidManifest('sidecar path');
  }
  const normalized = posix.normalize(value);
  const prefix = `${artifactRootRelativePath}/${expectedDirectory}/`;
  if (
    normalized !== value ||
    value.startsWith('/') ||
    !value.startsWith(prefix) ||
    value === prefix
  ) {
    return invalidManifest('sidecar path');
  }
  return value;
};

const invalidManifest = (field: string): never => {
  throw new Error(`Invalid capture journal manifest ${field}`);
};

const validateCaptureJournalManifest = async (
  value: unknown,
  requestedMeetingId: string,
): Promise<CaptureJournalManifest> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return invalidManifest('shape');
  }
  const manifest = value as Record<string, unknown>;
  if (
    manifest.schemaVersion !== 1 &&
    manifest.schemaVersion !== 2 &&
    manifest.schemaVersion !== 3 &&
    manifest.schemaVersion !== 4
  ) {
    throw new Error(
      `Unsupported capture journal schema version: ${String(manifest.schemaVersion)}`,
    );
  }
  const artifactRootRelativePath =
    getArtifactRootRelativePath(requestedMeetingId);
  if (manifest.meetingId !== requestedMeetingId) {
    return invalidManifest('meeting ID');
  }
  if (manifest.artifactRootRelativePath !== artifactRootRelativePath) {
    return invalidManifest('artifact root path');
  }
  if (
    manifest.manifestRelativePath !==
    `${artifactRootRelativePath}/${MANIFEST_FILE}`
  ) {
    return invalidManifest('manifest path');
  }
  if (!Array.isArray(manifest.entries)) {
    return invalidManifest('entries');
  }
  for (const entryValue of manifest.entries) {
    if (
      !entryValue ||
      typeof entryValue !== 'object' ||
      Array.isArray(entryValue)
    ) {
      return invalidManifest('entry shape');
    }
    const entry = entryValue as Record<string, unknown>;
    if (entry.source !== 'mic' && entry.source !== 'system') {
      return invalidManifest('entry source');
    }
    if (
      typeof entry.sequence !== 'number' ||
      !Number.isInteger(entry.sequence) ||
      entry.sequence < 0
    ) {
      return invalidManifest('entry sequence');
    }
    if (typeof entry.format !== 'string') {
      return invalidManifest('entry format');
    }
    if (manifest.schemaVersion === 4) {
      assertSafeRelativePath(
        entry.relativePath,
        artifactRootRelativePath,
        'chunks',
      );
      if (entry.ciphertextSha256) {
        assertChecksum(entry.ciphertextSha256, 'entry ciphertext checksum');
      }
    } else {
      const expectedPath = `${artifactRootRelativePath}/chunks/${entry.source}-${padSequence(entry.sequence)}.${formatToExtension(entry.format)}`;
      if (entry.relativePath !== expectedPath) {
        return invalidManifest('entry path');
      }
    }
  }

  if (manifest.schemaVersion === 3 || manifest.schemaVersion === 4) {
    if (manifest.schemaVersion === 4) {
      if (
        typeof manifest.keyId !== 'string' ||
        !manifest.keyId.trim() ||
        manifest.envelopeVersion !== 1
      ) {
        return invalidManifest('v4 keyId or envelopeVersion');
      }
      if (manifest.stickyFailure) {
        const failure = manifest.stickyFailure as CaptureJournalStickyFailure;
        if (!failure.code || !failure.message) {
          return invalidManifest('v4 sticky failure');
        }
      }
    }
    if (
      typeof manifest.generation !== 'string' ||
      manifest.generation.length < 16 ||
      !Number.isInteger(manifest.revision) ||
      (manifest.revision as number) < 0 ||
      !Array.isArray(manifest.expectedSources) ||
      !Array.isArray(manifest.intervals) ||
      !Array.isArray(manifest.transcriptCheckpoints) ||
      !Array.isArray(manifest.acceptanceFrames)
    ) {
      return invalidManifest('v3/v4 shape');
    }
    if (
      manifest.expectedSources.some(
        (source) => source !== 'mic' && source !== 'system',
      ) ||
      new Set(manifest.expectedSources).size !== manifest.expectedSources.length
    ) {
      return invalidManifest('expected sources');
    }
    for (const source of ['mic', 'system'] as const) {
      if (
        ![
          'available',
          'unavailable_at_start',
          'failed_during_capture',
        ].includes(
          (manifest.sourceAvailability as Record<string, string> | undefined)?.[
            source
          ] ?? '',
        )
      ) {
        return invalidManifest('source availability');
      }
    }
    if (
      manifest.lifecycleState !== 'recording' &&
      manifest.lifecycleState !== 'stopping' &&
      manifest.lifecycleState !== 'sealed'
    ) {
      return invalidManifest('lifecycle state');
    }
    const seenIntervals = new Set<number>();
    for (const value of manifest.intervals) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return invalidManifest('interval shape');
      }
      const interval = value as CaptureIntervalLedgerEntry;
      if (
        !Number.isInteger(interval.sequence) ||
        interval.sequence < 0 ||
        !Number.isFinite(interval.chunkStartSec) ||
        !Number.isFinite(interval.chunkEndSec) ||
        interval.chunkStartSec < 0 ||
        interval.chunkEndSec <= interval.chunkStartSec ||
        seenIntervals.has(interval.sequence)
      ) {
        return invalidManifest('interval');
      }
      seenIntervals.add(interval.sequence);
      for (const source of ['mic', 'system'] as const) {
        const disposition = interval.sources?.[source];
        if (!disposition || typeof disposition !== 'object') {
          return invalidManifest('interval source');
        }
        if (
          ![
            'pending',
            'raw_durable',
            'captured',
            'verified_silence',
            'source_unavailable',
            'missing',
          ].includes(disposition.disposition)
        ) {
          return invalidManifest('interval disposition');
        }
        if (
          disposition.disposition === 'raw_durable' ||
          disposition.disposition === 'captured'
        ) {
          assertChecksum(disposition.rawChecksumSha256, 'raw checksum');
          if (disposition.rawCiphertextSha256) {
            assertChecksum(
              disposition.rawCiphertextSha256,
              'raw ciphertext checksum',
            );
          }
          assertSafeRelativePath(
            disposition.rawRelativePath,
            artifactRootRelativePath,
            'chunks',
          );
        }
        if (disposition.disposition === 'captured') {
          assertChecksum(disposition.repairChecksumSha256, 'repair checksum');
          if (disposition.repairCiphertextSha256) {
            assertChecksum(
              disposition.repairCiphertextSha256,
              'repair ciphertext checksum',
            );
          }
          assertSafeRelativePath(
            disposition.repairRelativePath,
            artifactRootRelativePath,
            'repair',
          );
        }
        if (
          (disposition.disposition === 'verified_silence' ||
            disposition.disposition === 'source_unavailable' ||
            disposition.disposition === 'missing') &&
          (typeof disposition.reason !== 'string' || !disposition.reason.trim())
        ) {
          return invalidManifest('interval reason');
        }
      }
    }
    for (const value of manifest.transcriptCheckpoints) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return invalidManifest('checkpoint shape');
      }
      const checkpoint = value as CaptureTranscriptCheckpointRef;
      assertChecksum(
        checkpoint.chunkChecksumSha256,
        'checkpoint chunk checksum',
      );
      assertChecksum(
        checkpoint.transcriptChecksumSha256,
        'checkpoint transcript checksum',
      );
      assertChecksum(checkpoint.transcriptionConfigKey, 'config key');
      assertSafeRelativePath(
        checkpoint.relativePath,
        artifactRootRelativePath,
        'transcript-checkpoints',
      );
    }
    for (const value of manifest.acceptanceFrames) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return invalidManifest('acceptance frame shape');
      }
      const frame = value as CaptureTranscriptAcceptanceFrame;
      assertChecksum(frame.acceptedChecksumSha256, 'acceptance checksum');
      assertChecksum(
        frame.activityEvidenceDigestSha256,
        'activity evidence checksum',
      );
      assertSafeRelativePath(
        frame.relativePath,
        artifactRootRelativePath,
        'acceptance-frames',
      );
    }
  }

  if (
    manifest.schemaVersion === 2 ||
    manifest.schemaVersion === 3 ||
    manifest.schemaVersion === 4
  ) {
    if (manifest.activityEvidence === undefined) {
      if (manifest.lifecycleState === 'sealed') {
        throw new Error('capture_activity_missing');
      }
    } else {
      const parsed = await parseCaptureActivityEvidence(
        manifest.activityEvidence,
      );
      if (!parsed.ok) throw new Error(parsed.reason);
      manifest.activityEvidence = parsed.evidence;
    }
  }
  return value as CaptureJournalManifest;
};

const syncPath = async (path: string) => {
  const handle = await open(path, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
};

const defaultDurability: CaptureJournalDurability = {
  syncFile: syncPath,
  syncDirectory: syncPath,
};

const writeManifest = async (
  rootDir: string,
  manifest: CaptureJournalManifest,
  durability: CaptureJournalDurability,
  meetingKeyOverride?: Buffer,
) => {
  const artifactRootPath = getArtifactRootPath(rootDir, manifest.meetingId);
  await mkdir(artifactRootPath, { recursive: true });

  if (manifest.schemaVersion === 4) {
    const key =
      meetingKeyOverride ??
      (await getCaptureJournalAudioKey(manifest.meetingId));
    if (!key) {
      throw new Error(
        `audio_key_unavailable: Meeting audio key is required to write encrypted capture journal for ${manifest.meetingId}`,
      );
    }
    const manifestEncRelativePath = `${manifest.artifactRootRelativePath}/manifest.enc`;
    const manifestEncPath = join(rootDir, manifestEncRelativePath);
    const plaintext = Buffer.from(JSON.stringify(manifest, null, 2), 'utf8');

    const writeResult = await EncryptedArtifactStore.writeEncryptedFile(
      manifestEncPath,
      plaintext,
      key,
      {
        keyId: manifest.keyId,
        meetingId: manifest.meetingId,
        generation: manifest.generation,
        artifactKind: 'manifest',
        source: 'none',
        sequence: manifest.revision,
      },
    );

    const locator: CaptureJournalLocator = {
      schemaVersion: 4,
      envelopeVersion: 1,
      meetingId: manifest.meetingId,
      keyId: manifest.keyId,
      generation: manifest.generation,
      encryptedManifestRelativePath: manifestEncRelativePath,
      ciphertextSha256: writeResult.ciphertextSha256,
      plaintextSha256: writeResult.plaintextSha256,
    };

    const manifestPath = getManifestPath(rootDir, manifest.meetingId);
    const tempPath = `${manifestPath}.tmp`;
    await writeFile(tempPath, JSON.stringify(locator, null, 2));
    await durability.syncFile(tempPath);
    await rename(tempPath, manifestPath);
    await durability.syncDirectory(dirname(manifestPath));
    return;
  }

  const manifestPath = getManifestPath(rootDir, manifest.meetingId);
  const tempPath = `${manifestPath}.tmp`;
  await writeFile(tempPath, JSON.stringify(manifest, null, 2));
  await durability.syncFile(tempPath);
  await rename(tempPath, manifestPath);
  await durability.syncDirectory(dirname(manifestPath));
};

export const readCaptureJournalManifest = async (
  rootDir: string,
  meetingId: string,
  options?: { meetingKey?: Buffer },
): Promise<CaptureJournalManifest> => {
  const normalizedMeetingId = normalizeMeetingId(meetingId);
  const manifestPath = getManifestPath(rootDir, normalizedMeetingId);
  const raw = await readFile(manifestPath, 'utf8');
  const parsed = JSON.parse(raw);

  if (parsed && typeof parsed === 'object' && parsed.schemaVersion === 4) {
    const key =
      options?.meetingKey ??
      (await getCaptureJournalAudioKey(normalizedMeetingId));
    if (!key) {
      throw new Error(
        `audio_key_unavailable: Meeting audio key is required to decrypt capture journal for ${normalizedMeetingId}`,
      );
    }
    const locator = parsed as CaptureJournalLocator;
    const encPath = join(rootDir, locator.encryptedManifestRelativePath);
    const decrypted = await EncryptedArtifactStore.readEncryptedFile(
      encPath,
      key,
      {
        keyId: locator.keyId,
        meetingId: normalizedMeetingId,
        artifactKind: 'manifest',
      },
    );
    const manifestJson = JSON.parse(decrypted.plaintext.toString('utf8'));
    return await validateCaptureJournalManifest(
      manifestJson,
      normalizedMeetingId,
    );
  }

  return await validateCaptureJournalManifest(parsed, normalizedMeetingId);
};

export const createCaptureJournal = async (
  rootDir: string,
  args: CreateCaptureJournalArgs,
  durability: CaptureJournalDurability = defaultDurability,
): Promise<CaptureJournalManifest> => {
  const { meetingId, startedAtMs } = args;
  const normalizedMeetingId = normalizeMeetingId(meetingId);
  const artifactRootRelativePath =
    getArtifactRootRelativePath(normalizedMeetingId);
  const artifactRootPath = getArtifactRootPath(rootDir, normalizedMeetingId);

  try {
    return await readCaptureJournalManifest(rootDir, normalizedMeetingId, {
      meetingKey: args.meetingKey,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  await Promise.all(
    ['chunks', 'repair', 'transcript-checkpoints', 'acceptance-frames'].map(
      (directory) =>
        mkdir(join(artifactRootPath, directory), { recursive: true }),
    ),
  );

  if (args.schemaVersion === 4) {
    const key =
      args.meetingKey ?? (await getCaptureJournalAudioKey(normalizedMeetingId));
    if (!key) {
      throw new Error(
        `audio_key_unavailable: Meeting audio key is required to create capture journal v4 for ${normalizedMeetingId}`,
      );
    }
    const keyId = args.keyId ?? randomUUID();
    const expectedSources = args.expectedSources ?? ['mic', 'system'];
    const manifest: CaptureJournalManifestV4 = {
      schemaVersion: 4,
      meetingId: normalizedMeetingId,
      keyId,
      envelopeVersion: 1,
      artifactRootRelativePath,
      manifestRelativePath: `${artifactRootRelativePath}/${MANIFEST_FILE}`,
      lifecycleState: 'recording',
      startedAtMs: normalizeTimestampMs(startedAtMs),
      endedAtMs: null,
      entries: [],
      generation: randomUUID(),
      revision: 0,
      expectedSources,
      sourceAvailability: {
        mic: args.sourceAvailability?.mic ?? 'available',
        system: args.sourceAvailability?.system ?? 'available',
      },
      intervals: [],
      transcriptCheckpoints: [],
      acceptanceFrames: [],
    };
    await writeManifest(rootDir, manifest, durability, key);
    return manifest;
  }

  if (args.schemaVersion !== 3) {
    const manifest: CaptureJournalManifestV2 = {
      schemaVersion: 2,
      meetingId: normalizedMeetingId,
      artifactRootRelativePath,
      manifestRelativePath: `${artifactRootRelativePath}/${MANIFEST_FILE}`,
      lifecycleState: 'recording',
      startedAtMs: normalizeTimestampMs(startedAtMs),
      endedAtMs: null,
      entries: [],
    };
    await writeManifest(rootDir, manifest, durability);
    return manifest;
  }

  const expectedSources = args.expectedSources ?? ['mic', 'system'];
  const manifest: CaptureJournalManifestV3 = {
    schemaVersion: 3,
    meetingId: normalizedMeetingId,
    artifactRootRelativePath,
    manifestRelativePath: `${artifactRootRelativePath}/${MANIFEST_FILE}`,
    lifecycleState: 'recording',
    startedAtMs: normalizeTimestampMs(startedAtMs),
    endedAtMs: null,
    entries: [],
    generation: randomUUID(),
    revision: 0,
    expectedSources,
    sourceAvailability: {
      mic: args.sourceAvailability?.mic ?? 'available',
      system: args.sourceAvailability?.system ?? 'available',
    },
    intervals: [],
    transcriptCheckpoints: [],
    acceptanceFrames: [],
  };

  await writeManifest(rootDir, manifest, durability);
  return manifest;
};

const journalMutationTails = new Map<string, Promise<void>>();

const serializeJournalMutation = async <T>(
  rootDir: string,
  meetingId: string,
  mutation: () => Promise<T>,
): Promise<T> => {
  const key = getManifestPath(rootDir, normalizeMeetingId(meetingId));
  const previous = journalMutationTails.get(key) ?? Promise.resolve();
  let release: () => void = () => {};
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => current);
  journalMutationTails.set(key, tail);

  await previous;
  try {
    return await mutation();
  } finally {
    release();
    if (journalMutationTails.get(key) === tail) {
      journalMutationTails.delete(key);
    }
  }
};

export const requireV3OrV4Mutation = <
  T extends CaptureJournalManifestV3 | CaptureJournalManifestV4,
>(
  manifest: CaptureJournalManifest,
  identity: V3MutationIdentity,
): T => {
  if (manifest.schemaVersion !== 3 && manifest.schemaVersion !== 4) {
    throw new Error('Capture journal mutation requires schema version 3 or 4');
  }
  if (manifest.generation !== identity.generation) {
    throw new Error('Capture journal generation mismatch');
  }
  if (manifest.revision !== identity.expectedRevision) {
    throw new Error('Capture journal revision conflict');
  }
  if (manifest.lifecycleState === 'sealed') {
    throw new Error(
      `Capture journal for ${manifest.meetingId} is already sealed`,
    );
  }
  return manifest as T;
};

const writeSidecar = async (
  rootDir: string,
  relativePath: string,
  sidecar: unknown,
  durability: CaptureJournalDurability,
) => {
  const bytes = Buffer.from(JSON.stringify(sidecar));
  const path = join(rootDir, relativePath);
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.tmp`;
  await writeFile(tempPath, bytes);
  await durability.syncFile(tempPath);
  await rename(tempPath, path);
  await durability.syncDirectory(dirname(path));
  return { bytes, checksumSha256: computeChecksum(bytes) };
};

export const authorizeCaptureJournalInterval = async (
  rootDir: string,
  args: AuthorizeCaptureJournalIntervalArgs,
  durability: CaptureJournalDurability = defaultDurability,
): Promise<CaptureJournalManifestV3 | CaptureJournalManifestV4> =>
  serializeJournalMutation(rootDir, args.meetingId, async () => {
    const manifest = requireV3OrV4Mutation<
      CaptureJournalManifestV3 | CaptureJournalManifestV4
    >(
      await readCaptureJournalManifest(rootDir, args.meetingId, {
        meetingKey: args.meetingKey,
      }),
      args,
    );
    if (manifest.lifecycleState !== 'recording') {
      throw new Error('Capture journal is not accepting new intervals');
    }
    const sequence = normalizeSequence(args.sequence);
    const chunkStartSec = normalizeSeconds(args.chunkStartSec);
    const chunkEndSec = normalizeSeconds(args.chunkEndSec);
    if (chunkEndSec <= chunkStartSec) {
      throw new Error('Invalid capture journal interval bounds');
    }
    if (manifest.intervals.some((interval) => interval.sequence === sequence)) {
      throw new Error('Capture journal interval conflict');
    }
    const next: CaptureJournalManifestV3 | CaptureJournalManifestV4 = {
      ...manifest,
      revision: manifest.revision + 1,
      intervals: [
        ...manifest.intervals,
        {
          sequence,
          chunkStartSec,
          chunkEndSec,
          sources: {
            mic: { disposition: 'pending' },
            system: { disposition: 'pending' },
          },
        },
      ],
    };
    await writeManifest(rootDir, next, durability, args.meetingKey);
    return next;
  });

export const persistCaptureJournalRawChunk = async (
  rootDir: string,
  args: PersistCaptureJournalRawChunkArgs,
  durability: CaptureJournalDurability = defaultDurability,
): Promise<CaptureJournalManifestV3 | CaptureJournalManifestV4> =>
  serializeJournalMutation(rootDir, args.meetingId, async () => {
    const manifest = requireV3OrV4Mutation<
      CaptureJournalManifestV3 | CaptureJournalManifestV4
    >(
      await readCaptureJournalManifest(rootDir, args.meetingId, {
        meetingKey: args.meetingKey,
      }),
      args,
    );
    const interval = manifest.intervals.find(
      (candidate) => candidate.sequence === args.sequence,
    );
    if (!interval || interval.sources[args.source].disposition !== 'pending') {
      throw new Error('Capture journal raw transition conflict');
    }
    if (args.decodeDependency) {
      normalizeSequence(args.decodeDependency.anchorSequence);
      assertChecksum(
        args.decodeDependency.initializationChecksumSha256,
        'decode dependency checksum',
      );
    }
    const data = toBuffer(args.data);
    const rawChecksumSha256 = computeChecksum(data);

    let rawRelativePath: string;
    let rawCiphertextSha256: string | undefined;

    if (manifest.schemaVersion === 4) {
      const key =
        args.meetingKey ??
        (await getCaptureJournalAudioKey(manifest.meetingId));
      if (!key) {
        throw new Error(
          `audio_key_unavailable: Meeting audio key required for chunk persistence in ${manifest.meetingId}`,
        );
      }
      const opaqueFilename = `${randomUUID()}.enc`;
      rawRelativePath = `${manifest.artifactRootRelativePath}/chunks/${opaqueFilename}`;
      const rawPath = join(rootDir, rawRelativePath);
      const writeResult = await EncryptedArtifactStore.writeEncryptedFile(
        rawPath,
        data,
        key,
        {
          keyId: manifest.keyId,
          meetingId: manifest.meetingId,
          generation: manifest.generation,
          artifactKind: 'raw',
          source: args.source,
          sequence: args.sequence,
        },
      );
      rawCiphertextSha256 = writeResult.ciphertextSha256;
    } else {
      const extension = formatToExtension(args.format);
      rawRelativePath = `${manifest.artifactRootRelativePath}/chunks/${args.source}-${padSequence(args.sequence)}.${extension}`;
      const rawPath = join(rootDir, rawRelativePath);
      const tempPath = `${rawPath}.tmp`;
      await writeFile(tempPath, data);
      await durability.syncFile(tempPath);
      await rename(tempPath, rawPath);
      await durability.syncDirectory(dirname(rawPath));
    }

    const nextInterval: CaptureIntervalLedgerEntry = {
      ...interval,
      sources: {
        ...interval.sources,
        [args.source]: {
          disposition: 'raw_durable',
          rawChecksumSha256,
          rawRelativePath,
          ...(rawCiphertextSha256 ? { rawCiphertextSha256 } : {}),
          ...(args.decodeDependency
            ? { decodeDependency: args.decodeDependency }
            : {}),
        },
      },
    };
    const next: CaptureJournalManifestV3 | CaptureJournalManifestV4 = {
      ...manifest,
      revision: manifest.revision + 1,
      intervals: manifest.intervals.map((candidate) =>
        candidate.sequence === interval.sequence ? nextInterval : candidate,
      ),
    };
    await writeManifest(rootDir, next, durability, args.meetingKey);
    return next;
  });

export const completeCaptureJournalCapturedChunk = async (
  rootDir: string,
  args: CompleteCaptureJournalCapturedChunkArgs,
  durability: CaptureJournalDurability = defaultDurability,
): Promise<{
  manifest: CaptureJournalManifestV3 | CaptureJournalManifestV4;
  receipt: CaptureAudioReceipt;
}> =>
  serializeJournalMutation(rootDir, args.meetingId, async () => {
    const manifest = requireV3OrV4Mutation<
      CaptureJournalManifestV3 | CaptureJournalManifestV4
    >(
      await readCaptureJournalManifest(rootDir, args.meetingId, {
        meetingKey: args.meetingKey,
      }),
      args,
    );
    const interval = manifest.intervals.find(
      (candidate) => candidate.sequence === args.sequence,
    );
    const raw = interval?.sources[args.source];
    if (
      !interval ||
      raw?.disposition !== 'raw_durable' ||
      raw.rawChecksumSha256 !== args.rawChecksumSha256
    ) {
      throw new Error('Capture journal captured transition conflict');
    }

    if (manifest.schemaVersion === 4 && args.repairPath) {
      throw new Error(
        'Capture journal v4 does not permit plaintext repairPath; provide in-memory repairData',
      );
    }

    let repairData: Buffer;
    if (args.repairData) {
      repairData = toBuffer(args.repairData);
    } else if (args.repairPath) {
      const allowedRoot = resolve(rootDir);
      const candidate = resolve(args.repairPath);
      if (
        candidate === allowedRoot ||
        !candidate.startsWith(`${allowedRoot}${sep}`)
      ) {
        throw new Error(
          'Capture journal repair path is outside meeting storage',
        );
      }
      repairData = await readFile(candidate);
    } else {
      throw new Error('Capture journal repair artifact is required');
    }
    const repairChecksumSha256 = computeChecksum(repairData);

    let repairRelativePath: string;
    let repairCiphertextSha256: string | undefined;

    if (manifest.schemaVersion === 4) {
      const key =
        args.meetingKey ??
        (await getCaptureJournalAudioKey(manifest.meetingId));
      if (!key) {
        throw new Error(
          `audio_key_unavailable: Meeting audio key required for chunk completion in ${manifest.meetingId}`,
        );
      }
      const opaqueFilename = `${randomUUID()}.enc`;
      repairRelativePath = `${manifest.artifactRootRelativePath}/repair/${opaqueFilename}`;
      const repairPath = join(rootDir, repairRelativePath);
      const writeResult = await EncryptedArtifactStore.writeEncryptedFile(
        repairPath,
        repairData,
        key,
        {
          keyId: manifest.keyId,
          meetingId: manifest.meetingId,
          generation: manifest.generation,
          artifactKind: 'repair',
          source: args.source,
          sequence: args.sequence,
        },
      );
      repairCiphertextSha256 = writeResult.ciphertextSha256;
    } else {
      repairRelativePath = `${manifest.artifactRootRelativePath}/repair/${args.source}-${padSequence(args.sequence)}.wav`;
      const repairPath = join(rootDir, repairRelativePath);
      const tempPath = `${repairPath}.tmp`;
      await writeFile(tempPath, repairData);
      await durability.syncFile(tempPath);
      await rename(tempPath, repairPath);
      await durability.syncDirectory(dirname(repairPath));
    }

    const captured: CaptureIntervalSourceDisposition = {
      disposition: 'captured',
      rawChecksumSha256: raw.rawChecksumSha256,
      rawRelativePath: raw.rawRelativePath,
      ...(raw.rawCiphertextSha256
        ? { rawCiphertextSha256: raw.rawCiphertextSha256 }
        : {}),
      repairChecksumSha256,
      repairRelativePath,
      ...(repairCiphertextSha256
        ? { repairCiphertextSha256: repairCiphertextSha256 }
        : {}),
    };
    const next: CaptureJournalManifestV3 | CaptureJournalManifestV4 = {
      ...manifest,
      revision: manifest.revision + 1,
      intervals: manifest.intervals.map((candidate) =>
        candidate.sequence === interval.sequence
          ? {
              ...candidate,
              sources: { ...candidate.sources, [args.source]: captured },
            }
          : candidate,
      ),
    };
    await writeManifest(rootDir, next, durability, args.meetingKey);
    return {
      manifest: next,
      receipt: {
        durable: true,
        meetingId: manifest.meetingId,
        generation: manifest.generation,
        manifestRevision: next.revision,
        source: args.source,
        sequence: interval.sequence,
        checksumSha256: repairChecksumSha256,
        chunkStartSec: interval.chunkStartSec,
        chunkEndSec: interval.chunkEndSec,
        repairAudioRelativePath: repairRelativePath,
      },
    };
  });

const validateTranscriptCheckpointSidecar = (
  sidecar: CaptureTranscriptCheckpointV1,
  receipt: CaptureAudioReceipt,
) => {
  if (
    sidecar.schemaVersion !== 1 ||
    sidecar.meetingId !== receipt.meetingId ||
    sidecar.source !== receipt.source ||
    sidecar.sequence !== receipt.sequence ||
    sidecar.chunkChecksumSha256 !== receipt.checksumSha256 ||
    sidecar.chunkStartSec !== receipt.chunkStartSec ||
    sidecar.chunkEndSec !== receipt.chunkEndSec
  ) {
    throw new Error('Transcript checkpoint does not match audio receipt');
  }
  const duration = receipt.chunkEndSec - receipt.chunkStartSec;
  for (const segment of sidecar.segments) {
    if (
      !Number.isFinite(segment.start) ||
      !Number.isFinite(segment.end) ||
      segment.start < 0 ||
      segment.end <= segment.start ||
      segment.end > duration + 0.25 ||
      !segment.text.trim()
    ) {
      throw new Error('Invalid transcript checkpoint segment');
    }
    for (const word of segment.words ?? []) {
      if (
        !word.word.trim() ||
        !Number.isFinite(word.start) ||
        !Number.isFinite(word.end) ||
        word.start < 0 ||
        word.end <= word.start ||
        word.end > duration + 0.25
      ) {
        throw new Error('Invalid transcript checkpoint word');
      }
    }
  }
};

export const appendCaptureTranscriptCheckpoint = async (
  rootDir: string,
  args: AppendCaptureTranscriptCheckpointArgs,
  durability: CaptureJournalDurability = defaultDurability,
): Promise<{
  manifest: CaptureJournalManifestV3 | CaptureJournalManifestV4;
  checkpoint: CaptureTranscriptCheckpointRef;
}> =>
  serializeJournalMutation(rootDir, args.receipt.meetingId, async () => {
    const current = await readCaptureJournalManifest(
      rootDir,
      args.receipt.meetingId,
      { meetingKey: (args as any).meetingKey },
    );
    if (
      (current.schemaVersion !== 3 && current.schemaVersion !== 4) ||
      current.generation !== args.receipt.generation
    ) {
      throw new Error('Capture journal generation mismatch');
    }
    if (
      args.expectedManifestRevision > current.revision ||
      args.expectedManifestRevision < args.receipt.manifestRevision
    ) {
      throw new Error('Capture journal revision conflict');
    }
    if (current.lifecycleState === 'sealed') {
      throw new Error('Capture journal is already sealed');
    }
    const manifest = current;
    validateTranscriptCheckpointSidecar(args.sidecar, args.receipt);
    assertChecksum(args.transcriptionConfigKey, 'config key');
    if (
      computeChecksum(
        Buffer.from(
          canonicalizeTranscriptCheckpointConfig(
            args.sidecar.transcriptionConfig,
          ),
        ),
      ) !== args.transcriptionConfigKey
    ) {
      throw new Error('Transcript checkpoint configuration mismatch');
    }
    const interval = manifest.intervals.find(
      (candidate) => candidate.sequence === args.receipt.sequence,
    );
    const captured = interval?.sources[args.receipt.source];
    if (
      captured?.disposition !== 'captured' ||
      captured.repairChecksumSha256 !== args.receipt.checksumSha256 ||
      captured.repairRelativePath !== args.receipt.repairAudioRelativePath
    ) {
      throw new Error('Transcript checkpoint audio receipt is stale');
    }
    const existing = manifest.transcriptCheckpoints.find(
      (checkpoint) =>
        checkpoint.source === args.receipt.source &&
        checkpoint.sequence === args.receipt.sequence,
    );
    const relativePath = `${manifest.artifactRootRelativePath}/transcript-checkpoints/${args.receipt.source}-${padSequence(args.receipt.sequence)}-r0.json`;
    const sidecarBytes = Buffer.from(JSON.stringify(args.sidecar));
    const checksumSha256 = computeChecksum(sidecarBytes);
    if (existing) {
      if (existing.transcriptChecksumSha256 === checksumSha256) {
        await readCaptureJournalSidecar(
          rootDir,
          manifest.meetingId,
          existing.relativePath,
          existing.transcriptChecksumSha256,
        );
        return { manifest, checkpoint: existing };
      }
      throw new Error('Transcript checkpoint conflict');
    }
    await writeSidecar(rootDir, relativePath, args.sidecar, durability);
    const checkpoint: CaptureTranscriptCheckpointRef = {
      source: args.receipt.source,
      sequence: args.receipt.sequence,
      chunkChecksumSha256: args.receipt.checksumSha256,
      chunkStartSec: args.receipt.chunkStartSec,
      chunkEndSec: args.receipt.chunkEndSec,
      transcriptionConfigKey: args.transcriptionConfigKey,
      transcriptChecksumSha256: checksumSha256,
      revision: 0,
      disposition: args.disposition ?? 'transcribed',
      relativePath,
    };
    const next: CaptureJournalManifestV3 | CaptureJournalManifestV4 = {
      ...manifest,
      revision: manifest.revision + 1,
      transcriptCheckpoints: [...manifest.transcriptCheckpoints, checkpoint],
    };
    await writeManifest(rootDir, next, durability, (args as any).meetingKey);
    return { manifest: next, checkpoint };
  });

export const replaceCaptureTranscriptCheckpoint = async (
  rootDir: string,
  args: ReplaceCaptureTranscriptCheckpointArgs,
  durability: CaptureJournalDurability = defaultDurability,
): Promise<{
  manifest: CaptureJournalManifestV3 | CaptureJournalManifestV4;
  checkpoint: CaptureTranscriptCheckpointRef;
}> =>
  serializeJournalMutation(rootDir, args.receipt.meetingId, async () => {
    const manifest = await readCaptureJournalManifest(
      rootDir,
      args.receipt.meetingId,
      { meetingKey: (args as any).meetingKey },
    );
    if (
      (manifest.schemaVersion !== 3 && manifest.schemaVersion !== 4) ||
      manifest.generation !== args.receipt.generation ||
      manifest.lifecycleState === 'sealed'
    ) {
      throw new Error('Capture journal checkpoint replacement superseded');
    }
    if (manifest.revision !== args.expectedManifestRevision) {
      throw new Error('Capture journal revision conflict');
    }
    const index = manifest.transcriptCheckpoints.findIndex(
      (checkpoint) =>
        checkpoint.source === args.receipt.source &&
        checkpoint.sequence === args.receipt.sequence,
    );
    const prior = manifest.transcriptCheckpoints[index];
    if (
      !prior ||
      prior.transcriptChecksumSha256 !==
        args.expectedPriorTranscriptChecksumSha256 ||
      prior.repairAttempted
    ) {
      throw new Error('Transcript checkpoint replacement conflict');
    }
    validateTranscriptCheckpointSidecar(args.sidecar, args.receipt);
    const configKey = computeChecksum(
      Buffer.from(
        canonicalizeTranscriptCheckpointConfig(
          args.sidecar.transcriptionConfig,
        ),
      ),
    );
    if (configKey !== args.transcriptionConfigKey) {
      throw new Error('Transcript checkpoint configuration mismatch');
    }
    const interval = manifest.intervals.find(
      (candidate) => candidate.sequence === args.receipt.sequence,
    );
    const captured = interval?.sources[args.receipt.source];
    if (
      !interval ||
      captured?.disposition !== 'captured' ||
      captured.repairChecksumSha256 !== args.receipt.checksumSha256
    ) {
      throw new Error('Transcript checkpoint audio receipt is stale');
    }
    const revision = prior.revision + 1;
    const relativePath = `${manifest.artifactRootRelativePath}/transcript-checkpoints/${args.receipt.source}-${padSequence(args.receipt.sequence)}-r${revision}.json`;
    const sidecarBytes = Buffer.from(JSON.stringify(args.sidecar));
    const transcriptChecksumSha256 = computeChecksum(sidecarBytes);
    await writeSidecar(rootDir, relativePath, args.sidecar, durability);
    const checkpoint: CaptureTranscriptCheckpointRef = {
      ...prior,
      transcriptionConfigKey: args.transcriptionConfigKey,
      transcriptChecksumSha256,
      revision,
      repairAttempted: true,
      disposition: args.disposition ?? 'transcribed',
      relativePath,
    };
    const transcriptCheckpoints = [...manifest.transcriptCheckpoints];
    transcriptCheckpoints[index] = checkpoint;
    const next: CaptureJournalManifestV3 | CaptureJournalManifestV4 = {
      ...manifest,
      revision: manifest.revision + 1,
      transcriptCheckpoints,
    };
    await writeManifest(rootDir, next, durability, (args as any).meetingKey);
    return { manifest: next, checkpoint };
  });

export const promoteCaptureTranscriptCheckpoint = async (
  rootDir: string,
  args: PromoteCaptureTranscriptCheckpointArgs,
  durability: CaptureJournalDurability = defaultDurability,
): Promise<{
  manifest: CaptureJournalManifestV3 | CaptureJournalManifestV4;
  checkpoint: CaptureTranscriptCheckpointRef;
  frame: CaptureTranscriptAcceptanceFrame;
}> =>
  serializeJournalMutation(rootDir, args.receipt.meetingId, async () => {
    const manifest = await readCaptureJournalManifest(
      rootDir,
      args.receipt.meetingId,
      { meetingKey: (args as any).meetingKey },
    );
    if (
      (manifest.schemaVersion !== 3 && manifest.schemaVersion !== 4) ||
      manifest.generation !== args.receipt.generation ||
      manifest.lifecycleState === 'sealed'
    ) {
      throw new Error('Capture journal checkpoint promotion superseded');
    }
    if (manifest.revision !== args.expectedManifestRevision) {
      throw new Error('Capture journal revision conflict');
    }
    const checkpointIndex = manifest.transcriptCheckpoints.findIndex(
      (checkpoint) =>
        checkpoint.source === args.receipt.source &&
        checkpoint.sequence === args.receipt.sequence,
    );
    const priorCheckpoint = manifest.transcriptCheckpoints[checkpointIndex];
    const frameIndex = manifest.acceptanceFrames.findIndex(
      (frame) => frame.sequence === args.receipt.sequence,
    );
    const priorFrame = manifest.acceptanceFrames[frameIndex];
    if (
      !priorCheckpoint ||
      priorCheckpoint.transcriptChecksumSha256 !==
        args.expectedPriorTranscriptChecksumSha256 ||
      priorCheckpoint.repairAttempted ||
      !priorFrame ||
      priorFrame.acceptedChecksumSha256 !==
        args.expectedPriorAcceptedChecksumSha256 ||
      (priorFrame.revision ?? 0) > 0
    ) {
      throw new Error('Transcript checkpoint promotion conflict');
    }
    validateTranscriptCheckpointSidecar(args.sidecar, args.receipt);
    const configKey = computeChecksum(
      Buffer.from(
        canonicalizeTranscriptCheckpointConfig(
          args.sidecar.transcriptionConfig,
        ),
      ),
    );
    if (configKey !== args.transcriptionConfigKey) {
      throw new Error('Transcript checkpoint configuration mismatch');
    }
    const interval = manifest.intervals.find(
      (candidate) => candidate.sequence === args.receipt.sequence,
    );
    const captured = interval?.sources[args.receipt.source];
    if (
      !interval ||
      captured?.disposition !== 'captured' ||
      captured.repairChecksumSha256 !== args.receipt.checksumSha256 ||
      captured.repairRelativePath !== args.receipt.repairAudioRelativePath
    ) {
      throw new Error('Transcript checkpoint audio receipt is stale');
    }

    const checkpointRevision = priorCheckpoint.revision + 1;
    const checkpointRelativePath = `${manifest.artifactRootRelativePath}/transcript-checkpoints/${args.receipt.source}-${padSequence(args.receipt.sequence)}-r${checkpointRevision}.json`;
    const checkpointBytes = Buffer.from(JSON.stringify(args.sidecar));
    const transcriptChecksumSha256 = computeChecksum(checkpointBytes);
    const checkpoint: CaptureTranscriptCheckpointRef = {
      ...priorCheckpoint,
      transcriptionConfigKey: args.transcriptionConfigKey,
      transcriptChecksumSha256,
      revision: checkpointRevision,
      repairAttempted: true,
      disposition: args.disposition ?? 'transcribed',
      relativePath: checkpointRelativePath,
    };

    const acceptance = args.acceptance;
    assertChecksum(
      acceptance.activityEvidenceDigestSha256,
      'activity evidence checksum',
    );
    if (
      acceptance.sequence !== interval.sequence ||
      acceptance.sidecar.schemaVersion !== 1 ||
      acceptance.sidecar.meetingId !== manifest.meetingId ||
      acceptance.sidecar.sequence !== interval.sequence ||
      acceptance.sidecar.arbitrationVersion !== 'chunk_arbitration_v1' ||
      computeChecksum(
        Buffer.from(JSON.stringify(acceptance.sidecar.activityInputs)),
      ) !== acceptance.activityEvidenceDigestSha256
    ) {
      throw new Error('Invalid transcript acceptance promotion');
    }
    const priorFrameBytes = await readCaptureJournalSidecar(
      rootDir,
      manifest.meetingId,
      priorFrame.relativePath,
      priorFrame.acceptedChecksumSha256,
      { meetingKey: (args as any).meetingKey },
    );
    const priorFrameSidecar = JSON.parse(
      priorFrameBytes.toString('utf8'),
    ) as CaptureTranscriptAcceptanceFrameV1;
    if (
      priorFrame.activityEvidenceDigestSha256 !==
        acceptance.activityEvidenceDigestSha256 ||
      JSON.stringify(priorFrameSidecar.activityInputs) !==
        JSON.stringify(acceptance.sidecar.activityInputs)
    ) {
      throw new Error('Transcript acceptance activity evidence changed');
    }
    const orderedSegments = (
      segments: CaptureTranscriptAcceptanceFrameV1['segments'],
    ) =>
      [...segments].sort(
        (left, right) =>
          left.start - right.start ||
          left.end - right.end ||
          left.source.localeCompare(right.source),
      );
    const unchangedSourceSegments = orderedSegments(
      priorFrameSidecar.segments.filter(
        (segment) => segment.source !== args.receipt.source,
      ),
    );
    const suppliedUnchangedSourceSegments = orderedSegments(
      acceptance.sidecar.segments.filter(
        (segment) => segment.source !== args.receipt.source,
      ),
    );
    if (
      JSON.stringify(unchangedSourceSegments) !==
      JSON.stringify(suppliedUnchangedSourceSegments)
    ) {
      throw new Error('Transcript acceptance unrelated source changed');
    }
    const expectedPromotedSegments = orderedSegments(
      args.sidecar.segments.map((segment) => ({
        source: args.receipt.source,
        start: segment.start + args.receipt.chunkStartSec,
        end: segment.end + args.receipt.chunkStartSec,
        text: segment.text,
        ...(segment.words
          ? {
              words: segment.words.map((word) => ({
                word: word.word,
                start: word.start + args.receipt.chunkStartSec,
                end: word.end + args.receipt.chunkStartSec,
              })),
            }
          : {}),
      })),
    );
    const suppliedPromotedSegments = orderedSegments(
      acceptance.sidecar.segments.filter(
        (segment) => segment.source === args.receipt.source,
      ),
    );
    if (
      JSON.stringify(expectedPromotedSegments) !==
      JSON.stringify(suppliedPromotedSegments)
    ) {
      throw new Error('Transcript acceptance promotion evidence mismatch');
    }
    const promotedDigests = {
      mic:
        args.receipt.source === 'mic'
          ? transcriptChecksumSha256
          : acceptance.micCheckpointChecksumSha256,
      system:
        args.receipt.source === 'system'
          ? transcriptChecksumSha256
          : acceptance.systemCheckpointChecksumSha256,
    };
    for (const source of ['mic', 'system'] as const) {
      const supplied = promotedDigests[source];
      const sourceDisposition = interval.sources[source].disposition;
      if (supplied === null) {
        if (sourceDisposition === 'captured') {
          throw new Error('Transcript acceptance checkpoint missing');
        }
        continue;
      }
      if (sourceDisposition !== 'captured') {
        throw new Error('Unexpected transcript acceptance checkpoint');
      }
      const linked =
        source === args.receipt.source
          ? supplied === transcriptChecksumSha256
          : manifest.transcriptCheckpoints.some(
              (candidate) =>
                candidate.source === source &&
                candidate.sequence === interval.sequence &&
                candidate.transcriptChecksumSha256 === supplied,
            );
      if (!linked) throw new Error('Transcript acceptance checkpoint mismatch');
    }
    for (const segment of acceptance.sidecar.segments) {
      if (
        (segment.source !== 'mic' && segment.source !== 'system') ||
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
          throw new Error('Invalid transcript acceptance segment word');
        }
      }
    }
    const frameIndexToUpdate = manifest.acceptanceFrames.findIndex(
      (candidate) => candidate.sequence === interval.sequence,
    );
    const existing = manifest.acceptanceFrames[frameIndexToUpdate];
    const replacementRevision = existing ? (existing.revision ?? 0) + 1 : 0;
    const frameRelativePath = `${manifest.artifactRootRelativePath}/acceptance-frames/${padSequence(interval.sequence)}${replacementRevision > 0 ? `-r${replacementRevision}` : ''}.json`;
    const frameBytes = Buffer.from(JSON.stringify(acceptance.sidecar));
    const frameChecksumSha256 = computeChecksum(frameBytes);
    const frame: CaptureTranscriptAcceptanceFrame = {
      sequence: interval.sequence,
      micCheckpointChecksumSha256: promotedDigests.mic,
      systemCheckpointChecksumSha256: promotedDigests.system,
      arbitrationVersion: 'chunk_arbitration_v1',
      activityEvidenceDigestSha256: acceptance.activityEvidenceDigestSha256,
      acceptedChecksumSha256: frameChecksumSha256,
      relativePath: frameRelativePath,
      revision: replacementRevision,
    };

    await writeSidecar(
      rootDir,
      checkpointRelativePath,
      args.sidecar,
      durability,
    );
    await writeSidecar(
      rootDir,
      frameRelativePath,
      acceptance.sidecar,
      durability,
    );
    const transcriptCheckpoints = [...manifest.transcriptCheckpoints];
    transcriptCheckpoints[checkpointIndex] = checkpoint;
    const acceptanceFrames = [...manifest.acceptanceFrames];
    acceptanceFrames[frameIndex] = frame;
    const next: CaptureJournalManifestV3 | CaptureJournalManifestV4 = {
      ...manifest,
      revision: manifest.revision + 1,
      transcriptCheckpoints,
      acceptanceFrames,
    };
    await writeManifest(rootDir, next, durability, (args as any).meetingKey);
    return { manifest: next, checkpoint, frame };
  });

export const appendCaptureTranscriptAcceptanceFrame = async (
  rootDir: string,
  args: AppendCaptureTranscriptAcceptanceFrameArgs,
  durability: CaptureJournalDurability = defaultDurability,
): Promise<{
  manifest: CaptureJournalManifestV3 | CaptureJournalManifestV4;
  frame: CaptureTranscriptAcceptanceFrame;
}> =>
  serializeJournalMutation(rootDir, args.meetingId, async () => {
    const manifest = requireV3OrV4Mutation<
      CaptureJournalManifestV3 | CaptureJournalManifestV4
    >(
      await readCaptureJournalManifest(rootDir, args.meetingId, {
        meetingKey: (args as any).meetingKey,
      }),
      args,
    );
    assertChecksum(
      args.activityEvidenceDigestSha256,
      'activity evidence checksum',
    );
    const interval = manifest.intervals.find(
      (candidate) => candidate.sequence === args.sequence,
    );
    if (!interval) throw new Error('Transcript acceptance interval missing');
    if (
      args.sidecar.schemaVersion !== 1 ||
      args.sidecar.meetingId !== manifest.meetingId ||
      args.sidecar.sequence !== args.sequence ||
      args.sidecar.arbitrationVersion !== 'chunk_arbitration_v1' ||
      !Array.isArray(args.sidecar.segments)
    ) {
      throw new Error('Invalid transcript acceptance frame');
    }
    if (
      computeChecksum(
        Buffer.from(JSON.stringify(args.sidecar.activityInputs)),
      ) !== args.activityEvidenceDigestSha256
    ) {
      throw new Error('Transcript acceptance activity evidence mismatch');
    }
    for (const source of ['mic', 'system'] as const) {
      const supplied =
        source === 'mic'
          ? args.micCheckpointChecksumSha256
          : args.systemCheckpointChecksumSha256;
      const sourceDisposition = interval.sources[source].disposition;
      if (supplied === null) {
        if (sourceDisposition === 'captured') {
          throw new Error('Transcript acceptance checkpoint missing');
        }
        continue;
      }
      if (sourceDisposition !== 'captured') {
        throw new Error('Unexpected transcript acceptance checkpoint');
      }
      assertChecksum(supplied, 'acceptance checkpoint checksum');
      const linked = manifest.transcriptCheckpoints.some(
        (checkpoint) =>
          checkpoint.source === source &&
          checkpoint.sequence === args.sequence &&
          checkpoint.transcriptChecksumSha256 === supplied,
      );
      if (!linked) {
        throw new Error('Transcript acceptance checkpoint mismatch');
      }
    }
    for (const segment of args.sidecar.segments) {
      if (
        (segment.source !== 'mic' && segment.source !== 'system') ||
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
          throw new Error('Invalid transcript acceptance segment word');
        }
      }
    }
    const existing = manifest.acceptanceFrames.find(
      (frame) => frame.sequence === args.sequence,
    );
    const replacementRevision = existing ? (existing.revision ?? 0) + 1 : 0;
    const relativePath = `${manifest.artifactRootRelativePath}/acceptance-frames/${padSequence(args.sequence)}${replacementRevision > 0 ? `-r${replacementRevision}` : ''}.json`;
    const checksumSha256 = computeChecksum(
      Buffer.from(JSON.stringify(args.sidecar)),
    );
    if (existing) {
      if (existing.acceptedChecksumSha256 === checksumSha256) {
        return { manifest, frame: existing };
      }
      if (
        manifest.lifecycleState !== 'stopping' ||
        existing.acceptedChecksumSha256 !==
          args.expectedPriorAcceptedChecksumSha256 ||
        (existing.revision ?? 0) > 0
      ) {
        throw new Error('Transcript acceptance frame conflict');
      }
    }
    await writeSidecar(rootDir, relativePath, args.sidecar, durability);
    const frame: CaptureTranscriptAcceptanceFrame = {
      sequence: normalizeSequence(args.sequence),
      micCheckpointChecksumSha256: args.micCheckpointChecksumSha256,
      systemCheckpointChecksumSha256: args.systemCheckpointChecksumSha256,
      arbitrationVersion: 'chunk_arbitration_v1',
      activityEvidenceDigestSha256: args.activityEvidenceDigestSha256,
      acceptedChecksumSha256: checksumSha256,
      relativePath,
      revision: replacementRevision,
    };
    const acceptanceFrames = existing
      ? manifest.acceptanceFrames.map((candidate) =>
          candidate.sequence === frame.sequence ? frame : candidate,
        )
      : [...manifest.acceptanceFrames, frame];
    const next: CaptureJournalManifestV3 | CaptureJournalManifestV4 = {
      ...manifest,
      revision: manifest.revision + 1,
      acceptanceFrames,
    };
    await writeManifest(rootDir, next, durability, (args as any).meetingKey);
    return { manifest: next, frame };
  });

export const readCaptureJournalSidecar = async (
  rootDir: string,
  meetingId: string,
  relativePath: string,
  checksumSha256: string,
  options?: { meetingKey?: Buffer },
): Promise<Buffer> => {
  const manifest = await readCaptureJournalManifest(
    rootDir,
    meetingId,
    options,
  );
  assertChecksum(checksumSha256, 'sidecar checksum');
  const allowed =
    (manifest.schemaVersion === 3 || manifest.schemaVersion === 4) &&
    [
      ...manifest.transcriptCheckpoints.map((entry) => ({
        path: entry.relativePath,
        checksum: entry.transcriptChecksumSha256,
      })),
      ...manifest.acceptanceFrames.map((entry) => ({
        path: entry.relativePath,
        checksum: entry.acceptedChecksumSha256,
      })),
    ].some(
      (entry) =>
        entry.path === relativePath && entry.checksum === checksumSha256,
    );
  if (!allowed) throw new Error('Capture journal sidecar is not referenced');
  const bytes = await readFile(join(rootDir, relativePath));
  if (computeChecksum(bytes) !== checksumSha256) {
    throw new Error('Capture journal sidecar checksum mismatch');
  }
  return bytes;
};

export const deleteCaptureJournal = async (
  rootDir: string,
  meetingId: string,
): Promise<void> => {
  const normalizedMeetingId = normalizeMeetingId(meetingId);
  await serializeJournalMutation(rootDir, normalizedMeetingId, async () => {
    await rm(getArtifactRootPath(rootDir, normalizedMeetingId), {
      recursive: true,
      force: true,
    });
  });
};

const appendCaptureJournalChunkUnlocked = async (
  rootDir: string,
  args: AppendCaptureJournalChunkArgs,
  durability: CaptureJournalDurability = defaultDurability,
): Promise<CaptureJournalManifest> => {
  const meetingId = normalizeMeetingId(args.meetingId);
  const manifest = await createCaptureJournal(
    rootDir,
    {
      meetingId,
      startedAtMs: 0,
      meetingKey: args.meetingKey,
    },
    durability,
  );

  if (manifest.schemaVersion === 1) {
    throw new Error('Cannot mutate legacy capture journal');
  }

  if (manifest.lifecycleState === 'sealed') {
    throw new Error(`Capture journal for ${meetingId} is already sealed`);
  }

  const sequence = normalizeSequence(args.sequence);
  const chunkStartSec = normalizeSeconds(args.chunkStartSec);
  const chunkEndSec = Math.max(
    chunkStartSec,
    normalizeSeconds(args.chunkEndSec),
  );
  const format = String(args.format || 'bin');
  const data = toBuffer(args.data);
  const checksumSha256 = computeChecksum(data);

  if (manifest.schemaVersion === 4) {
    const key = args.meetingKey ?? (await getCaptureJournalAudioKey(meetingId));
    if (!key) {
      throw new Error(
        `audio_key_unavailable: Meeting audio key required for chunk persistence in ${meetingId}`,
      );
    }
    const existing = manifest.entries.find(
      (entry) => entry.source === args.source && entry.sequence === sequence,
    );
    if (existing) {
      if (
        existing.chunkStartSec !== chunkStartSec ||
        existing.chunkEndSec !== chunkEndSec ||
        existing.format !== format ||
        existing.byteCount !== data.byteLength ||
        existing.checksumSha256 !== checksumSha256
      ) {
        throw new Error(
          `Capture journal conflict for ${meetingId} ${args.source}#${sequence}`,
        );
      }
      const decrypted = await EncryptedArtifactStore.readEncryptedFile(
        join(rootDir, existing.relativePath),
        key,
        {
          keyId: manifest.keyId,
          meetingId,
          artifactKind: 'chunk',
        },
      );
      if (computeChecksum(decrypted.plaintext) !== existing.checksumSha256) {
        throw new Error(
          `Capture journal artifact checksum mismatch for ${meetingId} ${args.source}#${sequence}`,
        );
      }
      return manifest;
    }

    const opaqueFilename = `${randomUUID()}.enc`;
    const relativePath = `${manifest.artifactRootRelativePath}/chunks/${opaqueFilename}`;
    const chunkPath = join(rootDir, relativePath);
    const writeResult = await EncryptedArtifactStore.writeEncryptedFile(
      chunkPath,
      data,
      key,
      {
        keyId: manifest.keyId,
        meetingId: manifest.meetingId,
        generation: manifest.generation,
        artifactKind: 'chunk',
        source: args.source,
        sequence,
      },
    );

    const nextManifest: CaptureJournalManifestV4 = {
      ...manifest,
      revision: manifest.revision + 1,
      entries: [
        ...manifest.entries,
        {
          source: args.source,
          sequence,
          chunkStartSec,
          chunkEndSec,
          format,
          byteCount: data.byteLength,
          checksumSha256,
          relativePath,
          ciphertextSha256: writeResult.ciphertextSha256,
        },
      ],
    };
    await writeManifest(rootDir, nextManifest, durability, key);
    return nextManifest;
  }

  const relativePath = `${manifest.artifactRootRelativePath}/chunks/${args.source}-${padSequence(sequence)}.${formatToExtension(format)}`;

  const existing = manifest.entries.find(
    (entry) => entry.source === args.source && entry.sequence === sequence,
  );
  if (existing) {
    if (
      existing.chunkStartSec !== chunkStartSec ||
      existing.chunkEndSec !== chunkEndSec ||
      existing.format !== format ||
      existing.byteCount !== data.byteLength ||
      existing.checksumSha256 !== checksumSha256 ||
      existing.relativePath !== relativePath
    ) {
      throw new Error(
        `Capture journal conflict for ${meetingId} ${args.source}#${sequence}`,
      );
    }

    const existingStats = await stat(join(rootDir, existing.relativePath));
    if (existingStats.size !== existing.byteCount) {
      throw new Error(
        `Capture journal artifact size mismatch for ${meetingId} ${args.source}#${sequence}`,
      );
    }
    const existingData = await readFile(join(rootDir, existing.relativePath));
    if (computeChecksum(existingData) !== existing.checksumSha256) {
      throw new Error(
        `Capture journal artifact checksum mismatch for ${meetingId} ${args.source}#${sequence}`,
      );
    }
    return manifest;
  }

  const chunkPath = join(rootDir, relativePath);
  await mkdir(join(chunkPath, '..'), { recursive: true });
  const tempChunkPath = `${chunkPath}.tmp`;
  await writeFile(tempChunkPath, data);
  await durability.syncFile(tempChunkPath);
  await rename(tempChunkPath, chunkPath);
  await durability.syncDirectory(dirname(chunkPath));

  const nextManifest: CaptureJournalManifest = {
    ...manifest,
    entries: [
      ...manifest.entries,
      {
        source: args.source,
        sequence,
        chunkStartSec,
        chunkEndSec,
        format,
        byteCount: data.byteLength,
        checksumSha256,
        relativePath,
      },
    ],
  };
  await writeManifest(rootDir, nextManifest, durability);
  return nextManifest;
};

export const appendCaptureJournalChunk = async (
  rootDir: string,
  args: AppendCaptureJournalChunkArgs,
  durability: CaptureJournalDurability = defaultDurability,
): Promise<CaptureJournalManifest> =>
  serializeJournalMutation(rootDir, args.meetingId, () =>
    appendCaptureJournalChunkUnlocked(rootDir, args, durability),
  );

const getFinalActivityWindowEnd = (evidence: CaptureActivityEvidence) =>
  evidence.windows.reduce(
    (latest, window) => Math.max(latest, window.endTime),
    0,
  );

const hasSameActivityProducer = (
  left: CaptureActivityEvidence,
  right: CaptureActivityEvidence,
) =>
  left.clock.kind === right.clock.kind &&
  left.clock.origin === right.clock.origin &&
  left.thresholds.rms === right.thresholds.rms &&
  left.thresholds.dominanceRatio === right.thresholds.dominanceRatio &&
  left.thresholds.minimumSwitchIntervalMs ===
    right.thresholds.minimumSwitchIntervalMs &&
  left.algorithmVersion === right.algorithmVersion &&
  left.serializationVersion === right.serializationVersion;

const hasExactWindowPrefix = (
  stored: CaptureActivityEvidence,
  candidate: CaptureActivityEvidence,
) =>
  stored.windows.every((window, index) => {
    const next = candidate.windows[index];
    return (
      next?.startTime === window.startTime &&
      next.endTime === window.endTime &&
      next.speaker === window.speaker
    );
  });

const updateCaptureJournalActivityEvidenceUnlocked = async (
  rootDir: string,
  args: UpdateCaptureJournalActivityEvidenceArgs,
  durability: CaptureJournalDurability = defaultDurability,
): Promise<
  CaptureJournalManifestV2 | CaptureJournalManifestV3 | CaptureJournalManifestV4
> => {
  const meetingId = normalizeMeetingId(args.meetingId);
  const manifest = await createCaptureJournal(
    rootDir,
    { meetingId, startedAtMs: 0, meetingKey: args.meetingKey },
    durability,
  );
  if (manifest.schemaVersion === 1) {
    throw new Error('Cannot mutate legacy capture journal');
  }
  if (manifest.lifecycleState === 'sealed') {
    throw new Error(`Capture journal for ${meetingId} is already sealed`);
  }

  const parsed = await parseCaptureActivityEvidence(args.activityEvidence);
  if (!parsed.ok) throw new Error(parsed.reason);
  const activityEvidence = parsed.evidence;
  const stored = manifest.activityEvidence;
  if (stored) {
    if (stored.digestSha256 === activityEvidence.digestSha256) return manifest;
    if (
      getFinalActivityWindowEnd(activityEvidence) <
        getFinalActivityWindowEnd(stored) ||
      activityEvidence.windows.length < stored.windows.length
    ) {
      throw new Error('Older activity evidence snapshot');
    }
    if (activityEvidence.windows.length === stored.windows.length) {
      throw new Error('Conflicting activity evidence snapshot');
    }
    if (
      !hasSameActivityProducer(stored, activityEvidence) ||
      !hasExactWindowPrefix(stored, activityEvidence)
    ) {
      throw new Error('Conflicting activity evidence snapshot');
    }
  }

  const nextManifest:
    | CaptureJournalManifestV2
    | CaptureJournalManifestV3
    | CaptureJournalManifestV4 = {
    ...manifest,
    activityEvidence,
    ...(manifest.schemaVersion === 3 || manifest.schemaVersion === 4
      ? { revision: manifest.revision + 1 }
      : {}),
  };
  await writeManifest(rootDir, nextManifest, durability, args.meetingKey);
  return nextManifest;
};

export const updateCaptureJournalActivityEvidence = async (
  rootDir: string,
  args: UpdateCaptureJournalActivityEvidenceArgs,
  durability: CaptureJournalDurability = defaultDurability,
): Promise<
  CaptureJournalManifestV2 | CaptureJournalManifestV3 | CaptureJournalManifestV4
> =>
  serializeJournalMutation(rootDir, args.meetingId, () =>
    updateCaptureJournalActivityEvidenceUnlocked(rootDir, args, durability),
  );

export const markCaptureJournalSourceFailed = async (
  rootDir: string,
  args: V3MutationIdentity & {
    source: CaptureJournalSource;
    meetingKey?: Buffer;
  },
  durability: CaptureJournalDurability = defaultDurability,
): Promise<CaptureJournalManifestV3 | CaptureJournalManifestV4> =>
  serializeJournalMutation(rootDir, args.meetingId, async () => {
    const manifest = requireV3OrV4Mutation<
      CaptureJournalManifestV3 | CaptureJournalManifestV4
    >(
      await readCaptureJournalManifest(rootDir, args.meetingId, {
        meetingKey: args.meetingKey,
      }),
      args,
    );
    if (args.source !== 'mic' && args.source !== 'system') {
      throw new Error('Invalid capture source');
    }
    if (manifest.sourceAvailability[args.source] === 'failed_during_capture') {
      return manifest;
    }
    const next: CaptureJournalManifestV3 | CaptureJournalManifestV4 = {
      ...manifest,
      revision: manifest.revision + 1,
      sourceAvailability: {
        ...manifest.sourceAvailability,
        [args.source]: 'failed_during_capture',
      },
    };
    await writeManifest(rootDir, next, durability, args.meetingKey);
    return next;
  });

export const stopCaptureJournal = async (
  rootDir: string,
  args: StopCaptureJournalArgs,
  durability: CaptureJournalDurability = defaultDurability,
): Promise<CaptureJournalManifestV3 | CaptureJournalManifestV4> =>
  serializeJournalMutation(rootDir, args.meetingId, async () => {
    const manifest = requireV3OrV4Mutation<
      CaptureJournalManifestV3 | CaptureJournalManifestV4
    >(
      await readCaptureJournalManifest(rootDir, args.meetingId, {
        meetingKey: args.meetingKey,
      }),
      args,
    );
    if (manifest.lifecycleState !== 'recording') {
      throw new Error('Capture journal stopping transition conflict');
    }
    const stoppingWatermarks = {
      mic: Math.max(
        -1,
        ...manifest.intervals.map((interval) => interval.sequence),
      ),
      system: Math.max(
        -1,
        ...manifest.intervals.map((interval) => interval.sequence),
      ),
    };
    const intervals = manifest.intervals.map((interval) => ({
      ...interval,
      sources: Object.fromEntries(
        (['mic', 'system'] as const).map((source) => {
          const current = interval.sources[source];
          if (current.disposition !== 'pending') return [source, current];
          const unavailable =
            manifest.sourceAvailability[source] === 'unavailable_at_start';
          return [
            source,
            unavailable
              ? {
                  disposition: 'source_unavailable' as const,
                  reason: 'unavailable_at_start',
                }
              : {
                  disposition: 'missing' as const,
                  reason: 'pending_at_stop',
                },
          ];
        }),
      ) as CaptureIntervalLedgerEntry['sources'],
    }));
    const next: CaptureJournalManifestV3 | CaptureJournalManifestV4 = {
      ...manifest,
      lifecycleState: 'stopping',
      revision: manifest.revision + 1,
      stoppingWatermarks,
      intervals,
    };
    await writeManifest(rootDir, next, durability, args.meetingKey);
    return next;
  });

export const recordCaptureJournalStickyFailure = async (
  rootDir: string,
  args: {
    meetingId: string;
    reason: string;
    code?: CaptureJournalStickyFailure['code'];
    details?: unknown;
    meetingKey?: Buffer;
  },
  durability: CaptureJournalDurability = defaultDurability,
): Promise<CaptureJournalManifestV4> =>
  serializeJournalMutation(rootDir, args.meetingId, async () => {
    const manifest = await readCaptureJournalManifest(rootDir, args.meetingId, {
      meetingKey: args.meetingKey,
    });
    if (manifest.schemaVersion !== 4) {
      throw new Error(
        'Sticky failures are only supported on schema v4 capture journals',
      );
    }
    const stickyFailure: CaptureJournalStickyFailure = {
      code: args.code ?? 'authentication_failed',
      message: args.reason,
      occurredAtMs: Date.now(),
      ...(args.details ? { details: args.details } : {}),
    };
    const next: CaptureJournalManifestV4 = {
      ...manifest,
      revision: manifest.revision + 1,
      stickyFailure,
    };
    await writeManifest(rootDir, next, durability, args.meetingKey);
    return next;
  });

export const readCaptureJournalChunk = async (
  rootDir: string,
  meetingId: string,
  relativePath: string,
  options?: { meetingKey?: Buffer },
): Promise<Buffer> => {
  const normalizedMeetingId = normalizeMeetingId(meetingId);
  const manifest = await readCaptureJournalManifest(
    rootDir,
    normalizedMeetingId,
    options,
  );

  let expectedChecksum: string | null = null;
  let artifactKind: 'raw' | 'repair' | 'chunk' = 'raw';
  let source: CaptureJournalSource = 'mic';
  let sequence = 0;

  if (
    manifest.schemaVersion === 2 ||
    manifest.schemaVersion === 3 ||
    manifest.schemaVersion === 4
  ) {
    const entry = manifest.entries.find((e) => e.relativePath === relativePath);
    if (entry) {
      expectedChecksum = entry.checksumSha256;
      artifactKind = 'chunk';
      source = entry.source;
      sequence = entry.sequence;
    }
  }

  if (
    !expectedChecksum &&
    (manifest.schemaVersion === 3 || manifest.schemaVersion === 4)
  ) {
    for (const interval of manifest.intervals) {
      for (const [src, disposition] of Object.entries(interval.sources) as [
        CaptureJournalSource,
        CaptureIntervalSourceDisposition,
      ][]) {
        if (
          'rawRelativePath' in disposition &&
          disposition.rawRelativePath === relativePath
        ) {
          expectedChecksum = disposition.rawChecksumSha256;
          artifactKind = 'raw';
          source = src;
          sequence = interval.sequence;
          break;
        }
        if (
          'repairRelativePath' in disposition &&
          disposition.repairRelativePath === relativePath
        ) {
          expectedChecksum = disposition.repairChecksumSha256;
          artifactKind = 'repair';
          source = src;
          sequence = interval.sequence;
          break;
        }
      }
      if (expectedChecksum) break;
    }
  }

  if (!expectedChecksum) {
    throw new Error(
      `Capture journal chunk is not referenced in manifest: ${relativePath}`,
    );
  }

  const fullPath = join(rootDir, relativePath);

  if (manifest.schemaVersion === 4) {
    const key =
      options?.meetingKey ??
      (await getCaptureJournalAudioKey(normalizedMeetingId));
    if (!key) {
      throw new Error(
        'audio_key_unavailable: Meeting audio key required to read encrypted chunk',
      );
    }

    try {
      const decrypted = await EncryptedArtifactStore.readEncryptedFile(
        fullPath,
        key,
        {
          keyId: manifest.keyId,
          meetingId: normalizedMeetingId,
          artifactKind,
          source,
          sequence,
        },
      );
      const computedChecksum = computeChecksum(decrypted.plaintext);
      if (computedChecksum !== expectedChecksum) {
        throw new Error(
          `Capture journal chunk checksum mismatch: expected ${expectedChecksum}, got ${computedChecksum}`,
        );
      }
      return decrypted.plaintext;
    } catch (err: any) {
      try {
        await recordCaptureJournalStickyFailure(rootDir, {
          meetingId: normalizedMeetingId,
          code: 'crypto_error',
          reason: err.message || 'Chunk read/decrypt failure',
          meetingKey: key,
        });
      } catch {
        // preserve primary error
      }
      throw err;
    }
  }

  const bytes = await readFile(fullPath);
  const computedChecksum = computeChecksum(bytes);
  if (computedChecksum !== expectedChecksum) {
    throw new Error(
      `Capture journal chunk checksum mismatch: expected ${expectedChecksum}, got ${computedChecksum}`,
    );
  }
  return bytes;
};

const sealCaptureJournalUnlocked = async (
  rootDir: string,
  { meetingId, endedAtMs, meetingKey }: SealCaptureJournalArgs,
  durability: CaptureJournalDurability = defaultDurability,
): Promise<
  CaptureJournalManifestV2 | CaptureJournalManifestV3 | CaptureJournalManifestV4
> => {
  const manifest = await createCaptureJournal(
    rootDir,
    {
      meetingId,
      startedAtMs: 0,
      meetingKey,
    },
    durability,
  );
  const normalizedEndedAtMs = Math.max(
    manifest.startedAtMs,
    normalizeTimestampMs(endedAtMs),
  );

  if (manifest.schemaVersion === 1) {
    throw new Error('Cannot seal legacy capture journal');
  }
  if (
    manifest.schemaVersion === 4 &&
    (manifest as CaptureJournalManifestV4).stickyFailure
  ) {
    throw new Error(
      `Cannot seal capture journal: sticky failure recorded: ${(manifest as CaptureJournalManifestV4).stickyFailure?.message}`,
    );
  }
  if (manifest.schemaVersion === 3 || manifest.schemaVersion === 4) {
    if (manifest.lifecycleState !== 'stopping') {
      throw new Error('Capture journal must enter stopping before seal');
    }
    if (
      manifest.intervals.some((interval) =>
        Object.values(interval.sources).some(
          (source) =>
            source.disposition === 'pending' ||
            source.disposition === 'raw_durable',
        ),
      )
    ) {
      throw new Error('Capture journal has unresolved audio intervals');
    }
  }
  if (!manifest.activityEvidence) throw new Error('capture_activity_missing');
  const parsedEvidence = await parseCaptureActivityEvidence(
    manifest.activityEvidence,
  );
  if (!parsedEvidence.ok) throw new Error(parsedEvidence.reason);

  if (
    manifest.lifecycleState === 'sealed' &&
    manifest.endedAtMs === normalizedEndedAtMs
  ) {
    return manifest;
  }

  const nextManifest:
    | CaptureJournalManifestV2
    | CaptureJournalManifestV3
    | CaptureJournalManifestV4 = {
    ...manifest,
    activityEvidence: parsedEvidence.evidence,
    lifecycleState: 'sealed',
    endedAtMs: normalizedEndedAtMs,
    ...(manifest.schemaVersion === 3 || manifest.schemaVersion === 4
      ? { revision: manifest.revision + 1 }
      : {}),
  };
  await writeManifest(rootDir, nextManifest, durability, meetingKey);
  const durableManifest = await readCaptureJournalManifest(rootDir, meetingId, {
    meetingKey,
  });
  if (
    durableManifest.schemaVersion !== 2 &&
    durableManifest.schemaVersion !== 3 &&
    durableManifest.schemaVersion !== 4
  ) {
    throw new Error('Cannot seal legacy capture journal');
  }
  return durableManifest;
};

export const sealCaptureJournal = async (
  rootDir: string,
  args: SealCaptureJournalArgs,
  durability: CaptureJournalDurability = defaultDurability,
): Promise<
  CaptureJournalManifestV2 | CaptureJournalManifestV3 | CaptureJournalManifestV4
> =>
  serializeJournalMutation(rootDir, args.meetingId, () =>
    sealCaptureJournalUnlocked(rootDir, args, durability),
  );
