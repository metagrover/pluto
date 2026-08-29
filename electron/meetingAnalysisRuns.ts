import { createHash, randomUUID } from 'node:crypto';
import { readDownstreamProcessingLease } from '../src/services/downstreamProcessingLease';
import { buildAnalysisTranscriptFromJson } from '../src/utils/transcript';
import type { AnalysisDocumentV3 } from './llm/analysisTypes';
import { createNotesSource } from './llm/meetingNotesSource';
import { NotesStageCache } from './llm/meetingNotesStageCache';
import {
  NOTES_OLLAMA_MODEL,
  NOTES_PROMPT_VERSION,
} from './llm/meetingNotesTypes';
import type { MeetingNotesTemplate } from './llm/prompts';
import type { LLMProvider } from './llm/provider';

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
      stageCache?: NotesStageCache;
      cacheKey?: string;
      onStage?: (task: import('./llm/meetingNotesTypes').NotesTask) => void;
    },
  ): Promise<AnalysisDocumentV3>;
  extractValueSignals?(
    transcript: string,
    summary?: string,
    options?: { signal?: AbortSignal },
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
    options?: { signal?: AbortSignal },
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
  subscribers: Map<string, { reject: (reason: unknown) => void }>;
  promise: Promise<PublishedMeetingNotes>;
};

const NOTES_CONTEXT_TOKENS = 16_384;

const hashFingerprint = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');

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
    };
    const hash = (value: string | null | undefined) =>
      createHash('sha256')
        .update(value || '', 'utf8')
        .digest('hex');
    return (
      Boolean(
        integrity.causes?.some(
          (cause) => cause.code === 'capture_gap_detected',
        ),
      ) &&
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
    /^(notes_|meeting_notes_|entity_extraction_|value_signals_|knowledge_)[a-z_]+$/.test(
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
  onUpdated?: (meetingId: string) => void;
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
  const secondaryByMeeting = new Map<
    string,
    { runId: string; controller: AbortController }
  >();
  const stageCache = new NotesStageCache();
  const createRunId = dependencies.createRunId ?? randomUUID;
  const notify = (meetingId: string) => {
    try {
      dependencies.onUpdated?.(meetingId);
    } catch {
      /* A closing renderer cannot change durable publication/run state. */
    }
  };
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
      active.controller.abort(
        new DOMException('Meeting notes generation cancelled', 'AbortError'),
      );
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
    target.controller.abort(
      new DOMException('Meeting notes run superseded', 'AbortError'),
    );
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

  const generateAndPublishMeetingNotes = async (
    input: GenerateMeetingNotesInput,
  ): Promise<PublishedMeetingNotes> => {
    const meetingId = String(input.meetingId);
    let meeting = dependencies.db.getMeeting(meetingId);
    if (!meeting) throw new Error('meeting_not_found');
    if (!isEligibleMeetingSource(meeting)) {
      throw new Error('meeting_notes_source_ineligible');
    }
    if (!meeting.transcript_json)
      throw new Error('meeting_notes_source_missing');

    let source: ReturnType<typeof createNotesSource>;
    try {
      source = createNotesSource(meeting.transcript_json);
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
      source = createNotesSource(meeting.transcript_json);
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
            transcript: buildAnalysisTranscriptFromJson(
              meeting.transcript_json,
            ),
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
    const fingerprint = hashFingerprint({
      sourceRevision: revisions.sourceRevision,
      eligibilityRevision: revisions.eligibilityRevision,
      userNotesHash: revisions.userNotesHash,
      terms,
      template: input.template,
      provider: provider.name,
      model: configuredModel(settings),
      thinking: settings.ollama_structured_thinking ?? null,
      seed: settings.ollama_seed ?? null,
      contextTokens: NOTES_CONTEXT_TOKENS,
      promptVersion: NOTES_PROMPT_VERSION,
    });

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
            transcript: buildAnalysisTranscriptFromJson(
              meeting.transcript_json,
            ),
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
    dependencies.db.beginMeetingAnalysisRun({
      meetingId,
      runId,
      inputRevision: fingerprint,
      ...revisions,
    });
    notify(meetingId);

    const promise = (async (): Promise<PublishedMeetingNotes> => {
      try {
        const analysis = await provider.generateStructuredAnalysis(
          buildAnalysisTranscriptFromJson(meeting.transcript_json),
          meeting.user_notes ?? '',
          input.template,
          {
            signal: controller.signal,
            source,
            knownTerms: terms,
            trustedUserTerms: [],
            entityHints: terms,
            contextTokens: NOTES_CONTEXT_TOKENS,
            stageCache,
            cacheKey: fingerprint,
            onStage: (task) => {
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
        );
        if (controller.signal.aborted) throw controller.signal.reason;
        const published = dependencies.db.publishMeetingNotesIfCurrent({
          meetingId,
          runId,
          inputRevision: fingerprint,
          ...revisions,
          analysis,
        });
        if (!published) throw new Error('meeting_notes_superseded');
        notify(meetingId);
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
                meeting.transcript_json,
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
        const code = errorCode(error);
        dependencies.db.updateMeetingAnalysisRunStatus({
          meetingId,
          runId,
          notesStatus: code === 'notes_cancelled' ? 'cancelled' : 'failed',
          secondaryStatus:
            code === 'notes_cancelled' ? 'superseded' : 'pending',
          stage: code === 'notes_cancelled' ? 'cancelled' : 'notes_failed',
          errorCode: code,
        });
        notify(meetingId);
        throw error;
      } finally {
        if (activeByMeeting.get(meetingId)?.runId === runId) {
          activeByMeeting.delete(meetingId);
        }
      }
    })();
    activeByMeeting.set(meetingId, {
      fingerprint,
      runId,
      controller,
      subscribers: new Map(),
      promise,
    });
    return subscribe(
      activeByMeeting.get(meetingId) as ActiveRun,
      input.requestId,
    );
  };

  return {
    generateAndPublishMeetingNotes,
    cancelMeetingNotes,
    supersedeMeetingNotes,
  };
};
