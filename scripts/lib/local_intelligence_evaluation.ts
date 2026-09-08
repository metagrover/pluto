import { createHash } from 'node:crypto';

export type LocalIntelligenceLane =
  | 'quick_chat'
  | 'meeting_notes'
  | 'cross_meeting'
  | 'project_synthesis'
  | 'dreaming';

export type EvaluationModelIdentity = {
  configId: string;
  tag: string;
  digest: string;
};

export type NotesExperimentConfiguration = {
  configId: 'phi-notes-source-first' | 'gemma-notes-control';
  lane: 'meeting_notes';
  pipelineVariant: 'source_first' | 'compact_control';
  sourceFirstReconciliation: boolean;
  compactWriterContract: true;
  tag: string;
  digest: string;
};

export type NotesEvaluationCollection =
  | 'semantic'
  | 'ordinary_capacity'
  | 'expected_rejection';

export type NotesScheduledRun = {
  runId: string;
  caseId: string;
  configId: NotesExperimentConfiguration['configId'];
  collection: NotesEvaluationCollection;
  repetition: number;
  condition: 'cold' | 'warm';
};

export type NotesEvaluationCollections = {
  semantic: string[];
  ordinaryCapacity: string[];
  expectedRejection: string[];
};

export type NotesExperimentSettings = {
  seed: number;
  temperature: 0.1;
  threads: number;
  thinking: false;
  contextTokens: 16_384;
  writerOutputTokens: 2_048;
  editorOutputTokens: number;
  stageCache: 'disabled';
};

type LocalIntelligenceCeilings = {
  ordinaryNotesMs: number;
  longNotesMs: number;
  chatMs: number;
  dreamingMs: number;
  notesPhysicalStarts: number;
  minimumSamplesForP95: number;
};

export type LegacyLocalIntelligenceManifest = {
  schemaVersion: 1;
  suiteId: string;
  privacy: 'owner_only_private';
  sourceRevision: string;
  dirtyDiffSha256: string;
  corpusSha256: string;
  models: EvaluationModelIdentity[];
  ceilings: LocalIntelligenceCeilings;
};

export type NotesExperimentManifest = {
  schemaVersion: 2;
  suiteId: string;
  privacy: 'owner_only_private';
  sourceRevision: string;
  dirtyDiffSha256: string;
  corpusSha256: string;
  rubricSha256: string;
  scheduleSha256: string;
  partition: 'development' | 'held_out';
  models: EvaluationModelIdentity[];
  configurations: NotesExperimentConfiguration[];
  collections: NotesEvaluationCollections;
  settings: NotesExperimentSettings;
  schedule: NotesScheduledRun[];
  ceilings: LocalIntelligenceCeilings;
};

export type LocalIntelligenceManifest =
  | LegacyLocalIntelligenceManifest
  | NotesExperimentManifest;

export const PHI_NOTES_EXPERIMENT_CONFIGURATION = {
  configId: 'phi-notes-source-first',
  lane: 'meeting_notes',
  pipelineVariant: 'source_first',
  sourceFirstReconciliation: true,
  compactWriterContract: true,
  tag: 'phi4-mini:3.8b',
  digest: '78fad5d182a7c33065e153a5f8ba210754207ba9d91973f57dffa7f487363753',
} as const satisfies NotesExperimentConfiguration;

export const GEMMA_NOTES_CONTROL_CONFIGURATION = {
  configId: 'gemma-notes-control',
  lane: 'meeting_notes',
  pipelineVariant: 'compact_control',
  sourceFirstReconciliation: false,
  compactWriterContract: true,
  tag: 'gemma4:12b',
  digest: '4eb23ef187e2c5462566d6a1d3bbbc2f1346d0b4327cbb66d58fffbcc9b2b05c',
} as const satisfies NotesExperimentConfiguration;

export const NOTES_EXPERIMENT_CONFIGURATIONS = [
  PHI_NOTES_EXPERIMENT_CONFIGURATION,
  GEMMA_NOTES_CONTROL_CONFIGURATION,
] as const;

