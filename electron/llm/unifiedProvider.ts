import { GoogleGenerativeAI } from '@google/generative-ai';
import {
  OLLAMA_GENERAL_MODEL,
  OLLAMA_QUICK_CHAT_MODEL,
} from '../../src/utils/ollamaModels';
import { knowledgeSynthesisPause } from '../knowledgeSynthesisPause';
import { isSerializedTaskPreemption } from '../serializedTaskGate';
import {
  analysisDocumentToMarkdown,
  fallbackAnalysisDocument,
  parseAnalysisMarkdown,
} from './analysisDocument';
import { normalizeTranscriptEvidence } from './analysisGrounding';
import type { AnalysisDocumentV3, TopicSection } from './analysisTypes';
import {
  type LocalInferenceTask,
  runWithLocalInferenceCoordinator,
} from './inferenceCoordinator';
import type { LLMWorkClass } from './llmWorkClass';
import { calculateNotesRequestBudget } from './meetingNotesBudget';
import {
  generateMeetingNotes,
  precomputeNextMeetingNotesLeaf,
} from './meetingNotesPipeline';
import type {
  NotesStageObserver,
  NotesStageOutcome,
} from './meetingNotesRunMetrics';
import { buildNotesResponseSchema } from './meetingNotesSchema';
import { createNotesSourceFromText } from './meetingNotesSource';
import { NOTES_OLLAMA_MODEL, NOTES_PROMPT_VERSION } from './meetingNotesTypes';
import { createNotesWireRequest } from './meetingNotesWire';
import { createOllamaGenerationDeadline } from './ollamaGenerationDeadline';
import { ollamaHttpFetch, ollamaHttpStream } from './ollamaHttpTransport';
import {
  getEntitiesPrompt,
  getSpeakerIdentityPrompt,
  getSummaryPrompt,
  getSummaryRepairPrompt,
  getTitlePrompt,
  getValueSignalsPrompt,
} from './prompts';
import type { MeetingNotesTemplate } from './prompts';
import { SecondaryExtractionError } from './provider';
import type {
  AnalysisArtifacts,
  EntityExtractionContext,
  ExtractedEntities,
  InternalSignalDocument,
  InternalSignalTag,
  LLMProvider,
  LLMSettings,
  ProviderType,
} from './provider';

const OLLAMA_TIMEOUT_MS = 90_000;
const OLLAMA_PROJECT_SCOPE_CAPACITY_TIMEOUT_MS = 3 * 60_000;
const OLLAMA_ANALYSIS_TIMEOUT_MS = 5 * 60_000;
const OLLAMA_LIVE_ASK_PLUTO_TIMEOUT_MS = 20_000;
const OLLAMA_KNOWLEDGE_DOC_TIMEOUT_MS = 15 * 60_000;
const OLLAMA_GENERATION_IDLE_TIMEOUT_MS = 60_000;
const OLLAMA_ACTIVE_GENERATION_MIN_TIMEOUT_MS = 6 * 60_000;
const OLLAMA_ACTIVE_GENERATION_MAX_TIMEOUT_MS = 20 * 60_000;
const OLLAMA_EDITORIAL_CONTEXT_TOKENS = 32_768;
const OLLAMA_EDITORIAL_OUTPUT_TOKENS = 2_048;
export const STRUCTURED_ANALYSIS_PROMPT_VERSION = NOTES_PROMPT_VERSION;

const reportsNotesInputOverflow = (value: unknown): boolean =>
  /context_length_exceeded|context[_ ](?:window|length|size).*(?:exceed|overflow|too (?:large|long))|(?:exceed|overflow).*(?:context|input.*tokens)|(?:prompt|input) (?:is )?too long/i.test(
    value instanceof Error
      ? value.message
      : typeof value === 'string'
        ? value
        : (JSON.stringify(value) ?? ''),
  );

const rejectNotesProviderResponse = async (
  response: Response,
): Promise<never> => {
  let error: unknown;
  try {
    error = await response.json();
  } catch {
    /* Error bodies are optional and never logged. */
  }
  throw new MeetingNotesError(
    reportsNotesInputOverflow(error)
      ? 'notes_input_overflow'
      : 'notes_provider_error',
  );
};

// llama.cpp rejects nested string repetitions at 2000 or above. Keep the
// original schema and strict commitment/identity parsers authoritative, while
// expressing those bounds as guidance on the Ollama wire only (upstream #25746).
export function toOllamaCommitmentSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toOllamaCommitmentSchema);
  if (!value || typeof value !== 'object') return value;
  const wire = Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      toOllamaCommitmentSchema(child),
    ]),
  );
  if (
    wire.type === 'string' &&
    typeof wire.maxLength === 'number' &&
    wire.maxLength >= 2000
  ) {
    wire.description = [
      wire.description,
      `Maximum length: ${wire.maxLength} characters.`,
    ]
      .filter(Boolean)
      .join(' ');
    wire.maxLength = undefined;
  }
  return wire;
}

// Claude supports a narrower wire schema. The caller retains the original
// schema and strict response parser; constraints removed here remain guidance.
function toClaudeResponseSchema(
  schema: Record<string, unknown>,
): Record<string, unknown> {
  const wire = { ...schema };
  const constraints: string[] = [];
  for (const key of [
    'minLength',
    'maxLength',
    'minimum',
    'maximum',
    'exclusiveMinimum',
    'exclusiveMaximum',
    'multipleOf',
    'maxItems',
    'uniqueItems',
  ]) {
    if (key in wire) {
      constraints.push(`${key}: ${JSON.stringify(wire[key])}`);
      delete wire[key];
    }
  }
  if (typeof wire.minItems === 'number' && wire.minItems > 1) {
    constraints.push(`minItems: ${wire.minItems}`);
    wire.minItems = 1;
  }
  for (const key of ['properties', '$defs', 'definitions']) {
    const children = wire[key];
    if (children && typeof children === 'object' && !Array.isArray(children)) {
      wire[key] = Object.fromEntries(
        Object.entries(children).map(([name, child]) => [
          name,
          child && typeof child === 'object' && !Array.isArray(child)
            ? toClaudeResponseSchema(child as Record<string, unknown>)
            : child,
        ]),
      );
    }
  }
  for (const key of ['items', 'anyOf', 'allOf', 'oneOf', 'prefixItems']) {
    const child = wire[key];
    const transform = (value: unknown) =>
      value && typeof value === 'object' && !Array.isArray(value)
        ? toClaudeResponseSchema(value as Record<string, unknown>)
        : value;
    if (child)
      wire[key] = Array.isArray(child)
        ? child.map(transform)
        : transform(child);
  }
  if (constraints.length) {
    wire.description = [
      schema.description,
      `Constraints: ${constraints.join('; ')}.`,
    ]
      .filter(Boolean)
      .join(' ');
  }
  return wire;
}

const mergeUniqueByKey = <T>(
  primary: T[],
  fallback: T[],
  key: (item: T) => string,
): T[] => {
  const seen = new Set(primary.map(key));
  return [
    ...primary,
    ...fallback.filter((item) => {
      const itemKey = key(item);
      if (!itemKey || seen.has(itemKey)) return false;
      seen.add(itemKey);
      return true;
    }),
  ];
};

const HOUSEKEEPING_TOPIC =
  /\b(screen shar(?:e|ing)|introductions?|repository links?|link sharing|tool mechanics?)\b/i;
const GENERIC_EMPTY_ANALYSIS =
  /\b(?:no substantive (?:discussion|discussions|outcome|outcomes|content|detail|details)|nothing substantive|contains? only (?:filler|small talk)|no factual (?:data|detail|details|content))\b/i;

