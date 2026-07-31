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

export type CaptureJournalSource = 'mic' | 'system';
export type CaptureJournalLifecycleState = 'recording' | 'sealed';
export type CaptureJournalLifecycleStateV3 =
  | 'recording'
  | 'stopping'
  | 'sealed';

export type CaptureJournalEntry = {
  source: CaptureJournalSource;
  sequence: number;
  chunkStartSec: number;
  chunkEndSec: number;
  format: string;
  byteCount: number;
  checksumSha256: string;
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
      decodeDependency?: {
        anchorSequence: number;
        initializationChecksumSha256: string;
      };
    }
  | {
      disposition: 'captured';
      rawChecksumSha256: string;
      rawRelativePath: string;
      repairChecksumSha256: string;
      repairRelativePath: string;
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

export type CaptureJournalManifest =
  | CaptureJournalManifestV1
  | CaptureJournalManifestV2
  | CaptureJournalManifestV3;

type CreateCaptureJournalArgs = {
  meetingId: string;
  startedAtMs: number;
  schemaVersion?: 2 | 3;
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
};

type SealCaptureJournalArgs = {
  meetingId: string;
  endedAtMs: number;
};

export type StopCaptureJournalArgs = V3MutationIdentity;

type UpdateCaptureJournalActivityEvidenceArgs = {
  meetingId: string;
  activityEvidence: CaptureActivityEvidence;
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
};

export type PersistCaptureJournalRawChunkArgs = V3MutationIdentity & {
  source: CaptureJournalSource;
  sequence: number;
  format: string;
  data: Buffer | Uint8Array;
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

export type AppendCaptureTranscriptAcceptanceFrameArgs = V3MutationIdentity & {
  sequence: number;
  micCheckpointChecksumSha256: string | null;
  systemCheckpointChecksumSha256: string | null;
  activityEvidenceDigestSha256: string;
  sidecar: unknown;
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
    manifest.schemaVersion !== 3
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
    const expectedPath = `${artifactRootRelativePath}/chunks/${entry.source}-${padSequence(entry.sequence)}.${formatToExtension(entry.format)}`;
    if (entry.relativePath !== expectedPath) {
      return invalidManifest('entry path');
    }
  }

  if (manifest.schemaVersion === 3) {
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
      return invalidManifest('v3 shape');
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
          assertSafeRelativePath(
            disposition.rawRelativePath,
            artifactRootRelativePath,
            'chunks',
          );
        }
        if (disposition.disposition === 'captured') {
          assertChecksum(disposition.repairChecksumSha256, 'repair checksum');
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

  if (manifest.schemaVersion === 2 || manifest.schemaVersion === 3) {
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
) => {
  const artifactRootPath = getArtifactRootPath(rootDir, manifest.meetingId);
  await mkdir(artifactRootPath, { recursive: true });
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
): Promise<CaptureJournalManifest> => {
  const normalizedMeetingId = normalizeMeetingId(meetingId);
  const manifestPath = getManifestPath(rootDir, normalizedMeetingId);
  const raw = await readFile(manifestPath, 'utf8');
  return await validateCaptureJournalManifest(
    JSON.parse(raw),
    normalizedMeetingId,
  );
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
    return await readCaptureJournalManifest(rootDir, normalizedMeetingId);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  await Promise.all(
    ['chunks', 'repair', 'transcript-checkpoints', 'acceptance-frames'].map(
      (directory) =>
        mkdir(join(artifactRootPath, directory), { recursive: true }),
    ),
  );

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

const requireV3Mutation = (
  manifest: CaptureJournalManifest,
  identity: V3MutationIdentity,
): CaptureJournalManifestV3 => {
  if (manifest.schemaVersion !== 3) {
    throw new Error('Capture journal v3 mutation requires schema version 3');
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
  return manifest;
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
): Promise<CaptureJournalManifestV3> =>
  serializeJournalMutation(rootDir, args.meetingId, async () => {
    const manifest = requireV3Mutation(
      await readCaptureJournalManifest(rootDir, args.meetingId),
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
    const next: CaptureJournalManifestV3 = {
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
    await writeManifest(rootDir, next, durability);
    return next;
  });

export const persistCaptureJournalRawChunk = async (
  rootDir: string,
  args: PersistCaptureJournalRawChunkArgs,
  durability: CaptureJournalDurability = defaultDurability,
): Promise<CaptureJournalManifestV3> =>
  serializeJournalMutation(rootDir, args.meetingId, async () => {
    const manifest = requireV3Mutation(
      await readCaptureJournalManifest(rootDir, args.meetingId),
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
    const extension = formatToExtension(args.format);
    const rawRelativePath = `${manifest.artifactRootRelativePath}/chunks/${args.source}-${padSequence(args.sequence)}.${extension}`;
    const rawPath = join(rootDir, rawRelativePath);
    const tempPath = `${rawPath}.tmp`;
    await writeFile(tempPath, data);
    await durability.syncFile(tempPath);
    await rename(tempPath, rawPath);
    await durability.syncDirectory(dirname(rawPath));
    const nextInterval: CaptureIntervalLedgerEntry = {
      ...interval,
      sources: {
        ...interval.sources,
        [args.source]: {
          disposition: 'raw_durable',
          rawChecksumSha256,
          rawRelativePath,
          ...(args.decodeDependency
            ? { decodeDependency: args.decodeDependency }
            : {}),
        },
      },
    };
    const next: CaptureJournalManifestV3 = {
      ...manifest,
      revision: manifest.revision + 1,
      intervals: manifest.intervals.map((candidate) =>
        candidate.sequence === interval.sequence ? nextInterval : candidate,
      ),
    };
    await writeManifest(rootDir, next, durability);
    return next;
  });

export const completeCaptureJournalCapturedChunk = async (
  rootDir: string,
  args: CompleteCaptureJournalCapturedChunkArgs,
  durability: CaptureJournalDurability = defaultDurability,
): Promise<{
  manifest: CaptureJournalManifestV3;
  receipt: CaptureAudioReceipt;
}> =>
  serializeJournalMutation(rootDir, args.meetingId, async () => {
    const manifest = requireV3Mutation(
      await readCaptureJournalManifest(rootDir, args.meetingId),
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
    const repairRelativePath = `${manifest.artifactRootRelativePath}/repair/${args.source}-${padSequence(args.sequence)}.wav`;
    const repairPath = join(rootDir, repairRelativePath);
    const tempPath = `${repairPath}.tmp`;
    await writeFile(tempPath, repairData);
    await durability.syncFile(tempPath);
    await rename(tempPath, repairPath);
    await durability.syncDirectory(dirname(repairPath));
    const captured: CaptureIntervalSourceDisposition = {
      disposition: 'captured',
      rawChecksumSha256: raw.rawChecksumSha256,
      rawRelativePath: raw.rawRelativePath,
      repairChecksumSha256,
      repairRelativePath,
    };
    const next: CaptureJournalManifestV3 = {
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
    await writeManifest(rootDir, next, durability);
    return {
      manifest: next,
      receipt: {
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
  manifest: CaptureJournalManifestV3;
  checkpoint: CaptureTranscriptCheckpointRef;
}> =>
  serializeJournalMutation(rootDir, args.receipt.meetingId, async () => {
    const current = await readCaptureJournalManifest(
      rootDir,
      args.receipt.meetingId,
    );
    if (
      current.schemaVersion !== 3 ||
      current.generation !== args.receipt.generation
    ) {
      throw new Error('Capture journal generation mismatch');
    }
    if (current.lifecycleState === 'sealed') {
      throw new Error('Capture journal is already sealed');
    }
    const manifest = current;
    validateTranscriptCheckpointSidecar(args.sidecar, args.receipt);
    assertChecksum(args.transcriptionConfigKey, 'config key');
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
    const next: CaptureJournalManifestV3 = {
      ...manifest,
      revision: manifest.revision + 1,
      transcriptCheckpoints: [...manifest.transcriptCheckpoints, checkpoint],
    };
    await writeManifest(rootDir, next, durability);
    return { manifest: next, checkpoint };
  });

export const appendCaptureTranscriptAcceptanceFrame = async (
  rootDir: string,
  args: AppendCaptureTranscriptAcceptanceFrameArgs,
  durability: CaptureJournalDurability = defaultDurability,
): Promise<{
  manifest: CaptureJournalManifestV3;
  frame: CaptureTranscriptAcceptanceFrame;
}> =>
  serializeJournalMutation(rootDir, args.meetingId, async () => {
    const manifest = requireV3Mutation(
      await readCaptureJournalManifest(rootDir, args.meetingId),
      args,
    );
    assertChecksum(
      args.activityEvidenceDigestSha256,
      'activity evidence checksum',
    );
    const relativePath = `${manifest.artifactRootRelativePath}/acceptance-frames/${padSequence(args.sequence)}.json`;
    const checksumSha256 = computeChecksum(
      Buffer.from(JSON.stringify(args.sidecar)),
    );
    const existing = manifest.acceptanceFrames.find(
      (frame) => frame.sequence === args.sequence,
    );
    if (existing) {
      if (existing.acceptedChecksumSha256 === checksumSha256) {
        return { manifest, frame: existing };
      }
      throw new Error('Transcript acceptance frame conflict');
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
    };
    const next: CaptureJournalManifestV3 = {
      ...manifest,
      revision: manifest.revision + 1,
      acceptanceFrames: [...manifest.acceptanceFrames, frame],
    };
    await writeManifest(rootDir, next, durability);
    return { manifest: next, frame };
  });

export const readCaptureJournalSidecar = async (
  rootDir: string,
  meetingId: string,
  relativePath: string,
  checksumSha256: string,
): Promise<Buffer> => {
  const manifest = await readCaptureJournalManifest(rootDir, meetingId);
  assertChecksum(checksumSha256, 'sidecar checksum');
  const allowed =
    manifest.schemaVersion === 3 &&
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
): Promise<CaptureJournalManifestV2 | CaptureJournalManifestV3> => {
  const meetingId = normalizeMeetingId(args.meetingId);
  const manifest = await createCaptureJournal(
    rootDir,
    { meetingId, startedAtMs: 0 },
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

  const nextManifest: CaptureJournalManifestV2 | CaptureJournalManifestV3 = {
    ...manifest,
    activityEvidence,
    ...(manifest.schemaVersion === 3
      ? { revision: manifest.revision + 1 }
      : {}),
  };
  await writeManifest(rootDir, nextManifest, durability);
  return nextManifest;
};

export const updateCaptureJournalActivityEvidence = async (
  rootDir: string,
  args: UpdateCaptureJournalActivityEvidenceArgs,
  durability: CaptureJournalDurability = defaultDurability,
): Promise<CaptureJournalManifestV2 | CaptureJournalManifestV3> =>
  serializeJournalMutation(rootDir, args.meetingId, () =>
    updateCaptureJournalActivityEvidenceUnlocked(rootDir, args, durability),
  );

export const stopCaptureJournal = async (
  rootDir: string,
  args: StopCaptureJournalArgs,
  durability: CaptureJournalDurability = defaultDurability,
): Promise<CaptureJournalManifestV3> =>
  serializeJournalMutation(rootDir, args.meetingId, async () => {
    const manifest = requireV3Mutation(
      await readCaptureJournalManifest(rootDir, args.meetingId),
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
    const next: CaptureJournalManifestV3 = {
      ...manifest,
      lifecycleState: 'stopping',
      revision: manifest.revision + 1,
      stoppingWatermarks,
      intervals,
    };
    await writeManifest(rootDir, next, durability);
    return next;
  });

const sealCaptureJournalUnlocked = async (
  rootDir: string,
  { meetingId, endedAtMs }: SealCaptureJournalArgs,
  durability: CaptureJournalDurability = defaultDurability,
): Promise<CaptureJournalManifestV2 | CaptureJournalManifestV3> => {
  const manifest = await createCaptureJournal(
    rootDir,
    {
      meetingId,
      startedAtMs: 0,
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
  if (manifest.schemaVersion === 3) {
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

  const nextManifest: CaptureJournalManifestV2 | CaptureJournalManifestV3 = {
    ...manifest,
    activityEvidence: parsedEvidence.evidence,
    lifecycleState: 'sealed',
    endedAtMs: normalizedEndedAtMs,
    ...(manifest.schemaVersion === 3
      ? { revision: manifest.revision + 1 }
      : {}),
  };
  await writeManifest(rootDir, nextManifest, durability);
  const durableManifest = await readCaptureJournalManifest(rootDir, meetingId);
  if (
    durableManifest.schemaVersion !== 2 &&
    durableManifest.schemaVersion !== 3
  ) {
    throw new Error('Cannot seal legacy capture journal');
  }
  return durableManifest;
};

export const sealCaptureJournal = async (
  rootDir: string,
  args: SealCaptureJournalArgs,
  durability: CaptureJournalDurability = defaultDurability,
): Promise<CaptureJournalManifestV2 | CaptureJournalManifestV3> =>
  serializeJournalMutation(rootDir, args.meetingId, () =>
    sealCaptureJournalUnlocked(rootDir, args, durability),
  );
