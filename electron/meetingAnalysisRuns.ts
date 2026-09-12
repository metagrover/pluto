import { createHash, randomUUID } from 'node:crypto';
import { readDownstreamProcessingLease } from '../src/services/downstreamProcessingLease';
import { buildAnalysisTranscriptFromJson } from '../src/utils/transcript';
import type { AnalysisDocumentV3 } from './llm/analysisTypes';
import {
  type MeetingNotesRunMetric,
  createMeetingNotesRunMetrics,
} from './llm/meetingNotesRunMetrics';
import { createNotesSource } from './llm/meetingNotesSource';
import { NotesStageCache } from './llm/meetingNotesStageCache';
import {
  MeetingNotesError,
  NOTES_OLLAMA_MODEL,
  NOTES_PROMPT_VERSION,
} from './llm/meetingNotesTypes';
import type { MeetingNotesTemplate } from './llm/prompts';
import type { LLMProvider } from './llm/provider';
import { createMeetingNotesPreviewStore } from './meetingNotesPreview';
import { createMeetingNotesScheduler } from './meetingNotesScheduler';

type MeetingRecord = {
  id: string | number;
  transcript_json?: string | null;
  transcript_status?: string | null;
  transcript_integrity_json?: string | null;
  capture_journal_generation?: string | null;
  downstream_processing_json?: string | null;
  user_notes?: string | null;
  finalization_status?: string | null;
  analysis_json?: string | null;
};

type MeetingAnalysisRunRecord = {
  run_id: string;
  input_revision: string;
  notes_status: string;
  secondary_status?: string;
  automatic_attempt_count?: number;
};

type EntityHint = { type: string; name: string };

export type MeetingAnalysisRunCoordinatorDb = {
  getMeeting(meetingId: string | number): MeetingRecord | undefined;
  getMeetingAnalysisPublicationRevisions(meeting: MeetingRecord): {
    sourceRevision: string;
    eligibilityRevision: string;
    userNotesHash: string;
  } | null;
  getMeetingAnalysisRun(
    meetingId: string | number,
  ): MeetingAnalysisRunRecord | null;
  beginMeetingAnalysisRun(input: {
    meetingId: string | number;
    runId: string;
    inputRevision: string;
    sourceRevision: string;
    eligibilityRevision: string;
    userNotesHash: string;
    reason: 'automatic' | 'manual';
    stage?: 'queued' | 'notes_writer';
    queuePosition?: number | null;
  }): unknown;
  updateMeetingAnalysisRunStatus(input: {
    meetingId: string | number;
    runId: string;
    notesStatus: 'running' | 'published' | 'failed' | 'cancelled';
    secondaryStatus:
      | 'pending'
      | 'running'
      | 'complete'
      | 'failed'
      | 'superseded';
    stage: string;
    errorCode?: string | null;
  }): boolean;
  updateMeetingAnalysisQueuePosition?(input: {
    meetingId: string | number;
    runId: string;
    queuePosition: number | null;
  }): boolean;
  updateMeetingAnalysisQueueSnapshot?(
    updates: Array<{
      meetingId: string | number;
      runId: string;
      queuePosition: number | null;
    }>,
  ): number;
  updateMeetingAnalysisRunStatusIfCurrent(input: {
    meetingId: string | number;
    runId: string;
    inputRevision: string;
    sourceRevision: string;
    eligibilityRevision: string;
    userNotesHash: string;
    notesStatus: 'running' | 'published' | 'failed' | 'cancelled';
    secondaryStatus:
      | 'pending'
      | 'running'
      | 'complete'
      | 'failed'
      | 'superseded';
    stage: string;
    errorCode?: string | null;
  }): boolean;
  isMeetingAnalysisRunCurrent(input: {
    meetingId: string | number;
    runId: string;
    inputRevision: string;
    sourceRevision: string;
    eligibilityRevision: string;
    userNotesHash: string;
    requirePublished?: boolean;
  }): boolean;
  publishMeetingNotesIfCurrent(input: {
    meetingId: string | number;
    runId: string;
    inputRevision: string;
    sourceRevision: string;
    eligibilityRevision: string;
    userNotesHash: string;
    analysis: AnalysisDocumentV3;
  }): boolean;
  getAllEntities(): EntityHint[];
  getMeetingNotesIdentityProjection?(meetingId: string | number): {
    speakerDisplayNames: Record<string, string>;
    trustedUserTerms: string[];
  };
  upsertMeetingAnalysisRunMetric?(input: {
    meetingId: string | number;
    runId: string;
    reason: 'automatic' | 'manual';
    status: 'published' | 'failed' | 'cancelled';
    errorCode?: string | null;
    metrics: MeetingNotesRunMetric;
    startedAt: string;
    completedAt: string;
  }): void;
};

