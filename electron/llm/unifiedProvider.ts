import { GoogleGenerativeAI } from '@google/generative-ai';
import { knowledgeSynthesisPause } from '../knowledgeSynthesisPause';
import {
  createSerializedTaskGate,
  isSerializedTaskPreemption,
} from '../serializedTaskGate';
import {
  analysisDocumentToMarkdown,
  fallbackAnalysisDocument,
  parseAnalysisMarkdown,
} from './analysisDocument';
import {
  fallbackAnalysisDocumentV3,
  parseAnalysisDocumentV3,
  parseRecentWinV3,
} from './analysisDocumentV3';
import {
  groundAnalysisDocument,
  normalizeTranscriptEvidence,
} from './analysisGrounding';
import type {
  ActionItemV3,
  AnalysisDocumentV3,
  AnalysisErrorCategory,
  AnalysisGenerationMetadata,
  DecisionV3,
  MeetingTerminologyArtifactV1,
  RecentWinV3,
  TopicSection,
} from './analysisTypes';
import { createOllamaGenerationDeadline } from './ollamaGenerationDeadline';
import { ollamaHttpFetch, ollamaHttpStream } from './ollamaHttpTransport';
import {
  getEntitiesPrompt,
  getSpeakerIdentityPrompt,
  getStructuredAnalysisEditorialPrompt,
  getStructuredAnalysisPrompt,
  getStructuredAnalysisRepairPrompt,
  getSummaryPrompt,
  getSummaryRepairPrompt,
  getTerminologyReconciliationPrompt,
  getTitlePrompt,
  getTopicAnalysisPrompt,
  getTopicSegmentationPrompt,
  getValueSignalsPrompt,
} from './prompts';
import type { MeetingNotesTemplate } from './prompts';
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
import {
  type TerminologyCandidate,
  aggregateTerminologyCandidates,
  buildTerminologyContextBlock,
  createTerminologyArtifact,
  discoverRepeatedTerminologyCandidates,
  getAppliedTerminologyAliases,
  parseTerminologyCandidates,
} from './terminologyReconciliation';

const OLLAMA_TIMEOUT_MS = 90_000;
const OLLAMA_ANALYSIS_TIMEOUT_MS = 5 * 60_000;
const OLLAMA_KNOWLEDGE_DOC_TIMEOUT_MS = 15 * 60_000;
const OLLAMA_GENERATION_IDLE_TIMEOUT_MS = 60_000;
const OLLAMA_ACTIVE_GENERATION_MIN_TIMEOUT_MS = 6 * 60_000;
const OLLAMA_ACTIVE_GENERATION_MAX_TIMEOUT_MS = 20 * 60_000;
const OLLAMA_DEFAULT_MODEL = 'qwen3.5:9b';
const SHORT_TRANSCRIPT_SINGLE_TOPIC_MAX_SEGMENTS = 8;
const OLLAMA_EDITORIAL_CONTEXT_TOKENS = 32_768;
const OLLAMA_EDITORIAL_OUTPUT_TOKENS = 2_048;
const CONSERVATIVE_CHARACTERS_PER_TOKEN = 1;
export const STRUCTURED_ANALYSIS_PROMPT_VERSION = 'notes-v9';

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

const mergeSettledItems = <T extends { text: string; evidence?: string }>(
  primary: T[],
  fallback: T[],
): { items: T[]; restoredCount: number } => {
  const unmatchedPrimary = new Set(primary.map((_, index) => index));
  const restored: T[] = [];
  for (const fallbackItem of fallback) {
    const fallbackEvidence = normalizeTranscriptEvidence(
      fallbackItem.evidence ?? '',
    );
    const matchingIndex = [...unmatchedPrimary].find((index) => {
      const primaryItem = primary[index];
      const primaryClaim = normalizeTranscriptEvidence(
        primaryItem.text,
      ).replace(/\b(?:proceed|move forward) with\b/g, 'use');
      const fallbackClaim = normalizeTranscriptEvidence(
        fallbackItem.text,
      ).replace(/\b(?:proceed|move forward) with\b/g, 'use');
      const sameEvidence =
        fallbackEvidence.length > 0 &&
        normalizeTranscriptEvidence(primaryItem.evidence ?? '') ===
          fallbackEvidence;
      return (
        sameEvidence &&
        calculateJaccardSimilarity(primaryClaim, fallbackClaim) >= 0.5
      );
    });
    if (matchingIndex === undefined) {
      restored.push(fallbackItem);
    } else {
      unmatchedPrimary.delete(matchingIndex);
    }
  }
  return {
    items: [...primary, ...restored],
    restoredCount: restored.length,
  };
};