export type ResourceTelemetry = {
  memoryPressure: 'normal' | 'warning' | 'critical' | 'unknown';
  thermalState: 'nominal' | 'fair' | 'serious' | 'critical' | 'unknown';
  residentModelBytes: number;
  swapUsedBytes: number;
};

type RunStartedEvent = {
  type: 'run_started';
  eventId: string;
  runId: string;
  caseId: string;
  configId: string;
  lane: LocalIntelligenceLane;
  environment: 'replay' | 'disposable_integration';
  sourceRevision: string;
  atMs: number;
};

type PhysicalStartedEvent = {
  type: 'physical_started';
  eventId: string;
  runId: string;
  logicalStageId: string;
  attemptId: string;
  requestedModel: string;
  actualModel: string;
  atMs: number;
};

type PhysicalTerminalEvent = {
  type: 'physical_terminal';
  eventId: string;
  runId: string;
  attemptId: string;
  outcome: 'complete' | 'failed' | 'timeout' | 'cancelled' | 'preempted';
  atMs: number;
  inputTokens: number;
  outputTokens: number;
  resourceTelemetry: ResourceTelemetry;
};

type LogicalTerminalEvent = {
  type: 'logical_terminal';
  eventId: string;
  runId: string;
  logicalStageId: string;
  outcome:
    | 'accepted'
    | 'pending_review'
    | 'rejected'
    | 'failed'
    | 'timeout'
    | 'cancelled';
  acceptedInReplay: boolean;
  published: boolean;
  sourceRevision: string;
  atMs: number;
};

type RunContaminatedEvent = {
  type: 'run_contaminated';
  eventId: string;
  runId: string;
  reason: 'unplanned_inference' | 'sleep' | 'workload_change' | 'unattributed';
  atMs: number;
};

export type EvaluationEvent =
  | RunStartedEvent
  | PhysicalStartedEvent
  | PhysicalTerminalEvent
  | LogicalTerminalEvent
  | RunContaminatedEvent;

export type LocalIntelligenceRunResult = {
  runId: string;
  caseId: string;
  configId: string;
  lane: LocalIntelligenceLane;
  condition: 'cold' | 'warm' | 'mixed';
  status: 'accepted' | 'rejected' | 'failed' | 'timeout' | 'cancelled';
  totalMs: number | null;
  contaminated: boolean;
  physicalStarts: number;
  preemptions: number;
};

const manifestKeys = [
  'schemaVersion',
  'suiteId',
  'privacy',
  'sourceRevision',
  'dirtyDiffSha256',
  'corpusSha256',
  'models',
  'ceilings',
] as const;
const notesManifestKeys = [
  ...manifestKeys,
  'rubricSha256',
  'scheduleSha256',
  'partition',
  'configurations',
  'collections',
  'settings',
  'schedule',
] as const;
const modelKeys = ['configId', 'tag', 'digest'] as const;
const notesConfigurationKeys = [
  'configId',
  'lane',
  'pipelineVariant',
  'sourceFirstReconciliation',
  'compactWriterContract',
  'tag',
  'digest',
] as const;
const notesCollectionKeys = [
  'semantic',
  'ordinaryCapacity',
  'expectedRejection',
] as const;
const notesSettingsKeys = [
  'seed',
  'temperature',
  'threads',
  'thinking',
  'contextTokens',
  'writerOutputTokens',
  'editorOutputTokens',
  'stageCache',
] as const;
const notesScheduledRunKeys = [
  'runId',
  'caseId',
  'configId',
  'collection',
  'repetition',
  'condition',
] as const;
const ceilingKeys = [
  'ordinaryNotesMs',
  'longNotesMs',
  'chatMs',
  'dreamingMs',
  'notesPhysicalStarts',
  'minimumSamplesForP95',
] as const;
const runResultKeys = [
  'runId',
  'caseId',
  'configId',
  'lane',
  'condition',
  'status',
  'totalMs',
  'contaminated',
  'physicalStarts',
  'preemptions',
] as const;

