import type { AskPlutoActiveMeetingSnapshot } from '../../src/types/askPlutoQuery';
import {
  searchMeetingContextSectionsFts,
  searchMeetingNotesFts,
  walkEntityGraph,
} from '../db';

import type {
  MidFrontmatter,
  ParsedQuery,
  RetrievalResult,
} from './intelligenceTypes';

import {
  readProjectDisplayTitle,
  readProjectThemeSynthesis,
} from '../../src/utils/projectBriefing';
import * as dbModule from '../db';
// We import the llm provider factory
import { getAllSettings, getProvider } from '../llm/factory';
import { buildMeetingNotesEvidenceDocument } from './meetingNotesEvidence';
import { getIntentClassificationPrompt } from './queryPrompts';
import { removeTemporalPhrase, resolveTemporalQuery } from './temporalScope';

const parseMid = (value: unknown): MidFrontmatter | null => {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    return JSON.parse(value) as MidFrontmatter;
  } catch {
    return null;
  }
};

export const buildMeetingRetrievalResult = (
  meeting: dbModule.PersistedMeeting,
  label = 'Current meeting',
): RetrievalResult => {
  const document = buildMeetingNotesEvidenceDocument(meeting);
  const evidence: string[] = [`[${label}]: ${document.title}`];
  const occurredAt = meeting.started_at || meeting.created_at;
  if (occurredAt) evidence.push(`[Occurred]: ${occurredAt}`);
  if (document.notesText)
    evidence.push(`[Analysis]: ${document.notesText.slice(0, 2200)}`);
  if (document.decisionsText)
    evidence.push(`[Decisions]: ${document.decisionsText.slice(0, 1000)}`);
  if (document.actionItemsText)
    evidence.push(`[Action items]: ${document.actionItemsText.slice(0, 1200)}`);
  if (document.topicsText)
    evidence.push(`[Topics]: ${document.topicsText.slice(0, 600)}`);
  if (document.participantsText)
    evidence.push(`[Participants]: ${document.participantsText.slice(0, 600)}`);

  return {
    meeting_id: String(meeting.id),
    meeting_title: meeting.title || 'Untitled meeting',
    mid: parseMid(meeting.mid_json),
    evidence_text: evidence.join('\n'),
    score: 0,
    score_breakdown: {
      fts_rank: 0,
      graph_proximity: 0,
      recency_decay: calculateRecencyDecay(meeting.started_at),
      mention_weight: 0,
    },
    evidence_kind: 'note',
    source_revision: document.sourceRevision,
    trust_status: document.trustStatus,
  };
};

export const buildLiveMeetingRetrievalResult = (
  snapshot: AskPlutoActiveMeetingSnapshot,
): RetrievalResult => {
  const evidence = [`[Current meeting notes]: ${snapshot.title || 'Meeting'}`];
  if (snapshot.participants.length > 0) {
    evidence.push(
      `[Participants]: ${snapshot.participants.slice(0, 8).join(', ')}`,
    );
  }
  if (snapshot.notes.trim()) {
    evidence.push(`[Live notes]: ${snapshot.notes.trim().slice(0, 1200)}`);
  }

  return {
    meeting_id: snapshot.meetingId,
    meeting_title: snapshot.title || 'Meeting',
    mid: null,
    evidence_text: evidence.join('\n').slice(0, 1800),
    score: 0,
    score_breakdown: {
      fts_rank: 0,
      graph_proximity: 0,
      recency_decay: 1,
      mention_weight: 0,
    },
    evidence_kind: 'note',
    trust_status: 'inferred',
  };
};

const classifyQueryHeuristically = (
  lowerText: string,
): ParsedQuery['intent'] => {
  if (
    /\b(compare|comparison|versus|vs|difference|different|changed?|across meetings)\b/.test(
      lowerText,
    )
  ) {
    return 'comparative';
  }
  if (
    lowerText.includes('when') ||
    lowerText.includes('date') ||
    lowerText.match(
      /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|\d{4})\b/,
    )
  ) {
    return 'temporal';
  }
  if (
    /\b(why|risk|rationale|recommend|advice|trend|pattern|conflict|contradict)\b/.test(
      lowerText,
    )
  ) {
    return 'exploratory';
  }
  return 'factual';
};

export interface MatchedProjectEntity {
  id: string;
  canonicalId: string;
  name: string;
  displayTitle: string;
  keyTerms: string[];
  matchKind: 'explicit_label' | 'entity_mention' | 'key_term';
}

export const shouldKeepActiveProjectScope = (input: {
  relation: 'new_topic' | 'follow_up' | 'expansion' | 'omission_follow_up';
  hasActiveProject: boolean;
  candidateMatchKind?: MatchedProjectEntity['matchKind'];
}): boolean =>
  input.hasActiveProject &&
  input.relation !== 'new_topic' &&
  input.candidateMatchKind !== 'explicit_label';

const GENERIC_PROJECT_LABELS = new Set([
  'initiative',
  'pipeline',
  'program',
  'project',
  'roadmap',
  'stream',
  'workstream',
]);

const queryContainsProjectLabel = (query: string, label: string): boolean => {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`, 'i').test(query);
};

const extractProjectKeyTerms = (
  metadata: string | null | undefined,
  theme: ReturnType<typeof readProjectThemeSynthesis>,
): string[] => {
  const terms: string[] = [
    ...(theme?.currentFocus ? [theme.currentFocus] : []),
    ...(theme?.outcome ? [theme.outcome] : []),
  ];
  if (!metadata) return terms;
  try {
    const parsed = JSON.parse(metadata) as Record<string, unknown>;
    if (Array.isArray(parsed.labels)) {
      for (const label of parsed.labels) {
        if (typeof label === 'string' && label.trim().length >= 3) {
          terms.push(label.trim());
        }
      }
    }
    if (Array.isArray(parsed.aliases)) {
      for (const alias of parsed.aliases) {
        if (typeof alias === 'string' && alias.trim().length >= 3) {
          terms.push(alias.trim());
        }
      }
    }
    if (Array.isArray(parsed.projectMilestones)) {
      for (const m of parsed.projectMilestones) {
        if (
          m &&
          typeof m === 'object' &&
          typeof (m as Record<string, unknown>).title === 'string'
        ) {
          const title = (m as Record<string, unknown>).title as string;
          if (title.trim().length >= 4) terms.push(title.trim());
        }
      }
    }
  } catch {
    // Ignore JSON parse errors
  }
  return [...new Set(terms)];
};

export const matchProjectEntity = (
  query: string,
  entityMentions: string[] = [],
): MatchedProjectEntity | null => {
  const normalizedQuery = query.toLocaleLowerCase();
  const allProjects =
    typeof dbModule.getEntitiesByType === 'function'
      ? dbModule.getEntitiesByType('project')
      : [];

  const explicitMatches = allProjects
    .flatMap((project) => {
      const canonicalId =
        typeof dbModule.resolveProjectIdentityId === 'function'
          ? dbModule.resolveProjectIdentityId(project.id)
          : project.id;
      const displayTitle = readProjectDisplayTitle(
        project.metadata,
        project.name,
      );
      const theme = readProjectThemeSynthesis(project.metadata);
      const keyTerms = extractProjectKeyTerms(project.metadata, theme);
      const labels = [project.name, displayTitle]
        .map((label) => label.toLocaleLowerCase().trim())
        .filter(
          (label) =>
            label.length >= 3 &&
            !GENERIC_PROJECT_LABELS.has(label) &&
            queryContainsProjectLabel(normalizedQuery, label),
        );
      if (labels.length === 0) return [];
      return [
        {
          score: Math.max(...labels.map((label) => label.length)),
          match: {
            id: project.id,
            canonicalId,
            name: project.name,
            displayTitle,
            keyTerms,
            matchKind: 'explicit_label',
          } satisfies MatchedProjectEntity,
        },
      ];
    })
    .sort((left, right) => right.score - left.score);
  if (explicitMatches[0]) return explicitMatches[0].match;

  // 1. Direct match from entity mentions
  for (const entityId of entityMentions) {
    const canonicalId =
      typeof dbModule.resolveProjectIdentityId === 'function'
        ? dbModule.resolveProjectIdentityId(entityId)
        : entityId;
    const entity =
      typeof dbModule.getEntity === 'function'
        ? dbModule.getEntity(canonicalId)
        : undefined;
    if (entity && entity.type === 'project') {
      const displayTitle = readProjectDisplayTitle(
        entity.metadata,
        entity.name,
      );
      const theme = readProjectThemeSynthesis(entity.metadata);
      const keyTerms = extractProjectKeyTerms(entity.metadata, theme);
      return {
        id: entity.id,
        canonicalId,
        name: entity.name,
        displayTitle,
        keyTerms,
        matchKind: 'entity_mention',
      };
    }
  }

  // 2. Scan all project entities in db
  if (!allProjects.length) return null;

  for (const project of allProjects) {
    const canonicalId =
      typeof dbModule.resolveProjectIdentityId === 'function'
        ? dbModule.resolveProjectIdentityId(project.id)
        : project.id;
    const displayTitle = readProjectDisplayTitle(
      project.metadata,
      project.name,
    );
    const theme = readProjectThemeSynthesis(project.metadata);
    const keyTerms = extractProjectKeyTerms(project.metadata, theme);

    if (
      /\b(?:project|initiative|workstream|stream|roadmap)\b/i.test(
        normalizedQuery,
      )
    ) {
      for (const term of keyTerms) {
        const normalizedTerm = term.toLocaleLowerCase().trim();
        if (
          normalizedTerm.length >= 4 &&
          !GENERIC_PROJECT_LABELS.has(normalizedTerm) &&
          normalizedQuery.includes(normalizedTerm)
        ) {
          return {
            id: project.id,
            canonicalId,
            name: project.name,
            displayTitle,
            keyTerms,
            matchKind: 'key_term',
          };
        }
      }
    } else {
      const commonProjectIgnoredWords = new Set([
        'project',
        'active',
        'stream',
        'initiative',
        'milestone',
        'current',
        'focus',
        'task',
        'tasks',
        'done',
        'open',
        'status',
        'review',
        'update',
        'this',
        'that',
        'with',
        'from',
      ]);
      for (const term of keyTerms) {
        const normalizedTerm = term.toLocaleLowerCase().trim();
        if (
          normalizedTerm.length >= 3 &&
          !commonProjectIgnoredWords.has(normalizedTerm) &&
          new RegExp(
            `\\b${normalizedTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`,
            'i',
          ).test(normalizedQuery)
        ) {
          return {
            id: project.id,
            canonicalId,
            name: project.name,
            displayTitle,
            keyTerms,
            matchKind: 'key_term',
          };
        }
      }
    }
  }

  return null;
};

export const containsConfidentialAside = (text: string): boolean =>
  /\bconfidential\b|\boff[\s-]+the[\s-]+record\b|\b(?:keep|remain|stay|treat|hold)\b.{0,80}\bprivate\b|\bprivate\b.{0,80}\b(?:between us|only us|do not share|don't share)\b/i.test(
    text,
  );

export const enforceSynthesizedOnlyContext = (
  context: RetrievalResult[],
): RetrievalResult[] =>
  context
    .filter(
      (result) =>
        result.evidence_kind !== 'transcript' &&
        !containsConfidentialAside(
          `${result.evidence_text}\n${result.mid ? JSON.stringify(result.mid) : ''}`,
        ),
    )
    .map((result) =>
      result.transcript_passages?.length
        ? { ...result, transcript_passages: undefined }
        : result,
    );

export const isPlanningOrPriorityQuery = (query: string): boolean =>
  /\b(?:what\s+(?:should|do|can)\s+(?:i|we)\s+(?:need\s+to\s+)?(?:be\s+)?(?:focus|focusing|focused|working|work|do|prioritize|tackle)|what\s+(?:are|is)\s+(?:my|our|the\s+team(?:'s)?)\s+(?:top\s+)?(?:priorit(?:y|ies)|focus|deliverables?|next\s+steps?|action\s+items?|commitments?)|what(?:'s|\s+is)\s+(?:on\s+(?:my|our)\s+plate|(?:my|our)\s+(?:top\s+)?priorit(?:y|ies)|(?:my|our)\s+focus|top\s+of\s+mind|happening\s+with\s+(?:my|our)\s+work)|what\s+am\s+i\s+supposed\s+to\s+(?:be\s+)?(?:working|work|focus|do)|where\s+should\s+(?:i|we)\s+start|what\s+to\s+focus\s+on|next\s+steps?\s+for\s+(?:me|us)|current\s+priorities|active\s+streams|workspace\s+(?:overview|summary|update)|what(?:'s|\s+is)\s+going\s+on\s+across\s+(?:meetings|projects|my\s+work)|what\s+needs?\s+(?:my|our|immediate)?\s*attention|catch\s+me\s+up\s+on\s+(?:work|projects|priorities|everything)|how\s+should\s+i\s+prioritize|help\s+me\s+plan\s+(?:my|today|the\s+week)|what\s+did\s+i\s+commit\s+to)\b/i.test(
    query,
  ) ||
  /\b(?:i|we)\b.{0,30}\b(?:should|need\s+to|ought\s+to)\s+(?:be\s+)?(?:focus(?:ing)?|prioritiz(?:e|ing)|tackle)\b/i.test(
    query,
  );

const isWorkspaceRiskQuery = (query: string): boolean =>
  /\b(?:anything|what|which)\b.{0,45}\b(?:concerned|concerns?|risks?|blockers?|watch out for|worry about)\b|\b(?:risks?|concerns?|blockers?)\b.{0,30}\b(?:across|overall|workspace|workstreams?|projects?)\b/i.test(
    query,
  );

export type WorkspaceIntelligenceMode =
  | 'summary'
  | 'expanded'
  | 'risks'
  | 'risks_expanded'
  | 'omitted';

export const shouldUseWorkspaceIntelligence = (input: {
  query: string;
  relation: 'new_topic' | 'follow_up' | 'expansion' | 'omission_follow_up';
  priorQuestion?: string;
  conversationAnchor?: string;
}): boolean =>
  isPlanningOrPriorityQuery(input.query) ||
  isWorkspaceRiskQuery(input.query) ||
  (input.relation !== 'new_topic' &&
    [input.priorQuestion, input.conversationAnchor].some(
      (value) =>
        value &&
        (isPlanningOrPriorityQuery(value) || isWorkspaceRiskQuery(value)),
    ));

export const resolveWorkspaceIntelligenceMode = (
  query: string,
  relation: 'new_topic' | 'follow_up' | 'expansion' | 'omission_follow_up',
  priorQuestion?: string,
): WorkspaceIntelligenceMode => {
  if (/\b(?:left out|omitted|excluded|stale|older)\b/i.test(query))
    return 'omitted';
  if (
    isWorkspaceRiskQuery(query) ||
    (relation === 'expansion' &&
      !isPlanningOrPriorityQuery(query) &&
      Boolean(priorQuestion && isWorkspaceRiskQuery(priorQuestion)))
  )
    return relation === 'expansion' ? 'risks_expanded' : 'risks';
  if (relation === 'expansion') return 'expanded';
  return 'summary';
};

/**
 * Parses a query string to extract intent, entities and semantic bounds.
 */
export const parseQuery = async (
  text: string,
  options: {
    signal?: AbortSignal;
    useModelClassification?: boolean;
    now?: Date;
    disputedEntity?: string;
  } = {},
): Promise<ParsedQuery> => {
  options.signal?.throwIfAborted();
  const lowerText = text.toLowerCase();
  const temporalQuery = resolveTemporalQuery(text, options.now);
  const keywordText = removeTemporalPhrase(text, temporalQuery);

  // Basic tokenization
  const tokens = keywordText.split(/[\s,.;:!?]+/).filter((w) => w.length > 2);
  // Basic keyword extraction (exclude stopwords)
  const stopwords = new Set([
    'what',
    'is',
    'the',
    'of',
    'in',
    'on',
    'where',
    'when',
    'how',
    'why',
    'did',
    'does',
    'do',
    'a',
    'an',
    'can',
    'you',
    'tell',
    'me',
    'more',
    'details',
    'about',
    'please',
    'share',
    'give',
    'some',
    'information',
    'know',
    'find',
    'search',
    'show',
    'meeting',
    'meetings',
    'call',
    'calls',
    'recorded',
    'recording',
    // Modal verbs and query-framing words that add FTS noise
    'should',
    'would',
    'could',
    'shall',
    'might',
    'may',
    'must',
    'need',
    'needs',
    'ought',
    'answer',
    'answers',
    'summarize',
    'summary',
    'key',
    'points',
    'main',
    'list',
    'describe',
    'explain',
    'recent',
    'latest',
    'last',
    'any',
    'were',
    'was',
    'are',
    'there',
    'has',
    'have',
    'been',
    'get',
    'all',
    'from',
    'with',
    'for',
    'discussed',
    'mentioned',
    'talked',
    'said',
    'highlight',
    'highlights',
    'overview',
    'brief',
    'briefing',
    'update',
    'updates',
  ]);
  const isPlanning = isPlanningOrPriorityQuery(text);
  if (isPlanning) {
    const planningStopwords = [
      'focus',
      'focusing',
      'focused',
      'priority',
      'priorities',
      'prioritize',
      'plate',
      'start',
      'working',
      'work',
      'steps',
      'today',
      'day',
      'mind',
      'attention',
      'deliverables',
      'tackle',
      'plan',
      'planning',
      'catch',
      'everything',
      'state',
      'status',
      'update',
      'going',
      'need',
      'supposed',
      'responsible',
      'loops',
    ];
    for (const word of planningStopwords) {
      stopwords.add(word);
    }
  }
  if (options.disputedEntity) {
    stopwords.add(options.disputedEntity.toLowerCase());
  }
  const keywords = tokens.filter((w) => !stopwords.has(w.toLowerCase()));

  // Sanitize text for SQLite FTS5 MATCH queries
  const sanitizeForFts = (str: string) =>
    str.replace(/["*()\[\]{}^:~?!,.\-]/g, ' ').trim();
  const cleanJsonText = (value: string): string => {
    const trimmed = value.trim();
    if (trimmed.startsWith('```')) {
      return trimmed
        .replace(/^```(?:json)?\n?/, '')
        .replace(/\n?```$/, '')
        .trim();
    }
    return trimmed;
  };

  // 1. Fast-path heuristic for conversational greetings
  const trimmed = lowerText.trim();
  const isGreeting =
    /^(?:hi|hello|hey)(?:[\s,!]*?(?:pluto|there))?[\s!?.]*$/i.test(trimmed);
  const isCapabilityQuestion =
    /^(?:who are you|what can you do|what is this)[\s!?.]*$/i.test(trimmed);
  const isThanks = /^(?:thanks|thank you)(?:[\s,!]*pluto)?[\s!?.]*$/i.test(
    trimmed,
  );
  if (isGreeting || isCapabilityQuestion || isThanks) {
    console.log('[QueryEngine] Greeting detected, providing canned response');

    let cannedResponse =
      "Hi! I'm Pluto, your AI meeting assistant. Ask me anything about your meeting history.";
    if (/^(?:who are you|what is this)\b/i.test(trimmed)) {
      cannedResponse =
        "I'm Pluto, an AI meeting intelligence assistant. I can help you search through your meeting history, summarize discussions, and track action items.";
    } else if (/^what can you do\b/i.test(trimmed)) {
      cannedResponse =
        'I can search your synthesized meeting notes, project information, and people information to answer questions, compare decisions, and track action items.';
    } else if (isThanks) {
      cannedResponse = "You're welcome! Let me know if you need anything else.";
    }

    return {
      keywords: [],
      expanded_keywords: [],
      entity_mentions: [],
      temporal_range: null,
      intent: 'conversational',
      cannedResponse,
    };
  }

  // 2. Intent Classification & Synonym Expansion via LLM
  let intent: ParsedQuery['intent'] = 'factual';
  let expanded_keywords: string[] = [];

  if (isPlanning) {
    intent = 'factual';
  } else if (options.useModelClassification === false) {
    intent = classifyQueryHeuristically(lowerText);
  } else {
    try {
      const settings = await getAllSettings(dbModule);
      const provider = await getProvider(settings);
      const prompt = getIntentClassificationPrompt(text);

      console.log('[QueryEngine] Classifying intent via LLM...');
      const response = await provider.classifyQueryIntent(prompt, options);
      options.signal?.throwIfAborted();

      // Parse JSON with cleaning to handle model-generated markdown wrappers.
      const cleanedResponse =
        typeof response === 'string' ? cleanJsonText(response) : response;
      const parsed =
        typeof cleanedResponse === 'string'
          ? JSON.parse(cleanedResponse)
          : cleanedResponse;
      if (parsed.intent) {
        intent = parsed.intent as ParsedQuery['intent'];
      }
      if (Array.isArray(parsed.expanded_keywords)) {
        expanded_keywords = parsed.expanded_keywords;
      }
      console.log(
        `[QueryEngine] LLM Classification: ${intent}, Keywords: ${expanded_keywords.join(', ')}`,
      );
    } catch (err) {
      if (options.signal?.aborted) throw err;
      console.warn(
        '[QueryEngine] Failed to classify intent via LLM, falling back to heuristics:',
        err,
      );
      intent = classifyQueryHeuristically(lowerText);
    }
  }

  if (temporalQuery && intent !== 'comparative') intent = 'temporal';

  // Entity extraction via FTS against keywords (more reliable than full query)
  const entitySearchStr = keywords
    .map((k) => `"${sanitizeForFts(k)}"`)
    .join(' OR ');
  const entityMentions =
    intent !== 'conversational' && entitySearchStr.length > 0
      ? dbModule
          .searchEntitiesWithMeetingContext(entitySearchStr)
          .map((e) => e.id)
          .slice(0, 3) // top 3 entities
      : [];

  const matchedProject = matchProjectEntity(text, entityMentions);
  if (matchedProject) {
    if (!entityMentions.includes(matchedProject.canonicalId)) {
      entityMentions.unshift(matchedProject.canonicalId);
    }
    const projectTokens = [
      matchedProject.displayTitle,
      matchedProject.name,
      ...matchedProject.keyTerms,
    ]
      .flatMap((term) => term.split(/[\s,.;:!?]+/))
      .filter((w) => w.length > 2 && !stopwords.has(w.toLowerCase()));
    for (const token of projectTokens) {
      if (!expanded_keywords.includes(token)) {
        expanded_keywords.push(token);
      }
    }
  }

  return {
    keywords,
    expanded_keywords,
    entity_mentions: entityMentions,
    temporal_range: temporalQuery
      ? {
          from: temporalQuery.range.fromInclusive,
          to: temporalQuery.range.toExclusive,
          label: temporalQuery.range.label,
        }
      : null,
    intent,
  };
};