const isGenericEmptyAnalysisText = (value: string): boolean =>
  GENERIC_EMPTY_ANALYSIS.test(value);

const hasSubstantiveTopicContent = (topic: TopicSection): boolean =>
  topic.decisions.length > 0 ||
  topic.action_items.length > 0 ||
  topic.open_questions.length > 0 ||
  topic.key_points.some(
    (point) =>
      point.text.trim().length > 0 && !isGenericEmptyAnalysisText(point.text),
  ) ||
  (topic.summary.trim().length > 0 &&
    !isGenericEmptyAnalysisText(topic.summary));

const sanitizeGenericEmptyTopic = (topic: TopicSection): TopicSection => {
  const keyPoints = topic.key_points.filter(
    (point) => !isGenericEmptyAnalysisText(point.text),
  );
  if (!isGenericEmptyAnalysisText(topic.summary)) {
    return keyPoints.length === topic.key_points.length
      ? topic
      : { ...topic, key_points: keyPoints };
  }
  const summary =
    topic.decisions[0]?.text ||
    topic.action_items[0]?.text ||
    keyPoints[0]?.text ||
    topic.open_questions[0] ||
    topic.summary;
  return { ...topic, summary, key_points: keyPoints };
};

export const collapseOversizedTopics = (
  topics: TopicSection[],
  maxTopics = 6,
): TopicSection[] => {
  const substantiveTopics = topics.filter(
    (topic) =>
      (!HOUSEKEEPING_TOPIC.test(topic.title) &&
        hasSubstantiveTopicContent(topic)) ||
      topic.decisions.length > 0 ||
      topic.action_items.length > 0,
  );
  const eligibleTopics =
    substantiveTopics.length > 0 ? substantiveTopics : topics;
  const sanitizedTopics = eligibleTopics.map(sanitizeGenericEmptyTopic);
  if (sanitizedTopics.length <= maxTopics) return sanitizedTopics;
  const clusters = sanitizedTopics.map((topic, index) => ({
    topics: [topic],
    index,
  }));

  while (clusters.length > maxTopics) {
    let bestPair: [number, number] = [0, 1];
    let bestScore = -1;
    for (let left = 0; left < clusters.length; left += 1) {
      for (let right = left + 1; right < clusters.length; right += 1) {
        const leftText = clusters[left].topics
          .map(
            (topic) =>
              `${topic.title} ${topic.title} ${topic.title} ${topic.summary}`,
          )
          .join(' ');
        const rightText = clusters[right].topics
          .map(
            (topic) =>
              `${topic.title} ${topic.title} ${topic.title} ${topic.summary}`,
          )
          .join(' ');
        const similarity = calculateJaccardSimilarity(leftText, rightText);
        const proximity = 0.05 / (1 + Math.abs(left - right));
        const score = similarity + proximity;
        if (score > bestScore) {
          bestScore = score;
          bestPair = [left, right];
        }
      }
    }
    const [left, right] = bestPair;
    clusters[left] = {
      topics: [...clusters[left].topics, ...clusters[right].topics],
      index: Math.min(clusters[left].index, clusters[right].index),
    };
    clusters.splice(right, 1);
  }

  return clusters
    .sort((left, right) => left.index - right.index)
    .map((cluster) => {
      const ranked = [...cluster.topics].sort((left, right) => {
        const score = (topic: TopicSection): number =>
          topic.decisions.length * 10 +
          topic.action_items.length * 8 +
          topic.open_questions.length * 2 +
          Math.min(topic.summary.length, 240) / 80 -
          (HOUSEKEEPING_TOPIC.test(topic.title) ? 20 : 0);
        return score(right) - score(left);
      });
      const representative = ranked[0];
      const substantiveTopics = ranked.filter(
        (topic) =>
          !HOUSEKEEPING_TOPIC.test(topic.title) ||
          topic.decisions.length > 0 ||
          topic.action_items.length > 0,
      );
      const retainedTopics =
        substantiveTopics.length > 0 ? substantiveTopics : ranked;
      const summaries = retainedTopics
        .map((topic) => topic.summary.trim())
        .filter(
          (summary) =>
            summary.length > 0 && !isGenericEmptyAnalysisText(summary),
        )
        .filter(
          (summary, index, values) =>
            values.findIndex(
              (candidate) =>
                normalizeTranscriptEvidence(candidate) ===
                normalizeTranscriptEvidence(summary),
            ) === index,
        );
      let summary = '';
      for (const candidate of summaries) {
        const next = summary ? `${summary} ${candidate}` : candidate;
        if (summary && next.length > 360) break;
        summary = next.slice(0, 360);
      }
      const settledSummary =
        representative.decisions[0]?.text ||
        representative.action_items[0]?.text ||
        '';
      const ranges = cluster.topics
        .map((topic) => topic.transcript_range)
        .filter((range): range is [number, number] => Boolean(range));
      return {
        ...representative,
        summary: summary || settledSummary || representative.summary,
        key_points: mergeUniqueByKey(
          [],
          retainedTopics
            .flatMap((topic) => topic.key_points)
            .filter((point) => !isGenericEmptyAnalysisText(point.text)),
          (item) => normalizeTranscriptEvidence(item.text),
        ).slice(0, 3),
        decisions: deduplicateExtractedItems(
          cluster.topics.flatMap((topic) => topic.decisions),
          (item) => item.text,
          (item) => item.decided_by,
        ),
        action_items: deduplicateExtractedItems(
          cluster.topics.flatMap((topic) => topic.action_items),
          (item) => item.text,
          (item) => item.assignee,
        ),
        open_questions: [
          ...new Set(retainedTopics.flatMap((topic) => topic.open_questions)),
        ].slice(0, 2),
        transcript_range:
          ranges.length > 0
            ? [
                Math.min(...ranges.map((range) => range[0])),
                Math.max(...ranges.map((range) => range[1])),
              ]
            : undefined,
      };
    });
};

let nextNotesStageSequence = 0;
let electronActiveOllamaModel: string | null = null;

type LLMTask = LocalInferenceTask;

const isAbortError = (error: unknown): boolean =>
  error instanceof Error &&
  (error.name === 'AbortError' || /\babort(?:ed)?\b/i.test(error.message));

export const getOllamaTimeoutMs = (task: string): number =>
  task === 'knowledgeDoc'
    ? OLLAMA_KNOWLEDGE_DOC_TIMEOUT_MS
    : task === 'projectScopeReview'
      ? OLLAMA_PROJECT_SCOPE_CAPACITY_TIMEOUT_MS
      : task === 'askPlutoLive'
        ? OLLAMA_LIVE_ASK_PLUTO_TIMEOUT_MS
        : task === 'structuredAnalysis' ||
            task === 'notesWriter' ||
            task === 'notesAudit' ||
            task === 'notesMerge' ||
            task === 'analysisEditorial' ||
            task === 'topicSegmentation' ||
            task === 'terminologyReconciliation' ||
            task === 'topicAnalysis'
          ? OLLAMA_ANALYSIS_TIMEOUT_MS
          : OLLAMA_TIMEOUT_MS;

const usesProgressAwareOllamaDeadline = (task: LLMTask): boolean =>
  task === 'commitmentReconciliation' ||
  task === 'projectScopeReview' ||
  task === 'notesWriter' ||
  task === 'notesAudit' ||
  task === 'notesMerge' ||
  task === 'structuredAnalysis' ||
  task === 'analysisEditorial' ||
  task === 'topicSegmentation' ||
  task === 'terminologyReconciliation' ||
  task === 'topicAnalysis' ||
  task === 'knowledgeDoc';