const lanes = new Set<LocalIntelligenceLane>([
  'quick_chat',
  'meeting_notes',
  'cross_meeting',
  'project_synthesis',
  'dreaming',
]);
const digestPattern = /^[a-f0-9]{64}$/;
const revisionPattern = /^[a-f0-9]{40}$/;
const identifierPattern = /^[a-z0-9][a-z0-9._-]{0,127}$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const hasExactKeys = (
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean => {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
};

const isPositiveInteger = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) > 0;

const invalidManifest = (): never => {
  throw new Error('evaluation_manifest_invalid');
};

const sha256Json = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');

const validateCaseIds = (
  collections: NotesEvaluationCollections,
): NotesEvaluationCollections => {
  const seen = new Set<string>();
  const validated = {} as NotesEvaluationCollections;
  for (const key of notesCollectionKeys) {
    const values = collections[key];
    if (!Array.isArray(values) || values.length === 0) invalidManifest();
    validated[key] = values.map((value) => {
      if (
        typeof value !== 'string' ||
        !identifierPattern.test(value) ||
        seen.has(value)
      ) {
        invalidManifest();
      }
      seen.add(value);
      return value;
    });
  }
  return validated;
};

const pairedConfigurations = (reverse: boolean) =>
  reverse
    ? ([
        GEMMA_NOTES_CONTROL_CONFIGURATION,
        PHI_NOTES_EXPERIMENT_CONFIGURATION,
      ] as const)
    : NOTES_EXPERIMENT_CONFIGURATIONS;

export const buildFrozenNotesSchedule = (
  rawCollections: NotesEvaluationCollections,
): NotesScheduledRun[] => {
  const collections = validateCaseIds(rawCollections);
  const schedule: NotesScheduledRun[] = [];
  let pairIndex = 0;
  const appendPair = (
    caseId: string,
    collection: NotesEvaluationCollection,
    repetition: number,
    condition: NotesScheduledRun['condition'],
  ) => {
    for (const configuration of pairedConfigurations(pairIndex % 2 === 1)) {
      schedule.push({
        runId: `${collection}-${caseId}-${repetition}-${condition}-${configuration.configId}`,
        caseId,
        configId: configuration.configId,
        collection,
        repetition,
        condition,
      });
    }
    pairIndex += 1;
  };

  collections.semantic.forEach((caseId, caseIndex) => {
    for (let repetition = 1; repetition <= 3; repetition += 1) {
      const condition =
        repetition === 1
          ? 'cold'
          : repetition === 2
            ? 'warm'
            : caseIndex % 2 === 0
              ? 'cold'
              : 'warm';
      appendPair(caseId, 'semantic', repetition, condition);
    }
  });
  collections.ordinaryCapacity.forEach((caseId) => {
    for (const condition of ['cold', 'warm'] as const) {
      for (let repetition = 1; repetition <= 3; repetition += 1) {
        appendPair(caseId, 'ordinary_capacity', repetition, condition);
      }
    }
  });
  collections.expectedRejection.forEach((caseId, caseIndex) => {
    for (let repetition = 1; repetition <= 3; repetition += 1) {
      appendPair(
        caseId,
        'expected_rejection',
        repetition,
        (caseIndex + repetition) % 2 === 0 ? 'cold' : 'warm',
      );
    }
  });
  return schedule;
};

export const notesScheduleSha256 = (
  schedule: readonly NotesScheduledRun[],
): string => sha256Json(schedule);

