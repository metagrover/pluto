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

const activeSpeakers = (
  turns: BenchmarkTurn[],
  startTime: number,
  endTime: number,
): Set<BenchmarkSpeaker> =>
  new Set(
    turns
      .filter((turn) => turn.startTime < endTime && turn.endTime > startTime)
      .map((turn) => turn.speaker),
  );

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

  const boundaries = [
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
  for (let index = 1; index < boundaries.length; index += 1) {
    const startTime = boundaries[index - 1];
    const endTime = boundaries[index];
    const duration = endTime - startTime;
    const expected = activeSpeakers(reference, startTime, endTime);
    const actual = activeSpeakers(generated, startTime, endTime);
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
  const referenceChanges = reference
    .slice(1)
    .filter((turn, index) => turn.speaker !== reference[index].speaker)
    .map((turn) => turn.startTime);
  const generatedChanges = generated
    .slice(1)
    .filter((turn, index) => turn.speaker !== generated[index].speaker)
    .map((turn) => turn.startTime);
  const recordingDuration = input.audioDurationSeconds ?? maxTurnEnd;
  const boundaryErrorSeconds =
    referenceChanges.length === 0
      ? 0
      : referenceChanges.reduce(
          (total, boundary) =>
            total +
            (generatedChanges.length === 0
              ? recordingDuration
              : Math.min(
                  ...generatedChanges.map((candidate) =>
                    Math.abs(candidate - boundary),
                  ),
                )),
          0,
        ) / referenceChanges.length;
  const localTurns = reference.filter((turn) => turn.speaker === 'Me');
  const recalledLocalTurns = localTurns.filter((turn) => {
    const overlap = generated
      .filter((candidate) => candidate.speaker === 'Me')
      .reduce(
        (total, candidate) =>
          total +
          Math.max(
            0,
            Math.min(turn.endTime, candidate.endTime) -
              Math.max(turn.startTime, candidate.startTime),
          ),
        0,
      );
    return overlap / (turn.endTime - turn.startTime) >= 0.65;
  }).length;

  return {
    transcript,
    speakerAttributedWords,
    diarization: {
      referenceSpeakerSeconds,
      missedSpeechSeconds,
      falseAlarmSeconds,
      speakerConfusionSeconds,
      errorRate: safeRate(
        missedSpeechSeconds + falseAlarmSeconds + speakerConfusionSeconds,
        referenceSpeakerSeconds,
      ),
    },
    me: speakerMetrics(
      perSpeaker.Me.truePositive,
      perSpeaker.Me.predicted,
      perSpeaker.Me.reference,
    ),
    them: speakerMetrics(
      perSpeaker.Them.truePositive,
      perSpeaker.Them.predicted,
      perSpeaker.Them.reference,
    ),
    expectedSpeakerCount,
    generatedSpeakerCount,
    speakerCountCorrect: expectedSpeakerCount === generatedSpeakerCount,
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
