import path from 'node:path';

export type BenchmarkSpeaker = 'Me' | 'Them';
export type BenchmarkWord = {
  startTime: number;
  endTime: number;
  text: string;
  confidence?: number;
};
export type BenchmarkTranscriptSegment = {
  startTime: number;
  endTime: number;
  text: string;
};
export type BenchmarkTurn = BenchmarkTranscriptSegment & {
  speaker: BenchmarkSpeaker;
};
export type DiarizationInterval = {
  startTime: number;
  endTime: number;
  cluster: string;
  overlap?: boolean;
  confidence?: number;
};

export type CorpusProvenance = {
  tier: 'synthetic' | 'committed' | 'consented-private';
  source: string;
};
export type LocalAttributionBenchmarkCase = {
  id: string;
  recordingId: string;
  provenance: CorpusProvenance;
  audio: { mixedPath: string; systemReferencePath?: string };
  referencePath: string;
};
export type CandidateKind = 'asr' | 'diarizer' | 'pipeline';
export type CandidateModelIdentity = { id: string; version: string };
export type CandidateManifestEntry = {
  id: string;
  kind: CandidateKind;
  version: string;
  command: string[];
  model: CandidateModelIdentity;
  config: Record<string, unknown>;
};
export type LocalAttributionManifest = {
  schemaVersion: 1;
  cases: LocalAttributionBenchmarkCase[];
  candidates: CandidateManifestEntry[];
};
export type SpeakerReference = {
  schemaVersion: 1;
  transcript: { words: BenchmarkWord[] };
  turns: BenchmarkTurn[];
};
export type LocalAttributionCandidateOutput = {
  schemaVersion: 1;
  caseId: string;
  candidateId: string;
  transcript: {
    words: BenchmarkWord[];
    segments: BenchmarkTranscriptSegment[];
  };
  diarization: { turns: DiarizationInterval[] };
  runtime: {
    pipelineVersion: string;
    models: CandidateModelIdentity[];
    elapsedMs: number;
    hardware?: string;
  };
};

type ManifestOptions = { privateCorpusRoot?: string };
type UnknownRecord = Record<string, unknown>;

const fail = (field: string, requirement: string): never => {
  throw new Error(`Invalid ${field}: ${requirement}.`);
};

const objectAt = (value: unknown, field: string): UnknownRecord => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail(field, 'expected an object');
  }
  return value as UnknownRecord;
};

const arrayAt = (value: unknown, field: string): unknown[] => {
  if (!Array.isArray(value)) return fail(field, 'expected an array');
  return value;
};

const stringAt = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || value.trim() === '') {
    return fail(field, 'expected a non-empty string');
  }
  return value;
};

const numberAt = (value: unknown, field: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fail(field, 'expected a finite number');
  }
  return value;
};

const confidenceAt = (value: unknown, field: string): number | undefined => {
  if (value === undefined) return undefined;
  const confidence = numberAt(value, field);
  if (confidence < 0 || confidence > 1)
    return fail(field, 'expected a value from 0 to 1');
  return confidence;
};

const intervalAt = (
  raw: unknown,
  field: string,
): UnknownRecord & { startTime: number; endTime: number } => {
  const value = objectAt(raw, field);
  const startTime = numberAt(value.startTime, `${field}.startTime`);
  const endTime = numberAt(value.endTime, `${field}.endTime`);
  if (startTime < 0)
    fail(`${field}.startTime`, 'expected a non-negative timestamp');
  if (endTime <= startTime) fail(field, 'expected a positive duration');
  return { ...value, startTime, endTime };
};

const ensureAscending = <T extends { startTime: number }>(
  values: T[],
  field: string,
): T[] => {
  for (let index = 1; index < values.length; index += 1) {
    if (values[index].startTime < values[index - 1].startTime) {
      fail(`${field}[${index}]`, 'expected intervals ordered by startTime');
    }
  }
  return values;
};

const wordAt = (raw: unknown, field: string): BenchmarkWord => {
  const value = intervalAt(raw, field);
  const confidence = confidenceAt(value.confidence, `${field}.confidence`);
  return {
    startTime: value.startTime,
    endTime: value.endTime,
    text: stringAt(value.text, `${field}.text`),
    ...(confidence === undefined ? {} : { confidence }),
  };
};

