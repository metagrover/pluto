import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { realpathSync, statSync } from 'node:fs';
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
export type CandidateOperation = 'transcribe' | 'diarize';
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
    peakResidentMemoryMb?: number;
  };
};

export type CandidateCaseFailure = {
  caseId: string;
  status: 'failure';
  error: {
    code: CandidateFailureCode;
    message: string;
  };
};
export type CandidateCaseSuccess = {
  caseId: string;
  status: 'success';
  output: LocalAttributionCandidateOutput;
};
export type LocalCandidateRunResult = {
  candidateId: string;
  results: (CandidateCaseSuccess | CandidateCaseFailure)[];
  diagnostics?: { stderr: '[redacted]'; stderrBytes: number };
};
export type LocalCandidateRunOptions = {
  timeoutMs?: number;
  maxStderrBytes?: number;
};

export type CandidateFailureCode =
  | 'candidate_not_found'
  | 'candidate_unknown'
  | 'candidate_timeout'
  | 'candidate_exit_nonzero'
  | 'candidate_output_too_large'
  | 'candidate_invalid_json'
  | 'candidate_contract_mismatch'
  | 'candidate_unsupported_hardware'
  | 'candidate_model_missing'
  | 'candidate_model_checksum_failed'
  | 'candidate_out_of_memory';

export type PublicCandidateResult = {
  caseHash: string;
  candidateId: string;
  status: 'ok' | 'failed' | 'unsupported';
  elapsedMs: number;
  peakMemoryMb: number;
  failureCode?: CandidateFailureCode;
  metrics?: Record<string, unknown>;
  provenance?: {
    pipelineVersion: string;
    models: CandidateModelIdentity[];
  };
};

const candidateFailureCodes = new Set<CandidateFailureCode>([
  'candidate_not_found',
  'candidate_unknown',
  'candidate_timeout',
  'candidate_exit_nonzero',
  'candidate_output_too_large',
  'candidate_invalid_json',
  'candidate_contract_mismatch',
  'candidate_unsupported_hardware',
  'candidate_model_missing',
  'candidate_model_checksum_failed',
  'candidate_out_of_memory',
]);

/** Constructs a new public value; arbitrary input fields are never copied. */
export const sanitizeCandidateResult = (
  input: Record<string, unknown>,
): PublicCandidateResult => {
  const safeIdentifier = (value: unknown): string =>
    typeof value === 'string' &&
    value.length <= 128 &&
    /^[a-zA-Z0-9._:+@-]+$/.test(value)
      ? value
      : '';
  const status =
    input.status === 'ok' ||
    input.status === 'failed' ||
    input.status === 'unsupported'
      ? input.status
      : 'failed';
  const failureCode = candidateFailureCodes.has(
    input.failureCode as CandidateFailureCode,
  )
    ? (input.failureCode as CandidateFailureCode)
    : undefined;
  const metricKeys = new Set([
    'wordErrorRate',
    'diarizationErrorRate',
    'falseMeSeconds',
    'missedMeSeconds',
    'speakerCount',
    'transcript',
    'speakerAttributedWords',
    'diarization',
    'me',
    'them',
    'expectedSpeakerCount',
    'generatedSpeakerCount',
    'speakerCountCorrect',
    'boundaryErrorSeconds',
    'overlapAccuracy',
    'shortLocalTurnRecall',
    'runtimeFactor',
    'referenceWords',
    'hypothesisWords',
    'substitutions',
    'deletions',
    'insertions',
    'errors',
    'referenceSpeakerSeconds',
    'missedSpeechSeconds',
    'falseAlarmSeconds',
    'speakerConfusionSeconds',
    'errorRate',
    'truePositiveSeconds',
    'predictedSeconds',
    'referenceSeconds',
    'precision',
    'recall',
    'f1',
  ]);
  const safeMetrics = (value: unknown): Record<string, unknown> | undefined => {
    if (typeof value !== 'object' || value === null || Array.isArray(value))
      return undefined;
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (!metricKeys.has(key)) continue;
      if (typeof item === 'boolean') result[key] = item;
      else if (typeof item === 'number' && Number.isFinite(item))
        result[key] = Math.round(item * 10_000) / 10_000;
      else {
        const nested = safeMetrics(item);
        if (nested) result[key] = nested;
      }
    }
    return result;
  };
  const metrics = safeMetrics(input.metrics);
  const rawProvenance =
    typeof input.provenance === 'object' && input.provenance !== null
      ? (input.provenance as UnknownRecord)
      : undefined;
  const provenance = rawProvenance
    ? {
        pipelineVersion: safeIdentifier(rawProvenance.pipelineVersion),
        models: Array.isArray(rawProvenance.models)
          ? rawProvenance.models.flatMap((rawModel) => {
              if (typeof rawModel !== 'object' || rawModel === null) return [];
              const model = rawModel as UnknownRecord;
              const id = safeIdentifier(model.id);
              const version = safeIdentifier(model.version);
              return id && version ? [{ id, version }] : [];
            })
          : [],
      }
    : undefined;
  return {
    caseHash: safeIdentifier(input.caseHash),
    candidateId: safeIdentifier(input.candidateId),
    status,
    elapsedMs:
      typeof input.elapsedMs === 'number' &&
      Number.isFinite(input.elapsedMs) &&
      input.elapsedMs >= 0
        ? input.elapsedMs
        : 0,
    peakMemoryMb:
      typeof input.peakMemoryMb === 'number' &&
      Number.isFinite(input.peakMemoryMb) &&
      input.peakMemoryMb >= 0
        ? input.peakMemoryMb
        : 0,
    ...(failureCode === undefined ? {} : { failureCode }),
    ...(metrics === undefined ? {} : { metrics }),
    ...(provenance === undefined ? {} : { provenance }),
  };
};