const calculateRecencyDecay = (dateStr: string | null | undefined): number => {
  if (!dateStr) return 0.5;
  const daysAgo =
    (Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24);
  return 1 / (1 + Math.max(0, daysAgo) * 0.1);
};

export const mergeRetrievalResultsByMeeting = (
  ...resultSets: RetrievalResult[][]
): RetrievalResult[] => {
  const seenMeetingIds = new Set<string>();
  return resultSets.flatMap((results) =>
    results.filter((result) => {
      if (seenMeetingIds.has(result.meeting_id)) return false;
      seenMeetingIds.add(result.meeting_id);
      return true;
    }),
  );
};

const EXTRACTIVE_TEMPORAL_SUMMARY_QUERY =
  /\b(?:summari[sz]e|summary|recaps?|analy[sz]e|key takeaways?)\b|\bwhat (?:happened|was discussed)\b/i;
const EXTRACTIVE_DECISION_QUERY =
  /\b(?:decid(?:e|ed|ing)|decisions?|agreed?|agreements?)\b/i;
const EXTRACTIVE_ACTION_QUERY =
  /\b(?:action items?|next steps?|follow[- ]?ups?|assigned to|who (?:owns|is responsible))\b/i;
const CONTEXTLESS_SUMMARY_TEXT =
  /\b(?:one|a|another|the)\s+(?:speaker|participant|attendee)\b|\b(?:an?|the)\s+(?:application|app|project|product|tool)\b/i;
const GENERIC_MEETING_TITLE =
  /^(?:meeting|untitled meeting|recovered recording)$/i;

export const isSelfReferentialQuery = (query: string): boolean =>
  /\b(?:my\s+(?:quarterly\s+|annual\s+|monthly\s+|weekly\s+|recent\s+)?(?:accomplishments?|achievements?|commitments?|action items?|tasks?|work|deliverables?|updates?|contributions?|projects?|priorities|focus|plate)|what\s+(?:did\s+i|have\s+i|was\s+my|were\s+my|do\s+i|should\s+i|am\s+i|do\s+i\s+need)|give\s+me\s+my|generate\s+my|summarize\s+my|did\s+i\s+(?:say|mention|commit|work|agree)|what\s+i\s+(?:did|said|worked|committed)|what(?:'s|\s+is)\s+(?:on\s+my\s+plate|my\s+(?:top\s+)?priorit(?:y|ies)|my\s+focus))\b/i.test(
    query,
  );

const ASSIGNEE_ACTION_QUERY_PATTERNS = [
  /\b(?:what(?:'s| is)|what else is|show me (?:what(?:'s| is))?)\s+assigned to\s+(.+?)(?:\?|$)/i,
  /\bwhat\s+does\s+(.+?)\s+own(?:\?|$)/i,
  /\bwhat\s+(?:are|were)\s+(.+?)(?:'s|’s)\s+(?:action items?|commitments?|tasks?|accomplishments?|deliverables?)(?:\?|$)/i,
  /\b(?:generate|list|show|give me)\s+(.+?)(?:'s|’s)\s+(?:quarterly\s+|annual\s+|monthly\s+|weekly\s+|recent\s+)?(?:accomplishments?|achievements?|deliverables?)(?:\?|$)/i,
  /\bwhat\s+did\s+(.+?)\s+(?:accomplish|deliver|complete|finish)(?:\?|$)/i,
];

export const parseAssigneeActionQuery = (query: string): string | null => {
  if (
    /\b(?:what (?:are|is)|show me|list)?\s*my\s+(?:(?:open|completed|done|closed)\s+)?(?:commitments?|action items?|tasks?)\b/i.test(
      query,
    ) ||
    /\bwhat\s+do\s+i\s+own\b/i.test(query) ||
    /\bwhat\s+(?:should|do)\s+i\s+(?:need\s+to\s+)?(?:be\s+)?(?:focus|focusing|working|work|do|prioritize)(?:\s+on)?\b/i.test(
      query,
    ) ||
    /\bwhat\s+(?:are|is)\s+my\s+(?:top\s+)?(?:priorit(?:y|ies)|focus|deliverables?|next steps?)\b/i.test(
      query,
    ) ||
    /\bwhat(?:'s|\s+is)\s+(?:on\s+my\s+plate|my\s+(?:top\s+)?priorit(?:y|ies)|my\s+focus)\b/i.test(
      query,
    ) ||
    /\bwhat\s+am\s+i\s+supposed\s+to\s+(?:be\s+)?(?:working|work|focus|do)\b/i.test(
      query,
    ) ||
    /\b(?:commitments?|action items?|tasks?|priorities)\s+(?:are\s+)?mine\b/i.test(
      query,
    ) ||
    /\b(?:generate|list|show|what (?:are|were)|give me)?\s*my\s+(?:(?:quarterly|annual|monthly|weekly|recent)\s+)?(?:accomplishments?|achievements?|deliverables?|completed (?:tasks?|commitments?|work))\b/i.test(
      query,
    ) ||
    /\bwhat\s+did\s+i\s+(?:accomplish|deliver|complete|finish)\b/i.test(query)
  ) {
    return 'me';
  }
  for (const pattern of ASSIGNEE_ACTION_QUERY_PATTERNS) {
    const match = query.trim().match(pattern);
    const assignee = match?.[1]?.trim().replace(/[?.!,;:]+$/, '');
    if (assignee && assignee.length <= 80) return assignee;
  }
  return null;
};

const normalizePersonName = (value: string): string =>
  value
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

const formatActionDueDate = (value: unknown): string | null => {
  if (typeof value !== 'string' || !value.trim()) return null;
  const isoDate = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const date = isoDate
    ? new Date(
        Date.UTC(
          Number(isoDate[1]),
          Number(isoDate[2]) - 1,
          Number(isoDate[3]),
        ),
      )
    : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(date);
};

interface StructuredActionItem {
  description: string;
  assignee: string;
  dueDate: string | null;
  status: string;
}

const actionSimilarityTokens = (description: string): Set<string> =>
  new Set(
    description
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .split(/\s+/)
      .filter((token) => token.length > 2),
  );

const actionsAreNearDuplicates = (
  left: StructuredActionItem,
  right: StructuredActionItem,
): boolean => {
  const leftTokens = actionSimilarityTokens(left.description);
  const rightTokens = actionSimilarityTokens(right.description);
  if (leftTokens.size === 0 || rightTokens.size === 0) return false;
  let shared = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) shared += 1;
  }
  return shared / Math.min(leftTokens.size, rightTokens.size) >= 0.75;
};