const transcriptSegmentAt = (
  raw: unknown,
  field: string,
): BenchmarkTranscriptSegment => {
  const value = intervalAt(raw, field);
  return {
    startTime: value.startTime,
    endTime: value.endTime,
    text: stringAt(value.text, `${field}.text`),
  };
};

const modelAt = (raw: unknown, field: string): CandidateModelIdentity => {
  const value = objectAt(raw, field);
  return {
    id: stringAt(value.id, `${field}.id`),
    version: stringAt(value.version, `${field}.version`),
  };
};

const safeCorpusPath = (
  value: unknown,
  field: string,
  tier: CorpusProvenance['tier'],
  privateCorpusRoot?: string,
): string => {
  const candidate = stringAt(value, field);
  const hasTraversal = candidate.split(/[\\/]+/).includes('..');
  if (hasTraversal) fail(field, 'path traversal is not allowed');

  if (tier === 'consented-private') {
    if (!privateCorpusRoot)
      fail(field, 'a private corpus root must be supplied');
    if (!path.isAbsolute(candidate))
      fail(field, 'expected an absolute path inside the private corpus root');
    const root = path.resolve(privateCorpusRoot as string);
    const relative = path.relative(root, path.resolve(candidate));
    if (
      relative === '..' ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    ) {
      fail(field, 'expected a path inside the private corpus root');
    }
  } else if (path.isAbsolute(candidate)) {
    fail(field, 'committed and synthetic paths must be repository-relative');
  }
  return candidate;
};

const uniqueIds = <T extends { id: string }>(
  values: T[],
  noun: string,
): T[] => {
  const ids = new Set<string>();
  for (const value of values) {
    if (ids.has(value.id)) fail(`duplicate ${noun} id`, 'ids must be unique');
    ids.add(value.id);
  }
  return values;
};

export const loadLocalAttributionManifest = (
  raw: unknown,
  options: ManifestOptions = {},
): LocalAttributionManifest => {
  const value = objectAt(raw, 'manifest');
  if (value.schemaVersion !== 1) fail('schemaVersion', 'expected version 1');

  const cases = uniqueIds(
    arrayAt(value.cases, 'cases').map((rawCase, index) => {
      const field = `cases[${index}]`;
      const item = objectAt(rawCase, field);
      const provenanceRaw = objectAt(item.provenance, `${field}.provenance`);
      const tierRaw = provenanceRaw.tier;
      if (
        tierRaw !== 'synthetic' &&
        tierRaw !== 'committed' &&
        tierRaw !== 'consented-private'
      ) {
        fail(
          `${field}.provenance.tier`,
          'expected synthetic, committed, or consented-private',
        );
      }
      const tier = tierRaw as CorpusProvenance['tier'];
      const provenance: CorpusProvenance = {
        tier,
        source: stringAt(provenanceRaw.source, `${field}.provenance.source`),
      };
      const audioRaw = objectAt(item.audio, `${field}.audio`);
      const systemReferencePath =
        audioRaw.systemReferencePath === undefined
          ? undefined
          : safeCorpusPath(
              audioRaw.systemReferencePath,
              `${field}.audio.systemReferencePath`,
              tier,
              options.privateCorpusRoot,
            );
      return {
        id: stringAt(item.id, `${field}.id`),
        recordingId: stringAt(item.recordingId, `${field}.recordingId`),
        provenance,
        audio: {
          mixedPath: safeCorpusPath(
            audioRaw.mixedPath,
            `${field}.audio.mixedPath`,
            tier,
            options.privateCorpusRoot,
          ),
          ...(systemReferencePath === undefined ? {} : { systemReferencePath }),
        },
        referencePath: safeCorpusPath(
          item.referencePath,
          `${field}.referencePath`,
          tier,
          options.privateCorpusRoot,
        ),
      };
    }),
    'case',
  );

  const candidates = uniqueIds(
    arrayAt(value.candidates, 'candidates').map((rawCandidate, index) => {
      const field = `candidates[${index}]`;
      const item = objectAt(rawCandidate, field);
      const kindRaw = item.kind;
      if (
        kindRaw !== 'asr' &&
        kindRaw !== 'diarizer' &&
        kindRaw !== 'pipeline'
      ) {
        fail(`${field}.kind`, 'expected asr, diarizer, or pipeline');
      }
      const kind = kindRaw as CandidateKind;
      const command = arrayAt(item.command, `${field}.command`).map(
        (part, partIndex) => stringAt(part, `${field}.command[${partIndex}]`),
      );
      if (command.length === 0)
        fail(`${field}.command`, 'expected at least one command part');
      return {
        id: stringAt(item.id, `${field}.id`),
        kind,
        version: stringAt(item.version, `${field}.version`),
        command,
        model: modelAt(item.model, `${field}.model`),
        config: objectAt(item.config, `${field}.config`),
      };
    }),
    'candidate',
  );

  return { schemaVersion: 1, cases, candidates };
};

