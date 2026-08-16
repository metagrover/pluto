import { execFileSync } from 'node:child_process';
import fs, { type Stats } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

export type PrivateLiveReplayMeeting = {
  id: string;
  sealedDurationSeconds: number;
  sealedGeneration: number;
  integrity: 'sealed';
  unresolvedCaptureGap: false;
  micSource: 'independent';
  proxyTranscriptPath: string;
  sources: { micPath: string; systemPath: string };
};

export type PrivateLiveReplayManifest = {
  schemaVersion: 1;
  runtime: { executablePath: string; modelRoot: string };
  meetings: PrivateLiveReplayMeeting[];
};

export type PrivateLiveReplayManifestSummary = {
  schemaVersion: 1;
  meetingCount: number;
  sourceCount: number;
  audioMinutesRoundedTo5: number;
};

export type PrivateLiveReplayValidationAdapters = {
  lstat(filePath: string): Stats;
  realpath(filePath: string): string;
  durationSeconds(filePath: string): number;
};

export const PRIVATE_LIVE_REPLAY_MODEL_VERSION =
  'fluidaudio-0.15.5-asr-aed02740-ctc-accdafd8-int8-verified1';

const PRIVATE_FIELD =
  /^(?:transcript|text|words?|segments?|content|base64|audio|audioData|pcm|pcmData|samples?|speaker|identity)$/i;
const INLINE_AUDIO = /^data:audio\//i;
const ALLOWED_TOP_LEVEL = new Set(['schemaVersion', 'runtime', 'meetings']);
const ALLOWED_RUNTIME = new Set(['executablePath', 'modelRoot']);
const ALLOWED_MEETING = new Set([
  'id',
  'sealedDurationSeconds',
  'sealedGeneration',
  'integrity',
  'unresolvedCaptureGap',
  'micSource',
  'proxyTranscriptPath',
  'sources',
]);
const ALLOWED_SOURCES = new Set(['micPath', 'systemPath']);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const hasExactKeys = (
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
): boolean =>
  value !== null &&
  Object.keys(value).length === allowed.size &&
  Object.keys(value).every((key) => allowed.has(key));

const rejectPrivateContent = (value: unknown, key = ''): void => {
  if (PRIVATE_FIELD.test(key)) throw new Error('private_content_not_allowed');
  if (typeof value === 'string' && INLINE_AUDIO.test(value.trim())) {
    throw new Error('private_content_not_allowed');
  }
  if (Array.isArray(value)) {
    for (const entry of value) rejectPrivateContent(entry);
    return;
  }
  if (isRecord(value)) {
    for (const [childKey, child] of Object.entries(value)) {
      rejectPrivateContent(child, childKey);
    }
  }
};

const requireFinitePositive = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error('manifest_invalid');
  }
  return value;
};

const requireSafePositiveInteger = (value: unknown): number => {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new Error('manifest_invalid');
  }
  return value as number;
};

const requireOpaqueId = (value: unknown): string => {
  if (
    typeof value !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value) ||
    value.includes('..')
  ) {
    throw new Error('manifest_invalid');
  }
  return value;
};

const requirePath = (
  value: unknown,
  kind: 'file' | 'directory',
  adapters: PrivateLiveReplayValidationAdapters,
  unavailableCode: string,
): string => {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.includes('\0') ||
    !path.isAbsolute(value)
  ) {
    throw new Error(unavailableCode);
  }
  let stat: Stats;
  try {
    stat = adapters.lstat(value);
  } catch {
    throw new Error(unavailableCode);
  }
  if (stat.isSymbolicLink()) throw new Error(unavailableCode);
  if (kind === 'file' ? !stat.isFile() : !stat.isDirectory()) {
    throw new Error(unavailableCode);
  }
  try {
    return adapters.realpath(value);
  } catch {
    throw new Error(unavailableCode);
  }
};