const readStructuredActionItems = (
  meeting: dbModule.PersistedMeeting,
): StructuredActionItem[] => {
  const mid = parseMid(meeting.mid_json);
  if (mid?.action_items?.length) {
    return mid.action_items.flatMap((item) => {
      const description = item.description?.trim();
      const assignee = item.assignee?.trim();
      if (!description || !assignee) return [];
      return [
        {
          description,
          assignee,
          dueDate: formatActionDueDate(item.due_date),
          status: item.status,
        },
      ];
    });
  }

  if (typeof meeting.analysis_json !== 'string') return [];
  try {
    const analysis = JSON.parse(meeting.analysis_json) as Record<
      string,
      unknown
    >;
    if (!Array.isArray(analysis.all_action_items)) return [];
    return analysis.all_action_items.flatMap((value) => {
      if (!value || typeof value !== 'object') return [];
      const item = value as Record<string, unknown>;
      const description =
        typeof item.text === 'string'
          ? item.text.trim()
          : typeof item.description === 'string'
            ? item.description.trim()
            : '';
      const assignee =
        typeof item.assignee === 'string' ? item.assignee.trim() : '';
      if (!description || !assignee) return [];
      return [
        {
          description,
          assignee,
          dueDate: formatActionDueDate(item.due_date),
          status: typeof item.status === 'string' ? item.status : 'active',
        },
      ];
    });
  } catch {
    return [];
  }
};

export const buildAssigneeActionRecall = (
  query: string,
  meetings: dbModule.PersistedMeeting[],
): {
  assignee: string;
  answer: string;
  context: RetrievalResult[];
  coverageLimited: boolean;
  mentionedMeetingCount: number;
  commitmentCount: number;
} | null => {
  const assignee = parseAssigneeActionQuery(query);
  if (!assignee) return null;

  const selfReference = /^(?:me|myself|mine)$/i.test(assignee.trim());
  const person = selfReference
    ? (() => {
        const id = dbModule.identityStore.getSelfPersonId();
        return id ? dbModule.getEntity(id) : undefined;
      })()
    : dbModule.findEntity('person', assignee);
  if (selfReference && !person) {
    return {
      assignee: 'you',
      answer:
        "I can't resolve “me” yet. Confirm your identity in Pluto, then ask again.",
      context: [],
      coverageLimited: false,
      mentionedMeetingCount: 0,
      commitmentCount: 0,
    };
  }
  const canonicalCommitments = person
    ? dbModule.getCanonicalPersonCommitments(person.id)
    : undefined;
  if (person && canonicalCommitments) {
    const completedRequested =
      /\b(?:completed|complete|done|closed|finished|accomplishments?|achievements?|deliverables?)\b/i.test(
        query,
      );
    const isPriorityQuery =
      !completedRequested &&
      /\b(?:focus|focusing|priorit(?:y|ies|ize)|what should i|on my plate|next steps?|work on|supposed to)\b/i.test(
        query,
      );
    const confirmed = completedRequested
      ? canonicalCommitments.delivered
      : canonicalCommitments.open;
    const possible = completedRequested ? [] : canonicalCommitments.candidates;

    const sortedConfirmed = [...confirmed];
    if (isPriorityQuery) {
      sortedConfirmed.sort((a, b) => {
        if (a.dueDate && !b.dueDate) return -1;
        if (!a.dueDate && b.dueDate) return 1;
        if (a.dueDate && b.dueDate) {
          return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
        }
        return 0;
      });
    }

    const selected = [
      ...sortedConfirmed.map((item) => ({ ...item, confirmed: true as const })),
      ...possible.map((item) => ({ ...item, confirmed: false as const })),
    ].slice(0, 12);
    const grouped = new Map<
      string,
      { meeting: dbModule.PersistedMeeting; items: typeof selected }
    >();
    for (const item of selected) {
      const meeting = dbModule.getAskPlutoMeeting(item.sourceMeetingId) as
        | dbModule.PersistedMeeting
        | undefined;
      if (!meeting) continue;
      const existing = grouped.get(item.sourceMeetingId);
      if (existing) existing.items.push(item);
      else grouped.set(item.sourceMeetingId, { meeting, items: [item] });
    }
    const groups = [...grouped.values()];
    const context = groups.map(({ meeting, items }) => {
      const source = buildMeetingRetrievalResult(meeting, 'Commitment source');
      const evidence = items
        .map(
          (item) =>
            `${item.confirmed ? (completedRequested ? 'Completed deliverable' : 'Confirmed assignment') : 'Possible follow-up'}: ${item.text}${item.dueDate ? ` Due ${formatActionDueDate(item.dueDate) || item.dueDate}.` : ''}${item.evidence ? ` Evidence: ${item.evidence}` : ''}`,
        )
        .join('\n');
      return {
        ...source,
        evidence_text: `${source.evidence_text}\n[Commitments]:\n${evidence}`,
        evidence_kind: 'commitment' as const,
      };
    });
    const sourceIndex = new Map(
      groups.map((group, index) => [String(group.meeting.id), index + 1]),
    );
    const lines = [
      ...(isPriorityQuery && sortedConfirmed.length > 0
        ? [
            'Here is what is currently on your plate, based on your open commitments:',
          ]
        : []),
      ...sortedConfirmed.map(
        (item) =>
          `- ${item.text}${item.dueDate ? ` Due ${formatActionDueDate(item.dueDate) || item.dueDate}.` : ''} [Source ${sourceIndex.get(item.sourceMeetingId) || 1}]`,
      ),
      ...(possible.length
        ? [
            '',
            'Possible follow-ups — ownership is not confirmed:',
            ...possible.map(
              (item) =>
                `- ${item.text} [Source ${sourceIndex.get(item.sourceMeetingId) || 1}]`,
            ),
          ]
        : []),
    ];
    const subject = selfReference ? 'you' : person.name;
    return {
      assignee: subject,
      answer:
        lines.filter(Boolean).length > 0
          ? lines.join('\n')
          : isPriorityQuery
            ? `I couldn't find any open commitments or action items assigned to ${subject} to prioritize.`
            : `I couldn't find any confirmed ${completedRequested ? 'accomplishments or completed deliverables' : 'open commitments'} assigned to ${subject}.`,
      context,
      coverageLimited: false,
      mentionedMeetingCount: context.length,
      commitmentCount: sortedConfirmed.length,
    };
  }

  const normalizedAssignee = normalizePersonName(assignee);
  const mentionedMeetingCount = meetings.filter((meeting) =>
    [
      meeting.user_notes,
      meeting.enhanced_notes,
      meeting.mid_json,
      meeting.analysis_json,
    ].some(
      (value) =>
        typeof value === 'string' &&
        normalizePersonName(value).includes(normalizedAssignee),
    ),
  ).length;
  const rawMatches = meetings.flatMap((meeting) => {
    const actions = readStructuredActionItems(meeting).filter(
      (item) =>
        item.status.toLocaleLowerCase() !== 'completed' &&
        normalizePersonName(item.assignee) === normalizedAssignee,
    );
    return actions.length > 0 ? [{ meeting, actions }] : [];
  });
  const acceptedActions: StructuredActionItem[] = [];
  const matches = rawMatches.flatMap(({ meeting, actions }) => {
    const uniqueActions = actions.filter((action) => {
      if (
        acceptedActions.some((accepted) =>
          actionsAreNearDuplicates(accepted, action),
        )
      ) {
        return false;
      }
      acceptedActions.push(action);
      return true;
    });
    return uniqueActions.length > 0
      ? [{ meeting, actions: uniqueActions }]
      : [];
  });
  if (matches.length === 0) {
    return {
      assignee,
      answer: `I couldn't find any open action items assigned to ${assignee}.`,
      context: [],
      coverageLimited: mentionedMeetingCount > 0,
      mentionedMeetingCount,
      commitmentCount: 0,
    };
  }

  const context = matches.map(({ meeting, actions }) => {
    const source = buildMeetingRetrievalResult(meeting, 'Assignment source');
    const assignments = actions
      .map(
        (item) =>
          `${item.description}${item.dueDate ? ` Due ${item.dueDate}.` : ''}`,
      )
      .join('\n');
    return {
      ...source,
      evidence_text: `${source.evidence_text}\n[Action assignments]: ${assignments}`,
    };
  });
  const answer = matches
    .flatMap(({ actions }, sourceIndex) =>
      actions.map(
        (item) =>
          `- ${item.description}${item.dueDate ? ` Due ${item.dueDate}.` : ''} [Source ${sourceIndex + 1}]`,
      ),
    )
    .slice(0, 12)
    .join('\n');

  return {
    assignee,
    answer,
    context,
    coverageLimited: mentionedMeetingCount > context.length,
    mentionedMeetingCount,
    commitmentCount: acceptedActions.length,
  };
};

export const extractNamedPersonQuestionSubject = (
  query: string,
): string | null => {
  const patterns = [
    /\b[Ww]hat\s+do\s+you\s+think\s+(?:will|would)\s+satisfy\s+([\p{Lu}][\p{L}'-]+(?:\s+[\p{Lu}][\p{L}'-]+)?)/u,
    /\b(?:needed|required)\s+for\s+([\p{Lu}][\p{L}'-]+(?:\s+[\p{Lu}][\p{L}'-]+)?)/u,
    /\b(?:present|show|demonstrate|send|share)\b[\s\S]{0,50}\bto\s+([\p{Lu}][\p{L}'-]+(?:\s+[\p{Lu}][\p{L}'-]+)?)/u,
  ];
  for (const pattern of patterns) {
    const subject = query.match(pattern)?.[1]?.trim();
    if (subject && subject.length <= 80) return subject;
  }
  return null;
};

export const buildNamedPersonEvidenceQuery = (
  query: string,
  subject: string,
): string => {
  const subjectPattern = new RegExp(
    subject.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    'i',
  );
  const relevantClause = query
    .split(/[?!\.\n]+/u)
    .map((clause) => clause.trim())
    .find((clause) => subjectPattern.test(clause));
  const evidenceQuery = (relevantClause || query)
    .replace(
      /^who\s+(?:said|asked|requested|assigned|decided|told|stated)\s+(?:that\s+)?/i,
      '',
    )
    .trim();
  return evidenceQuery || subject;
};

export const focusContextOnNamedPerson = (
  query: string,
  context: RetrievalResult[],
): RetrievalResult[] => {
  const subject =
    extractNamedPersonQuestionSubject(query) || parsePersonWorkQuery(query);
  if (!subject) return context;
  if (/^(?:me|myself|mine)$/i.test(subject)) return context;
  const normalizedSubject = subject.toLocaleLowerCase();
  const matches = context.filter((result) =>
    result.evidence_text.toLocaleLowerCase().includes(normalizedSubject),
  );
  // A retrieved meeting about the same project is not evidence of this
  // person's work. An empty result is preferable to assigning them work by
  // association.
  return matches;
};

