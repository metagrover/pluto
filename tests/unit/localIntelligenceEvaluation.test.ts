import { describe, expect, it } from 'vitest';

import {
  type EvaluationEvent,
  GEMMA_NOTES_CONTROL_CONFIGURATION,
  type LocalIntelligenceManifest,
  type LocalIntelligenceRunResult,
  type NotesExperimentManifest,
  PHI_NOTES_EXPERIMENT_CONFIGURATION,
  aggregateLocalIntelligenceRuns,
  assertEvaluationCeiling,
  buildFrozenNotesSchedule,
  notesScheduleSha256,
  parseLocalIntelligenceManifest,
  projectContentFreeEvaluationReport,
  reconcileNotesEvaluationSchedule,
  validateEvaluationEventLedger,
} from '../../scripts/lib/local_intelligence_evaluation';

const digest = (character: string) => character.repeat(64);
const revision = 'c592a997fb0103aec96756ea1086a817eec8bb5d';

const manifestValue = (): LocalIntelligenceManifest => ({
  schemaVersion: 1,
  suiteId: 'local-intelligence-16gb-2026-09-06',
  privacy: 'owner_only_private',
  sourceRevision: revision,
  dirtyDiffSha256: digest('d'),
  corpusSha256: digest('c'),
  models: [
    {
      configId: 'gemma-control',
      tag: 'gemma4:12b',
      digest: digest('a'),
    },
    {
      configId: 'qwen-small',
      tag: 'qwen3.5:4b',
      digest: digest('b'),
    },
  ],
  ceilings: {
    ordinaryNotesMs: 600_000,
    longNotesMs: 1_200_000,
    chatMs: 120_000,
    dreamingMs: 180_000,
    notesPhysicalStarts: 12,
    minimumSamplesForP95: 20,
  },
});

const notesManifestValue = (): NotesExperimentManifest => {
  const collections = {
    semantic: Array.from({ length: 12 }, (_, index) => `semantic-${index + 1}`),
    ordinaryCapacity: Array.from(
      { length: 8 },
      (_, index) => `capacity-${index + 1}`,
    ),
    expectedRejection: ['reject-aggregate', 'reject-segment'],
  };
  const schedule = buildFrozenNotesSchedule(collections);
  return {
    schemaVersion: 2,
    suiteId: 'phi-notes-source-first-2026-09-07',
    privacy: 'owner_only_private',
    sourceRevision: revision,
    dirtyDiffSha256: digest('d'),
    corpusSha256: digest('c'),
    rubricSha256: digest('e'),
    scheduleSha256: notesScheduleSha256(schedule),
    partition: 'held_out',
    models: [
      {
        configId: PHI_NOTES_EXPERIMENT_CONFIGURATION.configId,
        tag: PHI_NOTES_EXPERIMENT_CONFIGURATION.tag,
        digest: PHI_NOTES_EXPERIMENT_CONFIGURATION.digest,
      },
      {
        configId: GEMMA_NOTES_CONTROL_CONFIGURATION.configId,
        tag: GEMMA_NOTES_CONTROL_CONFIGURATION.tag,
        digest: GEMMA_NOTES_CONTROL_CONFIGURATION.digest,
      },
    ],
    configurations: [
      { ...PHI_NOTES_EXPERIMENT_CONFIGURATION },
      { ...GEMMA_NOTES_CONTROL_CONFIGURATION },
    ],
    collections,
    settings: {
      seed: 41,
      temperature: 0.1,
      threads: 8,
      thinking: false,
      contextTokens: 16_384,
      writerOutputTokens: 2_048,
      editorOutputTokens: 4_096,
      stageCache: 'disabled',
    },
    schedule,
    ceilings: {
      ordinaryNotesMs: 600_000,
      longNotesMs: 1_200_000,
      chatMs: 120_000,
      dreamingMs: 180_000,
      notesPhysicalStarts: 12,
      minimumSamplesForP95: 20,
    },
  };
};

const telemetry = {
  memoryPressure: 'normal' as const,
  thermalState: 'nominal' as const,
  residentModelBytes: 8_000_000_000,
  swapUsedBytes: 4_000_000_000,
};

const acceptedRun = (
  overrides: Partial<LocalIntelligenceRunResult> = {},
): LocalIntelligenceRunResult => ({
  runId: 'run-1',
  caseId: 'case-1',
  configId: 'gemma-control',
  lane: 'meeting_notes',
  condition: 'warm',
  status: 'accepted',
  totalMs: 1000,
  contaminated: false,
  physicalStarts: 1,
  preemptions: 0,
  ...overrides,
});

