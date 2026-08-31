import type { NotesTask } from './meetingNotesTypes';

export const MAX_MEETING_NOTES_STAGE_METRICS = 256;

export type NotesStageOutcome =
  | 'complete'
  | 'preempted'
  | 'truncated'
  | 'failed'
  | 'cancelled';

export type NotesStageEvent =
  | {
      phase: 'queued';
      sequence: number;
      task: NotesTask;
      atMs: number;
    }
  | { phase: 'started'; sequence: number; atMs: number }
  | {
      phase: 'finished';
      sequence: number;
      atMs: number;
      outcome: NotesStageOutcome;
      inputTokens?: number | null;
      outputTokens?: number | null;
    };

export type NotesStageObserver = (event: NotesStageEvent) => void;

export type MeetingNotesStageMetric = {
  sequence: number;
  task: NotesTask;
  outcome: NotesStageOutcome;
  queueWaitMs: number;
  modelMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
};

export type MeetingNotesRunMetric = {
  schemaVersion: 1;
  reason: 'automatic' | 'manual';
  status: 'queued' | 'running' | 'published' | 'failed' | 'cancelled';
  sourceSegmentCount: number;
  sourceCharacterCount: number;
  plannedLeafCount: number | null;
  generatedNodeCount: number;
  repairCount: number;
  repartitionCount: number;
  queueMs: number;
  modelMs: number;
  totalMs: number;
  stages: MeetingNotesStageMetric[];
};

type MutableStage = {
  sequence: number;
  task: NotesTask;
  queuedAtMs: number;
  startedAtMs?: number;
  metric?: MeetingNotesStageMetric;
};

const roundMs = (value: number): number =>
  Math.max(0, Math.round(Number.isFinite(value) ? value : 0));

export const createMeetingNotesRunMetrics = (input: {
  reason: 'automatic' | 'manual';
  sourceSegmentCount: number;
  sourceCharacterCount: number;
  startedAtMs: number;
}) => {
  const stages = new Map<number, MutableStage>();
  let plannedLeafCount: number | null = null;
  let generatedNodeCount = 0;
  let repairCount = 0;
  let repartitionCount = 0;

  const observe: NotesStageObserver = (event) => {
    if (event.phase === 'queued') {
      if (
        stages.has(event.sequence) ||
        stages.size >= MAX_MEETING_NOTES_STAGE_METRICS
      )
        return;
      stages.set(event.sequence, {
        sequence: event.sequence,
        task: event.task,
        queuedAtMs: event.atMs,
      });
      return;
    }
    const stage = stages.get(event.sequence);
    if (!stage || stage.metric) return;
    if (event.phase === 'started') {
      stage.startedAtMs ??= event.atMs;
      return;
    }
    const startedAtMs = stage.startedAtMs ?? stage.queuedAtMs;
    stage.metric = {
      sequence: stage.sequence,
      task: stage.task,
      outcome: event.outcome,
      queueWaitMs: roundMs(startedAtMs - stage.queuedAtMs),
      modelMs: roundMs(event.atMs - startedAtMs),
      inputTokens: event.inputTokens ?? null,
      outputTokens: event.outputTokens ?? null,
    };
  };

  return {
    observe,
    setPlannedLeafCount(value: number): void {
      plannedLeafCount = value;
    },
    setGeneratedNodeCount(value: number): void {
      generatedNodeCount = value;
    },
    recordRepair(): void {
      repairCount += 1;
    },
    recordRepartition(): void {
      repartitionCount += 1;
    },
    snapshot(
      status: MeetingNotesRunMetric['status'],
      atMs: number,
    ): MeetingNotesRunMetric {
      const completedStages = [...stages.values()]
        .flatMap((stage) => (stage.metric ? [stage.metric] : []))
        .sort((left, right) => left.sequence - right.sequence);
      return {
        schemaVersion: 1,
        reason: input.reason,
        status,
        sourceSegmentCount: input.sourceSegmentCount,
        sourceCharacterCount: input.sourceCharacterCount,
        plannedLeafCount,
        generatedNodeCount,
        repairCount,
        repartitionCount,
        queueMs: completedStages.reduce(
          (total, stage) => total + stage.queueWaitMs,
          0,
        ),
        modelMs: completedStages.reduce(
          (total, stage) => total + stage.modelMs,
          0,
        ),
        totalMs: roundMs(atMs - input.startedAtMs),
        stages: completedStages,
      };
    },
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const hasExactKeys = (
  value: Record<string, unknown>,
  allowed: readonly string[],
): boolean => {
  const keys = Object.keys(value);
  return (
    keys.length === allowed.length && keys.every((key) => allowed.includes(key))
  );
};

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

const isNullableCount = (value: unknown): value is number | null =>
  value === null || isCount(value);

const tasks = new Set<NotesTask>(['notesWriter', 'notesAudit', 'notesMerge']);
const outcomes = new Set<NotesStageOutcome>([
  'complete',
  'preempted',
  'truncated',
  'failed',
  'cancelled',
]);
const statuses = new Set<MeetingNotesRunMetric['status']>([
  'queued',
  'running',
  'published',
  'failed',
  'cancelled',
]);

const parseStage = (value: unknown): MeetingNotesStageMetric => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'sequence',
      'task',
      'outcome',
      'queueWaitMs',
      'modelMs',
      'inputTokens',
      'outputTokens',
    ]) ||
    !isCount(value.sequence) ||
    !tasks.has(value.task as NotesTask) ||
    !outcomes.has(value.outcome as NotesStageOutcome) ||
    !isCount(value.queueWaitMs) ||
    !isCount(value.modelMs) ||
    !isNullableCount(value.inputTokens) ||
    !isNullableCount(value.outputTokens)
  ) {
    throw new Error('invalid_meeting_notes_run_metric');
  }
  return {
    sequence: value.sequence,
    task: value.task as NotesTask,
    outcome: value.outcome as NotesStageOutcome,
    queueWaitMs: value.queueWaitMs,
    modelMs: value.modelMs,
    inputTokens: value.inputTokens,
    outputTokens: value.outputTokens,
  };
};