export const getOllamaActiveGenerationTimeoutMs = (
  numPredict: number,
): number =>
  Math.min(
    OLLAMA_ACTIVE_GENERATION_MAX_TIMEOUT_MS,
    Math.max(
      OLLAMA_ACTIVE_GENERATION_MIN_TIMEOUT_MS,
      120_000 + Math.ceil(numPredict / 2) * 1_000,
    ),
  );

type PersonEntity = ExtractedEntities['people'][number];
type TopicEntity = ExtractedEntities['topics'][number];
type ActionItemEntity = ExtractedEntities['action_items'][number];
type DecisionEntity = ExtractedEntities['decisions'][number];
type ProjectEntity = NonNullable<ExtractedEntities['projects']>[number];
type RelationshipEntity = NonNullable<
  ExtractedEntities['relationships']
>[number];
type InternalSignalRecord = Record<keyof InternalSignalDocument, unknown>;

interface TextGenerationOptions {
  prompt: string;
  task: LLMTask;
  jsonMode?: boolean;
  responseSchema?: Record<string, unknown>;
  modelOverride?: string;
  signal?: AbortSignal;
  onStart?: () => void;
  onToken?: (delta: string) => void;
  notesBudget?: { contextTokens: number; outputTokens: number };
  notesModel?: string;
  notesResponseSchema?: Record<string, unknown>;
  notesStageObserver?: NotesStageObserver;
  workClass?: LLMWorkClass;
  onNotesMetrics?: (metrics: {
    inputTokens: number | null;
    outputTokens: number | null;
  }) => void;
}

export class UnifiedLLMProvider implements LLMProvider {
  name: string;
  requiresApiKey: boolean;

  private openAIBaseUrl = 'https://api.openai.com/v1';
  private claudeBaseUrl = 'https://api.anthropic.com/v1';
  private ollamaBaseUrl = 'http://127.0.0.1:11434';
  private geminiClient: GoogleGenerativeAI | null = null;
  private activeOllamaModel: string | null = null;

  constructor(
    private providerType: ProviderType,
    private settings: LLMSettings,
  ) {
    this.name = this.getProviderName(providerType);
    this.requiresApiKey = providerType !== 'ollama';
  }

  async isAvailable(): Promise<boolean> {
    switch (this.providerType) {
      case 'ollama': {
        try {
          const response = await this.ollamaFetch('/api/tags');
          return response.ok;
        } catch (e) {
          console.warn('[Ollama] Not available:', e);
          return false;
        }
      }
      case 'gemini':
        return !!this.settings.gemini_api_key;
      case 'openai':
        return !!this.settings.openai_api_key;
      case 'claude':
        return !!this.settings.claude_api_key;
      default:
        return false;
    }
  }

  // =============================================
  // v3 Structured Analysis
  // =============================================

  async generateStructuredAnalysis(
    transcript: string,
    userNotes?: string,
    template: MeetingNotesTemplate = 'auto',
    options: {
      signal?: AbortSignal;
      knownTerms?: string[];
      source?: import('./meetingNotesTypes').NotesSource;
      trustedUserTerms?: string[];
      entityHints?: string[];
      contextTokens?: number;
      /** Explicit benchmark experiment; product callers retain every-node audits. */
      hierarchyAuditStrategy?: 'every_node' | 'final_only';
      stageCache?: import('./meetingNotesStageCache').NotesStageCache;
      cacheKey?: string;
      onStage?: (task: import('./meetingNotesTypes').NotesTask) => void;
      onRepair?: (task: import('./meetingNotesTypes').NotesTask) => void;
      onStageEvent?: NotesStageObserver;
      onPlan?: (plan: { plannedLeafCount: number }) => void;
      onRepartition?: () => void;
      workClass?: LLMWorkClass;
    } = {},
  ): Promise<AnalysisDocumentV3> {
    if (options.signal?.aborted) throw new MeetingNotesError('notes_cancelled');
    const model =
      this.providerType === 'ollama'
        ? await this.resolveOllamaModel('notesWriter')
        : this.getConfiguredAnalysisModel();
    return generateMeetingNotes({
      source: options.source ?? createNotesSourceFromText(transcript),
      context: {
        userNotes: userNotes ?? '',
        template,
        trustedUserTerms: options.trustedUserTerms ?? [],
        entityHints: options.entityHints ?? options.knownTerms ?? [],
      },
      stageCache: options.stageCache,
      cacheKey: options.cacheKey,
      hierarchyAuditStrategy: options.hierarchyAuditStrategy,
      onStage: options.onStage,
      onRepair: options.onRepair,
      onPlan: options.onPlan,
      onRepartition: options.onRepartition,
      generate: async (request) => {
        const wire = createNotesWireRequest(
          request.prompt,
          request.sourceSpans ?? [],
        );
        const raw = await this.generateResumableAnalysisText({
          prompt: wire.prompt,
          task: request.task,
          jsonMode: true,
          signal: request.signal,
          ...(this.providerType === 'ollama'
            ? {
                notesResponseSchema: buildNotesResponseSchema(
                  request.responseContract,
                  wire.sourceLabels,
                ),
              }
            : {}),
          notesBudget: {
            contextTokens: request.contextTokens,
            outputTokens: request.outputTokens,
          },
          notesStageObserver: options.onStageEvent,
          notesModel: model,
          workClass: options.workClass,
        });
        return wire.decode(raw);
      },
      provider: this.providerType,
      model,
      contextTokens: options.contextTokens ?? 16_384,
      ...(options.signal ? { signal: options.signal } : {}),
    });
  }

  async precomputeStructuredAnalysisLeaf(
    transcript: string,
    userNotes: string,
    template: MeetingNotesTemplate,
    options: {
      signal?: AbortSignal;
      knownTerms?: string[];
      source?: import('./meetingNotesTypes').NotesSource;
      trustedUserTerms?: string[];
      entityHints?: string[];
      contextTokens?: number;
      stageCache: import('./meetingNotesStageCache').NotesStageCache;
      cacheKey: string;
      onStage?: (task: import('./meetingNotesTypes').NotesTask) => void;
      onRepair?: (task: import('./meetingNotesTypes').NotesTask) => void;
      onStageEvent?: NotesStageObserver;
      workClass?: LLMWorkClass;
    },
  ): Promise<'generated' | 'reused' | 'discarded'> {
    options.signal?.throwIfAborted();
    const model =
      this.providerType === 'ollama'
        ? await this.resolveOllamaModel('notesWriter')
        : this.getConfiguredAnalysisModel();
    return precomputeNextMeetingNotesLeaf({
      source: options.source ?? createNotesSourceFromText(transcript),
      context: {
        userNotes,
        template,
        trustedUserTerms: options.trustedUserTerms ?? [],
        entityHints: options.entityHints ?? options.knownTerms ?? [],
      },
      stageCache: options.stageCache,
      cacheKey: options.cacheKey,
      onStage: options.onStage,
      onRepair: options.onRepair,
      generate: async (request) => {
        const wire = createNotesWireRequest(
          request.prompt,
          request.sourceSpans ?? [],
        );
        const raw = await this.generateResumableAnalysisText({
          prompt: wire.prompt,
          task: request.task,
          jsonMode: true,
          signal: request.signal,
          ...(this.providerType === 'ollama'
            ? {
                notesResponseSchema: buildNotesResponseSchema(
                  request.responseContract,
                  wire.sourceLabels,
                ),
              }
            : {}),
          notesBudget: {
            contextTokens: request.contextTokens,
            outputTokens: request.outputTokens,
          },
          notesStageObserver: options.onStageEvent,
          notesModel: model,
          workClass: options.workClass,
        });
        return wire.decode(raw);
      },
      provider: this.providerType,
      model,
      contextTokens: options.contextTokens ?? 16_384,
      ...(options.signal ? { signal: options.signal } : {}),
    });
  }