describe('local intelligence evaluation contract', () => {
  it('keeps strict version-1 manifests readable', () => {
    expect(parseLocalIntelligenceManifest(manifestValue()).schemaVersion).toBe(
      1,
    );
  });

  it('freezes the paired Phi and Gemma notes schedule before inference', () => {
    const manifest = notesManifestValue();
    const parsed = parseLocalIntelligenceManifest(manifest);
    expect(parsed.schemaVersion).toBe(2);
    if (parsed.schemaVersion !== 2) throw new Error('expected notes manifest');

    expect(parsed.schedule).toHaveLength(180);
    expect(parsed.schedule.slice(0, 4).map(({ configId }) => configId)).toEqual(
      [
        'phi-notes-source-first',
        'gemma-notes-control',
        'gemma-notes-control',
        'phi-notes-source-first',
      ],
    );
    for (const configId of ['phi-notes-source-first', 'gemma-notes-control']) {
      for (const condition of ['cold', 'warm']) {
        expect(
          parsed.schedule.filter(
            (run) =>
              run.collection === 'ordinary_capacity' &&
              run.configId === configId &&
              run.condition === condition,
          ),
        ).toHaveLength(24);
      }
    }
  });

  it('rejects a disguised control route and any schedule mutation', () => {
    const wrongRoute = notesManifestValue();
    wrongRoute.configurations[0] = {
      ...wrongRoute.configurations[0]!,
      sourceFirstReconciliation: false,
    };
    expect(() => parseLocalIntelligenceManifest(wrongRoute)).toThrow(
      'evaluation_manifest_invalid',
    );

    const changedSchedule = notesManifestValue();
    changedSchedule.schedule = changedSchedule.schedule.slice(1);
    changedSchedule.scheduleSha256 = notesScheduleSha256(
      changedSchedule.schedule,
    );
    expect(() => parseLocalIntelligenceManifest(changedSchedule)).toThrow(
      'evaluation_schedule_mismatch',
    );
  });

  it('rejects an unknown model or mismatched digest', () => {
    const unknown = manifestValue();
    unknown.models[1] = {
      configId: 'unknown',
      tag: 'not-installed:latest',
      digest: digest('f'),
    };
    expect(() =>
      parseLocalIntelligenceManifest(unknown, [
        { tag: 'gemma4:12b', digest: digest('a') },
        { tag: 'qwen3.5:4b', digest: digest('b') },
      ]),
    ).toThrow('evaluation_model_identity_unknown');
  });

  it('rejects a missing source revision and arbitrary manifest fields', () => {
    expect(() =>
      parseLocalIntelligenceManifest({
        ...manifestValue(),
        sourceRevision: '',
      }),
    ).toThrow('evaluation_manifest_invalid');
    expect(() =>
      parseLocalIntelligenceManifest({
        ...manifestValue(),
        transcript: 'private words',
      }),
    ).toThrow('evaluation_manifest_invalid');
  });

  it('rejects duplicate physical attempt IDs', () => {
    const events: EvaluationEvent[] = [
      {
        type: 'run_started',
        eventId: 'event-1',
        runId: 'run-1',
        caseId: 'case-1',
        configId: 'gemma-control',
        lane: 'meeting_notes',
        environment: 'replay',
        sourceRevision: revision,
        atMs: 0,
      },
      {
        type: 'physical_started',
        eventId: 'event-2',
        runId: 'run-1',
        logicalStageId: 'writer-1',
        attemptId: 'attempt-1',
        requestedModel: 'gemma4:12b',
        actualModel: 'gemma4:12b',
        atMs: 10,
      },
      {
        type: 'physical_started',
        eventId: 'event-3',
        runId: 'run-1',
        logicalStageId: 'writer-1',
        attemptId: 'attempt-1',
        requestedModel: 'gemma4:12b',
        actualModel: 'gemma4:12b',
        atMs: 20,
      },
    ];
    expect(() =>
      validateEvaluationEventLedger(manifestValue(), events),
    ).toThrow('evaluation_attempt_duplicate');
  });

  it('rejects terminal events without a matching start', () => {
    const events: EvaluationEvent[] = [
      {
        type: 'physical_terminal',
        eventId: 'event-1',
        runId: 'run-1',
        attemptId: 'attempt-1',
        outcome: 'failed',
        atMs: 20,
        inputTokens: 10,
        outputTokens: 0,
        resourceTelemetry: telemetry,
      },
    ];
    expect(() =>
      validateEvaluationEventLedger(manifestValue(), events),
    ).toThrow('evaluation_terminal_without_start');
  });

  it('rejects null resource telemetry', () => {
    const events = [
      {
        type: 'run_started',
        eventId: 'event-run',
        runId: 'run-1',
        caseId: 'case-1',
        configId: 'gemma-control',
        lane: 'meeting_notes',
        environment: 'replay',
        sourceRevision: revision,
        atMs: 0,
      },
      {
        type: 'physical_started',
        eventId: 'event-start',
        runId: 'run-1',
        logicalStageId: 'writer-1',
        attemptId: 'attempt-1',
        requestedModel: 'gemma4:12b',
        actualModel: 'gemma4:12b',
        atMs: 10,
      },
      {
        type: 'physical_terminal',
        eventId: 'event-1',
        runId: 'run-1',
        attemptId: 'attempt-1',
        outcome: 'failed',
        atMs: 20,
        inputTokens: 10,
        outputTokens: 0,
        resourceTelemetry: null,
      },
    ] as unknown as EvaluationEvent[];
    expect(() =>
      validateEvaluationEventLedger(manifestValue(), events),
    ).toThrow('evaluation_event_invalid');
  });

  it('rejects replay results mislabelled as published', () => {
    const events: EvaluationEvent[] = [
      {
        type: 'run_started',
        eventId: 'event-1',
        runId: 'run-1',
        caseId: 'case-1',
        configId: 'gemma-control',
        lane: 'meeting_notes',
        environment: 'replay',
        sourceRevision: revision,
        atMs: 0,
      },
      {
        type: 'logical_terminal',
        eventId: 'event-2',
        runId: 'run-1',
        logicalStageId: 'writer-1',
        outcome: 'accepted',
        acceptedInReplay: true,
        published: true,
        sourceRevision: revision,
        atMs: 100,
      },
    ];
    expect(() =>
      validateEvaluationEventLedger(manifestValue(), events),
    ).toThrow('evaluation_replay_not_published');
  });

  it('counts physical starts and preemptions without accepting early output', () => {
    let now = 0;
    const events: EvaluationEvent[] = [
      {
        type: 'run_started',
        eventId: 'event-1',
        runId: 'run-1',
        caseId: 'case-1',
        configId: 'gemma-control',
        lane: 'meeting_notes',
        environment: 'replay',
        sourceRevision: revision,
        atMs: now,
      },
    ];
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      now += 10;
      events.push({
        type: 'physical_started',
        eventId: `event-start-${attempt}`,
        runId: 'run-1',
        logicalStageId: 'writer-1',
        attemptId: `attempt-${attempt}`,
        requestedModel: 'gemma4:12b',
        actualModel: 'gemma4:12b',
        atMs: now,
      });
      now += 10;
      events.push({
        type: 'physical_terminal',
        eventId: `event-end-${attempt}`,
        runId: 'run-1',
        attemptId: `attempt-${attempt}`,
        outcome: attempt < 3 ? 'preempted' : 'complete',
        atMs: now,
        inputTokens: 100,
        outputTokens: attempt < 3 ? 0 : 25,
        resourceTelemetry: telemetry,
      });
    }
    now += 10;
    events.push({
      type: 'logical_terminal',
      eventId: 'event-final',
      runId: 'run-1',
      logicalStageId: 'writer-1',
      outcome: 'accepted',
      acceptedInReplay: true,
      published: false,
      sourceRevision: revision,
      atMs: now,
    });

    expect(validateEvaluationEventLedger(manifestValue(), events)).toEqual({
      runCount: 1,
      logicalStageCount: 1,
      physicalStartCount: 3,
      preemptionCount: 2,
      acceptedReplayCount: 1,
      publishedCount: 0,
      contaminatedRunCount: 0,
      interruptedRunCount: 0,
      orphanedPhysicalStartCount: 0,
    });
    expect(() =>
      validateEvaluationEventLedger(manifestValue(), events.slice(0, -1)),
    ).not.toThrow();
    expect(
      validateEvaluationEventLedger(manifestValue(), events.slice(0, -1))
        .acceptedReplayCount,
    ).toBe(0);
  });

  it('preserves interrupted run IDs and resumes only never-started schedule rows', () => {
    const manifest = notesManifestValue();
    const interrupted = manifest.schedule[0]!;
    const completed = manifest.schedule[1]!;
    const events: EvaluationEvent[] = [
      {
        type: 'run_started',
        eventId: 'event-interrupted',
        runId: interrupted.runId,
        caseId: interrupted.caseId,
        configId: interrupted.configId,
        lane: 'meeting_notes',
        environment: 'replay',
        sourceRevision: revision,
        atMs: 1,
      },
      {
        type: 'run_started',
        eventId: 'event-completed-start',
        runId: completed.runId,
        caseId: completed.caseId,
        configId: completed.configId,
        lane: 'meeting_notes',
        environment: 'replay',
        sourceRevision: revision,
        atMs: 2,
      },
      {
        type: 'logical_terminal',
        eventId: 'event-completed-end',
        runId: completed.runId,
        logicalStageId: 'notes',
        outcome: 'failed',
        acceptedInReplay: false,
        published: false,
        sourceRevision: revision,
        atMs: 3,
      },
    ];

    const reconciled = reconcileNotesEvaluationSchedule(manifest, events);
    expect(reconciled.interrupted).toEqual([interrupted]);
    expect(reconciled.completed).toEqual([completed]);
    expect(reconciled.unstarted).toHaveLength(manifest.schedule.length - 2);
    expect(reconciled.unstarted).not.toContainEqual(interrupted);
  });

  it('retains failures, timeouts, censored, and contaminated runs', () => {
    const aggregate = aggregateLocalIntelligenceRuns([
      acceptedRun(),
      acceptedRun({
        runId: 'run-2',
        caseId: 'case-2',
        status: 'failed',
        totalMs: null,
      }),
      acceptedRun({
        runId: 'run-3',
        caseId: 'case-3',
        status: 'timeout',
        totalMs: 600_000,
      }),
      acceptedRun({
        runId: 'run-4',
        caseId: 'case-4',
        status: 'cancelled',
        totalMs: 400,
      }),
      acceptedRun({
        runId: 'run-5',
        caseId: 'case-5',
        contaminated: true,
      }),
    ]);

    expect(aggregate).toMatchObject({
      totalCount: 5,
      acceptedCount: 2,
      failedCount: 1,
      timeoutCount: 1,
      cancelledCount: 1,
      contaminatedCount: 1,
      completionRate: 0.4,
      isolatedAcceptedLatencyCount: 1,
      p95AcceptedMs: null,
    });
    expect(aggregate.latencyRows).toHaveLength(5);
    expect(aggregate.latencyRows[1]).toMatchObject({
      status: 'failed',
      totalMs: null,
      censored: true,
    });
  });

  it('reports p95 only when at least twenty accepted samples exist', () => {
    const runs = Array.from({ length: 20 }, (_, index) =>
      acceptedRun({
        runId: `run-${index}`,
        caseId: `case-${index}`,
        totalMs: (index + 1) * 100,
      }),
    );
    expect(aggregateLocalIntelligenceRuns(runs).p95AcceptedMs).toBe(1900);
  });

  it('enforces lane deadlines and the physical-start ceiling without sleeping', () => {
    expect(() =>
      assertEvaluationCeiling(manifestValue(), {
        lane: 'meeting_notes',
        durationClass: 'ordinary',
        elapsedMs: 600_001,
        physicalStarts: 1,
      }),
    ).toThrow('evaluation_deadline_exceeded');
    expect(() =>
      assertEvaluationCeiling(manifestValue(), {
        lane: 'meeting_notes',
        durationClass: 'long',
        elapsedMs: 100,
        physicalStarts: 13,
      }),
    ).toThrow('evaluation_physical_start_ceiling_exceeded');
    expect(() =>
      assertEvaluationCeiling(manifestValue(), {
        lane: 'quick_chat',
        elapsedMs: 120_001,
        physicalStarts: 1,
      }),
    ).toThrow('evaluation_deadline_exceeded');
  });

  it('projects only allowlisted, content-free public fields', () => {
    const report = projectContentFreeEvaluationReport(
      manifestValue(),
      [acceptedRun()],
      ['private sentinel'],
    );
    expect(report).toMatchObject({
      schemaVersion: 1,
      suiteId: 'local-intelligence-16gb-2026-09-06',
      sourceRevision: revision,
    });
    expect(JSON.stringify(report)).not.toContain('private sentinel');
    expect(() =>
      projectContentFreeEvaluationReport(
        manifestValue(),
        [
          {
            ...acceptedRun(),
            rawOutput: 'private sentinel',
          } as LocalIntelligenceRunResult,
        ],
        ['private sentinel'],
      ),
    ).toThrow('evaluation_public_report_unsafe');
  });
});