export const selectRecentPersonNoteContext = (
  context: RetrievalResult[],
  personName: string,
  profileAsOf?: string,
): RetrievalResult[] => {
  const personPattern = new RegExp(
    `(^|[^\\p{L}\\p{N}])${personName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^\\p{L}\\p{N}])`,
    'iu',
  );
  const profileTimestamp = Date.parse(profileAsOf || '') || 0;
  return context
    .map((result) => ({
      result,
      occurredAt:
        Date.parse(
          result.evidence_text.match(
            /\[(?:Occurred|Meeting date)\]:\s*([^\n]+)/,
          )?.[1] || '',
        ) || 0,
    }))
    .filter(({ result, occurredAt }) => {
      if (!occurredAt || occurredAt <= profileTimestamp) return false;
      if (result.evidence_kind === 'transcript') return false;
      if (
        containsConfidentialAside(
          `${result.evidence_text}\n${result.mid ? JSON.stringify(result.mid) : ''}`,
        )
      )
        return false;
      const substantiveEvidence = result.evidence_text.replace(
        /^\[(?:Section match|Notes match|Related notes|Occurred|Meeting date|Participants)\]:[^\n]*\n?/gim,
        '',
      );
      return personPattern.test(substantiveEvidence);
    })
    .sort((left, right) => right.occurredAt - left.occurredAt)
    .slice(0, 2)
    .map(({ result, occurredAt }) => {
      const personSentences = result.evidence_text
        .replace(
          /^\[(?:Section match|Notes match|Related notes|Occurred|Meeting date|Participants)\]:[^\n]*\n?/gim,
          '',
        )
        .split(/(?<=[.!?])\s+(?=[\p{Lu}\[])/u)
        .map((sentence) => sentence.trim())
        .filter((sentence) => personPattern.test(sentence))
        .slice(0, 4);
      return {
        ...result,
        mid: null,
        evidence_text: `[Meeting date]: ${new Date(occurredAt).toISOString()}\n[Person-specific notes]: ${personSentences.join(' ')}`,
        retrieved_sections: undefined,
      };
    });
};

export const selectNamedPersonAnswerContext = (
  query: string,
  context: RetrievalResult[],
  assignmentContext: RetrievalResult[] = [],
): RetrievalResult[] =>
  assignmentContext.length > 0
    ? assignmentContext
    : focusContextOnNamedPerson(query, context);

export const shouldKeepActivePersonScope = (input: {
  relation: 'new_topic' | 'follow_up' | 'expansion' | 'omission_follow_up';
  hasActivePerson: boolean;
  hasExplicitPersonSubject: boolean;
  hasExplicitProject: boolean;
}): boolean =>
  input.relation !== 'new_topic' &&
  input.hasActivePerson &&
  !input.hasExplicitPersonSubject &&
  !input.hasExplicitProject;

export const focusContextOnExplicitNamedSubject = (
  query: string,
  context: RetrievalResult[],
): RetrievalResult[] => {
  // FTS searches terms with OR semantics. A clearly named, multi-word subject
  // must occur as a unit before its matches can answer a question about it.
  const subject = query.match(
    /\b(?:about|regarding)\s+(?:the\s+)?((?:[\p{Lu}][\p{L}\d'-]*\s+){1,4}[\p{Lu}][\p{L}\d'-]*)\b/u,
  )?.[1];
  if (!subject) return context;
  const normalizedSubject = subject.toLocaleLowerCase().replace(/\s+/g, ' ');
  return context.filter((result) =>
    [result.meeting_title, result.evidence_text]
      .filter(Boolean)
      .join('\n')
      .toLocaleLowerCase()
      .replace(/\s+/g, ' ')
      .includes(normalizedSubject),
  );
};

export const parsePersonWorkQuery = (query: string): string | null => {
  const expectationSubject = extractNamedPersonQuestionSubject(query);
  if (expectationSubject) return expectationSubject;
  const overviewSubject = query
    .match(/\b(?:tell me about|who is)\s+([^\n?.!,;]{1,80})/i)?.[1]
    ?.trim();
  if (overviewSubject && dbModule.findEntity('person', overviewSubject)) {
    return overviewSubject;
  }
  const patterns = [
    /\bwhat(?:'s|\s+is)\s+(.+?)\s+(?:working\s+on|focused\s+on|doing)(?:\s+(?:currently|now|right\s+now))?(?:\?|$)/i,
    /\bwhat\s+does\s+(.+?)\s+(?:work\s+on|focus\s+on|do)(?:\s+(?:currently|now|right\s+now))?(?:\?|$)/i,
  ];
  for (const pattern of patterns) {
    const personName = query.match(pattern)?.[1]?.trim();
    if (personName && personName.length <= 80) return personName;
  }
  return null;
};

export const buildPersonWorkRecall = (
  query: string,
  inheritedPersonName?: string,
): {
  person: dbModule.Entity;
  displayTitle: string;
  asOf?: string;
  context: RetrievalResult[];
} | null => {
  const requestedName = parsePersonWorkQuery(query) || inheritedPersonName;
  if (!requestedName) return null;
  const selfReference = /^(?:me|myself|mine)$/i.test(requestedName);
  const person = selfReference
    ? (() => {
        const id = dbModule.identityStore.getSelfPersonId();
        return id ? dbModule.getEntity(id) : undefined;
      })()
    : dbModule.findEntity('person', requestedName);
  if (!person) return null;
  const detail = dbModule.getPersonBriefing(person.id);
  if (!detail) return null;
  const snapshot = detail.workingMemorySnapshot?.payload;
  const sections: string[] = [];
  const profileAsOf =
    detail.workingMemorySnapshot?.source_doc_last_synthesized_at ||
    detail.knowledgeDoc?.last_synthesized_at;
  const profileIsAged = Boolean(
    profileAsOf &&
      Date.parse(profileAsOf) < Date.now() - 3 * 24 * 60 * 60 * 1000,
  );
  if (profileAsOf) sections.push(`[Profile as of]: ${profileAsOf}`);
  if (snapshot) {
    sections.push(
      `[${profileIsAged ? 'Last recorded read' : 'Current read'}]: ${snapshot.current_read.headline}\n${snapshot.current_read.supporting_bullets
        .map((item) => `- ${item}`)
        .join('\n')}`,
    );
    sections.push(
      `[${profileIsAged ? 'Last recorded work' : 'Current work'}]: ${JSON.stringify(
        {
          active_streams: snapshot.active_streams,
          open_loops: snapshot.open_loops,
          risks_and_unknowns: snapshot.risks_and_unknowns,
        },
      )}`,
    );
  } else if (detail.knowledgeDoc?.rendered_content) {
    sections.push(
      `[${profileIsAged ? 'Last recorded person brief' : 'Person brief'}]: ${detail.knowledgeDoc.rendered_content.slice(0, 4_000)}`,
    );
  }
  const commitments = detail.commitments.open
    .map(
      (item) => `- ${item.text}${item.dueDate ? ` (due ${item.dueDate})` : ''}`,
    )
    .join('\n');
  if (commitments) sections.push(`[Open commitments]:\n${commitments}`);
  const evidence = sections.join('\n\n').slice(0, 6_000);
  if (!evidence.trim()) return null;

  return {
    person,
    displayTitle: detail.isSelf ? 'Your work' : person.name,
    ...(profileAsOf ? { asOf: profileAsOf } : {}),
    context: [
      {
        meeting_id: `person:${person.id}`,
        meeting_title: `${person.name} profile`,
        source_type: 'artifact',
        source_id: `person:${person.id}`,
        mid: null,
        evidence_text: `[Person profile]: ${person.name}\n${evidence}`,
        score: 1,
        score_breakdown: {
          fts_rank: 1,
          graph_proximity: 1,
          recency_decay: 1,
          mention_weight: 1,
        },
        evidence_kind: 'artifact',
        trust_status:
          detail.workingMemorySnapshot?.payload.current_read.trust_status ||
          'grounded',
      },
    ],
  };
};

export const buildProjectRecall = (
  query: string,
  entityMentions: string[] = [],
): {
  project: MatchedProjectEntity;
  displayTitle: string;
  asOf?: string;
  latestNoteAt?: string;
  context: RetrievalResult[];
} | null => {
  const matched = matchProjectEntity(query, entityMentions);
  if (!matched) return null;

  const brief =
    typeof dbModule.getProjectBrief === 'function'
      ? dbModule.getProjectBrief(matched.canonicalId)
      : null;
  const snapshot =
    typeof dbModule.getWorkingMemorySnapshot === 'function'
      ? dbModule.getWorkingMemorySnapshot('project', matched.canonicalId)
      : null;
  const entity =
    typeof dbModule.getEntity === 'function'
      ? dbModule.getEntity(matched.canonicalId)
      : null;
  if (!brief && !snapshot && !entity) return null;

  const displayTitle = brief?.project.displayTitle || matched.displayTitle;
  const status = entity?.status || brief?.project.status || 'active';
  const theme = brief?.theme;
  const currentRead = snapshot?.payload?.current_read;
  const sections: string[] = [
    `[Project: ${displayTitle}]`,
    `[Identified Name]: ${matched.name}`,
    `[Status]: ${status}`,
  ];
  const profileUpdatedAt =
    snapshot?.source_doc_last_synthesized_at ||
    snapshot?.generated_at ||
    theme?.synthesizedAt;
  if (profileUpdatedAt) sections.push(`[Profile as of]: ${profileUpdatedAt}`);

  if (theme) {
    if (theme.outcome) sections.push(`[Desired Outcome]: ${theme.outcome}`);
    if (theme.currentFocus)
      sections.push(`[Current Focus]: ${theme.currentFocus}`);
    if (theme.recentChanges?.length) {
      sections.push(
        `[Recent Changes]:\n${theme.recentChanges
          .slice(0, 4)
          .map((c) => `- ${c.summary}`)
          .join('\n')}`,
      );
    }
    if (theme.openThreads?.length) {
      sections.push(
        `[Open Threads & Risks]:\n${theme.openThreads
          .slice(0, 4)
          .map((t) => `- [${t.kind}] ${t.text}`)
          .join('\n')}`,
      );
    }
  }

  if (currentRead) {
    sections.push(
      `[Current Read]: ${currentRead.headline || ''}\n${(
        currentRead.supporting_bullets || []
      )
        .map((b) => `- ${b}`)
        .join('\n')}`,
    );
  }

  if (brief?.milestones?.length) {
    const today = new Date().toISOString().slice(0, 10);
    const milestonesText = brief.milestones
      .slice(0, 6)
      .map(
        (m) =>
          `- ${m.title} (${m.targetDate && m.targetDate < today && m.status !== 'complete' ? `past target: ${m.targetDate}; current completion not confirmed` : `${m.status}${m.targetDate ? `, target: ${m.targetDate}` : ''}`})`,
      )
      .join('\n');
    sections.push(`[Milestones]:\n${milestonesText}`);
  }

  if (brief?.tasks?.length) {
    const today = new Date().toISOString().slice(0, 10);
    const tasksText = brief.tasks
      .slice(0, 8)
      .map(
        (t) =>
          `- ${t.name}${t.assigned_to ? ` [Owner: ${t.assigned_to}]` : ''}${t.due_date ? ` (${t.due_date < today ? 'past due date' : 'due'}: ${t.due_date})` : ''} [Last recorded status: ${t.status || 'open'}${t.due_date && t.due_date < today ? '; current completion unknown' : ''}]`,
      )
      .join('\n');
    sections.push(`[Tasks & Action Items]:\n${tasksText}`);
  }

  const projectRetrievalResult: RetrievalResult = {
    meeting_id: matched.canonicalId,
    meeting_title: `Project: ${displayTitle}`,
    source_type: 'artifact',
    source_id: matched.canonicalId,
    mid: null,
    evidence_text: sections.join('\n'),
    score: 1.0,
    score_breakdown: {
      fts_rank: 1,
      graph_proximity: 1,
      recency_decay: 1,
      mention_weight: 1,
    },
    evidence_kind: 'overview',
    trust_status: snapshot?.trust_status ?? 'grounded',
  };

  const meetingResults: RetrievalResult[] = [];
  let latestNoteAt: string | undefined;
  {
    const projectNames = [displayTitle, matched.name]
      .join(' ')
      .toLocaleLowerCase();
    const focusTerms = [
      ...new Set(
        (query.toLocaleLowerCase().match(/[\p{L}\p{N}]{4,}/gu) || []).filter(
          (term) =>
            !projectNames.includes(term) &&
            !/^(?:about|across|after|again|all|and|before|changed|checking|concrete|current|detail|details|dive|doing|first|focus|from|given|give|has|have|into|know|latest|more|most|move|need|needs|next|please|project|recent|recently|right|same|should|status|tell|that|there|think|this|what|where|which|would)$/.test(
              term,
            ),
        ),
      ),
    ];
    const projectAliases = [displayTitle, matched.name].flatMap((name) => {
      const acronym = name.match(/\b[A-Z0-9]{2,}\b/g) || [];
      return [name, ...acronym];
    });
    const projectPhrases = [...new Set(projectAliases)]
      .map((phrase) =>
        phrase
          .toLocaleLowerCase()
          .replace(/["*()\[\]{}^:~?!,.\-]/g, ' ')
          .split(/\s+/)
          .filter((token) => token.length >= 2),
      )
      .filter((tokens) => tokens.length > 0)
      .map(
        (tokens) => `(${tokens.map((token) => `"${token}"`).join(' AND ')})`,
      );
    const projectSectionCandidates = projectPhrases.length
      ? searchMeetingContextSectionsFts(projectPhrases.join(' OR '), {
          limit: 40,
        }).filter(
          ({ section }) =>
            !containsConfidentialAside(
              `${section.heading}\n${section.summary}\n${section.content}`,
            ),
        )
      : [];
    const projectSectionMatches = projectSectionCandidates.filter(
      ({ section }) =>
        focusTerms.length === 0 ||
        focusTerms.some((term) =>
          `${section.heading} ${section.summary} ${section.content}`
            .toLocaleLowerCase()
            .includes(term),
        ),
    );
    const projectLabels = projectAliases
      .map((name) => name.trim().toLocaleLowerCase())
      .filter((name) => name.length >= 3);
    const stronglyAboutProject = (section: {
      heading: string;
      summary: string;
      content: string;
    }): boolean => {
      const headingAndSummary =
        `${section.heading} ${section.summary}`.toLocaleLowerCase();
      const content = section.content.toLocaleLowerCase();
      return projectLabels.some(
        (label) =>
          headingAndSummary.includes(label) ||
          content.split(label).length > 2 ||
          (focusTerms.length > 0 &&
            content.includes(label) &&
            focusTerms.some((term) => content.includes(term))),
      );
    };
    const latestProjectSection = projectSectionCandidates
      .filter(({ section }) => stronglyAboutProject(section))
      .sort(
        (left, right) =>
          (Date.parse(
            right.meeting.started_at || right.meeting.created_at || '',
          ) || 0) -
          (Date.parse(
            left.meeting.started_at || left.meeting.created_at || '',
          ) || 0),
      )[0];
    latestNoteAt =
      latestProjectSection?.meeting.started_at ||
      latestProjectSection?.meeting.created_at ||
      undefined;
    const sectionsByMeeting = new Map<string, typeof projectSectionMatches>();
    for (const match of projectSectionMatches) {
      if (!stronglyAboutProject(match.section)) continue;
      const meetingId = String(match.meeting.id);
      const matches = sectionsByMeeting.get(meetingId) || [];
      if (matches.length < 2) matches.push(match);
      sectionsByMeeting.set(meetingId, matches);
    }
    const recentSectionGroups = [...sectionsByMeeting].sort(
      ([, left], [, right]) =>
        (Date.parse(
          right[0].meeting.started_at || right[0].meeting.created_at || '',
        ) || 0) -
        (Date.parse(
          left[0].meeting.started_at || left[0].meeting.created_at || '',
        ) || 0),
    );
    for (const [meetingId, matches] of recentSectionGroups.slice(0, 3)) {
      const first = matches[0];
      latestNoteAt ||=
        first.meeting.started_at || first.meeting.created_at || undefined;
      const prepared = buildMeetingRetrievalResult(
        first.meeting,
        `Project section (${displayTitle})`,
      );
      meetingResults.push({
        ...prepared,
        meeting_id: meetingId,
        evidence_text: [
          `[Project: ${displayTitle}]`,
          `[Meeting date]: ${first.meeting.started_at || first.meeting.created_at || 'unknown'}`,
          ...matches.map(
            ({ section }) =>
              `[Section: ${section.heading}]: ${section.content.slice(0, 1800)}`,
          ),
        ].join('\n'),
        evidence_kind: 'section',
        retrieved_sections: matches.map(({ section }) => ({
          section_id: section.section_id,
          heading: section.heading,
          kind: section.kind,
          summary: section.summary,
          trust_status: section.trust_status,
          source_revision: section.source_revision,
        })),
        source_revision: first.section.source_revision,
        trust_status: first.section.trust_status,
      });
    }
  }

  return {
    project: matched,
    displayTitle,
    ...(profileUpdatedAt ? { asOf: profileUpdatedAt } : {}),
    ...(latestNoteAt ? { latestNoteAt } : {}),
    context: [projectRetrievalResult, ...meetingResults],
  };
};

export const buildAgedProjectAnswer = (
  query: string,
  recall: NonNullable<ReturnType<typeof buildProjectRecall>>,
  now = new Date(),
  previousAnswer = '',
  continuesCurrentRead = false,
  continuationKind?: 'expand' | 'clarify' | 'challenge',
): string | null => {
  if (
    !continuesCurrentRead &&
    !/\b(?:current|right now|latest|most recent|recently|changed|next|immediate|status|do first|focus on|pending|blocked|unresolved|needs checking|what we know|what is known)\b/i.test(
      query,
    )
  ) {
    return null;
  }
  const newestRecordedAt = [recall.latestNoteAt, recall.asOf]
    .map((value) => Date.parse(value || ''))
    .filter(Number.isFinite)
    .sort((left, right) => right - left)[0];
  if (
    !newestRecordedAt ||
    now.getTime() - newestRecordedAt < 3 * 24 * 60 * 60 * 1000
  ) {
    return null;
  }

  const dateLabel = (value: string): string =>
    new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(value));
  const latestLabel = dateLabel(new Date(newestRecordedAt).toISOString());
  const projectLabels = [recall.displayTitle, recall.project.name]
    .flatMap((label) => [label, ...(label.match(/\b[A-Z0-9]{2,}\b/g) || [])])
    .map((label) => label.toLocaleLowerCase())
    .filter((label) => label.length >= 3);
  const facetQuery = query
    .toLocaleLowerCase()
    .replace(recall.displayTitle.toLocaleLowerCase(), '');
  const requestedFacet =
    /\b(pipeline|release|outreach|quality|deployment|data|pilot|design|review|risk|blocker|issues?)\b/i
      .exec(facetQuery)?.[1]
      .toLocaleLowerCase();
  const seenDetails = new Set<string>();
  const candidateDetails = recall.context
    .filter((source) => source.source_type !== 'artifact')
    .flatMap((source) => {
      const occurredAt = source.evidence_text.match(
        /\[Meeting date\]:\s*([^\n]+)/,
      )?.[1];
      const date = occurredAt ? dateLabel(occurredAt) : latestLabel;
      return (source.retrieved_sections || []).flatMap((section) => {
        const summary = section.summary?.trim();
        if (!summary) return [];
        return summary
          .split(/(?<=[.!?])\s+(?=[A-Z])/)
          .map((sentence) => sentence.trim())
          .filter((sentence) => {
            const lower = sentence.toLocaleLowerCase();
            if (/\b(?:today|tomorrow|next week|this week)\b/.test(lower))
              return false;
            if (
              /\b(?:the other participant|local speaker|remote speaker)\b/.test(
                lower,
              )
            )
              return false;
            return (
              projectLabels.some((label) => lower.includes(label)) ||
              (Boolean(requestedFacet) && lower.includes(requestedFacet ?? ''))
            );
          })
          .filter((sentence) => {
            const key = sentence.toLocaleLowerCase();
            if (seenDetails.has(key)) return false;
            seenDetails.add(key);
            return true;
          })
          .map((sentence) => ({ date, sentence }));
      });
    });
  const facetDetails = requestedFacet
    ? candidateDetails.filter(({ sentence }) =>
        sentence.toLocaleLowerCase().includes(requestedFacet ?? ''),
      )
    : [];
  const details = (requestedFacet ? facetDetails : candidateDetails)
    .filter(({ sentence }) => !previousAnswer.includes(sentence))
    .slice(0, 3)
    .map(({ date, sentence }) => `- ${date}: ${sentence}`);
  const profileHeadline = recall.context[0]?.evidence_text
    .match(/\[Current Read\]:\s*([^\n]+)/)?.[1]
    ?.trim()
    .replace(/[.]+$/, '');
  const concreteProfileHeadline =
    profileHeadline &&
    /\b(?:is|are|will|has|have|focus(?:ed|ing)?|work(?:ing)?|build(?:ing)?|release|pilot|pipeline)\b/i.test(
      profileHeadline,
    )
      ? profileHeadline
      : undefined;
  const profileFocus = recall.context[0]?.evidence_text
    .match(/\[Current Focus\]:\s*([^\n]+)/)?.[1]
    ?.trim()
    .replace(/[.]+$/, '');
  const profileMilestone = recall.context[0]?.evidence_text
    .match(/\[Milestones\]:\n-\s*([^\n]+)/)?.[1]
    ?.trim();
  const profileOpenThreads = recall.context[0]?.evidence_text
    .match(/\[Open Threads & Risks\]:\n([\s\S]*?)(?=\n\[|$)/)?.[1]
    ?.split('\n')
    .map((line) => line.replace(/^-\s*(?:\[[^\]]+\]\s*)?/, '').trim())
    .filter(Boolean)
    .slice(0, 3);
  const profilePicture =
    profileFocus && profileFocus.length >= 16
      ? profileFocus
      : concreteProfileHeadline;
  const recorded = details.length
    ? `\n\nThe last notes say:\n${details.join('\n')}`
    : (profilePicture || profileMilestone) && recall.asOf
      ? `\n\nThe project profile (as of ${dateLabel(recall.asOf)}) ${profilePicture ? `said: ${profilePicture}.${profileMilestone ? ` It listed ${profileMilestone} as a milestone.` : ''}` : `listed ${profileMilestone} as a milestone.`}`
      : '';
  const nextStep =
    /\b(?:next|immediate|do first|focus on|needs checking|what we know)\b/i.test(
      query,
    )
      ? '\n\nI’d verify the release status and current owner before treating an older target or follow-up as today’s action.'
      : '';
  if (
    /\b(?:what (?:would|should|could) (?:you|i|we) (?:do|tackle|check) (?:first|next)|first move|next move)\b/i.test(
      query,
    )
  ) {
    return `For ${recall.displayTitle}, I’d first confirm the release status and who owns the next step. The newest project information I found is from ${latestLabel}, so I wouldn’t assume an older target is still pending.`;
  }
  if (continuationKind === 'challenge') {
    return `You're right to question the freshness. The newest project note I found for ${recall.displayTitle} is from ${latestLabel}, so my earlier description is a last recorded picture—not a verified status today. I can't confirm which recorded steps have since been completed.`;
  }
  if (continuationKind === 'clarify') {
    return `I mean the latest record I found for ${recall.displayTitle} is dated ${latestLabel}. It tells us what was discussed then, but not whether those plans were completed or changed afterward. I wouldn't call that a live project status.`;
  }
  if (continuationKind === 'expand' && continuesCurrentRead) {
    const addedDetail = details[0]
      ? ` The additional dated detail I found is ${details[0].replace(/^- /, '')}`
      : '';
    return `I can add a little to the last recorded picture of ${recall.displayTitle}, but not confirm its status today.${addedDetail} The newest project note I found is from ${latestLabel}; I’d check what has actually shipped and who owns the next step before treating an older plan as current.`;
  }
  if (/\b(?:unresolved|issues?|risks?|blockers?)\b/i.test(facetQuery)) {
    const openThreads = profileOpenThreads?.length
      ? `\n\nThe project profile last listed${recall.asOf ? ` (as of ${dateLabel(recall.asOf)})` : ''}:\n${profileOpenThreads.map((thread) => `- ${thread}`).join('\n')}`
      : '';
    return `I can't confirm which issues are still open for ${recall.displayTitle} today. The newest project note I found is from ${latestLabel}.${openThreads} ${openThreads ? 'I’d verify which of those remain active before ranking them.' : 'I’d need a newer project update before ranking concerns.'}`.trim();
  }
  if (previousAnswer && requestedFacet && details.length === 0) {
    return `I don't have a newer confirmed ${requestedFacet} update for ${recall.displayTitle} beyond what we just covered. The newest project note I found is from ${latestLabel}; it does not establish whether that work has shipped or who owns the next step today. I’d check those two points before calling it blocked or complete.`;
  }
  return `I can give you the last recorded picture of ${recall.displayTitle}, but I can't verify its status today. The newest project information I found is from ${latestLabel}.${recorded}${nextStep}`;
};

export const buildWorkingMemoryOverviewRecall = (
  query: string,
  entityMentions: string[],
): { context: RetrievalResult[]; scope: 'global' | 'project' } | null => {
  if (
    !/\b(?:overview|brief(?:ing)?|what(?:'s| is) going on|current priorities|active streams|risks and unknowns|across meetings|what should i (?:be )?(?:focus|working|work) on|on my plate|priorit(?:y|ies))\b/i.test(
      query,
    )
  ) {
    return null;
  }
  const matchedProject = matchProjectEntity(query, entityMentions);
  const project = matchedProject
    ? dbModule.getEntity(matchedProject.canonicalId)
    : entityMentions
        .map((entityId) => dbModule.getEntity(entityId))
        .find((entity) => entity?.type === 'project');
  const snapshot = project
    ? dbModule.getWorkingMemorySnapshot('project', project.id)
    : dbModule.getWorkingMemorySnapshot('global', 'global');
  if (!snapshot || snapshot.trust_status === 'synthesis_failed') return null;

  const evidence = Array.isArray(snapshot.payload.evidence_index)
    ? snapshot.payload.evidence_index.flatMap((value) => {
        if (!value || typeof value !== 'object') return [];
        const entry = value as Record<string, unknown>;
        if (
          typeof entry.meeting_id !== 'string' ||
          typeof entry.quote !== 'string' ||
          !entry.quote.trim()
        ) {
          return [];
        }
        return [
          {
            meetingId: entry.meeting_id,
            quote: entry.quote.trim(),
          },
        ];
      })
    : [];
  const grouped = new Map<string, string[]>();
  for (const entry of evidence) {
    const quotes = grouped.get(entry.meetingId) || [];
    if (quotes.length < 3) quotes.push(entry.quote);
    grouped.set(entry.meetingId, quotes);
  }
  const context = [...grouped.entries()]
    .slice(0, 6)
    .flatMap(([meetingId, quotes]) => {
      const meeting = dbModule.getAskPlutoMeeting(meetingId) as
        | dbModule.PersistedMeeting
        | undefined;
      if (!meeting) return [];
      const prepared = buildMeetingRetrievalResult(meeting, 'Overview source');
      return [
        {
          ...prepared,
          evidence_text: `[Overview evidence]: ${quotes.join('\n')}`,
          evidence_kind: 'overview' as const,
          trust_status: snapshot.trust_status,
        },
      ];
    });
  if (context.length > 0) {
    return { context, scope: project ? 'project' : 'global' };
  }

  // If no meeting quotes were indexed, form a primary overview artifact from the snapshot payload
  const currentRead = snapshot.payload?.current_read;
  const rawActiveStreams = Array.isArray(snapshot.payload?.active_streams)
    ? snapshot.payload.active_streams
    : [];
  const activeStreams: Array<Record<string, unknown>> = rawActiveStreams.filter(
    (item): item is Record<string, unknown> =>
      Boolean(item) && typeof item === 'object',
  );
  const rawOpenLoops = Array.isArray(snapshot.payload?.open_loops)
    ? snapshot.payload.open_loops
    : Array.isArray(
          (snapshot.payload as unknown as Record<string, unknown>)
            ?.needs_attention,
        )
      ? ((snapshot.payload as unknown as Record<string, unknown>)
          ?.needs_attention as unknown[])
      : [];
  const openLoops: Array<Record<string, unknown>> = rawOpenLoops.filter(
    (item): item is Record<string, unknown> =>
      Boolean(item) && typeof item === 'object',
  );

  const sections: string[] = [
    `[Working Memory Overview: ${project ? 'Project' : 'Workspace'}]`,
  ];
  if (currentRead?.headline) {
    sections.push(
      `[Current Read]: ${currentRead.headline}\n${(currentRead.supporting_bullets || []).map((b) => `- ${b}`).join('\n')}`,
    );
  }
  if (activeStreams.length > 0) {
    sections.push(
      `[Active Streams]:\n${activeStreams
        .slice(0, 5)
        .map(
          (s) =>
            `- ${typeof s.title === 'string' ? s.title : 'Stream'}: ${typeof s.current_read === 'string' ? s.current_read : typeof s.status === 'string' ? s.status : ''}`,
        )
        .join('\n')}`,
    );
  }
  if (openLoops.length > 0) {
    sections.push(
      `[Open Loops & Blockers]:\n${openLoops
        .slice(0, 5)
        .map(
          (l) =>
            `- ${typeof l.title === 'string' ? l.title : 'Item'}: ${typeof l.summary === 'string' ? l.summary : ''}`,
        )
        .join('\n')}`,
    );
  }

  if (sections.length <= 1) return null;

  const artifactResult: RetrievalResult = {
    meeting_id: snapshot.id || 'snapshot:working_memory',
    meeting_title: `${project ? 'Project' : 'Workspace'} Working Memory: Current Read & Streams`,
    source_type: 'artifact',
    source_id: snapshot.id || 'snapshot:working_memory',
    mid: null,
    evidence_text: sections.join('\n\n'),
    score: 1.0,
    score_breakdown: {
      fts_rank: 1,
      graph_proximity: 1,
      recency_decay: 1,
      mention_weight: 1,
    },
    evidence_kind: 'overview',
    trust_status: snapshot.trust_status,
  };

  return {
    context: [artifactResult],
    scope: project ? 'project' : 'global',
  };
};

export interface WorkspaceIntelligenceRecall {
  answer: string;
  context: RetrievalResult[];
  summary: {
    hasWorkingMemory: boolean;
    hasOpenCommitments: boolean;
    hasActiveProjects: boolean;
    recentMeetingCount: number;
    openCommitmentCount: number;
    activeStreamCount: number;
  };
}

const truncateAtThoughtBoundary = (
  value: string,
  maxLength: number,
): string => {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;

  const candidate = normalized.slice(0, maxLength + 1);
  const sentenceEnd = Math.max(
    candidate.lastIndexOf('.'),
    candidate.lastIndexOf('!'),
    candidate.lastIndexOf('?'),
  );
  if (sentenceEnd >= Math.floor(maxLength * 0.55)) {
    return candidate.slice(0, sentenceEnd + 1).trim();
  }

  const wordEnd = candidate.lastIndexOf(' ');
  return `${candidate.slice(0, Math.max(1, wordEnd)).trim()}…`;
};

const isGenericProjectDescription = (value: string | null | undefined) =>
  Boolean(
    value &&
      /\b(?:is|are)\s+(?:an?\s+)?(?:open[- ]source\s+)?project\b.*\b(?:focused on|designed to|built to|that helps)\b/i.test(
        value,
      ),
  );

interface WorkspaceFocusItem {
  title: string;
  current?: string;
  nextMove?: string;
  whyNow?: string;
  source: string;
}

const renderWorkspaceFocusItem = (
  item: WorkspaceFocusItem,
  index: number,
): string => {
  const detail = item.current || item.nextMove || item.whyNow;
  return `${index + 1}. **${item.title}**${detail ? ` — ${detail}` : ''} ${item.source}`;
};

export const buildWorkspaceIntelligenceRecall = (input: {
  query: string;
  persistedMeetings: dbModule.PersistedMeeting[];
  selfPersonId?: string | null;
  now?: number;
  mode?: WorkspaceIntelligenceMode;
}): WorkspaceIntelligenceRecall => {
  const now = input.now ?? Date.now();
  const mode = input.mode ?? 'summary';
  const recentCutoff = now - 14 * 24 * 60 * 60 * 1000;
  const recordDate = (
    item: Record<string, unknown>,
    primaryKey: string,
  ): number => {
    const evidenceQuality =
      item.evidence_quality && typeof item.evidence_quality === 'object'
        ? (item.evidence_quality as Record<string, unknown>)
        : null;
    const rawDate =
      item[primaryKey] ?? evidenceQuality?.last_reinforced_at ?? null;
    return typeof rawDate === 'string' ? Date.parse(rawDate) || 0 : 0;
  };
  const isCurrentSynthesizedItem = (
    item: Record<string, unknown>,
    primaryKey: string,
  ): boolean => {
    const evidenceQuality =
      item.evidence_quality && typeof item.evidence_quality === 'object'
        ? (item.evidence_quality as Record<string, unknown>)
        : null;
    if (
      evidenceQuality?.freshness === 'stale' ||
      evidenceQuality?.freshness === 'aging'
    )
      return false;
    const timestamp = recordDate(item, primaryKey);
    return timestamp === 0 || timestamp >= recentCutoff;
  };
  const selfPersonId =
    input.selfPersonId ??
    (typeof dbModule.identityStore?.getSelfPersonId === 'function'
      ? dbModule.identityStore.getSelfPersonId()
      : null);

  const personBriefing =
    selfPersonId && typeof dbModule.getPersonBriefing === 'function'
      ? dbModule.getPersonBriefing(selfPersonId)
      : null;

  const openCommitments = personBriefing?.commitments?.open ?? [];
  const candidateCommitments = personBriefing?.commitments?.candidates ?? [];

  const globalSnapshot =
    typeof dbModule.getWorkingMemorySnapshot === 'function'
      ? dbModule.getWorkingMemorySnapshot('global', 'global')
      : null;

  const currentRead = globalSnapshot?.payload?.current_read;
  const rawActiveStreams = Array.isArray(
    globalSnapshot?.payload?.active_streams,
  )
    ? globalSnapshot.payload.active_streams
    : [];
  const allActiveStreams: Array<Record<string, unknown>> =
    rawActiveStreams.filter(
      (item): item is Record<string, unknown> =>
        Boolean(item) && typeof item === 'object',
    );
  const activeStreams = allActiveStreams
    .filter((item) => isCurrentSynthesizedItem(item, 'last_touched_at'))
    .sort(
      (a, b) =>
        recordDate(b, 'last_touched_at') - recordDate(a, 'last_touched_at'),
    );
  const omittedStreams = allActiveStreams.filter(
    (item) => !isCurrentSynthesizedItem(item, 'last_touched_at'),
  );

  const rawGlobalOpenLoops = Array.isArray(globalSnapshot?.payload?.open_loops)
    ? globalSnapshot.payload.open_loops
    : Array.isArray(
          (globalSnapshot?.payload as unknown as Record<string, unknown>)
            ?.needs_attention,
        )
      ? ((globalSnapshot?.payload as unknown as Record<string, unknown>)
          ?.needs_attention as unknown[])
      : [];
  const openLoops: Array<Record<string, unknown>> = rawGlobalOpenLoops
    .filter(
      (item): item is Record<string, unknown> =>
        Boolean(item) && typeof item === 'object',
    )
    .filter((item) => isCurrentSynthesizedItem(item, 'last_touched_at'))
    .sort(
      (a, b) =>
        recordDate(b, 'last_touched_at') - recordDate(a, 'last_touched_at'),
    );

  const rawRisks = Array.isArray(globalSnapshot?.payload?.risks_and_unknowns)
    ? globalSnapshot.payload.risks_and_unknowns
    : [];
  const risksAndUnknowns: Array<Record<string, unknown>> = rawRisks
    .filter(
      (item): item is Record<string, unknown> =>
        Boolean(item) && typeof item === 'object',
    )
    .filter((item) => isCurrentSynthesizedItem(item, 'last_touched_at'))
    .sort(
      (a, b) =>
        recordDate(b, 'last_touched_at') - recordDate(a, 'last_touched_at'),
    );

  const portfolio =
    typeof dbModule.getProjectPortfolio === 'function'
      ? dbModule.getProjectPortfolio()
      : [];

  const projectCandidates = portfolio.filter((project) => {
    const actionableFocus =
      project.current_focus &&
      !isGenericProjectDescription(project.current_focus.trim());
    return (
      project.status !== 'completed' &&
      Boolean(
        actionableFocus || project.next_milestone || project.recent_change,
      )
    );
  });
  const isProjectCurrent = (project: (typeof projectCandidates)[number]) => {
    const activityAt = Date.parse(
      project.last_mentioned_at || project.updated_at || '',
    );
    if (!activityAt) return true;
    const cadenceDays =
      project.recurring_cadence === 'quarterly'
        ? 150
        : project.recurring_cadence === 'monthly'
          ? 75
          : project.recurring_cadence === 'biweekly'
            ? 35
            : project.recurring_cadence === 'weekly'
              ? 21
              : 45;
    return activityAt >= now - cadenceDays * 24 * 60 * 60 * 1000;
  };
  const activeProjects = projectCandidates
    .filter(isProjectCurrent)
    .sort(
      (a, b) =>
        (Date.parse(b.last_mentioned_at || b.updated_at || '') || 0) -
        (Date.parse(a.last_mentioned_at || a.updated_at || '') || 0),
    )
    .slice(0, 4);
  const omittedProjects = projectCandidates.filter(
    (project) => !isProjectCurrent(project),
  );

  // A recent meeting is not necessarily a useful update to a priority brief.
  // Keep the source set bounded, but do not let greetings and small talk crowd
  // out concrete changes recorded in newer synthesized notes.
  const seekingRisks = mode === 'risks' || mode === 'risks_expanded';
  const recentMeetings = input.persistedMeetings
    .filter((meeting) => {
      const occurredAt = Date.parse(
        meeting.started_at || meeting.created_at || '',
      );
      if (!occurredAt || occurredAt < recentCutoff) return false;
      const mid = parseMid(meeting.mid_json);
      const notes = meeting.enhanced_notes || meeting.user_notes || '';
      if (containsConfidentialAside(notes)) return false;
      if (seekingRisks) {
        const structuredItems = [
          ...(mid?.decisions || []).map((item) => item.description),
          ...(mid?.action_items || []).map((item) => item.description),
        ].join(' ');
        return /\b(?:risk|blocker|concern|issue|incident|failure|failed|unreliable|delay|approval)\b/i.test(
          `${notes} ${structuredItems}`,
        );
      }
      if (mid?.decisions?.length || mid?.action_items?.length) return true;
      return /\b(?:blocker|risk|issue|incident|deadline|milestone|release|deploy(?:ment|ed)?|launch|pilot|approval|review|follow[- ]?up|next step|action item|pull request|\bPR\b|pipeline|rollout|ship(?:ped|ping)?|fix(?:ed|ing)?|decision)\b/i.test(
        notes,
      );
    })
    .sort(
      (left, right) =>
        (Date.parse(right.started_at || right.created_at || '') || 0) -
        (Date.parse(left.started_at || left.created_at || '') || 0),
    )
    .slice(0, 4);
  const recentMeetingResults = recentMeetings.map((meeting) =>
    buildMeetingRetrievalResult(meeting, 'Recent meeting context'),
  );

  const sections: string[] = ['[Workspace Intelligence & Executive Briefing]'];

  const workspaceRefreshedAt =
    globalSnapshot?.source_doc_last_synthesized_at ||
    globalSnapshot?.generated_at ||
    globalSnapshot?.updated_at ||
    null;
  const workspaceRefreshedTimestamp = workspaceRefreshedAt
    ? Date.parse(workspaceRefreshedAt) || 0
    : 0;
  const noteUpdatesSinceSnapshot = recentMeetings.flatMap((meeting, index) => {
    const occurredAt = Date.parse(
      meeting.started_at || meeting.created_at || '',
    );
    if (
      !workspaceRefreshedTimestamp ||
      !occurredAt ||
      occurredAt <= workspaceRefreshedTimestamp
    )
      return [];
    const result = recentMeetingResults[index];
    const detail = result.evidence_text.match(
      /\[(?:Decisions|Action items|Analysis)\]:\s*([^\n]+)/i,
    )?.[1];
    if (!detail?.trim()) return [];
    return [
      {
        title: meeting.title || 'Untitled meeting',
        occurredAt,
        detail: truncateAtThoughtBoundary(
          detail
            .trim()
            .replace(
              /^\[(?:Summary|Overview|Analysis|Decisions|Action items)\]:\s*/i,
              '',
            ),
          280,
        ),
        source: `[Source ${index + 2}]`,
      },
    ];
  });
  if (workspaceRefreshedAt) {
    sections.push(`[Workspace refreshed]: ${workspaceRefreshedAt}`);
  }
  if (noteUpdatesSinceSnapshot.length > 0) {
    const latestUpdate = Math.max(
      ...noteUpdatesSinceSnapshot.map((update) => update.occurredAt),
    );
    sections.push(
      `[Newer synthesized-note overlay]: ${noteUpdatesSinceSnapshot.length} meeting notes through ${new Date(latestUpdate).toISOString()}`,
    );
  }
  sections.push(
    '[Selection policy]: Older or stale threads are omitted from the main priority list.',
  );
  sections.push(
    `[Omitted older or stale count]: ${omittedStreams.length + omittedProjects.length}`,
  );

  if (omittedStreams.length > 0 || omittedProjects.length > 0) {
    const omittedLines = [
      ...omittedStreams.map((item) => {
        const title =
          typeof item.title === 'string' ? item.title : 'Untitled stream';
        const read =
          typeof item.current_read === 'string' && item.current_read.trim()
            ? ` — ${item.current_read.trim()}`
            : '';
        const timestamp = recordDate(item, 'last_touched_at');
        return `- Stream "${title}"${read}${timestamp ? ` (last reinforced ${new Date(timestamp).toISOString()})` : ' (stale)'}`;
      }),
      ...omittedProjects.map((project) => {
        const title = project.display_title || project.name;
        const focus = project.current_focus
          ? ` — ${project.current_focus}`
          : project.next_milestone
            ? ` — next: ${project.next_milestone}`
            : '';
        const activityAt =
          project.last_mentioned_at || project.updated_at || null;
        return `- Project "${title}"${focus}${activityAt ? ` (last active ${activityAt})` : ' (stale)'}`;
      }),
    ];
    sections.push(`[Omitted older or stale work]:\n${omittedLines.join('\n')}`);
  }

  const currentReadIsUsable =
    Boolean(currentRead?.headline) &&
    currentRead?.freshness !== 'stale' &&
    globalSnapshot?.freshness !== 'stale' &&
    (!workspaceRefreshedTimestamp ||
      workspaceRefreshedTimestamp >= now - 7 * 24 * 60 * 60 * 1000);
  if (currentReadIsUsable && currentRead?.headline) {
    const bullets = (currentRead.supporting_bullets || [])
      .map((b) => `- ${b}`)
      .join('\n');
    sections.push(
      `[Workspace Current Read]: ${currentRead.headline}${bullets ? `\n${bullets}` : ''}`,
    );
  }

  if (activeStreams.length > 0) {
    const streamsText = activeStreams
      .slice(0, 5)
      .map((s) => {
        const title = typeof s.title === 'string' ? s.title : 'Active stream';
        const read =
          typeof s.current_read === 'string' && s.current_read.trim()
            ? `: ${s.current_read.trim()}`
            : '';
        const status =
          typeof s.status === 'string' && s.status.trim()
            ? ` [Status: ${s.status.trim()}]`
            : '';
        return `- Stream "${title}"${status}${read}`;
      })
      .join('\n');
    sections.push(`[Active Work Streams]:\n${streamsText}`);
  }

  if (openLoops.length > 0) {
    const loopsText = openLoops
      .slice(0, 5)
      .map((item) => {
        const title = typeof item.title === 'string' ? item.title : 'Open loop';
        const summary =
          typeof item.summary === 'string' && item.summary.trim()
            ? `: ${item.summary.trim()}`
            : '';
        const whyNow =
          typeof item.why_now === 'string' && item.why_now.trim()
            ? ` (Attention: ${item.why_now.trim()})`
            : '';
        return `- ${title}${summary}${whyNow}`;
      })
      .join('\n');
    sections.push(`[Open Loops & Blockers]:\n${loopsText}`);
  }

  if (risksAndUnknowns.length > 0) {
    const risksText = risksAndUnknowns
      .slice(0, 3)
      .map((r) => {
        const title = typeof r.title === 'string' ? r.title : 'Risk';
        const summary =
          typeof r.summary === 'string' && r.summary.trim()
            ? `: ${r.summary.trim()}`
            : '';
        return `- ${title}${summary}`;
      })
      .join('\n');
    sections.push(`[Risks & Key Unknowns]:\n${risksText}`);
  }

  if (openCommitments.length > 0 || candidateCommitments.length > 0) {
    const openLines = openCommitments.slice(0, 8).map((c) => {
      const dueStr = c.dueDate ? ` (Due: ${c.dueDate})` : '';
      const evidenceStr = c.evidence
        ? ` [Context: ${c.evidence.replace(/\s+/g, ' ').trim().slice(0, 160)}]`
        : '';
      return `- ${c.text}${dueStr}${evidenceStr}`;
    });
    const candidateLines = candidateCommitments.slice(0, 3).map((c) => {
      return `- [Unconfirmed candidate]: ${c.text}`;
    });
    sections.push(
      `[Your Commitments & Action Items]:\n${[...openLines, ...candidateLines].join('\n')}`,
    );
  } else {
    sections.push(
      '[Your Commitments]: No verified open action items are assigned to you in recent meetings. Orient priorities around active project goals, open loops, and recent decisions.',
    );
  }

  if (activeProjects.length > 0) {
    const projectLines = activeProjects.map((p) => {
      const title = p.display_title || p.name;
      const parts: string[] = [
        `- Project "${title}" [${p.status || 'active'}]`,
      ];
      if (p.current_focus) parts.push(`  * Current Focus: ${p.current_focus}`);
      if (p.next_milestone)
        parts.push(`  * Next Milestone: ${p.next_milestone}`);
      if (p.health_headline)
        parts.push(`  * Status Read: ${p.health_headline}`);
      const terms = extractProjectKeyTerms(
        p.metadata,
        readProjectThemeSynthesis(p.metadata),
      );
      if (terms.length > 0) {
        parts.push(`  * Labels & Key Terms: ${terms.slice(0, 5).join(', ')}`);
      }
      if (p.recent_change) {
        parts.push(`  * Recent Change: ${p.recent_change}`);
      }
      return parts.join('\n');
    });
    sections.push(`[Active Projects & Focus]:\n${projectLines.join('\n')}`);
  }

  if (recentMeetings.length > 0) {
    const meetingLines = recentMeetings.map((m) => {
      const dateStr = m.started_at || m.created_at;
      const formattedDate = dateStr
        ? new Date(dateStr).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
          })
        : 'recent';
      const mid = parseMid(m.mid_json);
      const decisions = mid?.decisions?.map((d) => d.description).slice(0, 2);
      const decisionsStr = decisions?.length
        ? ` | Decisions: ${decisions.join('; ')}`
        : '';
      const notes = m.enhanced_notes || m.user_notes || '';
      const summaryMatch = notes.match(
        /\[(?:Analysis|Overview|Summary)\]:\s*([^\n]+)/i,
      );
      const summaryText = summaryMatch?.[1]
        ? ` — ${summaryMatch[1].trim().slice(0, 140)}`
        : '';
      return `- Meeting "${m.title || 'Untitled'}" (${formattedDate})${summaryText}${decisionsStr}`;
    });
    sections.push(
      `[Recent Meetings & Key Decisions]:\n${meetingLines.join('\n')}`,
    );
  }

  const primaryResult: RetrievalResult = {
    meeting_id: 'workspace:intelligence',
    meeting_title:
      'Workspace Intelligence: Working Memory, Streams & Priorities',
    source_type: 'artifact',
    source_id: 'workspace:intelligence',
    mid: null,
    evidence_text: sections.join('\n\n'),
    score: 1.0,
    score_breakdown: {
      fts_rank: 1,
      graph_proximity: 1,
      recency_decay: 1,
      mention_weight: 1,
    },
    evidence_kind: 'overview',
    trust_status: globalSnapshot?.trust_status ?? 'grounded',
  };

  const source = '[Source 1]';

  const immediatePriorities: WorkspaceFocusItem[] = openCommitments
    .slice(0, 3)
    .map((commitment) => ({
      title: commitment.text,
      nextMove: commitment.dueDate
        ? `Complete by ${commitment.dueDate}`
        : undefined,
      whyNow: commitment.evidence
        ? truncateAtThoughtBoundary(commitment.evidence, 180)
        : undefined,
      source,
    }));

  const seenWork = new Set<string>();
  const activeWork: WorkspaceFocusItem[] = [
    ...activeStreams.map((stream) => {
      const title =
        typeof stream.title === 'string' ? stream.title : 'Active stream';
      const current =
        typeof stream.current_read === 'string' && stream.current_read.trim()
          ? stream.current_read.trim()
          : undefined;
      return {
        title,
        current,
        source,
      };
    }),
    ...activeProjects.map((project) => {
      const title = project.display_title || project.name;
      const current =
        project.current_focus &&
        !isGenericProjectDescription(project.current_focus)
          ? project.current_focus
          : undefined;
      return {
        title,
        current,
        nextMove: project.next_milestone || undefined,
        whyNow:
          project.recent_change ||
          (project.health_headline && project.health_headline.length >= 16
            ? project.health_headline
            : undefined),
        source,
      };
    }),
  ].filter((item) => {
    const key = item.title.trim().toLocaleLowerCase();
    if (seenWork.has(key)) return false;
    seenWork.add(key);
    return true;
  });

  const rankedFocus = [...immediatePriorities, ...activeWork].slice(0, 4);

  const seenAttention = new Set<string>();
  const attentionItems = [
    ...openLoops.slice(0, 2).map((item) => {
      const title = typeof item.title === 'string' ? item.title : 'Open loop';
      const summary =
        typeof item.summary === 'string' && item.summary.trim()
          ? ` — ${item.summary.trim()}`
          : '';
      return `- ${title}${summary} ${source}`;
    }),
    ...risksAndUnknowns.slice(0, 2).map((risk) => {
      const title = typeof risk.title === 'string' ? risk.title : 'Risk';
      const summary =
        typeof risk.summary === 'string' && risk.summary.trim()
          ? ` — ${risk.summary.trim()}`
          : '';
      return `- ${title}${summary} ${source}`;
    }),
    ...candidateCommitments
      .slice(0, 1)
      .map(
        (commitment) => `- Unconfirmed follow-up: ${commitment.text} ${source}`,
      ),
  ]
    .filter((line) => {
      const key = line
        .replace(/^-\s*/, '')
        .split(/\s+—\s+|\s+\[Source/)[0]
        .toLocaleLowerCase();
      if (seenAttention.has(key)) return false;
      seenAttention.add(key);
      return true;
    })
    .slice(0, 3);

  const seenRisks = new Set<string>();
  const riskItems = [...openLoops, ...risksAndUnknowns]
    .filter((item) => {
      const title = String(item.title || '')
        .trim()
        .toLocaleLowerCase();
      if (!title || seenRisks.has(title)) return false;
      seenRisks.add(title);
      return true;
    })
    .slice(0, mode === 'risks_expanded' ? 5 : 3)
    .map((item) => {
      const title = String(item.title).trim();
      const summary =
        typeof item.summary === 'string' && item.summary.trim()
          ? ` — ${item.summary.trim()}`
          : '';
      const whyNow =
        mode === 'risks_expanded' &&
        typeof item.why_now === 'string' &&
        item.why_now.trim()
          ? ` Why it was flagged: ${item.why_now.trim().replace(/[.!?]+$/, '')}.`
          : '';
      return `- ${title}${summary}${whyNow} ${source}`;
    });

  const answerSections: string[] = [];
  const updateLines = noteUpdatesSinceSnapshot
    .slice(0, 2)
    .map((update) => `- ${update.title} — ${update.detail} ${update.source}`);
  const omittedLines = [
    ...omittedStreams.map((item) => {
      const title =
        typeof item.title === 'string' ? item.title : 'Untitled stream';
      const read =
        typeof item.current_read === 'string' && item.current_read.trim()
          ? ` — ${item.current_read.trim()}`
          : '';
      const timestamp = recordDate(item, 'last_touched_at');
      const date = timestamp
        ? ` (last reinforced ${new Date(timestamp).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
          })})`
        : '';
      return `- ${title}${read}${date} ${source}`;
    }),
    ...omittedProjects.map((project) => {
      const title = project.display_title || project.name;
      const focus = project.current_focus
        ? ` — ${project.current_focus}`
        : project.next_milestone
          ? ` — next: ${project.next_milestone}`
          : '';
      const activityAt = Date.parse(
        project.last_mentioned_at || project.updated_at || '',
      );
      const date = activityAt
        ? ` (last active ${new Date(activityAt).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
          })})`
        : '';
      return `- ${title}${focus}${date} ${source}`;
    }),
  ].slice(0, 8);
  const snapshotNeedsConfirmation = Boolean(
    workspaceRefreshedTimestamp &&
      workspaceRefreshedTimestamp < now - 7 * 24 * 60 * 60 * 1000,
  );
  const refreshedLabel = workspaceRefreshedAt
    ? new Date(workspaceRefreshedAt).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      })
    : null;

  if (mode === 'omitted') {
    if (omittedLines.length > 0) {
      answerSections.push(
        `I left these older or stale signals out of the main priority list. ${source}`,
      );
      answerSections.push(
        `**Left out as older or stale**\n${omittedLines.join('\n')}`,
      );
    } else {
      answerSections.push(
        `I didn’t find any synthesized workstreams or projects marked stale. The shorter list came from deduplicating overlapping work and keeping the briefing focused. ${source}`,
      );
    }
  }

  if (mode === 'risks' || mode === 'risks_expanded') {
    answerSections.push(
      snapshotNeedsConfirmation
        ? `I’d treat these as recorded watch points, not confirmed blockers today. The workspace synthesis is from ${refreshedLabel}.`
        : 'Here are the concerns I’d check first.',
    );
    const riskUpdates = noteUpdatesSinceSnapshot
      .filter((update) =>
        /\b(?:risk|blocker|incident|issue|unreliable|failure|failed|delay|approval)\b/i.test(
          `${update.title} ${update.detail}`,
        ),
      )
      .slice(0, mode === 'risks_expanded' ? 3 : 2)
      .map((update) => `- ${update.title} — ${update.detail} ${update.source}`);
    if (riskUpdates.length > 0) {
      answerSections.push(
        `**Relevant newer updates**\n${riskUpdates.join('\n')}`,
      );
    }
    answerSections.push(
      riskItems.length > 0
        ? `**${snapshotNeedsConfirmation ? `Watch points recorded by ${refreshedLabel}` : 'Watch points'}**\n${riskItems.join('\n')}`
        : 'I don’t see a specific recent risk or open loop in the workspace synthesis that I can confidently rank.',
    );
    if (mode === 'risks_expanded' && riskItems.length > 0) {
      answerSections.push(
        'The missing piece is whether each item remains open. I’d check its latest status and owner before treating it as an immediate blocker.',
      );
    }
  }

  if (mode === 'expanded') {
    const priorityTerms = rankedFocus.flatMap((item) => [
      item.title.toLocaleLowerCase(),
      ...(item.title.match(/\b[A-Z0-9]{2,}\b/g) || []).map((term) =>
        term.toLocaleLowerCase(),
      ),
      ...(
        item.title.toLocaleLowerCase().match(/[\p{L}\p{N}]{5,}/gu) || []
      ).filter(
        (term) =>
          !/^(?:client|project|program|initiative|workstream)$/.test(term),
      ),
    ]);
    const additionalUpdates = noteUpdatesSinceSnapshot
      .slice(2)
      .filter((update) =>
        priorityTerms.some((term) =>
          update.title.toLocaleLowerCase().includes(term),
        ),
      )
      .slice(0, 3)
      .map((update) => `- ${update.title} — ${update.detail} ${update.source}`);
    const addedFocusDetails = rankedFocus.flatMap((item) => {
      const extra = item.current && item.nextMove ? item.nextMove : null;
      return extra ? [`- **${item.title}:** ${extra} ${item.source}`] : [];
    });
    const currentReadDetails = currentReadIsUsable
      ? (currentRead?.supporting_bullets || [])
          .slice(0, 3)
          .map((bullet) => `- ${bullet} ${source}`)
      : [];
    answerSections.push(
      snapshotNeedsConfirmation
        ? `I can add what the synthesis records, but the standing priorities are still from ${refreshedLabel}; I can't confirm their status today.`
        : 'Here’s the additional detail I have on those priorities.',
    );
    if (additionalUpdates.length > 0) {
      answerSections.push(
        `**Additional recorded update**\n${additionalUpdates.join('\n')}`,
      );
    }
    if (addedFocusDetails.length > 0 || currentReadDetails.length > 0) {
      answerSections.push(
        `**More context**\n${[...addedFocusDetails, ...currentReadDetails].join('\n')}`,
      );
    }
    if (
      additionalUpdates.length === 0 &&
      addedFocusDetails.length === 0 &&
      currentReadDetails.length === 0
    ) {
      answerSections.push(
        'I don’t have a more specific synthesized update on those priorities yet. I’d check their current status before turning the older brief into a to-do list.',
      );
    }
  }

  if (mode === 'summary') {
    if (currentReadIsUsable && currentRead?.headline) {
      const headline = currentRead.headline.trim().replace(/[.!?]+$/, '');
      answerSections.push(`Here’s my read: **${headline}.** ${source}`);
    } else if (rankedFocus.length > 0) {
      answerSections.push(
        snapshotNeedsConfirmation
          ? `The newest synthesized updates are below. The broader priorities come from the ${refreshedLabel} workspace snapshot, so I’d confirm their current status before acting.`
          : 'Here’s where I’d put your attention right now.',
      );
    }

    if (snapshotNeedsConfirmation && updateLines.length > 0) {
      answerSections.push(`**Recent updates**\n${updateLines.join('\n')}`);
    }

    if (rankedFocus.length > 0) {
      const visibleFocus = rankedFocus.slice(0, 3);
      answerSections.push(
        `${snapshotNeedsConfirmation ? `**Standing priorities (as of ${refreshedLabel})**` : '**Focus now**'}\n${visibleFocus
          .map((item, index) => renderWorkspaceFocusItem(item, index))
          .join('\n\n')}`,
      );
    }

    if (!snapshotNeedsConfirmation && updateLines.length > 0) {
      answerSections.push(`**Recent updates**\n${updateLines.join('\n')}`);
    }
  }

  if (mode === 'summary' && attentionItems.length > 0) {
    answerSections.push(`**Keep an eye on**\n${attentionItems.join('\n')}`);
  }

  if (workspaceRefreshedAt && mode !== 'expanded') {
    const latestOverlay = noteUpdatesSinceSnapshot.length
      ? new Date(
          Math.max(
            ...noteUpdatesSinceSnapshot.map((update) => update.occurredAt),
          ),
        ).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      : null;
    answerSections.push(
      mode === 'risks' || mode === 'risks_expanded'
        ? `The base workspace synthesis was refreshed ${refreshedLabel}. ${source}`
        : latestOverlay
          ? `The base workspace synthesis was refreshed ${refreshedLabel}. ${source}\nNewer synthesized meeting notes are included through ${latestOverlay}. ${source}`
          : `I left older or stale threads out of the main list. The workspace synthesis was refreshed ${refreshedLabel}. ${source}`,
    );
  }

  const answer =
    answerSections.join('\n\n') ||
    'I don’t have enough recent synthesized context to give you a priority list I’d trust yet.';

  return {
    answer,
    context: [primaryResult, ...recentMeetingResults],
    summary: {
      hasWorkingMemory: Boolean(globalSnapshot),
      hasOpenCommitments: openCommitments.length > 0,
      hasActiveProjects: activeProjects.length > 0,
      recentMeetingCount: recentMeetings.length,
      openCommitmentCount: openCommitments.length,
      activeStreamCount: activeStreams.length,
    },
  };
};

const normalizeScopeText = (value: string): string =>
  value
    .toLocaleLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

export const resolveExplicitMeetingScope = (
  query: string,
  meetings: dbModule.PersistedMeeting[],
  recentLimit = 5,
): {
  kind: 'named' | 'recent';
  label: string;
  meetings: dbModule.PersistedMeeting[];
} | null => {
  const normalizedQuery = normalizeScopeText(query);
  const namedMatch = meetings
    .map((meeting) => ({
      meeting,
      normalizedTitle: normalizeScopeText(meeting.title || ''),
    }))
    .filter(
      ({ meeting, normalizedTitle }) =>
        normalizedTitle.length >= 8 &&
        !GENERIC_MEETING_TITLE.test(meeting.title || '') &&
        normalizedQuery.includes(normalizedTitle),
    )
    .sort(
      (left, right) =>
        right.normalizedTitle.length - left.normalizedTitle.length,
    )[0];
  if (namedMatch) {
    return {
      kind: 'named',
      label: namedMatch.meeting.title || 'the named meeting',
      meetings: [namedMatch.meeting],
    };
  }

  const numberWords: Record<string, number> = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
  };
  const boundedCount = (value: string | undefined): number | undefined => {
    if (!value) return undefined;
    const parsed = numberWords[value.toLocaleLowerCase()] ?? Number(value);
    return Number.isFinite(parsed)
      ? Math.min(24, Math.max(1, parsed))
      : undefined;
  };
  const countedRecentMatch = query.match(
    /\b(?:last|previous|recent|latest)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:meetings?|calls?)\b/i,
  );
  const requestedCount = boundedCount(countedRecentMatch?.[1]);
  if (
    !requestedCount &&
    !/\b(?:recent|latest)\s+(?:meetings|calls)\b/i.test(query)
  ) {
    return null;
  }
  const limit = requestedCount ?? recentLimit;
  return {
    kind: 'recent',
    label: requestedCount
      ? `your last ${limit} ${limit === 1 ? 'meeting' : 'meetings'}`
      : 'your recent meetings',
    meetings: meetings.slice(0, limit),
  };
};

