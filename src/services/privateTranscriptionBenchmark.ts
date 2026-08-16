import fs from 'node:fs';
import path from 'node:path';

export type PrivateTranscriptionBenchmarkCase = {
  id: string;
  language: string;
  audio: {
    micAudioPath?: string;
    systemAudioPath?: string;
  };
  referenceTranscriptPath: string;
};

export type PrivateTranscriptionBenchmarkManifest = {
  schemaVersion: 1;
  cases: PrivateTranscriptionBenchmarkCase[];
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const requireExistingAbsoluteFile = (value: unknown, label: string) => {
  const filePath = String(value || '').trim();
  if (!filePath || !path.isAbsolute(filePath)) {
    throw new Error(`${label} must be an absolute local path.`);
  }
  if (!fs.statSync(filePath).isFile()) {
    throw new Error(`${label} must resolve to a local file.`);
  }
  return filePath;
};

const optionalExistingAbsoluteFile = (value: unknown, label: string) => {
  if (value === undefined || value === null || value === '') return undefined;
  return requireExistingAbsoluteFile(value, label);
};

const rejectInlineTranscriptContent = (raw: Record<string, unknown>) => {
  const forbiddenKeys = new Set([
    'text',
    'transcript',
    'referenceText',
    'referenceTranscript',
    'segments',
    'words',
  ]);
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!isObject(value)) return;
    for (const [key, child] of Object.entries(value)) {
      if (forbiddenKeys.has(key)) {
        throw new Error(
          'Private transcription manifests may contain file references only, never transcript content.',
        );
      }
      visit(child);
    }
  };
  visit(raw);
};

export const loadPrivateTranscriptionBenchmarkManifest = (
  raw: unknown,
): PrivateTranscriptionBenchmarkManifest => {
  if (!isObject(raw)) {
    throw new Error(
      'Private transcription benchmark manifest must be an object.',
    );
  }
  rejectInlineTranscriptContent(raw);
  if (raw.schemaVersion !== 1) {
    throw new Error('Private transcription benchmark schemaVersion must be 1.');
  }
  if (!Array.isArray(raw.cases) || raw.cases.length === 0) {
    throw new Error('Private transcription benchmark needs at least one case.');
  }
  const seenIds = new Set<string>();
  const cases = raw.cases.map((entry, index) => {
    if (!isObject(entry)) {
      throw new Error(`Private transcription case ${index} must be an object.`);
    }
    const id = String(entry.id || '').trim();
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(id)) {
      throw new Error(`Private transcription case ${index} has an invalid id.`);
    }
    if (seenIds.has(id)) throw new Error(`Duplicate private case id: ${id}`);
    seenIds.add(id);
    const language = String(entry.language || '').trim();
    if (!/^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(language)) {
      throw new Error(
        `Private transcription case ${id} has an invalid language.`,
      );
    }
    const audio = isObject(entry.audio) ? entry.audio : {};
    const micAudioPath = optionalExistingAbsoluteFile(
      audio.micAudioPath,
      `Private transcription case ${id} micAudioPath`,
    );
    const systemAudioPath = optionalExistingAbsoluteFile(
      audio.systemAudioPath,
      `Private transcription case ${id} systemAudioPath`,
    );
    if (!micAudioPath && !systemAudioPath) {
      throw new Error(
        `Private transcription case ${id} needs an audio source.`,
      );
    }
    return {
      id,
      language,
      audio: { micAudioPath, systemAudioPath },
      referenceTranscriptPath: requireExistingAbsoluteFile(
        entry.referenceTranscriptPath,
        `Private transcription case ${id} referenceTranscriptPath`,
      ),
    };
  });
  return { schemaVersion: 1, cases };
};

export const summarizePrivateTranscriptionManifest = (
  manifest: PrivateTranscriptionBenchmarkManifest,
) => ({
  schemaVersion: manifest.schemaVersion,
  caseCount: manifest.cases.length,
  audioSourceCount: manifest.cases.reduce(
    (count, entry) =>
      count +
      Number(Boolean(entry.audio.micAudioPath)) +
      Number(Boolean(entry.audio.systemAudioPath)),
    0,
  ),
  referenceCount: manifest.cases.length,
});