  private getConfiguredAnalysisModel(): string {
    switch (this.providerType) {
      case 'ollama':
        return (
          this.settings.ollama_model ||
          this.settings.llm_model ||
          NOTES_OLLAMA_MODEL
        );
      case 'openai':
        return this.settings.openai_model || 'gpt-4o-mini';
      case 'claude':
        return this.settings.claude_model || 'claude-3-haiku-20240307';
      case 'gemini':
        return this.settings.gemini_model || 'gemini-1.5-flash';
    }
  }

  // =============================================
  // Legacy v2 methods (deprecated, kept for backward compat)
  // =============================================

  /** @deprecated Use generateStructuredAnalysis */
  async generateSummary(
    transcript: string,
    userNotes?: string,
  ): Promise<string> {
    const artifacts = await this.generateAnalysisArtifacts(
      transcript,
      userNotes,
    );
    return artifacts.markdown;
  }

  async generateUserAnalysisMarkdown(
    transcript: string,
    userNotes?: string,
  ): Promise<string> {
    const prompt = getSummaryPrompt(transcript, userNotes);
    return this.generateText({ prompt, task: 'summary' });
  }

  async extractInternalSignals(
    transcript: string,
    summary?: string,
    options: { signal?: AbortSignal; workClass?: LLMWorkClass } = {},
  ): Promise<InternalSignalDocument> {
    const prompt = getValueSignalsPrompt(transcript, summary);

    try {
      const raw = await this.generateResumableAnalysisText({
        prompt,
        task: 'valueSignals',
        jsonMode: true,
        signal: options.signal,
        workClass: options.workClass,
      });
      const parsed = JSON.parse(
        this.cleanJsonText(raw),
      ) as Partial<InternalSignalRecord>;
      return {
        analysis_schema_version: 2,
        continuity: this.asStringArray(parsed.continuity),
        accountability_risks: this.asStringArray(parsed.accountability_risks),
        decision_impacts: this.asStringArray(parsed.decision_impacts),
        extra_tags: this.normalizeTags(parsed.extra_tags),
      };
    } catch (e) {
      if (isAbortError(e)) throw e;
      console.error(
        `[${this.name}] Failed to extract internal signals: value_signals_failed`,
      );
      throw new SecondaryExtractionError('value_signals_failed', e);
    }
  }

  async extractValueSignals(
    transcript: string,
    summary?: string,
    options: { signal?: AbortSignal; workClass?: LLMWorkClass } = {},
  ): Promise<InternalSignalDocument> {
    return this.extractInternalSignals(transcript, summary, options);
  }

  async generateAnalysisArtifacts(
    transcript: string,
    userNotes?: string,
  ): Promise<AnalysisArtifacts> {
    const firstDraft = await this.generateUserAnalysisMarkdown(
      transcript,
      userNotes,
    );
    let retryCount = 0;
    let parsed = parseAnalysisMarkdown(firstDraft, retryCount);

    if (parsed.issues.length > 0) {
      retryCount = 1;
      try {
        const repairPrompt = getSummaryRepairPrompt(
          transcript,
          firstDraft,
          userNotes,
        );
        const repaired = await this.generateText({
          prompt: repairPrompt,
          task: 'summaryRepair',
        });
        parsed = parseAnalysisMarkdown(repaired, retryCount);
      } catch (e) {
        console.error(`[${this.name}] Analysis repair failed:`, e);
      }
    }

    const document =
      parsed.issues.length > 0
        ? fallbackAnalysisDocument(retryCount, parsed.issues)
        : {
            ...parsed.document,
            quality: {
              ...parsed.document.quality,
              retry_count: retryCount,
            },
          };

    const markdown = analysisDocumentToMarkdown(document);
    const signals = await this.extractInternalSignals(transcript, markdown);

    return {
      markdown,
      analysis: document,
      signals,
    };
  }

  async extractSpeakerIdentity(transcript: string): Promise<string | null> {
    const prompt = getSpeakerIdentityPrompt(transcript);

    try {
      const name = (
        await this.generateText({ prompt, task: 'speaker' })
      ).trim();
      if (
        name &&
        name.length < 20 &&
        !name.includes(' ') &&
        name !== 'Unknown'
      ) {
        return name;
      }
      return null;
    } catch (e) {
      console.error(`[${this.name}] Failed to extract speaker identity:`, e);
      return null;
    }
  }