const mergeEditorialWithGroundedLocal = (
  localDraft: AnalysisDocumentV3,
  editedDraft: AnalysisDocumentV3,
  transcript: string,
  terminologyAliases: Record<string, string[]> = {},
): { analysis: AnalysisDocumentV3; repairedSettledOmission: boolean } => {
  const groundedLocal = groundAnalysisDocument(localDraft, transcript, {
    terminologyAliases,
  }).analysis;
  const topics = editedDraft.topics.map((topic) => ({
    ...topic,
    key_points: [...topic.key_points],
    decisions: [...topic.decisions],
    action_items: [...topic.action_items],
    open_questions: [...topic.open_questions],
  }));
  let repairedSettledOmission = false;

  for (const localTopic of groundedLocal.topics) {
    let targetIndex = -1;
    let bestSimilarity = 0;
    for (let index = 0; index < topics.length; index += 1) {
      const similarity = calculateJaccardSimilarity(
        localTopic.title,
        `${topics[index].title} ${topics[index].summary}`,
      );
      if (similarity > bestSimilarity) {
        bestSimilarity = similarity;
        targetIndex = index;
      }
    }
    if (topics.length === 1) targetIndex = 0;
    if (targetIndex < 0 && topics.length > 0) targetIndex = 0;
    if (targetIndex < 0) continue;

    const target = topics[targetIndex];
    const mergedDecisions = mergeSettledItems(
      target.decisions,
      localTopic.decisions,
    );
    const mergedActions = mergeSettledItems(
      target.action_items,
      localTopic.action_items,
    );
    if (mergedDecisions.restoredCount > 0 || mergedActions.restoredCount > 0) {
      repairedSettledOmission = true;
    }
    target.decisions = mergedDecisions.items;
    target.action_items = mergedActions.items;
    target.key_points = mergeUniqueByKey(
      target.key_points,
      localTopic.key_points,
      (item) => normalizeTranscriptEvidence(item.text),
    );
    target.key_points = mergeUniqueByKey(
      target.key_points,
      localTopic.summary ? [{ text: localTopic.summary }] : [],
      (item) => normalizeTranscriptEvidence(item.text),
    ).slice(0, 4);
  }

  return {
    analysis: {
      ...editedDraft,
      topics,
      recent_win: editedDraft.recent_win ?? groundedLocal.recent_win,
    },
    repairedSettledOmission,
  };
};

const buildDraftFromTopics = (
  topics: TopicSection[],
  meetingType: AnalysisDocumentV3['meeting_type'] = 'general',
): AnalysisDocumentV3 => ({
  analysis_schema_version: 3,
  overview:
    topics
      .map((topic) => topic.summary)
      .filter(Boolean)
      .join(' ')
      .slice(0, 1000) || 'Conversation captured. See topics below for details.',
  topics,
  all_action_items: deduplicateExtractedItems(
    topics.flatMap((topic) => topic.action_items),
    (item) => item.text,
    (item) => item.assignee,
  ),
  all_decisions: deduplicateExtractedItems(
    topics.flatMap((topic) => topic.decisions),
    (item) => item.text,
    (item) => item.decided_by,
  ),
  meeting_type: meetingType,
  quality: {
    format_pass: true,
    retry_count: 0,
    fallback_used: false,
    issues: [],
  },
});

const editorialPromptFits = (prompt: string): boolean =>
  Math.ceil(prompt.length / CONSERVATIVE_CHARACTERS_PER_TOKEN) +
    OLLAMA_EDITORIAL_OUTPUT_TOKENS <=
  OLLAMA_EDITORIAL_CONTEXT_TOKENS;

const buildAnalysisQualityIssues = (
  categories: AnalysisErrorCategory[],
): string[] => {
  const categorySet = new Set(categories);
  const issues: string[] = [];
  if (
    [
      'editorial_input_too_large',
      'editorial_invalid_json',
      'editorial_failed',
    ].some((category) => categorySet.has(category as AnalysisErrorCategory))
  ) {
    issues.push(
      'Meeting-wide consolidation was limited by local context capacity.',
    );
  }
  if (
    [
      'unsupported_action_item',
      'unsupported_decision',
      'conflicting_rollups',
      'editorial_dropped_settled_item',
    ].some((category) => categorySet.has(category as AnalysisErrorCategory))
  ) {
    issues.push(
      'Some generated actions or decisions could not be verified against transcript evidence and were omitted.',
    );
  }
  if (
    ['terminology_invalid_json', 'terminology_failed'].some((category) =>
      categorySet.has(category as AnalysisErrorCategory),
    )
  ) {
    issues.push(
      'Terminology reconciliation was unavailable, so raw transcript wording was preserved.',
    );
  }
  return issues;
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

const compactOversizedAnalysis = (
  analysis: AnalysisDocumentV3,
): AnalysisDocumentV3 => {
  if (analysis.topics.length <= 6) return analysis;
  const topics = collapseOversizedTopics(analysis.topics);
  return {
    ...buildDraftFromTopics(topics, analysis.meeting_type),
    overview: analysis.overview,
    quality: analysis.quality,
    recent_win: analysis.recent_win,
  };
};

// The default local Ollama runtime has one generation slot. Queue every
// generation at the provider boundary so request timeouts measure model work,
// not time spent waiting behind another analysis or knowledge request.
const runWithOllamaGenerationGate = createSerializedTaskGate<symbol, string>();
let electronActiveOllamaModel: string | null = null;

type LLMTask =
  | 'summary'
  | 'summaryRepair'
  | 'structuredAnalysis'
  | 'analysisEditorial'
  | 'topicSegmentation'
  | 'terminologyReconciliation'
  | 'topicAnalysis'
  | 'speaker'
  | 'title'
  | 'entities'
  | 'valueSignals'
  | 'knowledgeDoc'
  | 'askPluto'
  | 'askPlutoDeep'
  | 'queryClassification';

const isAbortError = (error: unknown): boolean =>
  error instanceof Error &&
  (error.name === 'AbortError' || /\babort(?:ed)?\b/i.test(error.message));

const isResumableMeetingAnalysisTask = (task: LLMTask): boolean =>
  task === 'topicSegmentation' ||
  task === 'terminologyReconciliation' ||
  task === 'topicAnalysis' ||
  task === 'analysisEditorial';

export const getOllamaTimeoutMs = (task: string): number =>
  task === 'knowledgeDoc'
    ? OLLAMA_KNOWLEDGE_DOC_TIMEOUT_MS
    : task === 'structuredAnalysis' ||
        task === 'analysisEditorial' ||
        task === 'topicSegmentation' ||
        task === 'terminologyReconciliation' ||
        task === 'topicAnalysis'
      ? OLLAMA_ANALYSIS_TIMEOUT_MS
      : OLLAMA_TIMEOUT_MS;

const usesProgressAwareOllamaDeadline = (task: LLMTask): boolean =>
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
  signal?: AbortSignal;
  onStart?: () => void;
  onToken?: (delta: string) => void;
}