export const parseLocalIntelligenceManifest = (
  value: unknown,
  installedModels?: readonly { tag: string; digest: string }[],
): LocalIntelligenceManifest => {
  if (!isRecord(value)) invalidManifest();
  const schemaVersion = value.schemaVersion;
  if (
    (schemaVersion !== 1 && schemaVersion !== 2) ||
    !hasExactKeys(value, schemaVersion === 1 ? manifestKeys : notesManifestKeys)
  ) {
    invalidManifest();
  }
  if (
    value.privacy !== 'owner_only_private' ||
    typeof value.suiteId !== 'string' ||
    !identifierPattern.test(value.suiteId) ||
    typeof value.sourceRevision !== 'string' ||
    !revisionPattern.test(value.sourceRevision) ||
    typeof value.dirtyDiffSha256 !== 'string' ||
    !digestPattern.test(value.dirtyDiffSha256) ||
    typeof value.corpusSha256 !== 'string' ||
    !digestPattern.test(value.corpusSha256) ||
    !Array.isArray(value.models) ||
    value.models.length === 0 ||
    !isRecord(value.ceilings) ||
    !hasExactKeys(value.ceilings, ceilingKeys)
  ) {
    invalidManifest();
  }

  const ceilings = value.ceilings;
  if (ceilingKeys.some((key) => !isPositiveInteger(ceilings[key]))) {
    invalidManifest();
  }

  const models: EvaluationModelIdentity[] = [];
  const configIds = new Set<string>();
  for (const candidate of value.models) {
    if (
      !isRecord(candidate) ||
      !hasExactKeys(candidate, modelKeys) ||
      typeof candidate.configId !== 'string' ||
      !identifierPattern.test(candidate.configId) ||
      typeof candidate.tag !== 'string' ||
      !candidate.tag.trim() ||
      typeof candidate.digest !== 'string' ||
      !digestPattern.test(candidate.digest) ||
      configIds.has(candidate.configId)
    ) {
      invalidManifest();
    }
    if (
      installedModels &&
      !installedModels.some(
        (installed) =>
          installed.tag === candidate.tag &&
          installed.digest === candidate.digest,
      )
    ) {
      throw new Error('evaluation_model_identity_unknown');
    }
    configIds.add(candidate.configId);
    models.push({
      configId: candidate.configId,
      tag: candidate.tag,
      digest: candidate.digest,
    });
  }

  const common = {
    suiteId: value.suiteId as string,
    privacy: 'owner_only_private',
    sourceRevision: value.sourceRevision as string,
    dirtyDiffSha256: value.dirtyDiffSha256 as string,
    corpusSha256: value.corpusSha256 as string,
    models,
    ceilings: {
      ordinaryNotesMs: ceilings.ordinaryNotesMs as number,
      longNotesMs: ceilings.longNotesMs as number,
      chatMs: ceilings.chatMs as number,
      dreamingMs: ceilings.dreamingMs as number,
      notesPhysicalStarts: ceilings.notesPhysicalStarts as number,
      minimumSamplesForP95: ceilings.minimumSamplesForP95 as number,
    },
  };

  if (schemaVersion === 1) {
    return { schemaVersion: 1, ...common };
  }

  if (
    typeof value.rubricSha256 !== 'string' ||
    !digestPattern.test(value.rubricSha256) ||
    typeof value.scheduleSha256 !== 'string' ||
    !digestPattern.test(value.scheduleSha256) ||
    !['development', 'held_out'].includes(String(value.partition)) ||
    !Array.isArray(value.configurations) ||
    value.configurations.length !== NOTES_EXPERIMENT_CONFIGURATIONS.length ||
    !isRecord(value.collections) ||
    !hasExactKeys(value.collections, notesCollectionKeys) ||
    !isRecord(value.settings) ||
    !hasExactKeys(value.settings, notesSettingsKeys) ||
    !Array.isArray(value.schedule)
  ) {
    invalidManifest();
  }

  const configurations = value.configurations.map((candidate) => {
    if (
      !isRecord(candidate) ||
      !hasExactKeys(candidate, notesConfigurationKeys)
    ) {
      invalidManifest();
    }
    const expected = NOTES_EXPERIMENT_CONFIGURATIONS.find(
      (configuration) => configuration.configId === candidate.configId,
    );
    if (
      !expected ||
      notesConfigurationKeys.some((key) => candidate[key] !== expected[key])
    ) {
      invalidManifest();
    }
    return { ...expected } as NotesExperimentConfiguration;
  });
  if (new Set(configurations.map(({ configId }) => configId)).size !== 2) {
    invalidManifest();
  }
  if (
    models.length !== configurations.length ||
    configurations.some(
      (configuration) =>
        !models.some(
          (model) =>
            model.configId === configuration.configId &&
            model.tag === configuration.tag &&
            model.digest === configuration.digest,
        ),
    )
  ) {
    invalidManifest();
  }

  const rawCollections = value.collections as Record<string, unknown>;
  const collections = validateCaseIds({
    semantic: rawCollections.semantic as string[],
    ordinaryCapacity: rawCollections.ordinaryCapacity as string[],
    expectedRejection: rawCollections.expectedRejection as string[],
  });
  const settings = value.settings;
  if (
    !Number.isSafeInteger(settings.seed) ||
    settings.temperature !== 0.1 ||
    !isPositiveInteger(settings.threads) ||
    settings.thinking !== false ||
    settings.contextTokens !== 16_384 ||
    settings.writerOutputTokens !== 2_048 ||
    !isPositiveInteger(settings.editorOutputTokens) ||
    settings.stageCache !== 'disabled'
  ) {
    invalidManifest();
  }

  const schedule = value.schedule.map((candidate) => {
    if (
      !isRecord(candidate) ||
      !hasExactKeys(candidate, notesScheduledRunKeys) ||
      typeof candidate.runId !== 'string' ||
      !identifierPattern.test(candidate.runId) ||
      typeof candidate.caseId !== 'string' ||
      !identifierPattern.test(candidate.caseId) ||
      !NOTES_EXPERIMENT_CONFIGURATIONS.some(
        ({ configId }) => configId === candidate.configId,
      ) ||
      !['semantic', 'ordinary_capacity', 'expected_rejection'].includes(
        String(candidate.collection),
      ) ||
      !isPositiveInteger(candidate.repetition) ||
      !['cold', 'warm'].includes(String(candidate.condition))
    ) {
      invalidManifest();
    }
    return candidate as NotesScheduledRun;
  });
  const expectedSchedule = buildFrozenNotesSchedule(collections);
  if (
    JSON.stringify(schedule) !== JSON.stringify(expectedSchedule) ||
    value.scheduleSha256 !== notesScheduleSha256(schedule)
  ) {
    throw new Error('evaluation_schedule_mismatch');
  }

  return {
    schemaVersion: 2,
    ...common,
    rubricSha256: value.rubricSha256 as string,
    scheduleSha256: value.scheduleSha256 as string,
    partition: value.partition as NotesExperimentManifest['partition'],
    configurations,
    collections,
    settings: settings as NotesExperimentSettings,
    schedule,
  };
};