export type WordErrorMetrics = {
  referenceWords: number;
  hypothesisWords: number;
  substitutions: number;
  deletions: number;
  insertions: number;
  errors: number;
  wordErrorRate: number;
};
export type SpeakerClassificationMetrics = {
  truePositiveSeconds: number;
  predictedSeconds: number;
  referenceSeconds: number;
  precision: number;
  recall: number;
  f1: number;
};
export type LocalAttributionMetrics = {
  wordErrorRate: number;
  diarizationErrorRate: number;
  falseMeSeconds: number;
  missedMeSeconds: number;
  speakerCount: number;
  transcript: WordErrorMetrics;
  speakerAttributedWords: WordErrorMetrics;
  diarization: {
    referenceSpeakerSeconds: number;
    missedSpeechSeconds: number;
    falseAlarmSeconds: number;
    speakerConfusionSeconds: number;
    errorRate: number;
  };
  me: SpeakerClassificationMetrics;
  them: SpeakerClassificationMetrics;
  expectedSpeakerCount: number;
  generatedSpeakerCount: number;
  speakerCountCorrect: boolean;
  boundaryErrorSeconds: number;
  overlapAccuracy: number;
  shortLocalTurnRecall: number;
  runtimeFactor?: number;
};

export type LocalAttributionMetricInput = {
  reference: BenchmarkTurn[];
  generated: BenchmarkTurn[];
  audioDurationSeconds?: number;
  elapsedMs?: number;
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
    const root = (() => {
      try {
        const canonicalRoot = realpathSync(privateCorpusRoot as string);
        if (!statSync(canonicalRoot).isDirectory())
          throw new Error('not a directory');
        return canonicalRoot;
      } catch {
        return fail('private corpus root', 'expected an existing directory');
      }
    })();
    const canonicalCandidate = (() => {
      try {
        const canonicalInput = realpathSync(candidate);
        if (!statSync(canonicalInput).isFile()) throw new Error('not a file');
        return canonicalInput;
      } catch {
        return fail(field, 'expected an existing private corpus file');
      }
    })();
    const relative = path.relative(root, canonicalCandidate);
    if (
      relative === '..' ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    ) {
      fail(field, 'expected a path inside the private corpus root');
    }
    return canonicalCandidate;
  }
  if (path.isAbsolute(candidate)) {
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
  const peakResidentMemoryMb =
    runtime.peakResidentMemoryMb === undefined
      ? undefined
      : numberAt(runtime.peakResidentMemoryMb, 'runtime.peakResidentMemoryMb');
  if (peakResidentMemoryMb !== undefined && peakResidentMemoryMb < 0)
    fail('runtime.peakResidentMemoryMb', 'expected a non-negative value');
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
      ...(peakResidentMemoryMb === undefined ? {} : { peakResidentMemoryMb }),
    },
  };
};

export type LocalAttributionBenchmarkRun = {
  caseId: string;
  tier: CorpusProvenance['tier'];
  candidateId: string;
  asrCandidate?: string;
  diarizerCandidate?: string;
  status: 'ok' | 'failed' | 'unsupported';
  metrics?: LocalAttributionMetrics | Record<string, unknown>;
  elapsedMs: number;
  peakMemoryMb: number;
  failureCode?: CandidateFailureCode;
  provenance?: { pipelineVersion: string; models: CandidateModelIdentity[] };
  // Callers may carry private diagnostics, but report construction never copies them.
  [privateField: string]: unknown;
};

export type LocalAttributionBenchmarkReport = {
  schemaVersion: 1;
  generatedAt: string;
  sourceCommit: string;
  environment: { platform: string; arch: string; nodeVersion: string };
  candidates: Array<{ id: string; kind: CandidateKind; model: string }>;
  results: Array<{
    caseHash: string;
    asrCandidate: string;
    diarizerCandidate: string;
    status: 'ok' | 'failed' | 'unsupported';
    metrics?: Record<string, unknown>;
    elapsedMs: number;
    peakMemoryMb: number;
    failureCode?: CandidateFailureCode;
    provenance?: { pipelineVersion: string; models: CandidateModelIdentity[] };
  }>;
  summary: {
    successfulRuns: number;
    failedRuns: number;
    unsupportedRuns: number;
    byTier: Array<{
      tier: CorpusProvenance['tier'];
      successfulRuns: number;
      failedRuns: number;
      unsupportedRuns: number;
    }>;
    byCandidateTier: Array<{
      asrCandidate: string;
      diarizerCandidate: string;
      tier: CorpusProvenance['tier'];
      successfulRuns: number;
      failedRuns: number;
      unsupportedRuns: number;
      meanMetrics?: {
        wordErrorRate: number;
        diarizationErrorRate: number;
        falseMeSeconds: number;
        missedMeSeconds: number;
        elapsedMs: number;
        peakMemoryMb: number;
      };
    }>;
  };
};