const probeDurationSeconds = (filePath: string): number => {
  let output: string;
  try {
    output = execFileSync(
      'ffprobe',
      [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        filePath,
      ],
      {
        encoding: 'utf8',
        timeout: 30_000,
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    );
  } catch {
    throw new Error('source_unavailable');
  }
  const duration = Number(output.trim());
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error('source_unavailable');
  }
  return duration;
};

const DEFAULT_ADAPTERS: PrivateLiveReplayValidationAdapters = {
  lstat: fs.lstatSync,
  realpath: fs.realpathSync,
  durationSeconds: probeDurationSeconds,
};

export const requirePreparedPrivateLiveReplayModel = (
  modelRoot: string,
): void => {
  try {
    const activationPath = path.join(modelRoot, 'active.json');
    const activationStat = fs.lstatSync(activationPath);
    if (
      activationStat.isSymbolicLink() ||
      !activationStat.isFile() ||
      activationStat.size > 1024
    ) {
      throw new Error('model_unavailable');
    }
    const activation = JSON.parse(fs.readFileSync(activationPath, 'utf8')) as
      | { version?: unknown }
      | undefined;
    if (
      !activation ||
      Object.keys(activation).length !== 1 ||
      activation.version !== PRIVATE_LIVE_REPLAY_MODEL_VERSION
    ) {
      throw new Error('model_unavailable');
    }
    const versionRoot = path.join(
      modelRoot,
      'versions',
      PRIVATE_LIVE_REPLAY_MODEL_VERSION,
    );
    const versionStat = fs.lstatSync(versionRoot);
    if (
      versionStat.isSymbolicLink() ||
      !versionStat.isDirectory() ||
      fs.readdirSync(versionRoot).length === 0
    ) {
      throw new Error('model_unavailable');
    }
  } catch {
    throw new Error('model_unavailable');
  }
};

export const readPrivateLiveReplayManifest = (
  manifestPath: string,
): unknown => {
  if (!path.isAbsolute(manifestPath)) throw new Error('manifest_unavailable');
  try {
    const stat = fs.lstatSync(manifestPath);
    if (
      stat.isSymbolicLink() ||
      !stat.isFile() ||
      stat.size <= 0 ||
      stat.size > 1024 * 1024
    ) {
      throw new Error('manifest_unavailable');
    }
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as unknown;
  } catch {
    throw new Error('manifest_unavailable');
  }
};

