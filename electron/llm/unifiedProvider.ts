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
  getFollowUpDraftsPrompt,
  getSpeakerIdentityPrompt,
  getStructuredAnalysisPrompt,
  getStructuredAnalysisRepairPrompt,
  getSummaryPrompt,
  getSummaryRepairPrompt,
  getTitlePrompt,
  getTopicAnalysisPrompt,
  getTopicSegmentationPrompt,
  getValueSignalsPrompt,
} from './prompts';
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

const OLLAMA_TIMEOUT_MS = 120_000;
const OLLAMA_KNOWLEDGE_DOC_TIMEOUT_MS = 900_000; // 15 minutes (CPU generation can be slow)
const OLLAMA_DEFAULT_MODEL = 'phi4-mini:3.8b';
const STRUCTURED_ANALYSIS_PROMPT_VERSION = 'notes-v4';

// The default local Ollama runtime has one generation slot. Queue every
// generation at the provider boundary so request timeouts measure model work,
// not time spent waiting behind another analysis or knowledge request.
const runWithOllamaGenerationGate = createSerializedTaskGate<symbol, string>();

type LLMTask =
  | 'summary'
  | 'summaryRepair'
  | 'structuredAnalysis'
  | 'topicSegmentation'
  | 'topicAnalysis'
  | 'speaker'
  | 'title'
  | 'entities'
  | 'valueSignals'
  | 'knowledgeDoc'
  | 'askPluto'
  | 'queryClassification'
  | 'followUps';

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
  private cachedOllamaModel: string | null = null;

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
  ): Promise<AnalysisDocumentV3> {
    if (this.providerType === 'ollama') {
      return this.generateStructuredAnalysisMultiPass(transcript, userNotes);
    }
    return this.generateStructuredAnalysisSinglePass(transcript, userNotes);
  }

  private async generateStructuredAnalysisSinglePass(
    transcript: string,
    userNotes?: string,
  ): Promise<AnalysisDocumentV3> {
    const errorCategories: AnalysisErrorCategory[] = [];

    try {
      const raw = await this.generateText({
        prompt: getStructuredAnalysisPrompt(transcript, userNotes),
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
  ): Promise<AnalysisDocumentV3> {
    const errorCategories: AnalysisErrorCategory[] = [];
    // Pass 1: Topic segmentation
    let topicSegments: Array<{
      title: string;
      start_segment: number;
      end_segment: number;
    }> = [];

    try {
      const segmentationPrompt = getTopicSegmentationPrompt(transcript);
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
            title: typeof t.title === 'string' ? t.title.trim() : 'Discussion',
            start_segment:
              typeof t.start_segment === 'number' ? t.start_segment : 0,
            end_segment: typeof t.end_segment === 'number' ? t.end_segment : 0,
          }))
          .filter((t) => t.title.length > 0);
      }
    } catch (e) {
      console.warn(
        `[${this.name}] Topic segmentation failed, using single-topic fallback:`,
        e,
      );
    }

    // If segmentation failed or returned nothing, treat whole transcript as one topic
    if (topicSegments.length === 0) {
      this.pushErrorCategory(errorCategories, 'empty_topics');
      topicSegments = [
        { title: 'General Discussion', start_segment: 0, end_segment: 9999 },
      ];
    }

    // Split transcript into lines for slicing
    const transcriptLines = transcript.split('\n');

    // Pass 2: Per-topic analysis
    const topics: TopicSection[] = [];
    const allActionItems: ActionItemV3[] = [];
    const allDecisions: DecisionV3[] = [];

    for (const segment of topicSegments) {
      const slice = transcriptLines
        .slice(segment.start_segment, segment.end_segment + 1)
        .join('\n');

      if (!slice.trim()) continue;

      try {
        const topicPrompt = getTopicAnalysisPrompt(
          segment.title,
          slice,
          userNotes,
        );
        const topicRaw = await this.generateText({
          prompt: topicPrompt,
          task: 'topicAnalysis',
          jsonMode: true,
        });
        const topicParsed = JSON.parse(this.cleanJsonText(topicRaw)) as Record<
          string,
          unknown
        >;

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
                from_user_notes: p.from_user_notes === true ? true : undefined,
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
                topic: segment.title,
              }))
              .filter((a) => a.text.length > 0)
          : [];

        const open_questions = Array.isArray(topicParsed.open_questions)
          ? topicParsed.open_questions.filter(
              (q): q is string => typeof q === 'string' && q.trim().length > 0,
            )
          : [];

        topics.push({
          title: segment.title,
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

        allActionItems.push(...action_items);
        allDecisions.push(...decisions);
      } catch (e) {
        console.warn(
          `[${this.name}] Per-topic analysis failed for "${segment.title}":`,
          e,
        );
      }
    }

    if (topics.length === 0) {
      return fallbackAnalysisDocumentV3(1, [
        'All per-topic analysis passes failed',
      ]);
    }

    // Generate overview from topics
    const overview =
      topics
        .map((t) => t.summary)
        .filter(Boolean)
        .join(' ')
        .slice(0, 500) ||
      'Conversation captured. See topics below for details.';

    return this.finalizeStructuredAnalysis({
      analysis: {
        analysis_schema_version: 3,
        overview,
        topics,
        all_action_items: allActionItems,
        all_decisions: allDecisions,
        meeting_type: 'general',
        quality: {
          format_pass: true,
          retry_count: 0,
          fallback_used: false,
          issues: [],
        },
      },
      transcript,
      retryCount: 0,
      errorCategories,
    });
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
    const topics = analysis.topics.map((topic) => {
      const decisions = topic.decisions.filter((decision) => {
        const supported = this.hasSupportInTranscript(
          decision.text,
          transcript,
          this.decisionSupportKeywords(),
        );
        if (!supported) {
          this.pushErrorCategory(errorCategories, 'unsupported_decision');
        }
        return supported;
      });

      const action_items = topic.action_items
        .map((item) => {
          const supported = this.hasSupportInTranscript(
            item.text,
            transcript,
            this.actionSupportKeywords(),
          );
          if (!supported) {
            this.pushErrorCategory(errorCategories, 'unsupported_action_item');
            return null;
          }

          const normalized: ActionItemV3 = {
            text: item.text,
            topic: topic.title,
          };
          if (
            item.assignee &&
            this.supportsFieldValue(item.assignee, transcript, item.text)
          ) {
            normalized.assignee = item.assignee;
          } else if (item.assignee) {
            this.pushErrorCategory(
              errorCategories,
              'unsupported_action_item_owner',
            );
          }
          if (
            item.due &&
            this.supportsFieldValue(item.due, transcript, item.text)
          ) {
            normalized.due = item.due;
          } else if (item.due) {
            this.pushErrorCategory(
              errorCategories,
              'unsupported_action_item_due',
            );
          }
          return normalized;
        })
        .filter((item): item is ActionItemV3 => item !== null);

      return {
        ...topic,
        decisions,
        action_items,
      };
    });

    const all_action_items = topics.flatMap((topic) =>
      topic.action_items.map((item) => ({
        text: item.text,
        assignee: item.assignee,
        due: item.due,
        topic: topic.title,
      })),
    );
    const all_decisions = topics.flatMap((topic) =>
      topic.decisions.map((decision) => ({
        text: decision.text,
        decided_by: decision.decided_by,
        rationale: decision.rationale,
      })),
    );

    if (
      JSON.stringify(analysis.all_action_items) !==
        JSON.stringify(all_action_items) ||
      JSON.stringify(analysis.all_decisions) !== JSON.stringify(all_decisions)
    ) {
      this.pushErrorCategory(errorCategories, 'conflicting_rollups');
    }

    if (topics.length === 0) {
      this.pushErrorCategory(errorCategories, 'empty_topics');
    } else {
      const coveredTopics = topics.filter(
        (topic) => topic.summary.trim().length > 0,
      );
      if (coveredTopics.length < Math.max(1, Math.ceil(topics.length / 2))) {
        this.pushErrorCategory(errorCategories, 'low_topic_coverage');
      }
    }

    return {
      ...analysis,
      topics,
      all_action_items,
      all_decisions,
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
      this.cachedOllamaModel ||
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

  private decisionSupportKeywords(): string[] {
    return [
      'decided',
      'agreed',
      'approved',
      'we will',
      "we'll",
      "let's",
      'going with',
      'ship',
      'rollout',
      'use ',
    ];
  }

  private actionSupportKeywords(): string[] {
    return [
      "i'll",
      'i will',
      "we'll",
      'we will',
      'can you',
      'please',
      'send',
      'draft',
      'follow up',
      'take that',
    ];
  }

  private supportsFieldValue(
    fieldValue: string,
    transcript: string,
    contextText: string,
  ): boolean {
    const transcriptLower = transcript.toLowerCase();
    if (transcriptLower.includes(fieldValue.toLowerCase())) {
      return true;
    }
    return this.bestTokenOverlap(fieldValue, contextText) >= 0.5;
  }

  private hasSupportInTranscript(
    claim: string,
    transcript: string,
    supportKeywords: string[],
  ): boolean {
    const segments = transcript
      .split('\n')
      .map((segment) => segment.trim())
      .filter(Boolean);
    let bestSegment = '';
    let bestScore = 0;

    for (const segment of segments) {
      const score = this.bestTokenOverlap(claim, segment);
      if (score > bestScore) {
        bestScore = score;
        bestSegment = segment.toLowerCase();
      }
    }

    if (bestScore < 0.6) {
      return false;
    }
    return supportKeywords.some((keyword) => bestSegment.includes(keyword));
  }

  private bestTokenOverlap(a: string, b: string): number {
    const ignoredTokens = new Set([
      'the',
      'for',
      'and',
      'with',
      'that',
      'this',
      'from',
      'will',
      'use',
      'send',
      'take',
      'into',
    ]);
    const normalize = (value: string): string[] =>
      value
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((token) => token.length >= 3 && !ignoredTokens.has(token));

    const aTokens = normalize(a);
    const bTokens = new Set(normalize(b));
    if (aTokens.length === 0) return 0;
    const matches = aTokens.filter((token) => bTokens.has(token)).length;
    return matches / aTokens.length;
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

  async generateFollowUpDrafts(params: {
    meetingTitle: string;
    overview?: string[];
    participants?: string[];
    entityContext?: string[];
    topicSummaries?: string[];
    actionItems: string[];
    decisions: string[];
    openQuestions?: string[];
    discussionPoints?: string[];
    customPrompt?: string;
  }): Promise<{ drafts: Array<{ title: string; content: string }> }> {
    const prompt = getFollowUpDraftsPrompt(params);

    try {
      const raw = await this.generateText({
        prompt,
        task: 'followUps',
        jsonMode: true,
      });
      const parsed = JSON.parse(this.cleanJsonText(raw)) as {
        drafts: Array<{ title: string; content: string }>;
      };
      return {
        drafts: Array.isArray(parsed.drafts) ? parsed.drafts : [],
      };
    } catch (e) {
      console.error(`[${this.name}] Failed to generate follow-up drafts:`, e);
      return { drafts: [] };
    }
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
        return runWithOllamaGenerationGate(Symbol(options.task), async () =>
          this.generateWithOllama(options),
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
    const outputTokenBudget = task === 'knowledgeDoc' ? 4096 : 2500;
    const estimatedTokens =
      Math.ceil(prompt.length / 3) +
      (task === 'knowledgeDoc' ? outputTokenBudget : 1000);
    const num_ctx = Math.min(
      task === 'knowledgeDoc' ? 16384 : 8192,
      Math.max(2048, Math.ceil(estimatedTokens / 1024) * 1024),
    );

    const requestBody: Record<string, unknown> = {
      model,
      prompt,
      stream: false,
      options: {
        num_ctx,
        num_predict: outputTokenBudget,
        temperature: this.getTemperature(task),
        num_thread: 8, // Ensure multi-threading is utilized
      },
      keep_alive: '1h', // Keep model in memory for 1 hour to avoid reload latency
    };

    if (jsonMode) {
      requestBody.format = 'json';
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
      task === 'knowledgeDoc'
        ? OLLAMA_KNOWLEDGE_DOC_TIMEOUT_MS
        : OLLAMA_TIMEOUT_MS,
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

    if (this.cachedOllamaModel) {
      return this.cachedOllamaModel;
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
          this.cachedOllamaModel = defaultCandidate;
          return defaultCandidate;
        }

        // Avoid obvious embedding-only models for text generation tasks.
        const nonEmbeddingCandidate = models.find(
          (name) =>
            !/(^|[-_:])(embed|embedding|bge|e5|gte)([-_:]|$)/i.test(name),
        );
        if (nonEmbeddingCandidate) {
          this.cachedOllamaModel = nonEmbeddingCandidate;
          return nonEmbeddingCandidate;
        }

        this.cachedOllamaModel = models[0];
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
    if (task === 'followUps') {
      return 'You are an expert communications assistant. Always respond with valid JSON only.';
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
    if (task === 'structuredAnalysis') return 0.7;
    if (task === 'topicSegmentation') return 0.3;
    if (task === 'topicAnalysis') return 0.5;
    if (task === 'summary') return 0.7;
    if (task === 'summaryRepair') return 0.2;
    if (task === 'valueSignals') return 0.2;
    if (task === 'knowledgeDoc') return 0.2;
    if (task === 'followUps') return 0.7;
    if (task === 'title') return 0.5;
    if (task === 'askPluto') return 0.4;
    if (task === 'queryClassification') return 0.1;
    return 0.3;
  }

  private getClaudeMaxTokens(task: LLMTask): number {
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
    if (task === 'followUps') return 2048;
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