export const benchmarkCaseHash = (caseId: string): string =>
  createHash('sha256').update(caseId, 'utf8').digest('hex');

const publicIdentifier = (value: string): string =>
  value.length <= 128 && /^[a-zA-Z0-9._:@+-]+$/.test(value) ? value : 'invalid';

const publicModel = (model: CandidateModelIdentity): string => {
  const id = /^[a-zA-Z0-9._-]+(?:\/[a-zA-Z0-9._-]+)?$/.test(model.id)
    ? model.id
    : 'invalid';
  const version = publicIdentifier(model.version);
  return `${id}@${version}`;
};

export const buildLocalAttributionBenchmarkReport = (input: {
  generatedAt: string;
  sourceCommit: string;
  environment: LocalAttributionBenchmarkReport['environment'];
  candidates: CandidateManifestEntry[];
  runs: LocalAttributionBenchmarkRun[];
}): LocalAttributionBenchmarkReport => {
  const candidates = input.candidates
    .map(({ id, kind, model }) => ({
      id: publicIdentifier(id),
      kind,
      model: publicModel(model),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const tierByHash = new Map<string, CorpusProvenance['tier']>();
  const results = input.runs
    .map((run) => {
      const caseHash = benchmarkCaseHash(run.caseId);
      tierByHash.set(caseHash, run.tier);
      const safe = sanitizeCandidateResult({
        caseHash,
        candidateId: run.candidateId,
        status: run.status,
        elapsedMs: run.elapsedMs,
        peakMemoryMb: run.peakMemoryMb,
        failureCode: run.failureCode,
        metrics: run.metrics,
        provenance: run.provenance,
      });
      return {
        caseHash: safe.caseHash,
        asrCandidate: publicIdentifier(run.asrCandidate ?? run.candidateId),
        diarizerCandidate: publicIdentifier(
          run.diarizerCandidate ?? run.candidateId,
        ),
        status: safe.status,
        ...(safe.metrics === undefined ? {} : { metrics: safe.metrics }),
        elapsedMs: safe.elapsedMs,
        peakMemoryMb: safe.peakMemoryMb,
        ...(safe.failureCode === undefined
          ? {}
          : { failureCode: safe.failureCode }),
        ...(safe.provenance === undefined
          ? {}
          : { provenance: safe.provenance }),
      };
    })
    .sort(
      (left, right) =>
        left.asrCandidate.localeCompare(right.asrCandidate) ||
        left.diarizerCandidate.localeCompare(right.diarizerCandidate) ||
        left.caseHash.localeCompare(right.caseHash),
    );
  const counts = (rows: typeof results) => ({
    successfulRuns: rows.filter(({ status }) => status === 'ok').length,
    failedRuns: rows.filter(({ status }) => status === 'failed').length,
    unsupportedRuns: rows.filter(({ status }) => status === 'unsupported')
      .length,
  });
  const tiers = [...new Set(input.runs.map(({ tier }) => tier))].sort();
  const candidateTierKeys = [
    ...new Set(
      results.map(
        (row) =>
          `${row.asrCandidate}\0${row.diarizerCandidate}\0${tierByHash.get(row.caseHash)}`,
      ),
    ),
  ].sort();
  return {
    schemaVersion: 1,
    generatedAt: input.generatedAt,
    sourceCommit: input.sourceCommit,
    environment: { ...input.environment },
    candidates,
    results,
    summary: {
      ...counts(results),
      byTier: tiers.map((tier) => ({
        tier,
        ...counts(
          results.filter((row) => tierByHash.get(row.caseHash) === tier),
        ),
      })),
      byCandidateTier: candidateTierKeys.map((key) => {
        const [asrCandidate, diarizerCandidate, tier] = key.split('\0') as [
          string,
          string,
          CorpusProvenance['tier'],
        ];
        const rows = results.filter(
          (row) =>
            row.asrCandidate === asrCandidate &&
            row.diarizerCandidate === diarizerCandidate &&
            tierByHash.get(row.caseHash) === tier,
        );
        const successful = rows.filter(
          (row) => row.status === 'ok' && row.metrics,
        );
        const mean = (values: number[]) =>
          Math.round(
            (values.reduce((total, value) => total + value, 0) /
              values.length) *
              10_000,
          ) / 10_000;
        return {
          asrCandidate,
          diarizerCandidate,
          tier,
          ...counts(rows),
          ...(successful.length === 0
            ? {}
            : {
                meanMetrics: {
                  wordErrorRate: mean(
                    successful.map((row) =>
                      Number(row.metrics?.wordErrorRate ?? 0),
                    ),
                  ),
                  diarizationErrorRate: mean(
                    successful.map((row) =>
                      Number(row.metrics?.diarizationErrorRate ?? 0),
                    ),
                  ),
                  falseMeSeconds: mean(
                    successful.map((row) =>
                      Number(row.metrics?.falseMeSeconds ?? 0),
                    ),
                  ),
                  missedMeSeconds: mean(
                    successful.map((row) =>
                      Number(row.metrics?.missedMeSeconds ?? 0),
                    ),
                  ),
                  elapsedMs: mean(successful.map((row) => row.elapsedMs)),
                  peakMemoryMb: mean(successful.map((row) => row.peakMemoryMb)),
                },
              }),
        };
      }),
    },
  };
};

const protocolFailure = (
  caseId: string,
  code: CandidateFailureCode,
  message: string,
): CandidateCaseFailure => ({
  caseId,
  status: 'failure',
  error: { code, message },
});

/**
 * Runs one local candidate process using newline-delimited JSON. Candidate
 * output is deliberately treated as untrusted: private inputs are sent to the
 * process, but neither its payloads nor its stderr are ever surfaced verbatim.
 */
export const runLocalAttributionCandidate = async (
  candidate: CandidateManifestEntry,
  cases: LocalAttributionBenchmarkCase[],
  options: LocalCandidateRunOptions = {},
): Promise<LocalCandidateRunResult> => {
  if (candidate.command.length === 0) {
    return {
      candidateId: candidate.id,
      results: cases.map(({ id }) =>
        protocolFailure(
          id,
          'candidate_not_found',
          'Candidate command is empty.',
        ),
      ),
    };
  }
  const timeoutMs = options.timeoutMs ?? 30 * 60 * 1000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('Invalid timeoutMs: expected a finite positive duration.');
  }
  const maxStderrBytes = options.maxStderrBytes ?? 8_192;
  if (!Number.isInteger(maxStderrBytes) || maxStderrBytes < 0) {
    throw new Error('Invalid maxStderrBytes: expected a non-negative integer.');
  }

  const requestIds = new Map(
    cases.map((benchmarkCase, index) => [
      `${candidate.id}:${index}:${benchmarkCase.id}`,
      benchmarkCase.id,
    ]),
  );
  const operation: CandidateOperation =
    candidate.kind === 'diarizer' ? 'diarize' : 'transcribe';
  const caseResults = new Map<
    string,
    CandidateCaseSuccess | CandidateCaseFailure
  >();
  let stderrBytes = 0;
  let stdoutBytes = 0;
  let stdoutBuffer = '';
  let terminalFailure:
    | { code: CandidateFailureCode; message: string }
    | undefined;
  let spawnErrorCode: string | undefined;
  let processClosed = false;
  let forceKillTimer: ReturnType<typeof setTimeout> | undefined;
  const usesProcessGroup = process.platform !== 'win32';

  const child = spawn(candidate.command[0], candidate.command.slice(1), {
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: false,
    detached: usesProcessGroup,
  });

  const signalCandidate = (signal: NodeJS.Signals) => {
    if (usesProcessGroup && child.pid !== undefined) {
      try {
        process.kill(-child.pid, signal);
        return;
      } catch {
        // The group may have exited between the state check and signal.
      }
    }
    try {
      child.kill(signal);
    } catch {
      // A process that already exited needs no further cleanup.
    }
  };
  const terminate = () => {
    signalCandidate('SIGTERM');
    forceKillTimer ??= setTimeout(() => {
      if (!processClosed) signalCandidate('SIGKILL');
    }, 100);
  };
  const failProtocol = (code: CandidateFailureCode, message: string) => {
    if (terminalFailure) return;
    terminalFailure = { code, message };
    for (const { id } of cases) {
      caseResults.set(id, protocolFailure(id, code, message));
    }
    terminate();
  };

  child.stdin.on('error', () => {
    if (!spawnErrorCode) {
      failProtocol('candidate_exit_nonzero', 'Candidate process input failed.');
    }
  });
  child.stderr.on('data', (chunk: Buffer | string) => {
    if (stderrBytes >= maxStderrBytes) return;
    stderrBytes += Math.min(
      Buffer.byteLength(chunk),
      maxStderrBytes - stderrBytes,
    );
  });
  child.stdout.on('data', (chunk: Buffer | string) => {
    if (terminalFailure) return;
    stdoutBytes += Buffer.byteLength(chunk);
    if (stdoutBytes > 10 * 1024 * 1024) {
      failProtocol(
        'candidate_output_too_large',
        'Candidate output exceeded the maximum cumulative size.',
      );
      return;
    }
    stdoutBuffer += chunk.toString();
    while (stdoutBuffer.includes('\n')) {
      const newline = stdoutBuffer.indexOf('\n');
      const line = stdoutBuffer.slice(0, newline);
      stdoutBuffer = stdoutBuffer.slice(newline + 1);
      if (line.trim() === '') continue;
      let raw: UnknownRecord;
      try {
        raw = objectAt(JSON.parse(line), 'candidate response');
      } catch {
        failProtocol(
          'candidate_invalid_json',
          'Candidate returned malformed JSONL output.',
        );
        return;
      }
      if (raw.schemaVersion !== 1) {
        failProtocol(
          'candidate_contract_mismatch',
          'Candidate returned an unsupported envelope version.',
        );
        return;
      }
      if (
        raw.requestId !== undefined &&
        raw.id !== undefined &&
        raw.requestId !== raw.id
      ) {
        failProtocol(
          'candidate_contract_mismatch',
          'Candidate returned conflicting response identifiers.',
        );
        return;
      }
      const responseId =
        typeof raw.requestId === 'string'
          ? raw.requestId
          : typeof raw.id === 'string'
            ? raw.id
            : '';
      const caseId = requestIds.get(responseId);
      if (!caseId) {
        failProtocol(
          'candidate_contract_mismatch',
          'Candidate returned an unexpected response identifier.',
        );
        return;
      }
      if (caseResults.has(caseId)) {
        caseResults.set(
          caseId,
          protocolFailure(
            caseId,
            'candidate_contract_mismatch',
            'Candidate returned more than one response for the case.',
          ),
        );
        failProtocol(
          'candidate_contract_mismatch',
          'Candidate returned a duplicate response identifier.',
        );
        return;
      }
      if (raw.error !== undefined) {
        const candidateError =
          typeof raw.error === 'object' && raw.error !== null
            ? (raw.error as UnknownRecord)
            : {};
        const safeCode = candidateFailureCodes.has(
          candidateError.code as CandidateFailureCode,
        )
          ? (candidateError.code as CandidateFailureCode)
          : 'candidate_contract_mismatch';
        caseResults.set(caseId, {
          caseId,
          status: 'failure',
          error: {
            code: safeCode,
            message: '[redacted]',
          },
        });
        continue;
      }
      try {
        const output = loadLocalAttributionCandidateOutput(raw.output);
        if (output.caseId !== caseId || output.candidateId !== candidate.id) {
          throw new Error('identity mismatch');
        }
        caseResults.set(caseId, { caseId, status: 'success', output });
      } catch {
        caseResults.set(
          caseId,
          protocolFailure(
            caseId,
            'candidate_contract_mismatch',
            'Candidate output failed schema or identity validation.',
          ),
        );
      }
    }
  });

  const completion = new Promise<{
    exitCode: number | null;
    signal: NodeJS.Signals | null;
  }>((resolve) => {
    child.once('error', (error: NodeJS.ErrnoException) => {
      spawnErrorCode = error.code;
    });
    child.once('close', (exitCode, signal) => {
      processClosed = true;
      resolve({ exitCode, signal });
    });
  });
  const timer = setTimeout(() => {
    failProtocol(
      'candidate_timeout',
      'Candidate exceeded the configured timeout.',
    );
  }, timeoutMs);

  const waitForDrainOrClose = (): Promise<void> =>
    new Promise((resolve) => {
      const done = () => {
        child.stdin.off('drain', done);
        child.stdin.off('close', done);
        child.stdin.off('error', done);
        resolve();
      };
      child.stdin.once('drain', done);
      child.stdin.once('close', done);
      child.stdin.once('error', done);
    });
  const writeRequests = async () => {
    for (const [id, caseId] of requestIds) {
      if (terminalFailure || child.stdin.destroyed) break;
      const benchmarkCase = cases.find((entry) => entry.id === caseId);
      if (!benchmarkCase) continue;
      const accepted = child.stdin.write(
        `${JSON.stringify({
          id,
          requestId: id,
          schemaVersion: 1,
          action: operation,
          candidate: {
            id: candidate.id,
            kind: candidate.kind,
            version: candidate.version,
            model: candidate.model,
            config: candidate.config,
          },
          case: benchmarkCase,
        })}\n`,
      );
      if (!accepted) {
        await waitForDrainOrClose();
      }
    }
    if (!terminalFailure && !child.stdin.destroyed) child.stdin.end();
  };
  const writing = writeRequests();
  const { exitCode, signal } = await completion;
  await writing;
  clearTimeout(timer);
  if (forceKillTimer) clearTimeout(forceKillTimer);

  if (!terminalFailure && spawnErrorCode) {
    terminalFailure = {
      code:
        spawnErrorCode === 'ENOENT'
          ? 'candidate_not_found'
          : 'candidate_exit_nonzero',
      message: 'Candidate process could not be started.',
    };
  } else if (!terminalFailure && (exitCode !== 0 || signal !== null)) {
    terminalFailure = {
      code: 'candidate_exit_nonzero',
      message: 'Candidate process exited unsuccessfully.',
    };
    for (const { id } of cases) {
      caseResults.set(
        id,
        protocolFailure(id, terminalFailure.code, terminalFailure.message),
      );
    }
  }

  if (!terminalFailure && stdoutBuffer.trim() !== '') {
    terminalFailure = {
      code: 'candidate_invalid_json',
      message: 'Candidate returned an incomplete JSONL response.',
    };
  }
  const results = cases.map(({ id }) => {
    if (terminalFailure) {
      return protocolFailure(id, terminalFailure.code, terminalFailure.message);
    }
    const result = caseResults.get(id);
    if (result) return result;
    return protocolFailure(
      id,
      'candidate_contract_mismatch',
      'Candidate did not return a response for the case.',
    );
  });
  return {
    candidateId: candidate.id,
    results,
    ...(stderrBytes === 0
      ? {}
      : { diagnostics: { stderr: '[redacted]' as const, stderrBytes } }),
  };
};

const tokens = (text: string): string[] =>
  text.toLocaleLowerCase('en-US').match(/[\p{L}\p{N}]+/gu) ?? [];

type EditCounts = {
  substitutions: number;
  deletions: number;
  insertions: number;
};

const editCounts = (reference: string[], hypothesis: string[]): EditCounts => {
  type Cell = EditCounts & { cost: number };
  let previous: Cell[] = Array.from(
    { length: hypothesis.length + 1 },
    (_, insertions) => ({
      cost: insertions,
      substitutions: 0,
      deletions: 0,
      insertions,
    }),
  );
  for (let row = 1; row <= reference.length; row += 1) {
    const current: Cell[] = [
      { cost: row, substitutions: 0, deletions: row, insertions: 0 },
    ];
    for (let column = 1; column <= hypothesis.length; column += 1) {
      const matches = reference[row - 1] === hypothesis[column - 1];
      const diagonal = {
        ...previous[column - 1],
        cost: previous[column - 1].cost + (matches ? 0 : 1),
        substitutions: previous[column - 1].substitutions + (matches ? 0 : 1),
      };
      const deletion = {
        ...previous[column],
        cost: previous[column].cost + 1,
        deletions: previous[column].deletions + 1,
      };
      const insertion = {
        ...current[column - 1],
        cost: current[column - 1].cost + 1,
        insertions: current[column - 1].insertions + 1,
      };
      current[column] = [diagonal, deletion, insertion].reduce(
        (best, candidate) => (candidate.cost < best.cost ? candidate : best),
      );
    }
    previous = current;
  }
  const { substitutions, deletions, insertions } = previous[hypothesis.length];
  return { substitutions, deletions, insertions };
};

const safeRate = (numerator: number, denominator: number): number =>
  denominator === 0 ? (numerator === 0 ? 0 : 1) : numerator / denominator;

const wordMetrics = (
  reference: string[],
  hypothesis: string[],
): WordErrorMetrics => {
  const components = editCounts(reference, hypothesis);
  const errors =
    components.substitutions + components.deletions + components.insertions;
  return {
    referenceWords: reference.length,
    hypothesisWords: hypothesis.length,
    ...components,
    errors,
    wordErrorRate: safeRate(errors, reference.length),
  };
};

const validateMetricTurns = (turns: BenchmarkTurn[], field: string): void => {
  turns.forEach((turn, index) => {
    const prefix = `${field}[${index}]`;
    if (
      !Number.isFinite(turn.startTime) ||
      !Number.isFinite(turn.endTime) ||
      turn.startTime < 0 ||
      turn.endTime <= turn.startTime
    ) {
      fail(prefix, 'expected finite timestamps with a positive duration');
    }
    if (turn.speaker !== 'Me' && turn.speaker !== 'Them') {
      fail(`${prefix}.speaker`, 'expected Me or Them');
    }
  });
};

type SpeakerCounts = Record<BenchmarkSpeaker, number>;
type SpeakerDelta = SpeakerCounts;

const timelineEvents = (turns: BenchmarkTurn[]): Map<number, SpeakerDelta> => {
  const events = new Map<number, SpeakerDelta>();
  const add = (time: number, speaker: BenchmarkSpeaker, delta: number) => {
    const event = events.get(time) ?? { Me: 0, Them: 0 };
    event[speaker] += delta;
    events.set(time, event);
  };
  for (const turn of turns) {
    add(turn.startTime, turn.speaker, 1);
    add(turn.endTime, turn.speaker, -1);
  }
  return events;
};

const applyEvent = (
  counts: SpeakerCounts,
  event: SpeakerDelta | undefined,
): void => {
  if (!event) return;
  counts.Me += event.Me;
  counts.Them += event.Them;
};

const activeSet = (counts: SpeakerCounts): Set<BenchmarkSpeaker> =>
  new Set((['Me', 'Them'] as const).filter((speaker) => counts[speaker] > 0));

const sameSpeakers = (
  left: Set<BenchmarkSpeaker>,
  right: Set<BenchmarkSpeaker>,
): boolean =>
  left.size === right.size && [...left].every((speaker) => right.has(speaker));

const activeSetBoundaries = (events: Map<number, SpeakerDelta>): number[] => {
  const counts: SpeakerCounts = { Me: 0, Them: 0 };
  const boundaries: number[] = [];
  for (const time of [...events.keys()].sort((left, right) => left - right)) {
    const before = activeSet(counts);
    applyEvent(counts, events.get(time));
    if (!sameSpeakers(before, activeSet(counts))) boundaries.push(time);
  }
  return boundaries;
};

const alignedBoundaryError = (
  reference: number[],
  generated: number[],
  unmatchedPenalty: number,
): number => {
  // Dynamic-programming alignment prevents one generated event from satisfying
  // multiple reference events. An unmatched onset/offset costs one recording
  // duration, and the aggregate is normalized by the larger event count.
  if (reference.length === 0 && generated.length === 0) return 0;
  let previous = Array.from(
    { length: generated.length + 1 },
    (_, index) => index * unmatchedPenalty,
  );
  for (let row = 1; row <= reference.length; row += 1) {
    const current = [row * unmatchedPenalty];
    for (let column = 1; column <= generated.length; column += 1) {
      current[column] = Math.min(
        previous[column] + unmatchedPenalty,
        current[column - 1] + unmatchedPenalty,
        previous[column - 1] +
          Math.abs(reference[row - 1] - generated[column - 1]),
      );
    }
    previous = current;
  }
  return (
    previous[generated.length] / Math.max(reference.length, generated.length)
  );
};

const unionIntersectionDuration = (
  startTime: number,
  endTime: number,
  turns: BenchmarkTurn[],
): number => {
  const clipped = turns
    .map((turn) => ({
      startTime: Math.max(startTime, turn.startTime),
      endTime: Math.min(endTime, turn.endTime),
    }))
    .filter((turn) => turn.endTime > turn.startTime)
    .sort(
      (left, right) =>
        left.startTime - right.startTime || left.endTime - right.endTime,
    );
  let duration = 0;
  let unionStart: number | undefined;
  let unionEnd = 0;
  for (const turn of clipped) {
    if (unionStart === undefined) {
      unionStart = turn.startTime;
      unionEnd = turn.endTime;
    } else if (turn.startTime > unionEnd) {
      duration += unionEnd - unionStart;
      unionStart = turn.startTime;
      unionEnd = turn.endTime;
    } else {
      unionEnd = Math.max(unionEnd, turn.endTime);
    }
  }
  return unionStart === undefined ? 0 : duration + unionEnd - unionStart;
};

const speakerMetrics = (
  truePositiveSeconds: number,
  predictedSeconds: number,
  referenceSeconds: number,
): SpeakerClassificationMetrics => {
  const precision =
    predictedSeconds === 0
      ? referenceSeconds === 0
        ? 1
        : 0
      : truePositiveSeconds / predictedSeconds;
  const recall =
    referenceSeconds === 0
      ? predictedSeconds === 0
        ? 1
        : 0
      : truePositiveSeconds / referenceSeconds;
  return {
    truePositiveSeconds,
    predictedSeconds,
    referenceSeconds,
    precision,
    recall,
    f1:
      precision + recall === 0
        ? 0
        : (2 * precision * recall) / (precision + recall),
  };
};

/**
 * Scores fixed Me/Them labels over half-open intervals [start, end). At every
 * boundary, active speakers form a set, so overlap contributes one
 * speaker-second per active label. Unmatched reference/hypothesis labels are
 * paired as confusion first; remaining labels are missed speech/false alarm.
 * Counted start/end events preserve duplicate same-label intervals. Boundary
 * error includes every change of active set: speech onset/offset, silence,
 * overlap transitions, and separated turns from the same speaker.
 */
export const computeLocalAttributionMetrics = (
  input: LocalAttributionMetricInput,
): LocalAttributionMetrics => {
  validateMetricTurns(input.reference, 'reference');
  validateMetricTurns(input.generated, 'generated');
  const maxTurnEnd = Math.max(
    0,
    ...input.reference.map((turn) => turn.endTime),
    ...input.generated.map((turn) => turn.endTime),
  );
  if (input.audioDurationSeconds !== undefined) {
    if (
      !Number.isFinite(input.audioDurationSeconds) ||
      input.audioDurationSeconds <= 0
    ) {
      fail('audioDurationSeconds', 'expected a finite positive duration');
    }
    if (input.audioDurationSeconds < maxTurnEnd) {
      fail('audioDurationSeconds', 'cannot end before a transcript turn');
    }
  }
  if (input.elapsedMs !== undefined) {
    if (!Number.isFinite(input.elapsedMs) || input.elapsedMs < 0) {
      fail('elapsedMs', 'expected a finite non-negative duration');
    }
    if (input.audioDurationSeconds === undefined) {
      fail('elapsedMs', 'audioDurationSeconds is required');
    }
  }

  const ordered = (turns: BenchmarkTurn[]): BenchmarkTurn[] =>
    [...turns].sort(
      (left, right) =>
        left.startTime - right.startTime || left.endTime - right.endTime,
    );
  const reference = ordered(input.reference);
  const generated = ordered(input.generated);
  const referenceTokens = reference.flatMap((turn) => tokens(turn.text));
  const generatedTokens = generated.flatMap((turn) => tokens(turn.text));
  const transcript = wordMetrics(referenceTokens, generatedTokens);
  const speakerWordParts = (speaker: BenchmarkSpeaker) =>
    wordMetrics(
      reference
        .filter((turn) => turn.speaker === speaker)
        .flatMap((turn) => tokens(turn.text)),
      generated
        .filter((turn) => turn.speaker === speaker)
        .flatMap((turn) => tokens(turn.text)),
    );
  const meWords = speakerWordParts('Me');
  const themWords = speakerWordParts('Them');
  const speakerAttributedWords: WordErrorMetrics = {
    referenceWords: meWords.referenceWords + themWords.referenceWords,
    hypothesisWords: meWords.hypothesisWords + themWords.hypothesisWords,
    substitutions: meWords.substitutions + themWords.substitutions,
    deletions: meWords.deletions + themWords.deletions,
    insertions: meWords.insertions + themWords.insertions,
    errors: meWords.errors + themWords.errors,
    wordErrorRate: safeRate(
      meWords.errors + themWords.errors,
      meWords.referenceWords + themWords.referenceWords,
    ),
  };

  const referenceEvents = timelineEvents(reference);
  const generatedEvents = timelineEvents(generated);
  const eventTimes = [
    ...new Set(
      [...reference, ...generated].flatMap((turn) => [
        turn.startTime,
        turn.endTime,
      ]),
    ),
  ].sort((left, right) => left - right);
  let referenceSpeakerSeconds = 0;
  let missedSpeechSeconds = 0;
  let falseAlarmSeconds = 0;
  let speakerConfusionSeconds = 0;
  let overlapSeconds = 0;
  let overlapCorrectSeconds = 0;
  const perSpeaker = {
    Me: { truePositive: 0, predicted: 0, reference: 0 },
    Them: { truePositive: 0, predicted: 0, reference: 0 },
  };
  const referenceCounts: SpeakerCounts = { Me: 0, Them: 0 };
  const generatedCounts: SpeakerCounts = { Me: 0, Them: 0 };
  for (let index = 0; index < eventTimes.length - 1; index += 1) {
    const startTime = eventTimes[index];
    const endTime = eventTimes[index + 1];
    applyEvent(referenceCounts, referenceEvents.get(startTime));
    applyEvent(generatedCounts, generatedEvents.get(startTime));
    const duration = endTime - startTime;
    const expected = activeSet(referenceCounts);
    const actual = activeSet(generatedCounts);
    const shared = [...expected].filter((speaker) =>
      actual.has(speaker),
    ).length;
    const unmatchedExpected = expected.size - shared;
    const unmatchedActual = actual.size - shared;
    const confused = Math.min(unmatchedExpected, unmatchedActual);
    referenceSpeakerSeconds += expected.size * duration;
    speakerConfusionSeconds += confused * duration;
    missedSpeechSeconds += (unmatchedExpected - confused) * duration;
    falseAlarmSeconds += (unmatchedActual - confused) * duration;
    if (expected.size > 1) {
      overlapSeconds += duration;
      if ([...expected].every((speaker) => actual.has(speaker))) {
        overlapCorrectSeconds += duration;
      }
    }
    for (const speaker of ['Me', 'Them'] as const) {
      if (expected.has(speaker)) perSpeaker[speaker].reference += duration;
      if (actual.has(speaker)) perSpeaker[speaker].predicted += duration;
      if (expected.has(speaker) && actual.has(speaker)) {
        perSpeaker[speaker].truePositive += duration;
      }
    }
  }

  const speakersIn = (turns: BenchmarkTurn[]) =>
    new Set(turns.map((turn) => turn.speaker)).size;
  const expectedSpeakerCount = speakersIn(reference);
  const generatedSpeakerCount = speakersIn(generated);
  const referenceLabels = new Set(reference.map((turn) => turn.speaker));
  const generatedLabels = new Set(generated.map((turn) => turn.speaker));
  const speakerCountCorrect =
    referenceLabels.size === generatedLabels.size &&
    [...referenceLabels].every((speaker) => generatedLabels.has(speaker));
  const recordingDuration = input.audioDurationSeconds ?? maxTurnEnd;
  const boundaryErrorSeconds = alignedBoundaryError(
    activeSetBoundaries(referenceEvents),
    activeSetBoundaries(generatedEvents),
    recordingDuration,
  );
  const localTurns = reference.filter((turn) => turn.speaker === 'Me');
  const generatedLocalTurns = generated.filter((turn) => turn.speaker === 'Me');
  const recalledLocalTurns = localTurns.filter((turn) => {
    const overlap = unionIntersectionDuration(
      turn.startTime,
      turn.endTime,
      generatedLocalTurns,
    );
    return overlap / (turn.endTime - turn.startTime) >= 0.65;
  }).length;

  const diarizationErrorRate = safeRate(
    missedSpeechSeconds + falseAlarmSeconds + speakerConfusionSeconds,
    referenceSpeakerSeconds,
  );
  const me = speakerMetrics(
    perSpeaker.Me.truePositive,
    perSpeaker.Me.predicted,
    perSpeaker.Me.reference,
  );

  return {
    wordErrorRate: transcript.wordErrorRate,
    diarizationErrorRate,
    falseMeSeconds: me.predictedSeconds - me.truePositiveSeconds,
    missedMeSeconds: me.referenceSeconds - me.truePositiveSeconds,
    speakerCount: generatedSpeakerCount,
    transcript,
    speakerAttributedWords,
    diarization: {
      referenceSpeakerSeconds,
      missedSpeechSeconds,
      falseAlarmSeconds,
      speakerConfusionSeconds,
      errorRate: diarizationErrorRate,
    },
    me,
    them: speakerMetrics(
      perSpeaker.Them.truePositive,
      perSpeaker.Them.predicted,
      perSpeaker.Them.reference,
    ),
    expectedSpeakerCount,
    generatedSpeakerCount,
    speakerCountCorrect,
    boundaryErrorSeconds,
    overlapAccuracy:
      overlapSeconds === 0 ? 1 : overlapCorrectSeconds / overlapSeconds,
    shortLocalTurnRecall:
      localTurns.length === 0 ? 1 : recalledLocalTurns / localTurns.length,
    ...(input.elapsedMs === undefined
      ? {}
      : {
          runtimeFactor:
            input.elapsedMs / 1000 / (input.audioDurationSeconds as number),
        }),
  };
};