export class UnifiedLLMProvider implements LLMProvider {
  name: string;
  requiresApiKey: boolean;

  private openAIBaseUrl = 'https://api.openai.com/v1';
  private claudeBaseUrl = 'https://api.anthropic.com/v1';
  private ollamaBaseUrl = 'http://127.0.0.1:11434';
  private geminiClient: GoogleGenerativeAI | null = null;
  private cachedOllamaModels = new Map<string, string>();
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
    options: { signal?: AbortSignal; knownTerms?: string[] } = {},
  ): Promise<AnalysisDocumentV3> {
    if (this.providerType === 'ollama') {
      return this.generateStructuredAnalysisMultiPass(
        transcript,
        userNotes,
        template,
        options.signal,
        options.knownTerms ?? [],
      );
    }
    return this.generateStructuredAnalysisSinglePass(
      transcript,
      userNotes,
      template,
      options.signal,
    );
  }

  private async generateStructuredAnalysisSinglePass(
    transcript: string,
    userNotes?: string,
    template: MeetingNotesTemplate = 'auto',
    signal?: AbortSignal,
  ): Promise<AnalysisDocumentV3> {
    const errorCategories: AnalysisErrorCategory[] = [];

    try {
      const raw = await this.generateText({
        prompt: getStructuredAnalysisPrompt(transcript, userNotes, template),
        task: 'structuredAnalysis',
        jsonMode: true,
        signal,
      });

      let retryCount = 0;
      let parsed = parseAnalysisDocumentV3(this.cleanJsonText(raw));
      if (!parsed) {
        retryCount = 1;
        this.pushErrorCategory(errorCategories, 'invalid_json');
        try {
          const repaired = await this.generateText({
            prompt: getStructuredAnalysisRepairPrompt(
              transcript,
              raw,
              userNotes,
              template,
            ),
            task: 'structuredAnalysis',
            jsonMode: true,
            signal,
          });
          parsed = parseAnalysisDocumentV3(this.cleanJsonText(repaired));
          this.pushErrorCategory(
            errorCategories,
            parsed ? 'repair_succeeded' : 'repair_failed',
          );
        } catch (repairError) {
          console.warn(
            `[${this.name}] Structured analysis repair failed:`,
            repairError,
          );
          this.pushErrorCategory(errorCategories, 'repair_failed');
        }
      }

      if (!parsed) {
        console.warn(
          `[${this.name}] Structured analysis returned unparseable JSON, using fallback`,
        );
        return fallbackAnalysisDocumentV3(1, [
          'LLM returned unparseable JSON for v3 analysis',
        ]);
      }

      return this.finalizeStructuredAnalysis({
        analysis: compactOversizedAnalysis(parsed),
        transcript,
        retryCount,
        errorCategories,
      });
    } catch (e) {
      if (isAbortError(e)) throw e;
      console.error(`[${this.name}] Structured analysis failed:`, e);
      return fallbackAnalysisDocumentV3(1, [
        `Analysis generation failed: ${String(e)}`,
      ]);
    }
  }

  private async generateStructuredAnalysisMultiPass(
    transcript: string,
    userNotes?: string,
    template: MeetingNotesTemplate = 'auto',
    signal?: AbortSignal,
    knownTerms: string[] = [],
  ): Promise<AnalysisDocumentV3> {
    const errorCategories: AnalysisErrorCategory[] = [];
    const windows = sliceTranscriptWindows(transcript, 60, 10);
    const topics: TopicSection[] = [];
    const rawActionItems: ActionItemV3[] = [];
    const rawDecisions: DecisionV3[] = [];
    const recentWins: RecentWinV3[] = [];
    const deterministicCandidates: TerminologyCandidate[] =
      discoverRepeatedTerminologyCandidates(transcript.split(/\r?\n/));
    const discoveredCandidates: TerminologyCandidate[] = [];
    const windowPlans: Array<{
      win: (typeof windows)[number];
      topicSegments: Array<{
        title: string;
        start_segment: number;
        end_segment: number;
      }>;
    }> = [];

    for (const win of windows) {
      const winTranscript = win.lines.join('\n');
      const isShortMeeting =
        windows.length === 1 &&
        win.lines.length <= SHORT_TRANSCRIPT_SINGLE_TOPIC_MAX_SEGMENTS;
      let topicSegments: Array<{
        title: string;
        start_segment: number;
        end_segment: number;
      }> = isShortMeeting
        ? [
            {
              title: 'Meeting outcomes',
              start_segment: win.startSegment,
              end_segment: win.endSegment,
            },
          ]
        : [];
      if (!isShortMeeting) {
        try {
          const segmentationPrompt = getTopicSegmentationPrompt(winTranscript);
          const segRaw = await this.generateResumableAnalysisText({
            prompt: segmentationPrompt,
            task: 'topicSegmentation',
            jsonMode: true,
            signal,
          });
          const segParsed = JSON.parse(this.cleanJsonText(segRaw)) as Record<
            string,
            unknown
          >;
          if (Array.isArray(segParsed.topics)) {
            topicSegments = segParsed.topics
              .filter(
                (t): t is Record<string, unknown> =>
                  t !== null && typeof t === 'object',
              )
              .map((t) => ({
                title:
                  typeof t.title === 'string' ? t.title.trim() : 'Discussion',
                start_segment:
                  typeof t.start_segment === 'number'
                    ? t.start_segment + win.startSegment
                    : win.startSegment,
                end_segment:
                  typeof t.end_segment === 'number'
                    ? t.end_segment + win.startSegment
                    : win.endSegment,
              }))
              .filter((t) => t.title.length > 0);
          }
          discoveredCandidates.push(
            ...parseTerminologyCandidates(
              segParsed.terminology_candidates,
              win.lines,
              win.startSegment,
            ),
          );
        } catch (e) {
          if (isAbortError(e)) throw e;
          console.warn(
            `[${this.name}] Topic segmentation failed for window ${win.windowIndex}, using single-topic fallback:`,
            e,
          );
        }
      }

      if (topicSegments.length === 0) {
        this.pushErrorCategory(errorCategories, 'empty_topics');
        topicSegments = [
          {
            title:
              windows.length > 1
                ? `Discussion Part ${win.windowIndex + 1}`
                : 'General Discussion',
            start_segment: win.startSegment,
            end_segment: win.endSegment,
          },
        ];
      }

      const topicsByStart = topicSegments
        .map((topic) => ({
          ...topic,
          start_segment: Math.max(
            win.startSegment,
            Math.min(win.endSegment, Math.floor(topic.start_segment)),
          ),
        }))
        .sort((left, right) => left.start_segment - right.start_segment)
        .filter(
          (topic, index, topics) =>
            index === 0 ||
            topic.start_segment !== topics[index - 1].start_segment,
        );
      topicSegments = topicsByStart.map((topic, index) => {
        const nextStart = topicsByStart[index + 1]?.start_segment;
        return {
          ...topic,
          start_segment: index === 0 ? win.startSegment : topic.start_segment,
          end_segment: nextStart === undefined ? win.endSegment : nextStart - 1,
        };
      });
      windowPlans.push({ win, topicSegments });
    }

    const candidateClusters = aggregateTerminologyCandidates([
      ...discoveredCandidates,
      ...deterministicCandidates,
    ]);
    let terminologyArtifact: MeetingTerminologyArtifactV1 | undefined;
    if (candidateClusters.length > 0) {
      try {
        const raw = await this.generateResumableAnalysisText({
          prompt: getTerminologyReconciliationPrompt(
            candidateClusters,
            knownTerms,
          ),
          task: 'terminologyReconciliation',
          jsonMode: true,
          signal,
        });
        const parsed = JSON.parse(this.cleanJsonText(raw)) as Record<
          string,
          unknown
        >;
        if (!Array.isArray(parsed.proposals)) {
          this.pushErrorCategory(errorCategories, 'terminology_invalid_json');
        } else {
          terminologyArtifact = createTerminologyArtifact({
            candidates: candidateClusters,
            proposals: parsed.proposals,
            knownTerms,
            provider: this.providerType,
            model: this.resolveModelName(),
            generatedAt: new Date().toISOString(),
          });
        }
      } catch (error) {
        if (isAbortError(error)) throw error;
        console.warn('[Analysis] Terminology reconciliation failed safely');
        this.pushErrorCategory(errorCategories, 'terminology_failed');
      }
    }
    const terminologyContext = terminologyArtifact
      ? buildTerminologyContextBlock(terminologyArtifact)
      : '';

    for (const { win, topicSegments } of windowPlans) {
      for (const segment of topicSegments) {
        const lastLineIndex = Math.max(0, win.lines.length - 1);
        const requestedStart = Math.floor(
          segment.start_segment - win.startSegment,
        );
        const requestedEnd = Math.floor(segment.end_segment - win.startSegment);
        const relativeStart = Math.max(
          0,
          Math.min(lastLineIndex, Math.min(requestedStart, requestedEnd)),
        );
        const relativeEnd = Math.max(
          relativeStart,
          Math.min(lastLineIndex, Math.max(requestedStart, requestedEnd)),
        );
        const slice = win.lines
          .slice(relativeStart, relativeEnd + 1)
          .join('\n');
        if (!slice.trim()) continue;

        try {
          const topicPrompt = getTopicAnalysisPrompt(
            segment.title,
            slice,
            userNotes,
            template,
            terminologyContext,
          );
          const topicRaw = await this.generateResumableAnalysisText({
            prompt: topicPrompt,
            task: 'topicAnalysis',
            jsonMode: true,
            signal,
          });
          const topicParsed = JSON.parse(
            this.cleanJsonText(topicRaw),
          ) as Record<string, unknown>;
          const analyzedTitle =
            typeof topicParsed.title === 'string' && topicParsed.title.trim()
              ? topicParsed.title.trim()
              : segment.title;

          const key_points = Array.isArray(topicParsed.key_points)
            ? topicParsed.key_points
                .filter(
                  (p): p is Record<string, unknown> =>
                    p !== null && typeof p === 'object',
                )
                .map((p) => ({
                  text: typeof p.text === 'string' ? p.text.trim() : '',
                  speaker:
                    typeof p.speaker === 'string'
                      ? p.speaker.trim() || undefined
                      : undefined,
                  from_user_notes:
                    p.from_user_notes === true ? true : undefined,
                }))
                .filter((p) => p.text.length > 0)
                .slice(0, 4)
            : [];

          const decisions = Array.isArray(topicParsed.decisions)
            ? topicParsed.decisions
                .filter(
                  (d): d is Record<string, unknown> =>
                    d !== null && typeof d === 'object',
                )
                .map((d) => ({
                  text: typeof d.text === 'string' ? d.text.trim() : '',
                  decided_by:
                    typeof d.decided_by === 'string'
                      ? d.decided_by.trim() || undefined
                      : undefined,
                  rationale:
                    typeof d.rationale === 'string'
                      ? d.rationale.trim() || undefined
                      : undefined,
                  evidence:
                    typeof d.evidence === 'string'
                      ? d.evidence.trim() || undefined
                      : undefined,
                }))
                .filter((d) => d.text.length > 0)
            : [];

          const action_items = Array.isArray(topicParsed.action_items)
            ? topicParsed.action_items
                .filter(
                  (a): a is Record<string, unknown> =>
                    a !== null && typeof a === 'object',
                )
                .map((a) => ({
                  text: typeof a.text === 'string' ? a.text.trim() : '',
                  assignee:
                    typeof a.assignee === 'string'
                      ? a.assignee.trim() || undefined
                      : undefined,
                  due:
                    typeof a.due === 'string'
                      ? a.due.trim() || undefined
                      : undefined,
                  evidence:
                    typeof a.evidence === 'string'
                      ? a.evidence.trim() || undefined
                      : undefined,
                  topic: analyzedTitle,
                }))
                .filter((a) => a.text.length > 0)
            : [];

          const open_questions = Array.isArray(topicParsed.open_questions)
            ? topicParsed.open_questions.filter(
                (q): q is string =>
                  typeof q === 'string' && q.trim().length > 0,
              )
            : [];

          const recentWin = parseRecentWinV3(topicParsed.recent_win);
          if (recentWin) recentWins.push(recentWin);

          topics.push({
            title: analyzedTitle,
            summary:
              typeof topicParsed.summary === 'string'
                ? topicParsed.summary.trim()
                : '',
            key_points,
            decisions,
            action_items,
            open_questions,
            transcript_range: [segment.start_segment, segment.end_segment],
          });

          rawActionItems.push(...action_items);
          rawDecisions.push(...decisions);
        } catch (e) {
          if (isAbortError(e)) throw e;
          console.warn(
            `[${this.name}] Per-topic analysis failed for "${segment.title}":`,
            e,
          );
        }
      }
    }

    if (topics.length === 0) {
      return fallbackAnalysisDocumentV3(1, [
        'All per-topic analysis passes failed',
      ]);
    }

    const allDecisions = deduplicateExtractedItems(
      rawDecisions,
      (d) => d.text,
      (d) => d.decided_by,
    );
    const allActionItems = deduplicateExtractedItems(
      rawActionItems,
      (a) => a.text,
      (a) => a.assignee,
    );

    const draftTopics = deduplicateExtractedItems(
      topics,
      (topic) => topic.title,
    );
    const localDraft = buildDraftFromTopics(draftTopics);
    localDraft.all_action_items = allActionItems;
    localDraft.all_decisions = allDecisions;
    localDraft.recent_win = recentWins[0];
    let finalDraft = localDraft;
    if (draftTopics.length > 1) {
      try {
        const draftContext = JSON.stringify({
          overview: localDraft.overview,
          topics: localDraft.topics,
          meeting_type: localDraft.meeting_type,
        });
        const editorialPrompt = getStructuredAnalysisEditorialPrompt(
          transcript,
          draftContext,
          userNotes,
          template,
          terminologyContext,
        );
        if (!editorialPromptFits(editorialPrompt)) {
          this.pushErrorCategory(errorCategories, 'editorial_input_too_large');
          const collapsedTopics = collapseOversizedTopics(localDraft.topics);
          finalDraft = buildDraftFromTopics(
            collapsedTopics,
            localDraft.meeting_type,
          );
          finalDraft.overview = collapsedTopics
            .slice(0, 3)
            .map((topic) => topic.summary)
            .join(' ')
            .slice(0, 600);
        } else {
          const edited = await this.generateEditorialDocument(
            editorialPrompt,
            signal,
          );
          if (edited) {
            const merged = mergeEditorialWithGroundedLocal(
              localDraft,
              edited,
              transcript,
              terminologyArtifact
                ? getAppliedTerminologyAliases(terminologyArtifact)
                : {},
            );
            finalDraft = merged.analysis;
            if (merged.repairedSettledOmission) {
              this.pushErrorCategory(
                errorCategories,
                'editorial_dropped_settled_item',
              );
            }
          } else {
            this.pushErrorCategory(errorCategories, 'editorial_invalid_json');
          }
        }
      } catch (error) {
        if (signal?.aborted) throw error;
        console.warn('[Analysis] Global editorial synthesis failed:', error);
        this.pushErrorCategory(errorCategories, 'editorial_failed');
      }
    }

    finalDraft.recent_win ??= localDraft.recent_win;

    finalDraft = compactOversizedAnalysis(finalDraft);

    return this.finalizeStructuredAnalysis({
      analysis: finalDraft,
      transcript,
      retryCount: 0,
      errorCategories,
      terminologyArtifact,
    });
  }

  private async generateEditorialDocument(
    prompt: string,
    signal?: AbortSignal,
  ): Promise<AnalysisDocumentV3 | null> {
    const raw = await this.generateResumableAnalysisText({
      prompt,
      task: 'analysisEditorial',
      jsonMode: true,
      signal,
    });
    const edited = parseAnalysisDocumentV3(this.cleanJsonText(raw));
    if (
      !edited ||
      edited.topics.length === 0 ||
      !edited.overview.trim() ||
      edited.topics.some((topic) => !topic.summary.trim())
    ) {
      return null;
    }
    return edited;
  }

  private finalizeStructuredAnalysis(params: {
    analysis: AnalysisDocumentV3;
    transcript: string;
    retryCount: number;
    errorCategories: AnalysisErrorCategory[];
    terminologyArtifact?: MeetingTerminologyArtifactV1;
  }): AnalysisDocumentV3 {
    const grounded = this.applyTranscriptGrounding(
      params.analysis,
      params.transcript,
      params.errorCategories,
      params.terminologyArtifact,
    );
    return {
      ...grounded,
      quality: {
        ...grounded.quality,
        format_pass: true,
        retry_count: params.retryCount,
        fallback_used: false,
        issues: [
          ...new Set([
            ...grounded.quality.issues,
            ...buildAnalysisQualityIssues(params.errorCategories),
          ]),
        ],
      },
      generation_metadata: this.buildAnalysisMetadata(
        params.errorCategories,
        params.terminologyArtifact,
      ),
    };
  }

  private applyTranscriptGrounding(
    analysis: AnalysisDocumentV3,
    transcript: string,
    errorCategories: AnalysisErrorCategory[],
    terminologyArtifact?: MeetingTerminologyArtifactV1,
  ): AnalysisDocumentV3 {
    const grounded = groundAnalysisDocument(analysis, transcript, {
      terminologyAliases: terminologyArtifact
        ? getAppliedTerminologyAliases(terminologyArtifact)
        : {},
    });
    for (const category of grounded.errorCategories) {
      this.pushErrorCategory(errorCategories, category);
    }

    if (
      JSON.stringify(analysis.all_action_items) !==
        JSON.stringify(grounded.analysis.all_action_items) ||
      JSON.stringify(analysis.all_decisions) !==
        JSON.stringify(grounded.analysis.all_decisions)
    ) {
      this.pushErrorCategory(errorCategories, 'conflicting_rollups');
    }

    if (grounded.analysis.topics.length === 0) {
      this.pushErrorCategory(errorCategories, 'empty_topics');
    } else {
      const coveredTopics = grounded.analysis.topics.filter(
        (topic) => topic.summary.trim().length > 0,
      );
      if (
        coveredTopics.length <
        Math.max(1, Math.ceil(grounded.analysis.topics.length / 2))
      ) {
        this.pushErrorCategory(errorCategories, 'low_topic_coverage');
      }
    }

    return {
      ...grounded.analysis,
    };
  }

  private buildAnalysisMetadata(
    errorCategories: AnalysisErrorCategory[],
    terminologyArtifact?: MeetingTerminologyArtifactV1,
  ): AnalysisGenerationMetadata {
    return {
      provider: this.providerType,
      model: this.resolveModelName(),
      generation_path:
        this.providerType === 'ollama' ? 'multi_pass' : 'single_pass',
      prompt_version: STRUCTURED_ANALYSIS_PROMPT_VERSION,
      generated_at: new Date().toISOString(),
      error_categories: [...new Set(errorCategories)],
      ...(terminologyArtifact ? { terminology: terminologyArtifact } : {}),
      ...(this.providerType === 'ollama'
        ? {
            generation_options: {
              structured_thinking:
                this.settings.ollama_structured_thinking ?? false,
              ...(Number.isSafeInteger(this.settings.ollama_seed)
                ? { seed: this.settings.ollama_seed }
                : {}),
            },
          }
        : {}),
    };
  }

  private resolveModelName(): string {
    if (this.providerType === 'openai') {
      return this.settings.openai_model || 'gpt-4o-mini';
    }
    if (this.providerType === 'claude') {
      return this.settings.claude_model || 'claude-3-haiku-20240307';
    }
    if (this.providerType === 'gemini') {
      return this.settings.gemini_model || 'gemini-1.5-flash';
    }
    return (
      this.settings.ollama_model ||
      this.settings.llm_model ||
      this.cachedOllamaModels.get(OLLAMA_DEFAULT_MODEL) ||
      OLLAMA_DEFAULT_MODEL
    );
  }

  private pushErrorCategory(
    categories: AnalysisErrorCategory[],
    category: AnalysisErrorCategory,
  ): void {
    if (!categories.includes(category)) {
      categories.push(category);
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
    options: { signal?: AbortSignal } = {},
  ): Promise<InternalSignalDocument> {
    const prompt = getValueSignalsPrompt(transcript, summary);

    try {
      const raw = await this.generateText({
        prompt,
        task: 'valueSignals',
        jsonMode: true,
        signal: options.signal,
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
      console.error(`[${this.name}] Failed to extract internal signals:`, e);
      return this.emptyInternalSignals();
    }
  }

  async extractValueSignals(
    transcript: string,
    summary?: string,
    options: { signal?: AbortSignal } = {},
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
    options: { signal?: AbortSignal } = {},
  ): Promise<string> {
    return this.generateText({
      prompt,
      task: 'knowledgeDoc',
      jsonMode: true,
      signal: options.signal,
    });
  }

  async answerAskPluto(
    prompt: string,
    options: {
      signal?: AbortSignal;
      mode?: 'fast' | 'deep';
      onStart?: () => void;
      onToken?: (delta: string) => void;
    } = {},
  ): Promise<string> {
    return this.generateText({
      prompt,
      task: options.mode === 'deep' ? 'askPlutoDeep' : 'askPluto',
      signal: options.signal,
      onStart: options.onStart,
      onToken: options.onToken,
    });
  }

  async classifyQueryIntent(
    prompt: string,
    options: { signal?: AbortSignal } = {},
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
  ): Promise<ExtractedEntities> {
    const prompt = getEntitiesPrompt(transcript, context);

    try {
      const raw = await this.generateText({
        prompt,
        task: 'entities',
        jsonMode: true,
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
      console.error(`[${this.name}] Failed to extract entities:`, e);
      return this.emptyEntities();
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
    const isBackground = options.task === 'knowledgeDoc';
    if (!isBackground) {
      knowledgeSynthesisPause.acquire('llm_active');
    }

    try {
      options.signal?.throwIfAborted();
      let result: string;
      switch (this.providerType) {
        case 'openai':
          options.onStart?.();
          result = await this.generateWithOpenAI(options);
          break;
        case 'claude':
          options.onStart?.();
          result = await this.generateWithClaude(options);
          break;
        case 'gemini':
          options.onStart?.();
          result = await this.generateWithGemini(options);
          break;
        case 'ollama':
          result = await runWithOllamaGenerationGate(
            Symbol(options.task),
            async (gateSignal) => {
              options.onStart?.();
              return this.generateWithOllama({
                ...options,
                signal: options.signal
                  ? AbortSignal.any([options.signal, gateSignal])
                  : gateSignal,
              });
            },
            options.task === 'knowledgeDoc'
              ? 0
              : options.task === 'askPluto' || options.task === 'askPlutoDeep'
                ? 20
                : 10,
            {
              preemptible:
                options.task === 'knowledgeDoc' ||
                options.task === 'title' ||
                isResumableMeetingAnalysisTask(options.task),
            },
          );
          break;
        default:
          throw new Error(`Unsupported provider: ${this.providerType}`);
      }
      options.signal?.throwIfAborted();
      return result;
    } finally {
      if (!isBackground) {
        knowledgeSynthesisPause.release('llm_active');
      }
    }
  }

  private async generateResumableAnalysisText(
    options: TextGenerationOptions,
  ): Promise<string> {
    while (true) {
      try {
        return await this.generateText(options);
      } catch (error) {
        if (!isSerializedTaskPreemption(error) || options.signal?.aborted) {
          throw error;
        }
      }
    }
  }

  private async generateWithOpenAI({
    prompt,
    task,
    jsonMode,
    signal,
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
    };

    if (jsonMode) {
      body.response_format = { type: 'json_object' };
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
      throw new Error(`OpenAI API error: ${response.statusText}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content ?? '';
  }

  private async generateWithClaude({
    prompt,
    task,
    signal,
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
        max_tokens: this.getClaudeMaxTokens(task),
        messages: [{ role: 'user', content: prompt }],
      }),
      signal,
    });

    if (!response.ok) {
      throw new Error(`Claude API error: ${response.statusText}`);
    }

    const data = await response.json();
    return data.content?.[0]?.text ?? '';
  }

  private async generateWithGemini({
    prompt,
    jsonMode,
  }: TextGenerationOptions): Promise<string> {
    const client = this.getGeminiClient();
    const modelName = this.settings.gemini_model || 'gemini-1.5-flash';

    const model = client.getGenerativeModel(
      jsonMode
        ? {
            model: modelName,
            generationConfig: { responseMimeType: 'application/json' },
          }
        : { model: modelName },
    );

    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text();
  }

  private async generateWithOllama({
    prompt,
    task,
    jsonMode,
    signal,
    onToken,
  }: TextGenerationOptions): Promise<string> {
    const model = await this.resolveOllamaModel(task);
    const activeModel = process.versions.electron
      ? electronActiveOllamaModel
      : this.activeOllamaModel;
    if (activeModel && activeModel !== model) {
      await this.unloadOllamaModel(activeModel);
    }
    this.activeOllamaModel = model;
    if (process.versions.electron) electronActiveOllamaModel = model;
    const { num_ctx, num_predict } = calculateOllamaContextBudget(prompt, task);
    const progressAware = usesProgressAwareOllamaDeadline(task);
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
      requestBody.format = 'json';
      requestBody.think = this.settings.ollama_structured_thinking ?? false;
    }
    if (task === 'queryClassification') requestBody.think = false;
    if (task === 'askPluto') requestBody.think = false;
    if (task === 'askPlutoDeep') {
      requestBody.think = false;
      const options = requestBody.options as Record<string, unknown>;
      options.top_k = 40;
      options.top_p = 1;
    }
    if (Number.isSafeInteger(this.settings.ollama_seed)) {
      (requestBody.options as Record<string, unknown>).seed =
        this.settings.ollama_seed;
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
          const packet = JSON.parse(line) as { response?: unknown };
          if (typeof packet.response !== 'string' || !packet.response) continue;
          answer += packet.response;
          onToken?.(packet.response);
        }
      };
      try {
        const response = await this.ollamaStream(
          '/api/generate',
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
        if (pending.trim()) consumeChunk(`${pending}\n`);
        if (!response.ok) {
          throw new Error(`Ollama API error: ${response.statusText}`);
        }
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
    const configuredFastModel = (this.settings.ollama_fast_model || '').trim();
    if (task === 'askPluto' && configuredFastModel) {
      return configuredFastModel;
    }
    const configuredModel = (
      this.settings.ollama_model ||
      this.settings.llm_model ||
      ''
    ).trim();
    if (configuredModel) {
      return configuredModel;
    }

    const cachedModel = this.cachedOllamaModels.get(OLLAMA_DEFAULT_MODEL);
    if (cachedModel) {
      return cachedModel;
    }

    try {
      const response = await this.ollamaFetch('/api/tags');
      if (!response.ok) {
        return OLLAMA_DEFAULT_MODEL;
      }
      const data = await response.json();
      const models: string[] = Array.isArray(data.models)
        ? data.models
            .map((item: { name?: string }) => item?.name)
            .filter(
              (value: unknown): value is string =>
                typeof value === 'string' && value.length > 0,
            )
        : [];

      if (models.length > 0) {
        const defaultCandidate = models.find(
          (name) =>
            name === OLLAMA_DEFAULT_MODEL ||
            name.startsWith(`${OLLAMA_DEFAULT_MODEL}:`),
        );
        if (defaultCandidate) {
          this.cachedOllamaModels.set(OLLAMA_DEFAULT_MODEL, defaultCandidate);
          return defaultCandidate;
        }

        // Avoid obvious embedding-only models for text generation tasks.
        const nonEmbeddingCandidate = models.find(
          (name) =>
            !/(^|[-_:])(embed|embedding|bge|e5|gte)([-_:]|$)/i.test(name),
        );
        if (nonEmbeddingCandidate) {
          this.cachedOllamaModels.set(
            OLLAMA_DEFAULT_MODEL,
            nonEmbeddingCandidate,
          );
          return nonEmbeddingCandidate;
        }

        this.cachedOllamaModels.set(OLLAMA_DEFAULT_MODEL, models[0]);
        return models[0];
      }
    } catch (e) {
      console.warn('[Ollama] Failed to auto-detect model, using default:', e);
    }

    return OLLAMA_DEFAULT_MODEL;
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
  ): Promise<{ ok: boolean; status: number; statusText: string }> {
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
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      onChunk(decoder.decode(value, { stream: true }));
    }
    const tail = decoder.decode();
    if (tail) onChunk(tail);
    return response;
  }

  private getSystemInstruction(task: LLMTask): string {
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
    if (task === 'askPluto' || task === 'askPlutoDeep') {
      return 'You are an intelligent meeting assistant.';
    }
    if (task === 'queryClassification') {
      return 'You are an exact expert intent classifier. Reply with valid JSON only.';
    }
    return 'You are an intelligent meeting assistant.';
  }

  private getTemperature(task: LLMTask): number {
    if (task === 'analysisEditorial') return 0.1;
    if (task === 'structuredAnalysis') return 0.7;
    if (task === 'topicSegmentation') return 0.1;
    if (task === 'terminologyReconciliation') return 0;
    if (task === 'topicAnalysis') return 0.1;
    if (task === 'summary') return 0.7;
    if (task === 'summaryRepair') return 0.2;
    if (task === 'valueSignals') return 0.2;
    if (task === 'knowledgeDoc') return 0.2;
    if (task === 'title') return 0.5;
    if (task === 'askPluto' || task === 'askPlutoDeep') return 0.2;
    if (task === 'queryClassification') return 0.1;
    return 0.3;
  }

  private getClaudeMaxTokens(task: LLMTask): number {
    if (task === 'analysisEditorial') return OLLAMA_EDITORIAL_OUTPUT_TOKENS;
    if (task === 'structuredAnalysis') return 4096;
    if (task === 'topicSegmentation') return 512;
    if (task === 'terminologyReconciliation') return 2048;
    if (task === 'topicAnalysis') return 2048;
    if (task === 'summary') return 1024;
    if (task === 'summaryRepair') return 1024;
    if (task === 'entities') return 2048;
    if (task === 'valueSignals') return 512;
    if (task === 'knowledgeDoc') return 4096;
    if (task === 'askPluto') return 1024;
    if (task === 'askPlutoDeep') return 2048;
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

  private emptyEntities(): ExtractedEntities {
    return {
      people: [],
      topics: [],
      action_items: [],
      decisions: [],
      projects: [],
      relationships: [],
    };
  }

  private emptyInternalSignals(): InternalSignalDocument {
    return {
      analysis_schema_version: 2,
      continuity: [],
      accountability_risks: [],
      decision_impacts: [],
      extra_tags: [],
    };
  }
}

export function calculateOllamaContextBudget(
  prompt: string,
  task: string,
): { num_ctx: number; num_predict: number } {
  const outputTokenBudget =
    task === 'queryClassification'
      ? 128
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
    task === 'askPluto'
      ? 8192
      : task === 'askPlutoDeep'
        ? 12288
        : task === 'knowledgeDoc' || task === 'analysisEditorial'
          ? OLLAMA_EDITORIAL_CONTEXT_TOKENS
          : 16384;
  const minimumContext =
    task === 'askPluto' || task === 'askPlutoDeep'
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