export const shouldUsePreparedExtractiveAnswer = ({
  mode,
  contextCount,
}: {
  mode: 'fast' | 'deep' | undefined;
  contextCount: number;
}): boolean => mode === 'fast' && contextCount === 1;

const extractPreparedAnalysis = (evidence: string): string | null => {
  const match = evidence.match(
    /\[(?:Analysis|Overview|Summary)\]:\s*([\s\S]*?)(?=\n\[[^\]]+\]:|$)/i,
  );
  if (!match?.[1]) return null;
  const normalized = match[1].replace(/\s+/g, ' ').trim();
  if (normalized.length < 40 || CONTEXTLESS_SUMMARY_TEXT.test(normalized)) {
    return null;
  }
  const primaryClaim = normalized.split(
    /\s+and\s+(?=(?:evaluated|discussed|considered|reviewed|questioned)\b)/i,
  )[0];
  if (primaryClaim.length <= 280) {
    return /[.!?]$/.test(primaryClaim) ? primaryClaim : `${primaryClaim}.`;
  }
  const bounded = primaryClaim.slice(0, 280);
  const sentenceEnd = Math.max(
    bounded.lastIndexOf('.'),
    bounded.lastIndexOf('!'),
    bounded.lastIndexOf('?'),
  );
  return (sentenceEnd >= 80 ? bounded.slice(0, sentenceEnd + 1) : bounded)
    .trim()
    .replace(/[,;:]$/, '.');
};