const metricKeys = [
  'schemaVersion',
  'reason',
  'status',
  'sourceSegmentCount',
  'sourceCharacterCount',
  'plannedLeafCount',
  'generatedNodeCount',
  'repairCount',
  'repartitionCount',
  'queueMs',
  'modelMs',
  'totalMs',
  'stages',
] as const;

export const parseMeetingNotesRunMetric = (
  input: unknown,
): MeetingNotesRunMetric => {
  let value: unknown = input;
  if (typeof input === 'string') {
    try {
      value = JSON.parse(input);
    } catch {
      throw new Error('invalid_meeting_notes_run_metric');
    }
  }
  if (
    !isRecord(value) ||
    !hasExactKeys(value, metricKeys) ||
    value.schemaVersion !== 1 ||
    (value.reason !== 'automatic' && value.reason !== 'manual') ||
    !statuses.has(value.status as MeetingNotesRunMetric['status']) ||
    !isCount(value.sourceSegmentCount) ||
    !isCount(value.sourceCharacterCount) ||
    !isNullableCount(value.plannedLeafCount) ||
    !isCount(value.generatedNodeCount) ||
    !isCount(value.repairCount) ||
    !isCount(value.repartitionCount) ||
    !isCount(value.queueMs) ||
    !isCount(value.modelMs) ||
    !isCount(value.totalMs) ||
    !Array.isArray(value.stages) ||
    value.stages.length > MAX_MEETING_NOTES_STAGE_METRICS
  ) {
    throw new Error('invalid_meeting_notes_run_metric');
  }
  return {
    schemaVersion: 1,
    reason: value.reason,
    status: value.status as MeetingNotesRunMetric['status'],
    sourceSegmentCount: value.sourceSegmentCount,
    sourceCharacterCount: value.sourceCharacterCount,
    plannedLeafCount: value.plannedLeafCount,
    generatedNodeCount: value.generatedNodeCount,
    repairCount: value.repairCount,
    repartitionCount: value.repartitionCount,
    queueMs: value.queueMs,
    modelMs: value.modelMs,
    totalMs: value.totalMs,
    stages: value.stages.map(parseStage),
  };
};

export const serializeMeetingNotesRunMetric = (
  metric: MeetingNotesRunMetric,
): string => JSON.stringify(parseMeetingNotesRunMetric(metric));
