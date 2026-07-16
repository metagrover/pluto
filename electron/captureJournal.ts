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

export type CaptureJournalManifest = {
  schemaVersion: 1;
  meetingId: string;
  artifactRootRelativePath: string;
  manifestRelativePath: string;
  lifecycleState: CaptureJournalLifecycleState;
  startedAtMs: number;
  endedAtMs: number | null;
  entries: CaptureJournalEntry[];
};

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
  const parsed = JSON.parse(raw) as CaptureJournalManifest;
  if (parsed.schemaVersion !== 1) {
    throw new Error(
      `Unsupported capture journal schema version: ${parsed.schemaVersion}`,
    );
  }
  return parsed;
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
  await mkdir(join(artifactRootPath, 'chunks'), { recursive: true });

  try {
    return await readCaptureJournalManifest(rootDir, normalizedMeetingId);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  const manifest: CaptureJournalManifest = {
    schemaVersion: 1,
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

export const appendCaptureJournalChunk = async (
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

export const sealCaptureJournal = async (
  rootDir: string,
  { meetingId, endedAtMs }: SealCaptureJournalArgs,
  durability: CaptureJournalDurability = defaultDurability,
): Promise<CaptureJournalManifest> => {
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

  if (
    manifest.lifecycleState === 'sealed' &&
    manifest.endedAtMs === normalizedEndedAtMs
  ) {
    return manifest;
  }

  const nextManifest: CaptureJournalManifest = {
    ...manifest,
    lifecycleState: 'sealed',
    endedAtMs: normalizedEndedAtMs,
  };
  await writeManifest(rootDir, nextManifest, durability);
  return nextManifest;
};
