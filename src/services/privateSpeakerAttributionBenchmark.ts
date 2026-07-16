import crypto from 'node:crypto';
import path from 'node:path';

export type PrivateSpeakerLabel = 'Me' | 'Them';

export type PrivateSpeakerAttributionBenchmarkCase = {
  id: string;
  title: string;
  audio: {
    mixedAudioPath: string;
    micAudioPath: string;
    systemAudioPath: string;
  };
  transcript: {
    groundTruthTranscriptPath: string;
    speakers: PrivateSpeakerLabel[];
  };
};

export type PrivateSpeakerAttributionBenchmarkManifest = {
  schemaVersion: number;
  cases: PrivateSpeakerAttributionBenchmarkCase[];
};

export type PrivateSpeakerAttributionManifestSummary = {
  schemaVersion: number;
  totalCases: number;
  speakerSet: PrivateSpeakerLabel[];
  cases: Array<{
    caseId: string;
    speakerSet: PrivateSpeakerLabel[];
    hasMixedAudio: boolean;
    hasMicAudio: boolean;
    hasSystemAudio: boolean;
  }>;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const normalizeString = (value: unknown) => String(value || '').trim();

const requireAbsoluteLocalPath = (value: unknown, label: string) => {
  const normalized = normalizeString(value);
  if (!normalized || !path.isAbsolute(normalized)) {
    throw new Error(`${label} must be an absolute local path.`);
  }
  return normalized;
};

const loadSpeakers = (value: unknown): PrivateSpeakerLabel[] => {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(
      'Private benchmark transcript speaker labels must be a non-empty array.',
    );
  }

  const speakers = value.map((entry) => normalizeString(entry));
  if (speakers.some((speaker) => speaker !== 'Me' && speaker !== 'Them')) {
    throw new Error(
      'Private benchmark transcript speaker labels must be only Me or Them.',
    );
  }

  return [...new Set(speakers)] as PrivateSpeakerLabel[];
};

export const loadPrivateSpeakerAttributionManifest = (
  raw: unknown,
): PrivateSpeakerAttributionBenchmarkManifest => {
  if (!isObject(raw)) {
    throw new Error('Private speaker-attribution benchmark manifest must be an object.');
  }

  const schemaVersion = Number(raw.schemaVersion);
  if (!Number.isInteger(schemaVersion) || schemaVersion <= 0) {
    throw new Error(
      'Private speaker-attribution benchmark manifest needs a schemaVersion.',
    );
  }

  const casesRaw = Array.isArray(raw.cases) ? raw.cases : [];
  if (casesRaw.length === 0) {
    throw new Error(
      'Private speaker-attribution benchmark manifest needs at least one case.',
    );
  }

  const seenIds = new Set<string>();
  const cases = casesRaw.map((entry) => {
    if (!isObject(entry)) {
      throw new Error('Private benchmark cases must be objects.');
    }
    const id = normalizeString(entry.id);
    const title = normalizeString(entry.title);
    if (!id) {
      throw new Error('Private benchmark case id is required.');
    }
    if (!title) {
      throw new Error(`Private benchmark case ${id} needs a non-empty title.`);
    }
    if (seenIds.has(id)) {
      throw new Error(`Duplicate private benchmark case id: ${id}`);
    }
    seenIds.add(id);

    const audio = isObject(entry.audio) ? entry.audio : {};
    const transcript = isObject(entry.transcript) ? entry.transcript : {};
    return {
      id,
      title,
      audio: {
        mixedAudioPath: requireAbsoluteLocalPath(
          audio.mixedAudioPath,
          `Private benchmark case ${id} mixedAudioPath`,
        ),
        micAudioPath: requireAbsoluteLocalPath(
          audio.micAudioPath,
          `Private benchmark case ${id} micAudioPath`,
        ),
        systemAudioPath: requireAbsoluteLocalPath(
          audio.systemAudioPath,
          `Private benchmark case ${id} systemAudioPath`,
        ),
      },
      transcript: {
        groundTruthTranscriptPath: requireAbsoluteLocalPath(
          transcript.groundTruthTranscriptPath,
          `Private benchmark case ${id} groundTruthTranscriptPath`,
        ),
        speakers: loadSpeakers(transcript.speakers),
      },
    } satisfies PrivateSpeakerAttributionBenchmarkCase;
  });

  return {
    schemaVersion,
    cases,
  };
};

const redactCaseId = (id: string) =>
  `private-case-${crypto.createHash('sha256').update(id).digest('hex').slice(0, 12)}`;

export const buildPrivateSpeakerAttributionManifestSummary = (
  manifest: PrivateSpeakerAttributionBenchmarkManifest,
): PrivateSpeakerAttributionManifestSummary => {
  const speakerSet = [...new Set(manifest.cases.flatMap((entry) => entry.transcript.speakers))].sort() as PrivateSpeakerLabel[];

  return {
    schemaVersion: manifest.schemaVersion,
    totalCases: manifest.cases.length,
    speakerSet,
    cases: manifest.cases.map((entry) => ({
      caseId: redactCaseId(entry.id),
      speakerSet: [...entry.transcript.speakers].sort() as PrivateSpeakerLabel[],
      hasMixedAudio: entry.audio.mixedAudioPath.length > 0,
      hasMicAudio: entry.audio.micAudioPath.length > 0,
      hasSystemAudio: entry.audio.systemAudioPath.length > 0,
    })),
  };
};