  async generateTitle(transcript: string): Promise<string> {
    const prompt = getTitlePrompt(transcript);

    try {
      const generated = await this.generateText({ prompt, task: 'title' });
      const title = generated
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map((line) =>
          line
            .replace(/["'*]/g, '')
            .replace(/^(?:title|subject|meeting title)\s*:\s*/i, '')
            .replace(/^#+\s+/, '')
            .trim(),
        )
        .find(
          (line) =>
            line.length > 0 &&
            !line.match(/^(here is|sure|i can help|the title|below is)/i),
        );

      if (title && title.length < 100) {
        return title;
      }
      return 'Meeting';
    } catch (e) {
      console.error(`[${this.name}] Failed to generate title:`, e);
      return 'Meeting';
    }
  }

  async synthesizeKnowledgeDocument(
    prompt: string,
    options: {
      signal?: AbortSignal;
      purpose?: 'projectScope' | 'commitmentReconciliation' | 'dreaming';
      responseSchema?: Record<string, unknown>;
      model?: string;
      promptVersion?: string;
    } = {},
  ): Promise<string> {
    if (options.purpose === 'dreaming' && this.providerType !== 'ollama') {
      throw new Error('dreaming_local_provider_required');
    }
    if (
      options.purpose === 'dreaming' &&
      (!options.model?.trim() || !options.promptVersion?.trim())
    ) {
      throw new Error('dreaming_request_metadata_required');
    }
    return this.generateText({
      prompt,
      task:
        options.purpose === 'commitmentReconciliation'
          ? 'commitmentReconciliation'
          : options.purpose === 'projectScope'
            ? 'projectScopeReview'
            : 'knowledgeDoc',
      jsonMode: true,
      responseSchema: options.responseSchema,
      modelOverride:
        options.purpose === 'dreaming' ? options.model?.trim() : undefined,
      signal: options.signal,
    });
  }

  async answerAskPluto(
    prompt: string,
    options: {
      signal?: AbortSignal;
      mode?: 'fast' | 'deep';
      live?: boolean;
      onStart?: () => void;
      onToken?: (delta: string) => void;
    } = {},
  ): Promise<string> {
    return this.generateText({
      prompt,
      task: options.live
        ? 'askPlutoLive'
        : options.mode === 'deep'
          ? 'askPlutoDeep'
          : 'askPluto',
      signal: options.signal,
      onStart: options.onStart,
      onToken: options.onToken,
    });
  }

  async classifyQueryIntent(
    prompt: string,
    options: { signal?: AbortSignal; workClass?: LLMWorkClass } = {},
  ): Promise<string> {
    return this.generateText({
      prompt,
      task: 'queryClassification',
      jsonMode: true,
      signal: options.signal,
    });
  }

  async extractEntities(
    transcript: string,
    context?: EntityExtractionContext,
    options: { signal?: AbortSignal; workClass?: LLMWorkClass } = {},
  ): Promise<ExtractedEntities> {
    const prompt = getEntitiesPrompt(transcript, context);

    try {
      const raw = await this.generateResumableAnalysisText({
        prompt,
        task: 'entities',
        jsonMode: true,
        signal: options.signal,
        workClass: options.workClass,
      });
      const parsed = JSON.parse(this.cleanJsonText(raw)) as Record<
        string,
        unknown
      >;
      return {
        people: this.asArray<PersonEntity>(parsed.people),
        topics: this.asArray<TopicEntity>(parsed.topics),
        action_items: this.asArray<ActionItemEntity>(parsed.action_items),
        decisions: this.asArray<DecisionEntity>(parsed.decisions),
        projects: this.asArray<ProjectEntity>(parsed.projects),
        relationships: this.asArray<RelationshipEntity>(parsed.relationships),
      };
    } catch (e) {
      if (isAbortError(e)) throw e;
      console.error(
        `[${this.name}] Failed to extract entities: entity_extraction_failed`,
      );
      throw new SecondaryExtractionError('entity_extraction_failed', e);
    }
  }

  private getProviderName(provider: ProviderType): string {
    switch (provider) {
      case 'ollama':
        return 'Ollama (Local)';
      case 'gemini':
        return 'Google Gemini';
      case 'openai':
        return 'OpenAI';
      case 'claude':
        return 'Anthropic Claude';
      default:
        return 'LLM';
    }
  }

  private async generateText(options: TextGenerationOptions): Promise<string> {
    const queuedAt = Date.now();
    const notesStageObserver = options.notesBudget
      ? options.notesStageObserver
      : undefined;
    const notesStageSequence = notesStageObserver
      ? nextNotesStageSequence++
      : null;
    let notesStageStartedAt: number | null = null;
    let notesStageFinished = false;
    let terminalNotesMetrics = {
      inputTokens: null as number | null,
      outputTokens: null as number | null,
    };
    const observeNotesStarted = () => {
      if (!notesStageObserver || notesStageSequence === null) return;
      notesStageStartedAt ??= Date.now();
      notesStageObserver({
        phase: 'started',
        sequence: notesStageSequence,
        atMs: notesStageStartedAt,
      });
    };
    const observeNotesFinished = (outcome: NotesStageOutcome) => {
      if (
        !notesStageObserver ||
        notesStageSequence === null ||
        notesStageFinished
      )
        return;
      notesStageFinished = true;
      notesStageObserver({
        phase: 'finished',
        sequence: notesStageSequence,
        atMs: Date.now(),
        outcome,
        ...terminalNotesMetrics,
      });
    };
    if (notesStageObserver && notesStageSequence !== null) {
      notesStageObserver({
        phase: 'queued',
        sequence: notesStageSequence,
        task: options.task as import('./meetingNotesTypes').NotesTask,
        atMs: queuedAt,
      });
    }
    if (options.notesBudget) {
      calculateNotesRequestBudget({
        prompt: options.prompt,
        ...options.notesBudget,
      });
    }
    const isBackground = options.task === 'knowledgeDoc';
    if (!isBackground) {
      knowledgeSynthesisPause.acquire('llm_active');
    }

    try {
      options.signal?.throwIfAborted();
      let result: string;
      switch (this.providerType) {
        case 'openai':
          observeNotesStarted();
          options.onStart?.();
          result = await this.generateWithOpenAI(options);
          break;
        case 'claude':
          observeNotesStarted();
          options.onStart?.();
          result = await this.generateWithClaude(options);
          break;
        case 'gemini':
          observeNotesStarted();
          options.onStart?.();
          result = await this.generateWithGemini(options);
          break;
        case 'ollama': {
          result = await runWithLocalInferenceCoordinator({
            key: Symbol(options.task),
            task: options.task,
            workClass: options.workClass,
            signal: options.signal,
            onAdmitted: ({ task, queueMs }) => {
              if (options.notesBudget)
                console.log(
                  '[Notes gate]',
                  JSON.stringify({ task, waitMs: queueMs }),
                );
              if (
                task === 'askPluto' ||
                task === 'askPlutoDeep' ||
                task === 'askPlutoLive'
              ) {
                console.info(
                  '[Inference admission]',
                  JSON.stringify({ task, queueMs }),
                );
              }
            },
            run: async (gateSignal) => {
              observeNotesStarted();
              options.onStart?.();
              return this.generateWithOllama({
                ...options,
                onNotesMetrics: (metrics) => {
                  terminalNotesMetrics = metrics;
                  options.onNotesMetrics?.(metrics);
                },
                signal: options.signal
                  ? AbortSignal.any([options.signal, gateSignal])
                  : gateSignal,
              });
            },
          });
          break;
        }
        default:
          throw new Error(`Unsupported provider: ${this.providerType}`);
      }
      options.signal?.throwIfAborted();
      observeNotesFinished('complete');
      return result;
    } catch (error) {
      observeNotesFinished(
        isSerializedTaskPreemption(error)
          ? 'preempted'
          : error instanceof MeetingNotesError &&
              error.code === 'notes_output_truncated'
            ? 'truncated'
            : isAbortError(error)
              ? 'cancelled'
              : 'failed',
      );
      throw error;
    } finally {
      if (!isBackground) {
        knowledgeSynthesisPause.release('llm_active');
      }
    }
  }

  private async generateResumableAnalysisText(
    options: TextGenerationOptions,
  ): Promise<string> {
    let preemptions = 0;
    while (true) {
      try {
        return await this.generateText(options);
      } catch (error) {
        if (options.notesBudget && reportsNotesInputOverflow(error))
          throw new MeetingNotesError('notes_input_overflow');
        if (!isSerializedTaskPreemption(error) || options.signal?.aborted) {
          throw error;
        }
        if (options.notesBudget)
          console.log(
            '[Notes preemption]',
            JSON.stringify({ task: options.task, count: ++preemptions }),
          );
      }
    }
  }

  private async generateWithOpenAI({
    prompt,
    task,
    jsonMode,
    responseSchema,
    signal,
    notesBudget,
  }: TextGenerationOptions): Promise<string> {
    if (!this.settings.openai_api_key) {
      throw new Error('OpenAI API key not configured');
    }

    const body: Record<string, unknown> = {
      model: this.settings.openai_model || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: this.getSystemInstruction(task) },
        { role: 'user', content: prompt },
      ],
      temperature: this.getTemperature(task),
      ...(notesBudget
        ? { max_completion_tokens: notesBudget.outputTokens }
        : {}),
    };

    if (jsonMode) {
      body.response_format = responseSchema
        ? {
            type: 'json_schema',
            json_schema: { name: task, schema: responseSchema, strict: true },
          }
        : { type: 'json_object' };
    }

    const response = await fetch(`${this.openAIBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.settings.openai_api_key}`,
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      if (notesBudget) return rejectNotesProviderResponse(response);
      throw new Error(`OpenAI API error: ${response.statusText}`);
    }

    const data = await response.json();
    if (notesBudget && data.choices?.[0]?.finish_reason === 'length')
      throw new MeetingNotesError('notes_output_truncated');
    if (
      task === 'commitmentReconciliation' &&
      data.choices?.[0]?.finish_reason === 'length'
    )
      throw new Error('commitment_response_incomplete');
    return data.choices?.[0]?.message?.content ?? '';
  }

  private async generateWithClaude({
    prompt,
    task,
    responseSchema,
    signal,
    notesBudget,
  }: TextGenerationOptions): Promise<string> {
    if (!this.settings.claude_api_key) {
      throw new Error('Claude API key not configured');
    }

    const response = await fetch(`${this.claudeBaseUrl}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.settings.claude_api_key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.settings.claude_model || 'claude-3-haiku-20240307',
        max_tokens: notesBudget?.outputTokens ?? this.getClaudeMaxTokens(task),
        messages: [{ role: 'user', content: prompt }],
        ...(responseSchema
          ? {
              output_config: {
                format: {
                  type: 'json_schema',
                  schema: toClaudeResponseSchema(responseSchema),
                },
              },
            }
          : {}),
      }),
      signal,
    });

    if (!response.ok) {
      if (notesBudget) return rejectNotesProviderResponse(response);
      throw new Error(`Claude API error: ${response.statusText}`);
    }

    const data = await response.json();
    if (notesBudget && data.stop_reason === 'max_tokens')
      throw new MeetingNotesError('notes_output_truncated');
    if (
      task === 'commitmentReconciliation' &&
      data.stop_reason === 'max_tokens'
    )
      throw new Error('commitment_response_incomplete');
    return data.content?.[0]?.text ?? '';
  }

  private async generateWithGemini({
    prompt,
    task,
    jsonMode,
    responseSchema,
    notesBudget,
    signal,
  }: TextGenerationOptions): Promise<string> {
    const client = this.getGeminiClient();
    const modelName = this.settings.gemini_model || 'gemini-1.5-flash';

    const model = client.getGenerativeModel(
      jsonMode
        ? {
            model: modelName,
            generationConfig: {
              responseMimeType: 'application/json',
              // The installed SDK forwards generationConfig unchanged. Use the
              // API's JSON Schema field, not its narrower OpenAPI responseSchema.
              ...(responseSchema ? { responseJsonSchema: responseSchema } : {}),
              ...(notesBudget
                ? { maxOutputTokens: notesBudget.outputTokens }
                : {}),
            },
          }
        : { model: modelName },
    );

    const result = await model.generateContent(
      prompt,
      signal ? { signal } : undefined,
    );
    signal?.throwIfAborted();
    const response = await result.response;
    if (
      notesBudget &&
      response.candidates?.some(
        (candidate) => candidate.finishReason === 'MAX_TOKENS',
      )
    )
      throw new MeetingNotesError('notes_output_truncated');
    if (
      task === 'commitmentReconciliation' &&
      response.candidates?.some(
        (candidate) => candidate.finishReason === 'MAX_TOKENS',
      )
    )
      throw new Error('commitment_response_incomplete');
    return response.text();
  }

  private async generateWithOllama({
    prompt,
    task,
    jsonMode,
    responseSchema,
    signal,
    onToken,
    notesBudget,
    notesResponseSchema,
    notesModel,
    modelOverride,
    onNotesMetrics,
  }: TextGenerationOptions): Promise<string> {
    const model = modelOverride
      ? modelOverride
      : notesBudget && notesModel
        ? notesModel
        : await this.resolveOllamaModel(task);
    const activeModel = process.versions.electron
      ? electronActiveOllamaModel
      : this.activeOllamaModel;
    if (activeModel && activeModel !== model) {
      await this.unloadOllamaModel(activeModel);
    }
    this.activeOllamaModel = model;
    if (process.versions.electron) electronActiveOllamaModel = model;
    const { num_ctx, num_predict } = notesBudget
      ? calculateNotesRequestBudget({
          prompt,
          contextTokens: notesBudget.contextTokens,
          outputTokens: notesBudget.outputTokens,
        })
      : calculateOllamaContextBudget(prompt, task);
    const progressAware =
      Boolean(notesBudget) || usesProgressAwareOllamaDeadline(task);
    const shouldStream = Boolean(onToken) || progressAware;

    const requestBody: Record<string, unknown> = {
      model,
      prompt,
      stream: shouldStream,
      options: {
        num_ctx,
        num_predict,
        temperature: this.getTemperature(task),
        num_thread: 8, // Ensure multi-threading is utilized
      },
      keep_alive: '1h', // Keep model in memory for 1 hour to avoid reload latency
    };

    if (jsonMode) {
      requestBody.format =
        notesResponseSchema ??
        (task === 'commitmentReconciliation' && responseSchema
          ? toOllamaCommitmentSchema(responseSchema)
          : responseSchema) ??
        'json';
      requestBody.think = this.settings.ollama_structured_thinking ?? false;
    }
    if (
      task === 'queryClassification' ||
      task === 'projectScopeReview' ||
      task === 'commitmentReconciliation'
    )
      requestBody.think = false;
    if (task === 'askPluto') requestBody.think = false;
    if (task === 'askPlutoDeep') {
      requestBody.think = false;
      const options = requestBody.options as Record<string, unknown>;
      options.top_k = 40;
      options.top_p = 1;
    }
    if (task === 'askPlutoLive') {
      requestBody.think = false;
    }
    if (Number.isSafeInteger(this.settings.ollama_seed)) {
      (requestBody.options as Record<string, unknown>).seed =
        this.settings.ollama_seed;
    }

    // Ollama's generate endpoint can apply JSON grammar to the reasoning
    // channel, yielding no final answer. Chat defers grammar until the answer.
    const useNotesChat = Boolean(notesBudget);
    if (useNotesChat) {
      requestBody.prompt = undefined;
      requestBody.messages = [{ role: 'user', content: prompt }];
    }

    const start = Date.now();
    try {
      console.log(
        `[Ollama] Generating text for task: ${task} (model: ${model})...`,
      );
    } catch (_ioErr) {
      // stdout may be closed in packaged Electron — ignore write errors
    }

    if (shouldStream) {
      let pending = '';
      let answer = '';
      let completed = false;
      const deadline = progressAware
        ? createOllamaGenerationDeadline({
            capacityTimeoutMs: getOllamaTimeoutMs(task),
            idleTimeoutMs: OLLAMA_GENERATION_IDLE_TIMEOUT_MS,
            activeTimeoutMs: getOllamaActiveGenerationTimeoutMs(num_predict),
            callerSignal: signal,
          })
        : null;
      const timeoutSignal = deadline
        ? deadline.signal
        : AbortSignal.timeout(getOllamaTimeoutMs(task));
      const combinedSignal =
        signal && !deadline
          ? AbortSignal.any([signal, timeoutSignal])
          : timeoutSignal;
      const consumeChunk = (chunk: string) => {
        pending += chunk;
        const lines = pending.split('\n');
        pending = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          const packet = JSON.parse(line) as Record<string, unknown>;
          if (task === 'projectScopeReview' && packet.done === true) {
            completed = true;
            if (packet.done_reason === 'length')
              throw new Error('project_scope_response_incomplete');
          }
          if (task === 'commitmentReconciliation' && packet.done === true) {
            completed = true;
            if (packet.done_reason === 'length')
              throw new Error('commitment_response_incomplete');
          }
          if (notesBudget && packet.done) {
            completed = true;
            const notesMetrics = readNotesMetrics(packet);
            onNotesMetrics?.({
              inputTokens: notesMetrics.inputTokens,
              outputTokens: notesMetrics.outputTokens,
            });
            console.log(
              '[Notes metrics]',
              JSON.stringify({
                task,
                ...notesMetrics,
                elapsedMs: Date.now() - start,
              }),
            );
            if (packet.done_reason === 'length')
              throw new MeetingNotesError('notes_output_truncated');
          }
          if (packet.error)
            throw new MeetingNotesError(
              notesBudget && reportsNotesInputOverflow(packet.error)
                ? 'notes_input_overflow'
                : 'notes_provider_error',
            );
          const content = useNotesChat
            ? (packet.message as { content?: unknown } | undefined)?.content
            : packet.response;
          if (typeof content !== 'string' || !content) continue;
          answer += content;
          onToken?.(content);
        }
      };
      try {
        const response = await this.ollamaStream(
          useNotesChat ? '/api/chat' : '/api/generate',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
            signal: combinedSignal,
          },
          (chunk) => {
            deadline?.recordProgress();
            consumeChunk(chunk);
          },
        );
        if (pending.trim()) consumeChunk('\n');
        if (!response.ok) {
          if (notesBudget)
            throw new MeetingNotesError(
              reportsNotesInputOverflow(response.errorBody)
                ? 'notes_input_overflow'
                : 'notes_provider_error',
            );
          throw new Error(`Ollama API error: ${response.statusText}`);
        }
        if (notesBudget && !completed)
          throw new MeetingNotesError('notes_output_incomplete');
        if (task === 'projectScopeReview' && !completed)
          throw new Error('project_scope_response_incomplete');
        if (task === 'commitmentReconciliation' && !completed)
          throw new Error('commitment_response_incomplete');
        return answer;
      } catch (error) {
        const fastModel = (this.settings.ollama_fast_model || '').trim();
        if (
          signal?.aborted &&
          isSerializedTaskPreemption(signal.reason) &&
          fastModel &&
          fastModel !== model
        ) {
          await this.unloadOllamaModel(model);
        }
        throw error;
      } finally {
        deadline?.dispose();
      }
    }

    let response: Response;
    try {
      response = await this.ollamaFetch(
        '/api/generate',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        },
        getOllamaTimeoutMs(task),
        signal,
      );
    } catch (error) {
      const fastModel = (this.settings.ollama_fast_model || '').trim();
      if (
        signal?.aborted &&
        isSerializedTaskPreemption(signal.reason) &&
        fastModel &&
        fastModel !== model
      ) {
        await this.unloadOllamaModel(model);
      }
      throw error;
    }

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.statusText}`);
    }

    const data = await response.json();
    const duration = Date.now() - start;
    try {
      console.log(`[Ollama] Generation complete in ${duration}ms (${task})`);
    } catch (_ioErr) {
      // stdout may be closed in packaged Electron — ignore write errors
    }

    return data.response ?? '';
  }