type NotesProvider = {
  name: string;
  synthesizeKnowledgeDocument?: LLMProvider['synthesizeKnowledgeDocument'];
  generateStructuredAnalysis(
    transcript: string,
    userNotes?: string,
    template?: MeetingNotesTemplate,
    options?: {
      signal?: AbortSignal;
      knownTerms?: string[];
      source?: ReturnType<typeof createNotesSource>;
      trustedUserTerms?: string[];
      entityHints?: string[];
      contextTokens?: number;
      compactWriterContract?: boolean;
      optionalReviewDeadlineAtMs?: number;
      optionalReviewMinStartMs?: number;
      stageCache?: NotesStageCache;
      cacheKey?: string;
      onStage?: (task: import('./llm/meetingNotesTypes').NotesTask) => void;
      onDraft?: (draft: import('./llm/meetingNotesTypes').NotesDraft) => void;
      onRepair?: (task: import('./llm/meetingNotesTypes').NotesTask) => void;
      onStageEvent?: import('./llm/meetingNotesRunMetrics').NotesStageObserver;
      onPlan?: (plan: { plannedLeafCount: number }) => void;
      onRepartition?: () => void;
      workClass?: import('./llm/llmWorkClass').LLMWorkClass;
    },
  ): Promise<AnalysisDocumentV3>;
  precomputeStructuredAnalysisLeaf?: LLMProvider['precomputeStructuredAnalysisLeaf'];
  extractValueSignals?(
    transcript: string,
    summary?: string,
    options?: {
      signal?: AbortSignal;
      workClass?: import('./llm/llmWorkClass').LLMWorkClass;
    },
  ): Promise<{
    analysis_schema_version: number;
    continuity: string[];
    accountability_risks: string[];
    decision_impacts: string[];
    extra_tags: Array<{ tag: string; confidence: number }>;
  }>;
  extractEntities?(
    transcript: string,
    context?: import('./llm/provider').EntityExtractionContext,
    options?: {
      signal?: AbortSignal;
      workClass?: import('./llm/llmWorkClass').LLMWorkClass;
    },
  ): Promise<import('./llm/provider').ExtractedEntities>;
};

type SettingsRecord = {
  llm_provider?: unknown;
  ollama_model?: unknown;
  llm_model?: unknown;
  openai_model?: unknown;
  claude_model?: unknown;
  gemini_model?: unknown;
  ollama_structured_thinking?: unknown;
  ollama_seed?: unknown;
};

export type GenerateMeetingNotesInput = {
  meetingId: string | number;
  requestId: string;
  template: MeetingNotesTemplate;
  reason: 'automatic' | 'manual' | 'secondary';
};

export type PublishedMeetingNotes = {
  meetingId: string;
  runId: string;
  status: 'published';
};

type ActiveRun = {
  fingerprint: string;
  runId: string;
  controller: AbortController;
  scheduleKey: string;
  subscribers: Map<string, { reject: (reason: unknown) => void }>;
  promise: Promise<PublishedMeetingNotes>;
};

const NOTES_CONTEXT_TOKENS = 16_384;
export const MEETING_NOTES_ABSOLUTE_DEADLINE_MS = 12 * 60_000;
export const MEETING_NOTES_PUBLICATION_RESERVE_MS = 15_000;
export const MEETING_NOTES_OPTIONAL_REVIEW_MIN_START_MS = 5 * 60_000;
export const MAX_AUTOMATIC_MEETING_NOTES_ATTEMPTS = 2;

export const createMeetingNotesOptionalReviewBudget = (
  startedAtMs: number,
  deadlineMs = MEETING_NOTES_ABSOLUTE_DEADLINE_MS,
) => {
  const publicationReserveMs = Math.min(
    MEETING_NOTES_PUBLICATION_RESERVE_MS,
    Math.floor(deadlineMs / 4),
  );
  return {
    optionalReviewDeadlineAtMs: startedAtMs + deadlineMs - publicationReserveMs,
    optionalReviewMinStartMs: Math.min(
      MEETING_NOTES_OPTIONAL_REVIEW_MIN_START_MS,
      Math.max(0, deadlineMs - publicationReserveMs),
    ),
  };
};

