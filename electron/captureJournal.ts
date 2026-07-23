import { createHash } from 'node:crypto';
import {
  mkdir,
  open,
  readFile,
  rename,
  stat,
  writeFile,
} from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  type CaptureActivityEvidence,
  parseCaptureActivityEvidence,
} from '../src/utils/transcriptActivityEvidence.ts';

export type CaptureJournalSource = 'mic' | 'system';
export type CaptureJournalLifecycleState = 'recording' | 'sealed';

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
  lifecycleState: CaptureJournalLifecycleState;
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

export type CaptureJournalManifest =
  | CaptureJournalManifestV1
  | CaptureJournalManifestV2;

type CreateCaptureJournalArgs = {
  meetingId: string;
  startedAtMs: number;
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

type UpdateCaptureJournalActivityEvidenceArgs = {
  meetingId: string;
  activityEvidence: CaptureActivityEvidence;
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
  if (manifest.schemaVersion !== 1 && manifest.schemaVersion !== 2) {
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

  if (manifest.schemaVersion === 2) {
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
  { meetingId, startedAtMs }: CreateCaptureJournalArgs,
  durability: CaptureJournalDurability = defaultDurability,
): Promise<CaptureJournalManifest> => {
  const normalizedMeetingId = normalizeMeetingId(meetingId);
  const artifactRootRelativePath =
    getArtifactRootRelativePath(normalizedMeetingId);
  const artifactRootPath = getArtifactRootPath(rootDir, normalizedMeetingId);

  try {
    return await readCaptureJournalManifest(rootDir, normalizedMeetingId);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  await mkdir(join(artifactRootPath, 'chunks'), { recursive: true });

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

const updateCaptureJournalActivityEvidenceUnlocked = async (
  rootDir: string,
  args: UpdateCaptureJournalActivityEvidenceArgs,
  durability: CaptureJournalDurability = defaultDurability,
): Promise<CaptureJournalManifestV2> => {
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
  }

  const nextManifest: CaptureJournalManifestV2 = {
    ...manifest,
    activityEvidence,
  };
  await writeManifest(rootDir, nextManifest, durability);
  return nextManifest;
};

export const updateCaptureJournalActivityEvidence = async (
  rootDir: string,
  args: UpdateCaptureJournalActivityEvidenceArgs,
  durability: CaptureJournalDurability = defaultDurability,
): Promise<CaptureJournalManifestV2> =>
  serializeJournalMutation(rootDir, args.meetingId, () =>
    updateCaptureJournalActivityEvidenceUnlocked(rootDir, args, durability),
  );

const sealCaptureJournalUnlocked = async (
  rootDir: string,
  { meetingId, endedAtMs }: SealCaptureJournalArgs,
  durability: CaptureJournalDurability = defaultDurability,
): Promise<CaptureJournalManifestV2> => {
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

  const nextManifest: CaptureJournalManifestV2 = {
    ...manifest,
    activityEvidence: parsedEvidence.evidence,
    lifecycleState: 'sealed',
    endedAtMs: normalizedEndedAtMs,
  };
  await writeManifest(rootDir, nextManifest, durability);
  const durableManifest = await readCaptureJournalManifest(rootDir, meetingId);
  if (durableManifest.schemaVersion !== 2) {
    throw new Error('Cannot seal legacy capture journal');
  }
  return durableManifest;
};

export const sealCaptureJournal = async (
  rootDir: string,
  args: SealCaptureJournalArgs,
  durability: CaptureJournalDurability = defaultDurability,
): Promise<CaptureJournalManifestV2> =>
  serializeJournalMutation(rootDir, args.meetingId, () =>
    sealCaptureJournalUnlocked(rootDir, args, durability),
  );