export const validatePrivateLiveReplayManifest = (
  raw: unknown,
  adapters: PrivateLiveReplayValidationAdapters = DEFAULT_ADAPTERS,
): PrivateLiveReplayManifest => {
  rejectPrivateContent(raw);
  if (!isRecord(raw) || !hasExactKeys(raw, ALLOWED_TOP_LEVEL)) {
    throw new Error('manifest_invalid');
  }
  if (raw.schemaVersion !== 1 || !isRecord(raw.runtime)) {
    throw new Error('manifest_invalid');
  }
  if (!hasExactKeys(raw.runtime, ALLOWED_RUNTIME)) {
    throw new Error('manifest_invalid');
  }
  const executablePath = requirePath(
    raw.runtime.executablePath,
    'file',
    adapters,
    'runtime_unavailable',
  );
  const modelRoot = requirePath(
    raw.runtime.modelRoot,
    'directory',
    adapters,
    'model_unavailable',
  );
  if (adapters === DEFAULT_ADAPTERS)
    requirePreparedPrivateLiveReplayModel(modelRoot);
  if (!Array.isArray(raw.meetings)) throw new Error('manifest_invalid');

  const ids = new Set<string>();
  const meetings = raw.meetings.map((entry): PrivateLiveReplayMeeting => {
    if (!isRecord(entry) || !hasExactKeys(entry, ALLOWED_MEETING)) {
      throw new Error('manifest_invalid');
    }
    const id = requireOpaqueId(entry.id);
    if (ids.has(id)) throw new Error('manifest_invalid');
    ids.add(id);
    const sealedDurationSeconds = requireFinitePositive(
      entry.sealedDurationSeconds,
    );
    const sealedGeneration = requireSafePositiveInteger(entry.sealedGeneration);
    if (entry.integrity !== 'sealed') throw new Error('integrity_not_sealed');
    if (entry.unresolvedCaptureGap !== false) {
      throw new Error('unresolved_capture_gap');
    }
    if (entry.micSource !== 'independent') {
      throw new Error('mixed_mic_source');
    }
    const proxyTranscriptPath = requirePath(
      entry.proxyTranscriptPath,
      'file',
      adapters,
      'source_unavailable',
    );
    if (
      !isRecord(entry.sources) ||
      !hasExactKeys(entry.sources, ALLOWED_SOURCES)
    ) {
      throw new Error('manifest_invalid');
    }
    const micPath = requirePath(
      entry.sources.micPath,
      'file',
      adapters,
      'source_unavailable',
    );
    const systemPath = requirePath(
      entry.sources.systemPath,
      'file',
      adapters,
      'source_unavailable',
    );
    const micStat = adapters.lstat(micPath);
    const systemStat = adapters.lstat(systemPath);
    if (
      micPath === systemPath ||
      (micStat.dev === systemStat.dev && micStat.ino === systemStat.ino)
    ) {
      throw new Error('source_not_independent');
    }
    for (const sourcePath of [micPath, systemPath]) {
      const duration = adapters.durationSeconds(sourcePath);
      if (!Number.isFinite(duration) || duration <= 0) {
        throw new Error('source_unavailable');
      }
      if (Math.abs(duration - sealedDurationSeconds) > 5) {
        throw new Error('source_duration_mismatch');
      }
    }
    return {
      id,
      sealedDurationSeconds,
      sealedGeneration,
      integrity: 'sealed',
      unresolvedCaptureGap: false,
      micSource: 'independent',
      proxyTranscriptPath,
      sources: { micPath, systemPath },
    };
  });

  const audioSeconds = meetings.reduce(
    (total, meeting) => total + meeting.sealedDurationSeconds,
    0,
  );
  if (
    meetings.length < 3 ||
    audioSeconds < 90 * 60 ||
    !meetings.some((meeting) => meeting.sealedDurationSeconds >= 30 * 60)
  ) {
    throw new Error('insufficient_corpus');
  }

  return {
    schemaVersion: 1,
    runtime: { executablePath, modelRoot },
    meetings,
  };
};

export const summarizePrivateLiveReplayManifest = (
  manifest: PrivateLiveReplayManifest,
): PrivateLiveReplayManifestSummary => {
  const audioMinutes =
    manifest.meetings.reduce(
      (total, meeting) => total + meeting.sealedDurationSeconds,
      0,
    ) / 60;
  return {
    schemaVersion: 1,
    meetingCount: manifest.meetings.length,
    sourceCount: manifest.meetings.length * 2,
    audioMinutesRoundedTo5: Math.round(audioMinutes / 5) * 5,
  };
};

const option = (name: string): string => {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1])
    throw new Error('manifest_unavailable');
  return process.argv[index + 1];
};

const allowedCliCode = (error: unknown): string => {
  const code = error instanceof Error ? error.message : '';
  return new Set([
    'manifest_invalid',
    'manifest_unavailable',
    'private_content_not_allowed',
    'insufficient_corpus',
    'mixed_mic_source',
    'source_not_independent',
    'source_unavailable',
    'source_duration_mismatch',
    'integrity_not_sealed',
    'unresolved_capture_gap',
    'runtime_unavailable',
    'model_unavailable',
  ]).has(code)
    ? code
    : 'manifest_unavailable';
};

export const runManifestCli = (): void => {
  try {
    const manifestPath = option('--manifest');
    const summary = summarizePrivateLiveReplayManifest(
      validatePrivateLiveReplayManifest(
        readPrivateLiveReplayManifest(manifestPath),
      ),
    );
    process.stdout.write(`${JSON.stringify(summary)}\n`);
  } catch (error) {
    process.stderr.write(`${allowedCliCode(error)}\n`);
    process.exitCode = 1;
  }
};

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  runManifestCli();
}