  private async unloadOllamaModel(model: string): Promise<void> {
    try {
      await this.ollamaFetch(
        '/api/generate',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            keep_alive: 0,
            stream: false,
          }),
        },
        30_000,
      );
      if (this.activeOllamaModel === model) {
        this.activeOllamaModel = null;
      }
      if (electronActiveOllamaModel === model) {
        electronActiveOllamaModel = null;
      }
    } catch (error) {
      console.warn(
        `[Ollama] Failed to unload preempted model ${model}:`,
        error,
      );
    }
  }

  private getGeminiClient(): GoogleGenerativeAI {
    if (!this.settings.gemini_api_key) {
      throw new Error('Gemini API key not configured');
    }
    if (!this.geminiClient) {
      this.geminiClient = new GoogleGenerativeAI(this.settings.gemini_api_key);
    }
    return this.geminiClient;
  }

  private async resolveOllamaModel(task?: LLMTask): Promise<string> {
    if (task === 'askPlutoLive' || task === 'queryClassification') {
      return (
        (this.settings.ollama_fast_model || '').trim() ||
        OLLAMA_QUICK_CHAT_MODEL
      );
    }
    const configuredModel = (
      this.settings.ollama_model ||
      this.settings.llm_model ||
      ''
    ).trim();
    if (configuredModel) {
      return configuredModel;
    }

    return OLLAMA_GENERAL_MODEL;
  }

  private async ollamaFetch(
    path: string,
    options?: RequestInit,
    timeoutMs = OLLAMA_TIMEOUT_MS,
    externalSignal?: AbortSignal,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const abortFromExternal = () => controller.abort(externalSignal?.reason);
    externalSignal?.addEventListener('abort', abortFromExternal, {
      once: true,
    });
    if (externalSignal?.aborted) abortFromExternal();

    try {
      // Keep long-lived localhost generations out of Electron's network
      // service, which can suspend requests while Ollama is still working.
      const fetchImpl = process.versions.electron ? ollamaHttpFetch : fetch;
      return await fetchImpl(`${this.ollamaBaseUrl}${path}`, {
        ...options,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
      externalSignal?.removeEventListener('abort', abortFromExternal);
    }
  }

  private async ollamaStream(
    path: string,
    options: RequestInit,
    onChunk: (chunk: string) => void,
  ): Promise<{
    ok: boolean;
    status: number;
    statusText: string;
    errorBody?: string;
  }> {
    if (process.versions.electron) {
      return await ollamaHttpStream(
        `${this.ollamaBaseUrl}${path}`,
        options,
        onChunk,
      );
    }
    const response = await fetch(`${this.ollamaBaseUrl}${path}`, options);
    if (!response.body) {
      if (typeof response.text === 'function') {
        onChunk(await response.text());
      } else if (typeof response.json === 'function') {
        onChunk(`${JSON.stringify(await response.json())}\n`);
      }
      return response;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        onChunk(decoder.decode(value, { stream: true }));
      }
      const tail = decoder.decode();
      if (tail) onChunk(tail);
    } catch (error) {
      await reader.cancel().catch(() => undefined);
      throw error;
    } finally {
      reader.releaseLock();
    }
    return response;
  }

  private getSystemInstruction(task: LLMTask): string {
    if (task === 'notesWriter') {
      return 'You are a source-grounded meeting notes writer. Always respond with valid JSON only.';
    }
    if (task === 'notesAudit') {
      return 'You are a source-grounded meeting notes auditor. Always respond with valid JSON only.';
    }
    if (task === 'notesMerge') {
      return 'You are a source-grounded meeting notes merger. Always respond with valid JSON only.';
    }
    if (task === 'analysisEditorial') {
      return 'You are a rigorous global meeting-notes editor. Always respond with valid JSON only.';
    }
    if (task === 'structuredAnalysis') {
      return 'You are a rigorous meeting analyst. Always respond with valid JSON only.';
    }
    if (task === 'topicSegmentation') {
      return 'You are a meeting topic segmentation expert. Always respond with valid JSON only.';
    }
    if (task === 'terminologyReconciliation') {
      return 'You reconcile uncertain meeting terminology conservatively. Always respond with valid JSON only.';
    }
    if (task === 'topicAnalysis') {
      return 'You are a meeting topic analyst. Always respond with valid JSON only.';
    }
    if (task === 'entities') {
      return 'You are an expert at extracting structured entities from meeting transcripts. Always respond with valid JSON only.';
    }
    if (task === 'valueSignals') {
      return 'You are an expert at classifying conversation value signals. Always respond with valid JSON only.';
    }
    if (task === 'projectScopeReview') {
      return 'You assess project scope conservatively against transcript evidence. Always respond with valid JSON only.';
    }
    if (task === 'commitmentReconciliation') {
      return 'Compare commitments conservatively by meaning and source context. Same topic is not the same obligation. Return valid JSON only.';
    }
    if (task === 'knowledgeDoc') {
      return 'You are an expert at generating strict citation-grounded knowledge documents. Always respond with valid JSON only.';
    }
    if (task === 'summaryRepair') {
      return 'You are a strict formatting assistant. Return only corrected markdown.';
    }
    if (task === 'title') {
      return 'You are a strict assistant that generates concise meeting titles. Return ONLY the title itself, with no conversational filler, no quotes, and no markdown formatting.';
    }
    if (task === 'speaker') {
      return 'You are a helpful assistant that extracts speaker information.';
    }
    if (
      task === 'askPluto' ||
      task === 'askPlutoDeep' ||
      task === 'askPlutoLive'
    ) {
      return 'You are an intelligent meeting assistant.';
    }
    if (task === 'queryClassification') {
      return 'You are an exact expert intent classifier. Reply with valid JSON only.';
    }
    return 'You are an intelligent meeting assistant.';
  }

  private getTemperature(task: LLMTask): number {
    if (
      task === 'notesWriter' ||
      task === 'notesAudit' ||
      task === 'notesMerge'
    )
      return 0.1;
    if (task === 'analysisEditorial') return 0.1;
    if (task === 'structuredAnalysis') return 0.7;
    if (task === 'topicSegmentation') return 0.1;
    if (task === 'terminologyReconciliation') return 0;
    if (task === 'topicAnalysis') return 0.1;
    if (task === 'summary') return 0.7;
    if (task === 'summaryRepair') return 0.2;
    if (task === 'valueSignals') return 0.2;
    if (task === 'projectScopeReview') return 0.1;
    if (task === 'commitmentReconciliation') return 0;
    if (task === 'knowledgeDoc') return 0.2;
    if (task === 'title') return 0.5;
    if (
      task === 'askPluto' ||
      task === 'askPlutoDeep' ||
      task === 'askPlutoLive'
    )
      return 0.2;
    if (task === 'queryClassification') return 0.1;
    return 0.3;
  }

  private getClaudeMaxTokens(task: LLMTask): number {
    if (task === 'notesWriter') return 2048;
    if (task === 'notesAudit') return 1536;
    if (task === 'notesMerge') return 2048;
    if (task === 'analysisEditorial') return OLLAMA_EDITORIAL_OUTPUT_TOKENS;
    if (task === 'structuredAnalysis') return 4096;
    if (task === 'topicSegmentation') return 512;
    if (task === 'terminologyReconciliation') return 2048;
    if (task === 'topicAnalysis') return 2048;
    if (task === 'summary') return 1024;
    if (task === 'summaryRepair') return 1024;
    if (task === 'entities') return 2048;
    if (task === 'valueSignals') return 512;
    if (task === 'projectScopeReview') return 2500;
    if (task === 'commitmentReconciliation') return 2500;
    if (task === 'knowledgeDoc') return 4096;
    if (task === 'askPluto') return 1024;
    if (task === 'askPlutoDeep') return 2048;
    if (task === 'askPlutoLive') return 768;
    if (task === 'queryClassification') return 128;
    return 50;
  }

  private cleanJsonText(value: string): string {
    const trimmed = value.trim();
    if (trimmed.startsWith('```')) {
      return trimmed.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }
    return trimmed;
  }

  private asArray<T>(value: unknown): T[] {
    return Array.isArray(value) ? (value as T[]) : [];
  }

  private asStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
      .slice(0, 3);
  }

  private normalizeTag(value: string): string {
    return value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }

  private normalizeTags(value: unknown): InternalSignalTag[] {
    if (!Array.isArray(value)) {
      return [];
    }

    const dedupe = new Map<string, number>();
    for (const entry of value) {
      if (!entry || typeof entry !== 'object') continue;
      const record = entry as Record<string, unknown>;
      const rawTag = typeof record.tag === 'string' ? record.tag : '';
      const normalizedTag = this.normalizeTag(rawTag);
      if (!normalizedTag) continue;
      const rawConfidence =
        typeof record.confidence === 'number' ? record.confidence : 0.5;
      const confidence = Math.max(0, Math.min(1, Number(rawConfidence)));
      const existing = dedupe.get(normalizedTag);
      if (existing === undefined || confidence > existing) {
        dedupe.set(normalizedTag, confidence);
      }
    }

    return Array.from(dedupe.entries())
      .map(([tag, confidence]) => ({ tag, confidence }))
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 8);
  }
}