const extractPreparedField = (
  evidence: string,
  label: 'Decisions' | 'Action items',
): string | null => {
  const match = evidence.match(
    new RegExp(`\\[${label}\\]:\\s*([\\s\\S]*?)(?=\\n\\[[^\\]]+\\]:|$)`, 'i'),
  );
  const normalized = match?.[1]?.replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  return /[.!?]$/.test(normalized) ? normalized : `${normalized}.`;
};

export const buildExtractiveTemporalSummary = (
  query: string,
  context: RetrievalResult[],
): string | null => {
  const field = EXTRACTIVE_DECISION_QUERY.test(query)
    ? 'Decisions'
    : EXTRACTIVE_ACTION_QUERY.test(query)
      ? 'Action items'
      : null;
  if (
    !field &&
    (!EXTRACTIVE_TEMPORAL_SUMMARY_QUERY.test(query) || context.length < 1)
  ) {
    return null;
  }
  const claims = context.flatMap((source, index) => {
    const title = (source.meeting_title || source.mid?.title || '').trim();
    if (!title || GENERIC_MEETING_TITLE.test(title)) return [];
    const prepared = field
      ? extractPreparedField(source.evidence_text, field)
      : extractPreparedAnalysis(source.evidence_text);
    if (!prepared) return [];
    return [`${title}: ${prepared} [Source ${index + 1}]`];
  });
  return claims.length > 0 ? claims.slice(0, 2).join('\n\n') : null;
};