export const shouldUseMeetingNotesOptionalReviewBudget = (
  providerName: string,
): boolean => providerName.toLowerCase().startsWith('ollama');

const hashFingerprint = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');

export const createMeetingNotesStageCacheKey = (input: {
  userNotesHash: string;
  terms: string[];
  trustedUserTerms?: string[];
  template: MeetingNotesTemplate;
  provider: string;
  model: string | null;
  thinking: unknown;
  seed: unknown;
  contextTokens: number;
  promptVersion: string;
}): string => hashFingerprint(input);

const hasAuthorizedPartialCaptureGap = (meeting: MeetingRecord): boolean => {
  if (
    meeting.transcript_status !== 'needs_attention' ||
    !meeting.capture_journal_generation
  ) {
    return false;
  }
  const lease = readDownstreamProcessingLease(
    meeting.downstream_processing_json,
  );
  if (lease?.schemaVersion !== 2) return false;
  try {
    const integrity = JSON.parse(meeting.transcript_integrity_json || '{}') as {
      causes?: Array<{ code?: unknown }>;
      reasons?: unknown;
    };
    const hash = (value: string | null | undefined) =>
      createHash('sha256')
        .update(value || '', 'utf8')
        .digest('hex');
    const hasGap = Boolean(
      integrity.causes?.some(
        (cause) =>
          cause.code === 'capture_gap_detected' ||
          cause.code === 'required_source_failed',
      ) ||
        (Array.isArray(integrity.reasons) &&
          integrity.reasons.includes('system_capture_incomplete')),
    );
    return (
      hasGap &&
      lease.source.captureJournalGeneration ===
        meeting.capture_journal_generation &&
      lease.source.transcriptSha256 === hash(meeting.transcript_json) &&
      lease.source.transcriptIntegritySha256 ===
        hash(meeting.transcript_integrity_json)
    );
  } catch {
    return false;
  }
};

const isEligibleMeetingSource = (meeting: MeetingRecord): boolean =>
  meeting.finalization_status !== 'recovery_required' &&
  (meeting.transcript_status === 'validated' ||
    hasAuthorizedPartialCaptureGap(meeting));

const configuredModel = (settings: SettingsRecord): string | null => {
  const provider = settings.llm_provider;
  if (provider === 'openai') return stringSetting(settings.openai_model);
  if (provider === 'claude') return stringSetting(settings.claude_model);
  if (provider === 'gemini') return stringSetting(settings.gemini_model);
  return (
    stringSetting(settings.ollama_model) ??
    stringSetting(settings.llm_model) ??
    NOTES_OLLAMA_MODEL
  );
};

const stringSetting = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

const errorCode = (error: unknown): string => {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return 'notes_cancelled';
  }
  if (
    error instanceof Error &&
    /^(?:(?:notes_|meeting_notes_|entity_extraction_|value_signals_|knowledge_)[a-z_]+|ollama_residency_(?:discovery|cleanup)_failed)$/.test(
      error.message,
    )
  )
    return error.message;
  return 'notes_generation_failed';
};