export const loadSpeakerReference = (raw: unknown): SpeakerReference => {
  const value = objectAt(raw, 'reference');
  if (value.schemaVersion !== 1) fail('schemaVersion', 'expected version 1');
  const transcript = objectAt(value.transcript, 'transcript');
  const words = ensureAscending(
    arrayAt(transcript.words, 'transcript.words').map((word, index) =>
      wordAt(word, `transcript.words[${index}]`),
    ),
    'transcript.words',
  );
  const turns = ensureAscending(
    arrayAt(value.turns, 'turns').map((turn, index) => {
      const field = `turns[${index}]`;
      const interval = intervalAt(turn, field);
      if (interval.speaker !== 'Me' && interval.speaker !== 'Them') {
        fail(`${field}.speaker`, 'expected Me or Them');
      }
      const speaker = interval.speaker as BenchmarkSpeaker;
      return {
        startTime: interval.startTime,
        endTime: interval.endTime,
        speaker,
        text: stringAt(interval.text, `${field}.text`),
      };
    }),
    'turns',
  );
  return { schemaVersion: 1, transcript: { words }, turns };
};

export const loadLocalAttributionCandidateOutput = (
  raw: unknown,
): LocalAttributionCandidateOutput => {
  const value = objectAt(raw, 'candidate output');
  if (value.schemaVersion !== 1) fail('schemaVersion', 'expected version 1');
  const transcript = objectAt(value.transcript, 'transcript');
  const diarization = objectAt(value.diarization, 'diarization');
  const runtime = objectAt(value.runtime, 'runtime');
  const models = arrayAt(runtime.models, 'runtime.models').map((model, index) =>
    modelAt(model, `runtime.models[${index}]`),
  );
  if (models.length === 0)
    fail('runtime.models', 'expected at least one model identity');
  const elapsedMs = numberAt(runtime.elapsedMs, 'runtime.elapsedMs');
  if (elapsedMs < 0)
    fail('runtime.elapsedMs', 'expected a non-negative duration');

  const turns = ensureAscending(
    arrayAt(diarization.turns, 'diarization.turns').map((turn, index) => {
      const field = `diarization.turns[${index}]`;
      const interval = intervalAt(turn, field);
      if (
        interval.overlap !== undefined &&
        typeof interval.overlap !== 'boolean'
      ) {
        fail(`${field}.overlap`, 'expected a boolean');
      }
      const overlap = interval.overlap as boolean | undefined;
      const confidence = confidenceAt(
        interval.confidence,
        `${field}.confidence`,
      );
      return {
        startTime: interval.startTime,
        endTime: interval.endTime,
        cluster: stringAt(interval.cluster, `${field}.cluster`),
        ...(overlap === undefined ? {} : { overlap }),
        ...(confidence === undefined ? {} : { confidence }),
      };
    }),
    'diarization.turns',
  );

  const hardware =
    runtime.hardware === undefined
      ? undefined
      : stringAt(runtime.hardware, 'runtime.hardware');
  return {
    schemaVersion: 1,
    caseId: stringAt(value.caseId, 'caseId'),
    candidateId: stringAt(value.candidateId, 'candidateId'),
    transcript: {
      words: ensureAscending(
        arrayAt(transcript.words, 'transcript.words').map((word, index) =>
          wordAt(word, `transcript.words[${index}]`),
        ),
        'transcript.words',
      ),
      segments: ensureAscending(
        arrayAt(transcript.segments, 'transcript.segments').map(
          (segment, index) =>
            transcriptSegmentAt(segment, `transcript.segments[${index}]`),
        ),
        'transcript.segments',
      ),
    },
    diarization: { turns },
    runtime: {
      pipelineVersion: stringAt(
        runtime.pipelineVersion,
        'runtime.pipelineVersion',
      ),
      models,
      elapsedMs,
      ...(hardware === undefined ? {} : { hardware }),
    },
  };
};