export function calculateOllamaContextBudget(
  prompt: string,
  task: string,
): { num_ctx: number; num_predict: number } {
  const outputTokenBudget =
    task === 'queryClassification'
      ? 128
      : task === 'askPlutoLive'
        ? 768
        : task === 'askPluto'
          ? 192
          : task === 'askPlutoDeep'
            ? 512
            : task === 'analysisEditorial'
              ? OLLAMA_EDITORIAL_OUTPUT_TOKENS
              : task === 'terminologyReconciliation'
                ? 2048
                : task === 'knowledgeDoc' ||
                    task === 'structuredAnalysis' ||
                    task === 'summary'
                  ? 4096
                  : 2500;
  const estimatedInputTokens = Math.ceil(prompt.length / 3);
  const totalNeeded = estimatedInputTokens + outputTokenBudget;
  const maxCap =
    task === 'askPlutoLive'
      ? 8192
      : task === 'askPluto'
        ? 8192
        : task === 'askPlutoDeep'
          ? 12288
          : task === 'knowledgeDoc' || task === 'analysisEditorial'
            ? OLLAMA_EDITORIAL_CONTEXT_TOKENS
            : 16384;
  const minimumContext =
    task === 'askPlutoLive'
      ? 8192
      : task === 'askPluto' || task === 'askPlutoDeep'
        ? 4096
        : task === 'title'
          ? 8192
          : 4096;
  const num_ctx = Math.min(
    maxCap,
    Math.max(minimumContext, Math.ceil(totalNeeded / 1024) * 1024),
  );
  return { num_ctx, num_predict: outputTokenBudget };
}