const eventKeys: Record<EvaluationEvent['type'], readonly string[]> = {
  run_started: [
    'type',
    'eventId',
    'runId',
    'caseId',
    'configId',
    'lane',
    'environment',
    'sourceRevision',
    'atMs',
  ],
  physical_started: [
    'type',
    'eventId',
    'runId',
    'logicalStageId',
    'attemptId',
    'requestedModel',
    'actualModel',
    'atMs',
  ],
  physical_terminal: [
    'type',
    'eventId',
    'runId',
    'attemptId',
    'outcome',
    'atMs',
    'inputTokens',
    'outputTokens',
    'resourceTelemetry',
  ],
  logical_terminal: [
    'type',
    'eventId',
    'runId',
    'logicalStageId',
    'outcome',
    'acceptedInReplay',
    'published',
    'sourceRevision',
    'atMs',
  ],
  run_contaminated: ['type', 'eventId', 'runId', 'reason', 'atMs'],
};

const telemetryKeys = [
  'memoryPressure',
  'thermalState',
  'residentModelBytes',
  'swapUsedBytes',
] as const;

const validTelemetry = (value: unknown): value is ResourceTelemetry =>
  isRecord(value) &&
  hasExactKeys(value, telemetryKeys) &&
  ['normal', 'warning', 'critical', 'unknown'].includes(
    String(value.memoryPressure),
  ) &&
  ['nominal', 'fair', 'serious', 'critical', 'unknown'].includes(
    String(value.thermalState),
  ) &&
  typeof value.residentModelBytes === 'number' &&
  Number.isFinite(value.residentModelBytes) &&
  value.residentModelBytes >= 0 &&
  typeof value.swapUsedBytes === 'number' &&
  Number.isFinite(value.swapUsedBytes) &&
  value.swapUsedBytes >= 0;

const invalidEvent = (): never => {
  throw new Error('evaluation_event_invalid');
};