export const createMeetingAnalysisRunCoordinator = (dependencies: {
  db: MeetingAnalysisRunCoordinatorDb;
  getSettings(): Promise<SettingsRecord>;
  getProvider(settings: SettingsRecord): Promise<NotesProvider>;
  createRunId?: () => string;
  /** Test seam; production runs use the fixed absolute deadline. */
  notesDeadlineMs?: number;
  knowledgeSynthesisPause?: {
    acquire(reason: string): void;
    release(reason: string): void;
  };
  onUpdated?: (meetingId: string) => void;
  onPublished?: (meetingId: string, runId: string) => void;
  runSecondary?: (input: {
    meetingId: string;
    runId: string;
    inputRevision: string;
    sourceRevision: string;
    eligibilityRevision: string;
    userNotesHash: string;
    transcript: string;
    analysis: AnalysisDocumentV3;
    provider: NotesProvider;
    signal: AbortSignal;
    canCommit(): boolean;
  }) => Promise<void>;
}) => {
  const activeByMeeting = new Map<string, ActiveRun>();
  const previews = createMeetingNotesPreviewStore();
  const secondaryByMeeting = new Map<
    string,
    { runId: string; controller: AbortController }
  >();
  const stageCache = new NotesStageCache(Date.now, 60 * 60 * 1000);
  const createRunId = dependencies.createRunId ?? randomUUID;
  const notify = (meetingId: string) => {
    try {
      dependencies.onUpdated?.(meetingId);
    } catch {
      /* A closing renderer cannot change durable publication/run state. */
    }
  };
  const announcePublication = (meetingId: string, runId: string) => {
    try {
      dependencies.onPublished?.(meetingId, runId);
    } catch {
      /* Native notification failure cannot change durable publication state. */
    }
  };
  const scheduledRuns = new Map<string, { meetingId: string; runId: string }>();
  const scheduler = createMeetingNotesScheduler((snapshot) => {
    const updates = snapshot.flatMap((entry) => {
      const run = scheduledRuns.get(entry.key);
      return run ? [{ ...run, queuePosition: entry.position }] : [];
    });
    if (dependencies.db.updateMeetingAnalysisQueueSnapshot) {
      dependencies.db.updateMeetingAnalysisQueueSnapshot(updates);
    } else {
      for (const update of updates) {
        dependencies.db.updateMeetingAnalysisQueuePosition?.(update);
      }
    }
    for (const update of updates) {
      notify(update.meetingId);
    }
  });
  const startSecondary = (
    input: Parameters<NonNullable<typeof dependencies.runSecondary>>[0],
    controller: AbortController,
  ) => {
    if (!dependencies.runSecondary || secondaryByMeeting.has(input.meetingId))
      return;
    secondaryByMeeting.set(input.meetingId, { runId: input.runId, controller });
    const update = (
      secondaryStatus: 'running' | 'complete' | 'failed',
      stage: string,
      code?: string,
    ) => {
      if (!input.canCommit()) return;
      dependencies.db.updateMeetingAnalysisRunStatusIfCurrent({
        ...input,
        notesStatus: 'published',
        secondaryStatus,
        stage,
        errorCode: code ?? null,
      });
      notify(input.meetingId);
    };
    update('running', 'value_signals');
    void Promise.resolve()
      .then(() => dependencies.runSecondary!(input))
      .then(() => update('complete', 'complete'))
      .catch((error) =>
        update(
          'failed',
          'secondary_failed',
          errorCode(error) === 'notes_generation_failed'
            ? 'secondary_processing_failed'
            : errorCode(error),
        ),
      )
      .finally(() => {
        if (secondaryByMeeting.get(input.meetingId)?.runId === input.runId)
          secondaryByMeeting.delete(input.meetingId);
      });
  };

  const subscribe = (
    active: ActiveRun,
    requestId: string,
  ): Promise<PublishedMeetingNotes> =>
    new Promise((resolve, reject) => {
      active.subscribers.set(requestId, { reject });
      active.promise.then(resolve, reject);
    });

  const cancelMeetingNotes = async (input: {
    meetingId: string | number;
    requestId: string;
  }): Promise<{ cancelled: boolean }> => {
    const meetingId = String(input.meetingId);
    const active = activeByMeeting.get(meetingId);
    const subscriber = active?.subscribers.get(input.requestId);
    if (!active || !subscriber) {
      return { cancelled: false };
    }
    active.subscribers.delete(input.requestId);
    subscriber.reject(
      new DOMException('Meeting notes request cancelled', 'AbortError'),
    );
    if (active.subscribers.size === 0) {
      const reason = new DOMException(
        'Meeting notes generation cancelled',
        'AbortError',
      );
      if (!scheduler.cancel(active.scheduleKey, reason)) {
        active.controller.abort(reason);
      }
      dependencies.db.updateMeetingAnalysisRunStatus({
        meetingId,
        runId: active.runId,
        notesStatus: 'cancelled',
        secondaryStatus: 'superseded',
        stage: 'cancelled',
        errorCode: 'notes_cancelled',
      });
      notify(meetingId);
    }
    return { cancelled: true };
  };

  const supersedeMeetingNotes = (meetingId: string | number): boolean => {
    const normalizedMeetingId = String(meetingId);
    const active = activeByMeeting.get(normalizedMeetingId);
    const secondary = secondaryByMeeting.get(normalizedMeetingId);
    const target = active ?? secondary;
    if (!target) return false;
    const reason = new DOMException(
      'Meeting notes run superseded',
      'AbortError',
    );
    if (!active || !scheduler.cancel(active.scheduleKey, reason)) {
      target.controller.abort(reason);
    }
    dependencies.db.updateMeetingAnalysisRunStatus({
      meetingId: normalizedMeetingId,
      runId: target.runId,
      notesStatus: active ? 'cancelled' : 'published',
      secondaryStatus: 'superseded',
      stage: 'superseded',
      errorCode: 'notes_superseded',
    });
    secondaryByMeeting.delete(normalizedMeetingId);
    notify(normalizedMeetingId);
    return true;
  };

  const precomputeIncrementalMeetingNotes = async (input: {
    source: ReturnType<typeof createNotesSource>;
    userNotes: string;
    template: MeetingNotesTemplate;
    signal: AbortSignal;
  }): Promise<'generated' | 'reused' | 'discarded'> => {
    input.signal.throwIfAborted();
    const settings = await dependencies.getSettings();
    const provider = await dependencies.getProvider(settings);
    if (!provider.precomputeStructuredAnalysisLeaf) return 'discarded';
    const terms = dependencies.db
      .getAllEntities()
      .filter((entity) => entity.type === 'person' || entity.type === 'project')
      .map((entity) => entity.name)
      .filter((name) => typeof name === 'string' && name.trim())
      .slice(0, 24);
    const userNotesHash = createHash('sha256')
      .update(input.userNotes, 'utf8')
      .digest('hex');
    const cacheKey = createMeetingNotesStageCacheKey({
      userNotesHash,
      terms,
      template: input.template,
      provider: provider.name,
      model: configuredModel(settings),
      thinking: settings.ollama_structured_thinking ?? null,
      seed: settings.ollama_seed ?? null,
      contextTokens: NOTES_CONTEXT_TOKENS,
      promptVersion: NOTES_PROMPT_VERSION,
    });
    return provider.precomputeStructuredAnalysisLeaf(
      '',
      input.userNotes,
      input.template,
      {
        signal: input.signal,
        source: input.source,
        knownTerms: terms,
        trustedUserTerms: [],
        entityHints: terms,
        contextTokens: NOTES_CONTEXT_TOKENS,
        compactWriterContract: true,
        stageCache,
        cacheKey,
        workClass: 'automatic_notes',
      },
    );
  };

  const generateAndPublishMeetingNotes = async (
    input: GenerateMeetingNotesInput,
  ): Promise<PublishedMeetingNotes> => {
    const meetingId = String(input.meetingId);
    const identityProjection = () =>
      dependencies.db.getMeetingNotesIdentityProjection?.(meetingId) ?? {
        speakerDisplayNames: {},
        trustedUserTerms: [],
      };
    const notesSource = (record: MeetingRecord) => {
      if (!record.transcript_json)
        throw new MeetingNotesError('meeting_notes_source_missing');
      const projection = identityProjection();
      return {
        projection,
        source: createNotesSource(
          record.transcript_json,
          projection.speakerDisplayNames,
        ),
      };
    };
    const analysisTranscript = (record: MeetingRecord) => {
      const projection = identityProjection();
      return buildAnalysisTranscriptFromJson(
        record.transcript_json,
        projection.speakerDisplayNames,
      );
    };
    let meeting = dependencies.db.getMeeting(meetingId);
    if (!meeting) throw new Error('meeting_not_found');
    if (!isEligibleMeetingSource(meeting)) {
      throw new Error('meeting_notes_source_ineligible');
    }
    if (!meeting.transcript_json)
      throw new Error('meeting_notes_source_missing');

    let source: ReturnType<typeof createNotesSource>;
    try {
      source = notesSource(meeting).source;
    } catch {
      throw new Error('meeting_notes_source_invalid');
    }
    let revisions =
      dependencies.db.getMeetingAnalysisPublicationRevisions(meeting);
    if (!revisions) throw new Error('meeting_notes_source_ineligible');

    const settings = await dependencies.getSettings();
    const provider = await dependencies.getProvider(settings);
    // All paths, including an automatic retry of secondary work, must pair
    // the current document with its run after asynchronous initialization.
    meeting = dependencies.db.getMeeting(meetingId);
    if (!meeting) throw new Error('meeting_not_found');
    if (!isEligibleMeetingSource(meeting))
      throw new Error('meeting_notes_source_ineligible');
    if (!meeting.transcript_json)
      throw new Error('meeting_notes_source_missing');
    try {
      source = notesSource(meeting).source;
    } catch {
      throw new Error('meeting_notes_source_invalid');
    }
    revisions = dependencies.db.getMeetingAnalysisPublicationRevisions(meeting);
    if (!revisions) throw new Error('meeting_notes_source_ineligible');
    if (input.reason === 'secondary') {
      const persisted = dependencies.db.getMeetingAnalysisRun(meetingId);
      if (persisted?.notes_status !== 'published' || !meeting.analysis_json)
        throw new Error('meeting_notes_not_published');
      const identity = {
        meetingId,
        runId: persisted.run_id,
        inputRevision: persisted.input_revision,
        ...revisions,
      };
      if (
        !dependencies.db.isMeetingAnalysisRunCurrent({
          ...identity,
          requirePublished: true,
        })
      )
        throw new Error('meeting_notes_superseded');
      if (persisted.secondary_status !== 'complete') {
        const controller = new AbortController();
        startSecondary(
          {
            ...identity,
            transcript: analysisTranscript(meeting),
            analysis: JSON.parse(meeting.analysis_json) as AnalysisDocumentV3,
            provider,
            signal: controller.signal,
            canCommit: () =>
              !controller.signal.aborted &&
              dependencies.db.isMeetingAnalysisRunCurrent({
                ...identity,
                requirePublished: true,
              }),
          },
          controller,
        );
      }
      return { meetingId, runId: persisted.run_id, status: 'published' };
    }
    const terms = dependencies.db
      .getAllEntities()
      .filter((entity) => entity.type === 'person' || entity.type === 'project')
      .map((entity) => entity.name)
      .filter((name) => typeof name === 'string' && name.trim())
      .slice(0, 24);
    const projection = identityProjection();
    const generationIdentity = {
      userNotesHash: revisions.userNotesHash,
      terms,
      ...(projection.trustedUserTerms.length > 0
        ? { trustedUserTerms: projection.trustedUserTerms }
        : {}),
      template: input.template,
      provider: provider.name,
      model: configuredModel(settings),
      thinking: settings.ollama_structured_thinking ?? null,
      seed: settings.ollama_seed ?? null,
      contextTokens: NOTES_CONTEXT_TOKENS,
      promptVersion: NOTES_PROMPT_VERSION,
    };
    const fingerprint = hashFingerprint({
      sourceRevision: revisions.sourceRevision,
      eligibilityRevision: revisions.eligibilityRevision,
      ...generationIdentity,
    });
    const stageCacheKey = createMeetingNotesStageCacheKey(generationIdentity);

    const active = activeByMeeting.get(meetingId);
    if (active?.fingerprint === fingerprint) {
      return subscribe(active, input.requestId);
    }
    if (active) {
      supersedeMeetingNotes(meetingId);
    }

    const persisted = dependencies.db.getMeetingAnalysisRun(meetingId);
    if (
      input.reason === 'automatic' &&
      persisted?.notes_status === 'failed' &&
      persisted.input_revision === fingerprint &&
      (persisted.automatic_attempt_count ?? 0) >=
        MAX_AUTOMATIC_MEETING_NOTES_ATTEMPTS
    ) {
      throw new Error('meeting_notes_automatic_attempts_exhausted');
    }
    if (
      input.reason === 'automatic' &&
      persisted?.notes_status === 'published' &&
      persisted.input_revision === fingerprint
    ) {
      if (
        persisted.secondary_status !== 'complete' &&
        !secondaryByMeeting.has(meetingId) &&
        meeting.analysis_json
      ) {
        const analysis = JSON.parse(
          meeting.analysis_json,
        ) as AnalysisDocumentV3;
        const controller = new AbortController();
        const identity = {
          meetingId,
          runId: persisted.run_id,
          inputRevision: fingerprint,
          ...revisions,
        };
        startSecondary(
          {
            ...identity,
            transcript: analysisTranscript(meeting),
            analysis,
            provider,
            signal: controller.signal,
            canCommit: () =>
              !controller.signal.aborted &&
              dependencies.db.isMeetingAnalysisRunCurrent({
                ...identity,
                requirePublished: true,
              }),
          },
          controller,
        );
      }
      return { meetingId, runId: persisted.run_id, status: 'published' };
    }

    supersedeMeetingNotes(meetingId);

    const runId = createRunId();
    const controller = new AbortController();
    const primaryReason = input.reason === 'manual' ? 'manual' : 'automatic';
    const metricsStartedAtMs = Date.now();
    const metricsStartedAt = new Date(metricsStartedAtMs).toISOString();
    const runMetrics = createMeetingNotesRunMetrics({
      reason: primaryReason,
      sourceSegmentCount: source.segments.length,
      sourceCharacterCount: source.segments.reduce(
        (total, segment) => total + segment.text.length,
        0,
      ),
      startedAtMs: metricsStartedAtMs,
    });
    let metricFinalized = false;
    const finalizeMetric = (
      status: 'published' | 'failed' | 'cancelled',
      terminalErrorCode?: string | null,
    ) => {
      if (metricFinalized) return;
      metricFinalized = true;
      const completedAtMs = Date.now();
      try {
        dependencies.db.upsertMeetingAnalysisRunMetric?.({
          meetingId,
          runId,
          reason: primaryReason,
          status,
          errorCode: terminalErrorCode ?? null,
          metrics: runMetrics.snapshot(status, completedAtMs),
          startedAt: metricsStartedAt,
          completedAt: new Date(completedAtMs).toISOString(),
        });
      } catch {
        // Metrics are observational: a deleted parent row or telemetry failure
        // must not replace the run's publication or cancellation outcome.
      }
    };
    dependencies.db.beginMeetingAnalysisRun({
      meetingId,
      runId,
      inputRevision: fingerprint,
      ...revisions,
      reason: primaryReason,
      stage: 'queued',
      queuePosition: null,
    });
    notify(meetingId);

    const scheduleKey = `${meetingId}:${runId}`;
    scheduledRuns.set(scheduleKey, { meetingId, runId });
    const scheduledPromise = scheduler.enqueue({
      key: scheduleKey,
      scheduleClass: primaryReason,
      run: async (): Promise<PublishedMeetingNotes> => {
        dependencies.knowledgeSynthesisPause?.acquire('meeting_notes_run');
        try {
          runMetrics.setPrimaryQueueMs(Date.now() - metricsStartedAtMs);
          const admittedMeeting = dependencies.db.getMeeting(meetingId);
          const admittedRevisions = admittedMeeting
            ? dependencies.db.getMeetingAnalysisPublicationRevisions(
                admittedMeeting,
              )
            : null;
          if (
            !admittedMeeting ||
            !isEligibleMeetingSource(admittedMeeting) ||
            !admittedMeeting.transcript_json ||
            !admittedRevisions ||
            admittedRevisions.sourceRevision !== revisions.sourceRevision ||
            admittedRevisions.eligibilityRevision !==
              revisions.eligibilityRevision ||
            admittedRevisions.userNotesHash !== revisions.userNotesHash ||
            !dependencies.db.isMeetingAnalysisRunCurrent({
              meetingId,
              runId,
              inputRevision: fingerprint,
              ...revisions,
            })
          ) {
            throw new Error('meeting_notes_superseded');
          }
          const admittedNotesInput = notesSource(admittedMeeting);
          source = admittedNotesInput.source;
          dependencies.db.updateMeetingAnalysisRunStatusIfCurrent({
            meetingId,
            runId,
            inputRevision: fingerprint,
            ...revisions,
            notesStatus: 'running',
            secondaryStatus: 'pending',
            stage: 'notes_writer',
          });
          notify(meetingId);
          let generatedNodeCount = 0;
          const analysis = await (async () => {
            let deadline: ReturnType<typeof setTimeout> | undefined;
            const deadlineMs =
              dependencies.notesDeadlineMs ??
              MEETING_NOTES_ABSOLUTE_DEADLINE_MS;
            const startedAtMs = Date.now();
            const optionalReviewBudget = createMeetingNotesOptionalReviewBudget(
              startedAtMs,
              deadlineMs,
            );
            const optionalReviewBudgetOptions =
              shouldUseMeetingNotesOptionalReviewBudget(provider.name)
                ? optionalReviewBudget
                : {};
            const deadlineExceeded = new Promise<never>((_resolve, reject) => {
              deadline = setTimeout(() => {
                const error = new MeetingNotesError('notes_deadline_exceeded');
                controller.abort(error);
                reject(error);
              }, deadlineMs);
            });
            try {
              return await Promise.race([
                provider.generateStructuredAnalysis(
                  buildAnalysisTranscriptFromJson(
                    admittedMeeting.transcript_json!,
                    admittedNotesInput.projection.speakerDisplayNames,
                  ),
                  admittedMeeting.user_notes ?? '',
                  input.template,
                  {
                    signal: controller.signal,
                    source,
                    knownTerms: [
                      ...admittedNotesInput.projection.trustedUserTerms,
                      ...terms,
                    ],
                    trustedUserTerms:
                      admittedNotesInput.projection.trustedUserTerms,
                    entityHints: terms,
                    contextTokens: NOTES_CONTEXT_TOKENS,
                    compactWriterContract: true,
                    ...optionalReviewBudgetOptions,
                    stageCache,
                    cacheKey: stageCacheKey,
                    onStageEvent: runMetrics.observe,
                    onDraft: (draft) => {
                      previews.set(
                        meetingId,
                        runId,
                        draft,
                        () =>
                          !controller.signal.aborted &&
                          dependencies.db.getMeetingAnalysisRun(meetingId)
                            ?.notes_status === 'running' &&
                          dependencies.db.isMeetingAnalysisRunCurrent({
                            meetingId,
                            runId,
                            inputRevision: fingerprint,
                            ...revisions,
                          }),
                      );
                      notify(meetingId);
                    },
                    onPlan: ({ plannedLeafCount }) =>
                      runMetrics.setPlannedLeafCount(plannedLeafCount),
                    onRepair: () => runMetrics.recordRepair(),
                    onRepartition: () => runMetrics.recordRepartition(),
                    workClass:
                      primaryReason === 'manual'
                        ? 'manual_notes'
                        : 'automatic_notes',
                    onStage: (task) => {
                      if (task !== 'notesAudit') {
                        generatedNodeCount += 1;
                        runMetrics.setGeneratedNodeCount(generatedNodeCount);
                      }
                      dependencies.db.updateMeetingAnalysisRunStatusIfCurrent({
                        meetingId,
                        runId,
                        inputRevision: fingerprint,
                        ...revisions,
                        notesStatus: 'running',
                        secondaryStatus: 'pending',
                        stage: task,
                      });
                      notify(meetingId);
                    },
                  },
                ),
                deadlineExceeded,
              ]);
            } finally {
              if (deadline) clearTimeout(deadline);
            }
          })();
          if (controller.signal.aborted) throw controller.signal.reason;
          const published = dependencies.db.publishMeetingNotesIfCurrent({
            meetingId,
            runId,
            inputRevision: fingerprint,
            ...revisions,
            analysis,
          });
          if (!published) throw new Error('meeting_notes_superseded');
          finalizeMetric('published');
          notify(meetingId);
          announcePublication(meetingId, runId);
          if (dependencies.runSecondary) {
            const secondaryInput = {
              meetingId,
              runId,
              inputRevision: fingerprint,
              ...revisions,
            };
            startSecondary(
              {
                ...secondaryInput,
                transcript: buildAnalysisTranscriptFromJson(
                  admittedMeeting.transcript_json,
                  admittedNotesInput.projection.speakerDisplayNames,
                ),
                analysis,
                provider,
                signal: controller.signal,
                canCommit: () =>
                  !controller.signal.aborted &&
                  dependencies.db.isMeetingAnalysisRunCurrent({
                    ...secondaryInput,
                    requirePublished: true,
                  }),
              },
              controller,
            );
          }
          return { meetingId, runId, status: 'published' };
        } catch (error) {
          const terminalError = controller.signal.aborted
            ? controller.signal.reason
            : error;
          const code = errorCode(terminalError);
          dependencies.db.updateMeetingAnalysisRunStatus({
            meetingId,
            runId,
            notesStatus: code === 'notes_cancelled' ? 'cancelled' : 'failed',
            secondaryStatus:
              code === 'notes_cancelled' ? 'superseded' : 'pending',
            stage: code === 'notes_cancelled' ? 'cancelled' : 'notes_failed',
            errorCode: code,
          });
          finalizeMetric(
            code === 'notes_cancelled' ? 'cancelled' : 'failed',
            code,
          );
          notify(meetingId);
          throw terminalError;
        } finally {
          previews.clear(meetingId, runId);
          dependencies.knowledgeSynthesisPause?.release('meeting_notes_run');
          if (activeByMeeting.get(meetingId)?.runId === runId) {
            activeByMeeting.delete(meetingId);
          }
          scheduledRuns.delete(scheduleKey);
        }
      },
    });
    const promise = scheduledPromise.finally(() => {
      previews.clear(meetingId, runId);
      if (activeByMeeting.get(meetingId)?.runId === runId) {
        activeByMeeting.delete(meetingId);
      }
      scheduledRuns.delete(scheduleKey);
    });
    activeByMeeting.set(meetingId, {
      fingerprint,
      runId,
      controller,
      scheduleKey,
      subscribers: new Map(),
      promise,
    });
    return subscribe(
      activeByMeeting.get(meetingId) as ActiveRun,
      input.requestId,
    );
  };

  return {
    getMeetingNotesPreview: (meetingId: string | number) =>
      previews.get(String(meetingId)),
    generateAndPublishMeetingNotes,
    precomputeIncrementalMeetingNotes,
    cancelMeetingNotes,
    supersedeMeetingNotes,
  };
};