export interface TranscriptWindow {
  windowIndex: number;
  startSegment: number;
  endSegment: number;
  lines: string[];
}

export function sliceTranscriptWindows(
  transcript: string,
  maxLinesPerWindow = 120,
  overlapLines = 15,
): TranscriptWindow[] {
  const allLines = transcript.split('\n').filter((l) => l.trim().length > 0);
  if (allLines.length <= maxLinesPerWindow) {
    return [
      {
        windowIndex: 0,
        startSegment: 0,
        endSegment: Math.max(0, allLines.length - 1),
        lines: allLines,
      },
    ];
  }

  const windows: TranscriptWindow[] = [];
  let start = 0;
  let idx = 0;

  while (start < allLines.length) {
    const end = Math.min(allLines.length, start + maxLinesPerWindow);
    const windowLines = allLines.slice(start, end);
    windows.push({
      windowIndex: idx,
      startSegment: start,
      endSegment: end - 1,
      lines: windowLines,
    });

    if (end >= allLines.length) break;
    start = end - overlapLines;
    idx += 1;
  }

  return windows;
}

function calculateJaccardSimilarity(strA: string, strB: string): number {
  const setA = new Set(strA.toLowerCase().match(/\w+/g) || []);
  const setB = new Set(strB.toLowerCase().match(/\w+/g) || []);
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const word of setA) {
    if (setB.has(word)) intersection += 1;
  }
  const union = new Set([...setA, ...setB]).size;
  return union > 0 ? intersection / union : 0;
}

export function deduplicateExtractedItems<T>(
  items: T[],
  getText: (item: T) => string,
  getAssignee?: (item: T) => string | undefined,
): T[] {
  if (!items || items.length === 0) return [];
  const result: T[] = [];

  for (const item of items) {
    const text = getText(item)?.trim() || '';
    if (!text) continue;

    const assignee = getAssignee
      ? getAssignee(item)?.trim().toLowerCase()
      : undefined;

    const isDuplicate = result.some((existing) => {
      const existingText = getText(existing)?.trim() || '';
      const existingAssignee = getAssignee
        ? getAssignee(existing)?.trim().toLowerCase()
        : undefined;

      if (assignee && existingAssignee && assignee !== existingAssignee) {
        return false;
      }

      const similarity = calculateJaccardSimilarity(text, existingText);
      return similarity >= 0.7;
    });

    if (!isDuplicate) {
      result.push(item);
    }
  }

  return result;
}
import { readNotesMetrics } from './meetingNotesMetrics';
import { MeetingNotesError } from './meetingNotesTypes';