export const validateEvaluationEventLedger = (
  manifest: LocalIntelligenceManifest,
  events: readonly EvaluationEvent[],
) => {
  const parsedManifest = parseLocalIntelligenceManifest(manifest);
  const modelByConfig = new Map(
    parsedManifest.models.map((model) => [model.configId, model]),
  );
  const eventIds = new Set<string>();
  const runs = new Map<string, RunStartedEvent>();
  const attempts = new Map<string, PhysicalStartedEvent>();
  const terminalAttempts = new Set<string>();
  const logicalStages = new Set<string>();
  const terminalRuns = new Set<string>();
  const contaminatedRuns = new Set<string>();
  let preemptionCount = 0;
  let acceptedReplayCount = 0;
  let publishedCount = 0;

  for (const rawEvent of events) {
    if (
      !isRecord(rawEvent) ||
      typeof rawEvent.type !== 'string' ||
      !(rawEvent.type in eventKeys) ||
      !hasExactKeys(
        rawEvent,
        eventKeys[rawEvent.type as EvaluationEvent['type']],
      ) ||
      typeof rawEvent.eventId !== 'string' ||
      !identifierPattern.test(rawEvent.eventId) ||
      typeof rawEvent.runId !== 'string' ||
      !identifierPattern.test(rawEvent.runId) ||
      typeof rawEvent.atMs !== 'number' ||
      !Number.isFinite(rawEvent.atMs) ||
      rawEvent.atMs < 0 ||
      eventIds.has(rawEvent.eventId)
    ) {
      invalidEvent();
    }
    eventIds.add(rawEvent.eventId);
    const event = rawEvent as EvaluationEvent;

    if (event.type === 'run_started') {
      if (
        runs.has(event.runId) ||
        !identifierPattern.test(event.caseId) ||
        !modelByConfig.has(event.configId) ||
        !lanes.has(event.lane) ||
        !['replay', 'disposable_integration'].includes(event.environment) ||
        event.sourceRevision !== parsedManifest.sourceRevision
      ) {
        invalidEvent();
      }
      runs.set(event.runId, event);
      continue;
    }

    if (event.type === 'physical_started') {
      const run = runs.get(event.runId);
      if (!run) invalidEvent();
      if (attempts.has(event.attemptId)) {
        throw new Error('evaluation_attempt_duplicate');
      }
      const expectedModel = modelByConfig.get(run.configId)?.tag;
      if (
        !identifierPattern.test(event.logicalStageId) ||
        !identifierPattern.test(event.attemptId) ||
        !event.requestedModel ||
        event.requestedModel !== expectedModel ||
        event.actualModel !== event.requestedModel
      ) {
        throw new Error('evaluation_wire_model_mismatch');
      }
      attempts.set(event.attemptId, event);
      continue;
    }

    if (event.type === 'physical_terminal') {
      const start = attempts.get(event.attemptId);
      if (!start || start.runId !== event.runId) {
        throw new Error('evaluation_terminal_without_start');
      }
      if (terminalAttempts.has(event.attemptId)) {
        throw new Error('evaluation_attempt_terminal_duplicate');
      }
      if (
        !['complete', 'failed', 'timeout', 'cancelled', 'preempted'].includes(
          event.outcome,
        ) ||
        !Number.isSafeInteger(event.inputTokens) ||
        event.inputTokens < 0 ||
        !Number.isSafeInteger(event.outputTokens) ||
        event.outputTokens < 0 ||
        !validTelemetry(event.resourceTelemetry) ||
        event.atMs < start.atMs
      ) {
        invalidEvent();
      }
      terminalAttempts.add(event.attemptId);
      if (event.outcome === 'preempted') preemptionCount += 1;
      continue;
    }

    const run = runs.get(event.runId);
    if (!run) invalidEvent();
    if (event.type === 'run_contaminated') {
      if (
        ![
          'unplanned_inference',
          'sleep',
          'workload_change',
          'unattributed',
        ].includes(event.reason)
      ) {
        invalidEvent();
      }
      contaminatedRuns.add(event.runId);
      continue;
    }

    if (
      !identifierPattern.test(event.logicalStageId) ||
      ![
        'accepted',
        'pending_review',
        'rejected',
        'failed',
        'timeout',
        'cancelled',
      ].includes(event.outcome) ||
      event.sourceRevision !== parsedManifest.sourceRevision ||
      event.acceptedInReplay !== (event.outcome === 'accepted') ||
      event.atMs < run.atMs
    ) {
      invalidEvent();
    }
    if (run.environment === 'replay' && event.published) {
      throw new Error('evaluation_replay_not_published');
    }
    if (event.published && run.environment !== 'disposable_integration') {
      throw new Error('evaluation_replay_not_published');
    }
    if (logicalStages.has(`${event.runId}:${event.logicalStageId}`)) {
      throw new Error('evaluation_logical_terminal_duplicate');
    }
    logicalStages.add(`${event.runId}:${event.logicalStageId}`);
    terminalRuns.add(event.runId);
    if (event.acceptedInReplay) acceptedReplayCount += 1;
    if (event.published) publishedCount += 1;
  }

  return {
    runCount: runs.size,
    logicalStageCount: logicalStages.size,
    physicalStartCount: attempts.size,
    preemptionCount,
    acceptedReplayCount,
    publishedCount,
    contaminatedRunCount: contaminatedRuns.size,
    interruptedRunCount: [...runs.keys()].filter(
      (runId) => !terminalRuns.has(runId),
    ).length,
    orphanedPhysicalStartCount: [...attempts.keys()].filter(
      (attemptId) => !terminalAttempts.has(attemptId),
    ).length,
  };
};

