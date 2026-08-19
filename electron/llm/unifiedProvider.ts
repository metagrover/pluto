import { GoogleGenerativeAI } from '@google/generative-ai';
import { createSerializedTaskGate } from '../serializedTaskGate';
import {
  analysisDocumentToMarkdown,
  fallbackAnalysisDocument,
  parseAnalysisMarkdown,
} from './analysisDocument';
import {
  fallbackAnalysisDocumentV3,
  parseAnalysisDocumentV3,
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
  TopicSection,
} from './analysisTypes';
import { ollamaHttpFetch } from './ollamaHttpTransport';
import {
  getEntitiesPrompt,
  getSpeakerIdentityPrompt,
  getStructuredAnalysisEditorialPrompt,
  getStructuredAnalysisPrompt,
  getStructuredAnalysisRepairPrompt,
  getSummaryPrompt,
  getSummaryRepairPrompt,
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

const OLLAMA_TIMEOUT_MS = 90_000;
const OLLAMA_KNOWLEDGE_DOC_TIMEOUT_MS = 900_000; // 15 minutes (CPU generation can be slow)
const OLLAMA_DEFAULT_MODEL = 'qwen3.5:9b';
const SHORT_TRANSCRIPT_SINGLE_TOPIC_MAX_SEGMENTS = 8;
const OLLAMA_EDITORIAL_CONTEXT_TOKENS = 32_768;
const OLLAMA_EDITORIAL_OUTPUT_TOKENS = 2_048;
const CONSERVATIVE_CHARACTERS_PER_TOKEN = 1;
export const STRUCTURED_ANALYSIS_PROMPT_VERSION = 'notes-v7';

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
): { analysis: AnalysisDocumentV3; repairedSettledOmission: boolean } => {
  const groundedLocal = groundAnalysisDocument(localDraft, transcript).analysis;
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
    target.key_points = mergeUniqueByKey(
      target.key_points,
      localTopic.key_points,
      (item) => normalizeTranscriptEvidence(item.text),
    );
    target.decisions = mergedDecisions.items;
    target.action_items = mergedActions.items;
    target.key_points = mergeUniqueByKey(
      target.key_points,
      localTopic.summary ? [{ text: localTopic.summary }] : [],
      (item) => normalizeTranscriptEvidence(item.text),
    );
  }

  return {
    analysis: { ...editedDraft, topics },
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

const HOUSEKEEPING_TOPIC =
  /\b(screen shar(?:e|ing)|introductions?|repository links?|link sharing|tool mechanics?)\b/i;

const collapseOversizedTopics = (
  topics: TopicSection[],
  maxTopics = 6,
): TopicSection[] => {
  if (topics.length <= maxTopics) return topics;
  const clusters = topics.map((topic, index) => ({ topics: [topic], index }));

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
        .filter(Boolean)
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
      const ranges = cluster.topics
        .map((topic) => topic.transcript_range)
        .filter((range): range is [number, number] => Boolean(range));
      return {
        ...representative,
        summary: summary || representative.summary,
        key_points: mergeUniqueByKey(
          [],
          retainedTopics.flatMap((topic) => topic.key_points),
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

// The default local Ollama runtime has one generation slot. Queue every
// generation at the provider boundary so request timeouts measure model work,
// not time spent waiting behind another analysis or knowledge request.
const runWithOllamaGenerationGate = createSerializedTaskGate<symbol, string>();

type LLMTask =
  | 'summary'
  | 'summaryRepair'
  | 'structuredAnalysis'
  | 'analysisEditorial'
  | 'topicSegmentation'
  | 'topicAnalysis'
  | 'speaker'
  | 'title'
  | 'entities'
  | 'valueSignals'
  | 'knowledgeDoc'
  | 'askPluto'
  | 'queryClassification';

const isAbortError = (error: unknown): boolean =>
  error instanceof Error &&
  (error.name === 'AbortError' || /\babort(?:ed)?\b/i.test(error.message));

export const getOllamaTimeoutMs = (task: string): number =>
  task === 'knowledgeDoc' ? OLLAMA_KNOWLEDGE_DOC_TIMEOUT_MS : OLLAMA_TIMEOUT_MS;

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
}

export class UnifiedLLMProvider implements LLMProvider {
  name: string;
  requiresApiKey: boolean;

  private openAIBaseUrl = 'https://api.openai.com/v1';
  private claudeBaseUrl = 'https://api.anthropic.com/v1';
  private ollamaBaseUrl = 'http://127.0.0.1:11434';
  private geminiClient: GoogleGenerativeAI | null = null;
  private cachedOllamaModels = new Map<string, string>();

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
  ): Promise<AnalysisDocumentV3> {
    if (this.providerType === 'ollama') {
      return this.generateStructuredAnalysisMultiPass(
        transcript,
        userNotes,
        template,
      );
    }
    return this.generateStructuredAnalysisSinglePass(
      transcript,
      userNotes,
      template,
    );
  }

  private async generateStructuredAnalysisSinglePass(
    transcript: string,
    userNotes?: string,
    template: MeetingNotesTemplate = 'auto',
  ): Promise<AnalysisDocumentV3> {
    const errorCategories: AnalysisErrorCategory[] = [];

    try {
      const raw = await this.generateText({
        prompt: getStructuredAnalysisPrompt(transcript, userNotes, template),
        task: 'structuredAnalysis',
        jsonMode: true,
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
        analysis: parsed,
        transcript,
        retryCount,
        errorCategories,
      });
    } catch (e) {
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
  ): Promise<AnalysisDocumentV3> {
    const errorCategories: AnalysisErrorCategory[] = [];
    const windows = sliceTranscriptWindows(transcript, 120, 15);
    const topics: TopicSection[] = [];
    const rawActionItems: ActionItemV3[] = [];
    const rawDecisions: DecisionV3[] = [];

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
          const segRaw = await this.generateText({
            prompt: segmentationPrompt,
            task: 'topicSegmentation',
            jsonMode: true,
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
          );
          const topicRaw = await this.generateText({
            prompt: topicPrompt,
            task: 'topicAnalysis',
            jsonMode: true,
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
          const edited = await this.generateEditorialDocument(editorialPrompt);
          if (edited) {
            const merged = mergeEditorialWithGroundedLocal(
              localDraft,
              edited,
              transcript,
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
        console.warn('[Analysis] Global editorial synthesis failed:', error);
        this.pushErrorCategory(errorCategories, 'editorial_failed');
      }
    }

    return this.finalizeStructuredAnalysis({
      analysis: finalDraft,
      transcript,
      retryCount: 0,
      errorCategories,
    });
  }

  private async generateEditorialDocument(
    prompt: string,
  ): Promise<AnalysisDocumentV3 | null> {
    const raw = await this.generateText({
      prompt,
      task: 'analysisEditorial',
      jsonMode: true,
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
  }): AnalysisDocumentV3 {
    const grounded = this.applyTranscriptGrounding(
      params.analysis,
      params.transcript,
      params.errorCategories,
    );
    return {
      ...grounded,
      quality: {
        ...grounded.quality,
        format_pass: true,
        retry_count: params.retryCount,
        fallback_used: false,
      },
      generation_metadata: this.buildAnalysisMetadata(params.errorCategories),
    };
  }

  private applyTranscriptGrounding(
    analysis: AnalysisDocumentV3,
    transcript: string,
    errorCategories: AnalysisErrorCategory[],
  ): AnalysisDocumentV3 {
    const grounded = groundAnalysisDocument(analysis, transcript);
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
  ): AnalysisGenerationMetadata {
    return {
      provider: this.providerType,
      model: this.resolveModelName(),
      generation_path:
        this.providerType === 'ollama' ? 'multi_pass' : 'single_pass',
      prompt_version: STRUCTURED_ANALYSIS_PROMPT_VERSION,
      generated_at: new Date().toISOString(),
      error_categories: [...new Set(errorCategories)],
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
  ): Promise<InternalSignalDocument> {
    const prompt = getValueSignalsPrompt(transcript, summary);

    try {
      const raw = await this.generateText({
        prompt,
        task: 'valueSignals',
        jsonMode: true,
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
      console.error(`[${this.name}] Failed to extract internal signals:`, e);
      return this.emptyInternalSignals();
    }
  }

  async extractValueSignals(
    transcript: string,
    summary?: string,
  ): Promise<InternalSignalDocument> {
    return this.extractInternalSignals(transcript, summary);
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
      const title = (await this.generateText({ prompt, task: 'title' }))
        .trim()
        .replace(/["']/g, '')
        .replace(/^title\s*:\s*/i, '')
        .trim();
      if (title && title.length < 100) {
        return title;
      }
      return 'Meeting';
    } catch (e) {
      console.error(`[${this.name}] Failed to generate title:`, e);
      return 'Meeting';
    }
  }

  async synthesizeKnowledgeDocument(prompt: string): Promise<string> {
    return this.generateText({
      prompt,
      task: 'knowledgeDoc',
      jsonMode: true,
    });
  }

  async answerAskPluto(prompt: string): Promise<string> {
    return this.generateText({
      prompt,
      task: 'askPluto',
    });
  }

  async classifyQueryIntent(prompt: string): Promise<string> {
    return this.generateText({
      prompt,
      task: 'queryClassification',
      jsonMode: true,
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
    switch (this.providerType) {
      case 'openai':
        return this.generateWithOpenAI(options);
      case 'claude':
        return this.generateWithClaude(options);
      case 'gemini':
        return this.generateWithGemini(options);
      case 'ollama':
        return runWithOllamaGenerationGate(
          Symbol(options.task),
          async () => this.generateWithOllama(options),
          options.task === 'knowledgeDoc'
            ? 0
            : options.task === 'askPluto'
              ? 20
              : 10,
        );
      default:
        throw new Error(`Unsupported provider: ${this.providerType}`);
    }
  }

  private async generateWithOpenAI({
    prompt,
    task,
    jsonMode,
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
  }: TextGenerationOptions): Promise<string> {
    const model = await this.resolveOllamaModel();
    const { num_ctx, num_predict } = calculateOllamaContextBudget(prompt, task);

    const requestBody: Record<string, unknown> = {
      model,
      prompt,
      stream: false,
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

    const response = await this.ollamaFetch(
      '/api/generate',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      },
      getOllamaTimeoutMs(task),
    );

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

  private getGeminiClient(): GoogleGenerativeAI {
    if (!this.settings.gemini_api_key) {
      throw new Error('Gemini API key not configured');
    }
    if (!this.geminiClient) {
      this.geminiClient = new GoogleGenerativeAI(this.settings.gemini_api_key);
    }
    return this.geminiClient;
  }

  private async resolveOllamaModel(): Promise<string> {
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
  ): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

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
    }
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
      return 'You are a helpful assistant that generates concise meeting titles.';
    }
    if (task === 'speaker') {
      return 'You are a helpful assistant that extracts speaker information.';
    }
    if (task === 'askPluto') {
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
    if (task === 'topicAnalysis') return 0.1;
    if (task === 'summary') return 0.7;
    if (task === 'summaryRepair') return 0.2;
    if (task === 'valueSignals') return 0.2;
    if (task === 'knowledgeDoc') return 0.2;
    if (task === 'title') return 0.5;
    if (task === 'askPluto') return 0.4;
    if (task === 'queryClassification') return 0.1;
    return 0.3;
  }

  private getClaudeMaxTokens(task: LLMTask): number {
    if (task === 'analysisEditorial') return OLLAMA_EDITORIAL_OUTPUT_TOKENS;
    if (task === 'structuredAnalysis') return 4096;
    if (task === 'topicSegmentation') return 512;
    if (task === 'topicAnalysis') return 2048;
    if (task === 'summary') return 1024;
    if (task === 'summaryRepair') return 1024;
    if (task === 'entities') return 2048;
    if (task === 'valueSignals') return 512;
    if (task === 'knowledgeDoc') return 4096;
    if (task === 'askPluto') return 2048;
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
    task === 'analysisEditorial'
      ? OLLAMA_EDITORIAL_OUTPUT_TOKENS
      : task === 'knowledgeDoc' ||
          task === 'structuredAnalysis' ||
          task === 'summary'
        ? 4096
        : 2500;
  const estimatedInputTokens = Math.ceil(prompt.length / 3);
  const totalNeeded = estimatedInputTokens + outputTokenBudget;
  const maxCap =
    task === 'knowledgeDoc' || task === 'analysisEditorial'
      ? OLLAMA_EDITORIAL_CONTEXT_TOKENS
      : 16384;
  const num_ctx = Math.min(
    maxCap,
    Math.max(4096, Math.ceil(totalNeeded / 1024) * 1024),
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