/**
 * Core Retrieval logic: Vectorless RAG
 */
export const retrieveContext = async (
  parsed: ParsedQuery,
  options: {
    pinnedResults?: RetrievalResult[];
    query?: string;
    meetingIds?: string[];
  } = {},
): Promise<RetrievalResult[]> => {
  if (parsed.intent === 'conversational') {
    return [];
  }

  const startTime = Date.now();
  const TIME_BUDGET = 1000; // 1 second

  const resultsMap: Record<string, RetrievalResult> = {};

  // Sanitize keywords for SQLite FTS MATCH syntax to prevent SQL crashes
  const sanitizeForFts = (str: string) =>
    str.replace(/["*()\[\]{}^:~?!,.\-]/g, ' ').trim();
  const allKeywords = [...parsed.keywords, ...(parsed.expanded_keywords || [])]
    .map(sanitizeForFts)
    .filter((k) => k.length > 0);

  const ftsQueryStr = allKeywords
    .map((k) => {
      const parts = k.split(/\s+/).filter((p) => p.length > 0);
      if (parts.length > 1) {
        return `(${parts.map((p) => `"${p}"`).join(' AND ')})`;
      }
      return `"${parts[0]}"`;
    })
    .join(' OR ');

  // 2. Heading-first section search. Results remain grouped by meeting so the
  // prompt and citation contract stay bounded and backwards compatible.
  if (ftsQueryStr) {
    const sectionMatches = searchMeetingContextSectionsFts(ftsQueryStr, {
      limit: 30,
      ...(options.meetingIds?.length ? { meetingIds: options.meetingIds } : {}),
    }).filter(
      ({ section }) =>
        !containsConfidentialAside(
          `${section.heading}\n${section.summary}\n${section.content}`,
        ),
    );
    const sectionsByMeeting = new Map<string, typeof sectionMatches>();
    for (const match of sectionMatches) {
      const meetingId = String(match.meeting.id);
      const existing = sectionsByMeeting.get(meetingId) || [];
      if (existing.length < 3) existing.push(match);
      sectionsByMeeting.set(meetingId, existing);
    }
    for (const [meetingId, matches] of sectionsByMeeting) {
      const first = matches[0];
      const idx = sectionMatches.indexOf(first);
      const fts_rank = 1.0 / (idx + 1);
      const prepared = buildMeetingRetrievalResult(
        first.meeting,
        'Section match',
      );
      const occurredAt = first.meeting.started_at || first.meeting.created_at;
      const evidence = [
        `[Section match]: ${first.meeting.title || 'Untitled meeting'}`,
        ...(occurredAt ? [`[Occurred]: ${occurredAt}`] : []),
        ...matches.map(
          ({ section }) =>
            `[Section: ${section.heading}]: ${section.content.slice(0, 1800)}`,
        ),
      ];
      resultsMap[meetingId] = {
        ...prepared,
        evidence_text: evidence.join('\n'),
        evidence_kind: 'section',
        retrieved_sections: matches.map(({ section }) => ({
          section_id: section.section_id,
          heading: section.heading,
          kind: section.kind,
          summary: section.summary,
          trust_status: section.trust_status,
          source_revision: section.source_revision,
          ...(section.transcript_start_index !== null &&
          section.transcript_end_index !== null
            ? {
                transcript_range: [
                  section.transcript_start_index,
                  section.transcript_end_index,
                ] as [number, number],
              }
            : {}),
        })),
        source_revision: first.section.source_revision,
        trust_status: first.section.trust_status,
        score: fts_rank * 0.4,
        score_breakdown: {
          fts_rank,
          graph_proximity: 0,
          recency_decay: calculateRecencyDecay(first.meeting.started_at),
          mention_weight: 0,
        },
      };
    }

    // Search note-level evidence as well as sections. A database can be only
    // partially backfilled, so one section match must not hide other matching
    // meetings that currently exist only in the notes index.
    const meetings = searchMeetingNotesFts(ftsQueryStr, { limit: 20 }).filter(
      (meeting) =>
        (!options.meetingIds?.length ||
          options.meetingIds.includes(String(meeting.id))) &&
        !resultsMap[String(meeting.id)],
    );
    for (const [idx, m] of meetings.entries()) {
      // rank is an implicit SQLite FTS score, we mock it via idx if it's not exposed
      // Assuming return order is rank order
      const fts_rank = 1.0 / (idx + 1);
      const prepared = buildMeetingRetrievalResult(m, 'Notes match');
      resultsMap[String(m.id)] = {
        ...prepared,
        score: fts_rank * 0.4,
        score_breakdown: {
          fts_rank,
          graph_proximity: 0,
          recency_decay: calculateRecencyDecay(m.started_at),
          mention_weight: 0,
        },
      };
    }
  }

  const walkedMeetingCount = new Map<
    string,
    { proximity: number; count: number }
  >();

  // 3. Structural Search via Entity Graph (BFS 1-2 hops)
  for (const entityId of parsed.entity_mentions) {
    if (Date.now() - startTime > TIME_BUDGET) break;

    // Find meetings directly linked to this entity first
    const directMeetings = dbModule.getMeetingsForEntity(entityId);
    for (const dm of directMeetings) {
      if (
        options.meetingIds?.length &&
        !options.meetingIds.includes(String(dm.meeting_id))
      ) {
        continue;
      }
      const existing = walkedMeetingCount.get(dm.meeting_id) || {
        proximity: 0,
        count: 0,
      };
      walkedMeetingCount.set(dm.meeting_id, {
        proximity: Math.max(existing.proximity, 1.0), // direct hit
        count: existing.count + 1,
      });
    }

    // Walk the graph for related entities
    const relatedEntities = walkEntityGraph(entityId, 2, {
      state: 'confirmed',
    });
    for (const rel of relatedEntities) {
      if (Date.now() - startTime > TIME_BUDGET) break;

      const relatedMeetings = dbModule.getMeetingsForEntity(rel.id);
      for (const rm of relatedMeetings) {
        if (
          options.meetingIds?.length &&
          !options.meetingIds.includes(String(rm.meeting_id))
        ) {
          continue;
        }
        const existing = walkedMeetingCount.get(rm.meeting_id) || {
          proximity: 0,
          count: 0,
        };
        walkedMeetingCount.set(rm.meeting_id, {
          proximity: Math.max(existing.proximity, 0.5), // indirect (graph-walked) hit
          count: existing.count + 1,
        });
      }
    }
  }

  // 4. Merge Graph results into resultsMap
  for (const [mId, stats] of walkedMeetingCount.entries()) {
    if (resultsMap[mId]) {
      // Boost existing FTS result
      resultsMap[mId].score_breakdown.graph_proximity = stats.proximity;
      resultsMap[mId].score_breakdown.mention_weight = Math.min(
        1,
        stats.count * 0.2,
      );
    } else {
      // Add new structural hit
      const m = dbModule.getAskPlutoMeeting(mId) as
        | dbModule.PersistedMeeting
        | undefined;
      if (!m) continue;

      const prepared = buildMeetingRetrievalResult(m, 'Related notes');
      resultsMap[mId] = {
        ...prepared,
        score: 0,
        score_breakdown: {
          fts_rank: 0,
          graph_proximity: stats.proximity,
          recency_decay: calculateRecencyDecay(m.started_at),
          mention_weight: Math.min(1, stats.count * 0.2),
        },
      };
    }
  }

  // 5. Time filter processing
  // (Range logic can be added here if temporal_range is set)

  const pinnedResults = mergeRetrievalResultsByMeeting(
    options.pinnedResults || [],
  );
  for (const pinnedResult of pinnedResults) {
    resultsMap[pinnedResult.meeting_id] ||= pinnedResult;
  }

  // 6. Result Fusion & Final Scoring
  const finalResults = Object.values(resultsMap).map((res) => {
    // Composite weights from design spec:
    // fts: 0.4, graph: 0.3, recency: 0.2, mentions: 0.1
    res.score =
      res.score_breakdown.fts_rank * 0.4 +
      res.score_breakdown.graph_proximity * 0.3 +
      res.score_breakdown.recency_decay * 0.2 +
      res.score_breakdown.mention_weight * 0.1;

    return res;
  });

  // Filter out low-relevance noise and return top K=6 to keep the prompt size manageable
  const filteredResults = finalResults.filter((res) => res.score > 0.05);
  filteredResults.sort((a, b) => b.score - a.score);

  const selected = !pinnedResults.length
    ? filteredResults.slice(0, 6)
    : [
        ...pinnedResults,
        ...filteredResults.filter(
          (result) =>
            !new Set(pinnedResults.map((pinned) => pinned.meeting_id)).has(
              result.meeting_id,
            ),
        ),
      ].slice(0, 6);
  return selected;
};