export const reconcileNotesEvaluationSchedule = (
  manifest: NotesExperimentManifest,
  events: readonly EvaluationEvent[],
) => {
  const parsed = parseLocalIntelligenceManifest(manifest);
  if (parsed.schemaVersion !== 2) invalidManifest();
  validateEvaluationEventLedger(parsed, events);
  const startedRunIds = new Set(
    events
      .filter((event): event is RunStartedEvent => event.type === 'run_started')
      .map((event) => event.runId),
  );
  const terminalRunIds = new Set(
    events
      .filter(
        (event): event is LogicalTerminalEvent =>
          event.type === 'logical_terminal',
      )
      .map((event) => event.runId),
  );
  const scheduledRunIds = new Set(parsed.schedule.map(({ runId }) => runId));
  if ([...startedRunIds].some((runId) => !scheduledRunIds.has(runId))) {
    throw new Error('evaluation_schedule_mismatch');
  }
  return {
    unstarted: parsed.schedule.filter((run) => !startedRunIds.has(run.runId)),
    interrupted: parsed.schedule.filter(
      (run) => startedRunIds.has(run.runId) && !terminalRunIds.has(run.runId),
    ),
    completed: parsed.schedule.filter((run) => terminalRunIds.has(run.runId)),
  };
};

const validateRunResult = (run: unknown): LocalIntelligenceRunResult => {
  if (
    !isRecord(run) ||
    !hasExactKeys(run, runResultKeys) ||
    typeof run.runId !== 'string' ||
    !identifierPattern.test(run.runId) ||
    typeof run.caseId !== 'string' ||
    !identifierPattern.test(run.caseId) ||
    typeof run.configId !== 'string' ||
    !identifierPattern.test(run.configId) ||
    !lanes.has(run.lane as LocalIntelligenceLane) ||
    !['cold', 'warm', 'mixed'].includes(String(run.condition)) ||
    !['accepted', 'rejected', 'failed', 'timeout', 'cancelled'].includes(
      String(run.status),
    ) ||
    (run.totalMs !== null &&
      (typeof run.totalMs !== 'number' ||
        !Number.isFinite(run.totalMs) ||
        run.totalMs < 0)) ||
    typeof run.contaminated !== 'boolean' ||
    !Number.isSafeInteger(run.physicalStarts) ||
    Number(run.physicalStarts) < 0 ||
    !Number.isSafeInteger(run.preemptions) ||
    Number(run.preemptions) < 0
  ) {
    throw new Error('evaluation_run_result_invalid');
  }
  return run as LocalIntelligenceRunResult;
};

const percentile = (
  values: readonly number[],
  fraction: number,
): number | null => {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? null;
};

export const aggregateLocalIntelligenceRuns = (
  rawRuns: readonly LocalIntelligenceRunResult[],
  minimumSamplesForP95 = 20,
) => {
  const runs = rawRuns.map(validateRunResult);
  const accepted = runs.filter((run) => run.status === 'accepted');
  const isolatedAcceptedLatencies = accepted
    .filter((run) => !run.contaminated && run.totalMs !== null)
    .map((run) => run.totalMs as number);
  return {
    totalCount: runs.length,
    acceptedCount: accepted.length,
    rejectedCount: runs.filter((run) => run.status === 'rejected').length,
    failedCount: runs.filter((run) => run.status === 'failed').length,
    timeoutCount: runs.filter((run) => run.status === 'timeout').length,
    cancelledCount: runs.filter((run) => run.status === 'cancelled').length,
    contaminatedCount: runs.filter((run) => run.contaminated).length,
    completionRate: runs.length ? accepted.length / runs.length : 0,
    isolatedAcceptedLatencyCount: isolatedAcceptedLatencies.length,
    p95AcceptedMs:
      isolatedAcceptedLatencies.length >= minimumSamplesForP95
        ? percentile(isolatedAcceptedLatencies, 0.95)
        : null,
    latencyRows: runs.map((run) => ({
      configId: run.configId,
      lane: run.lane,
      condition: run.condition,
      status: run.status,
      totalMs: run.totalMs,
      contaminated: run.contaminated,
      censored: run.status !== 'accepted' || run.totalMs === null,
      physicalStarts: run.physicalStarts,
      preemptions: run.preemptions,
    })),
  };
};

export const assertEvaluationCeiling = (
  manifest: LocalIntelligenceManifest,
  run: {
    lane: LocalIntelligenceLane;
    durationClass?: 'ordinary' | 'long';
    elapsedMs: number;
    physicalStarts: number;
  },
): void => {
  const deadlineMs =
    run.lane === 'meeting_notes'
      ? run.durationClass === 'long'
        ? manifest.ceilings.longNotesMs
        : manifest.ceilings.ordinaryNotesMs
      : run.lane === 'dreaming'
        ? manifest.ceilings.dreamingMs
        : manifest.ceilings.chatMs;
  if (run.elapsedMs > deadlineMs) {
    throw new Error('evaluation_deadline_exceeded');
  }
  if (
    run.lane === 'meeting_notes' &&
    run.physicalStarts > manifest.ceilings.notesPhysicalStarts
  ) {
    throw new Error('evaluation_physical_start_ceiling_exceeded');
  }
};

const assertNoSentinel = (
  value: unknown,
  sentinels: readonly string[],
): void => {
  const serialized = JSON.stringify(value);
  if (
    sentinels.some(
      (sentinel) => sentinel.length > 0 && serialized.includes(sentinel),
    )
  ) {
    throw new Error('evaluation_public_report_unsafe');
  }
};

export const projectContentFreeEvaluationReport = (
  manifest: LocalIntelligenceManifest,
  rawRuns: readonly LocalIntelligenceRunResult[],
  privateSentinels: readonly string[] = [],
) => {
  const parsedManifest = parseLocalIntelligenceManifest(manifest);
  let aggregate: ReturnType<typeof aggregateLocalIntelligenceRuns>;
  try {
    aggregate = aggregateLocalIntelligenceRuns(
      rawRuns,
      parsedManifest.ceilings.minimumSamplesForP95,
    );
  } catch {
    throw new Error('evaluation_public_report_unsafe');
  }
  const report = {
    schemaVersion: 1 as const,
    suiteId: parsedManifest.suiteId,
    sourceRevision: parsedManifest.sourceRevision,
    corpusSha256: parsedManifest.corpusSha256,
    models: parsedManifest.models.map(({ configId, tag, digest }) => ({
      configId,
      tag,
      digest,
    })),
    aggregate,
  };
  assertNoSentinel(report, privateSentinels);
  return report;
};
