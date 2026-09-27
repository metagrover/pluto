import { createHash } from 'node:crypto';
import type { AskPlutoActiveMeetingSnapshot } from '../../src/types/askPlutoQuery';
import { parseTranscriptSegments } from '../../src/utils/transcript';
import {
  searchMeetingContextSectionsFts,
  searchMeetingNotesFts,
  searchMeetingsFts,
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
  const document = buildMeetingNotesEvidenceDocument(
    meeting,
    dbModule.getMeetingNotesIdentityProjection(meeting.id).speakerDisplayNames,
  );
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
  const evidence = [
    `[Current recording - provisional]: ${snapshot.title || 'Meeting'}`,
  ];
  if (snapshot.participants.length > 0) {
    evidence.push(
      `[Participants]: ${snapshot.participants.slice(0, 8).join(', ')}`,
    );
  }
  if (snapshot.notes.trim()) {
    evidence.push(`[Live notes]: ${snapshot.notes.trim().slice(0, 1200)}`);
  }
  const transcript = snapshot.transcript
    .slice(-24)
    .map((segment) => `${segment.speaker || 'Speaker'}: ${segment.text.trim()}`)
    .filter((line) => !line.endsWith(': '))
    .join('\n');
  if (transcript)
    evidence.push(`[Live transcript - provisional]:\n${transcript}`);
  if (snapshot.interimText.trim()) {
    evidence.push(
      `[Interim transcript - unconfirmed]: ${snapshot.interimText.trim().slice(0, 700)}`,
    );
  }

  return {
    meeting_id: snapshot.meetingId,
    meeting_title: snapshot.title || 'Meeting',
    mid: null,
    evidence_text: evidence.join('\n').slice(0, 4800),
    score: 0,
    score_breakdown: {
      fts_rank: 0,
      graph_proximity: 0,
      recency_decay: 1,
      mention_weight: 0,
    },
    evidence_kind: 'live',
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
}

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
      };
    }
  }

  // 2. Scan all project entities in db
  const allProjects =
    typeof dbModule.getEntitiesByType === 'function'
      ? dbModule.getEntitiesByType('project')
      : [];
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

    const normalizedName = project.name.toLocaleLowerCase().trim();
    const normalizedDisplay = displayTitle.toLocaleLowerCase().trim();

    if (
      (normalizedName.length >= 3 &&
        normalizedQuery.includes(normalizedName)) ||
      (normalizedDisplay.length >= 3 &&
        normalizedQuery.includes(normalizedDisplay))
    ) {
      return {
        id: project.id,
        canonicalId,
        name: project.name,
        displayTitle,
        keyTerms,
      };
    }

    if (
      /\b(?:project|initiative|workstream|stream|roadmap)\b/i.test(
        normalizedQuery,
      )
    ) {
      for (const term of keyTerms) {
        const normalizedTerm = term.toLocaleLowerCase().trim();
        if (
          normalizedTerm.length >= 4 &&
          normalizedQuery.includes(normalizedTerm)
        ) {
          return {
            id: project.id,
            canonicalId,
            name: project.name,
            displayTitle,
            keyTerms,
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
          };
        }
      }
    }
  }

  return null;
};

export const isPlanningOrPriorityQuery = (query: string): boolean =>
  /\b(?:what\s+(?:should|do|can)\s+(?:i|we)\s+(?:need\s+to\s+)?(?:be\s+)?(?:focus|focusing|focused|working|work|do|prioritize|tackle)|what\s+(?:are|is)\s+(?:my|our|the\s+team(?:'s)?)\s+(?:top\s+)?(?:priorit(?:y|ies)|focus|deliverables?|next\s+steps?|action\s+items?|commitments?)|what(?:'s|\s+is)\s+(?:on\s+(?:my|our)\s+plate|(?:my|our)\s+(?:top\s+)?priorit(?:y|ies)|(?:my|our)\s+focus|top\s+of\s+mind|happening\s+with\s+(?:my|our)\s+work)|what\s+am\s+i\s+supposed\s+to\s+(?:be\s+)?(?:working|work|focus|do)|where\s+should\s+(?:i|we)\s+start|what\s+to\s+focus\s+on|next\s+steps?\s+for\s+(?:me|us)|current\s+priorities|active\s+streams|workspace\s+(?:overview|summary|update)|what(?:'s|\s+is)\s+going\s+on\s+across\s+(?:meetings|projects|my\s+work)|what\s+needs?\s+(?:my|our|immediate)?\s*attention|catch\s+me\s+up\s+on\s+(?:work|projects|priorities|everything)|how\s+should\s+i\s+prioritize|help\s+me\s+plan\s+(?:my|today|the\s+week)|what\s+did\s+i\s+commit\s+to)\b/i.test(
    query,
  );

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
        'I can extract entities, search through meeting transcripts using semantic retrieval, and answer factual questions using your recording history as context.';
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
      const meeting = dbModule.getMeeting(item.sourceMeetingId) as
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

export const buildProjectRecall = (
  query: string,
  entityMentions: string[] = [],
): {
  project: MatchedProjectEntity;
  displayTitle: string;
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
    const milestonesText = brief.milestones
      .slice(0, 6)
      .map(
        (m) =>
          `- ${m.title} (${m.status}${m.targetDate ? `, target: ${m.targetDate}` : ''})`,
      )
      .join('\n');
    sections.push(`[Milestones]:\n${milestonesText}`);
  }

  if (brief?.tasks?.length) {
    const tasksText = brief.tasks
      .slice(0, 8)
      .map(
        (t) =>
          `- ${t.name}${t.assigned_to ? ` [Owner: ${t.assigned_to}]` : ''}${t.due_date ? ` (due: ${t.due_date})` : ''} [Status: ${t.status || 'open'}]`,
      )
      .join('\n');
    sections.push(`[Tasks & Action Items]:\n${tasksText}`);
  }

  if (brief?.meetings?.length) {
    const meetingsText = brief.meetings
      .slice(0, 4)
      .map(
        (m) =>
          `- Meeting: "${m.title}" (${m.started_at || m.created_at || 'date unknown'})${m.context ? ` — Context: ${m.context.slice(0, 160)}` : ''}`,
      )
      .join('\n');
    sections.push(`[Recent Contributing Meetings]:\n${meetingsText}`);
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
  if (brief?.meetings?.length) {
    for (const m of brief.meetings.slice(0, 3)) {
      const persisted = dbModule.getMeeting(m.id) as
        | dbModule.PersistedMeeting
        | undefined;
      if (persisted) {
        meetingResults.push(
          buildMeetingRetrievalResult(
            persisted,
            `Project meeting (${displayTitle})`,
          ),
        );
      }
    }
  }

  return {
    project: matched,
    displayTitle,
    context: [projectRetrievalResult, ...meetingResults],
  };
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
      const meeting = dbModule.getMeeting(meetingId) as
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

export const buildWorkspaceIntelligenceRecall = (input: {
  query: string;
  persistedMeetings: dbModule.PersistedMeeting[];
  selfPersonId?: string | null;
}): WorkspaceIntelligenceRecall => {
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
  const activeStreams: Array<Record<string, unknown>> = rawActiveStreams.filter(
    (item): item is Record<string, unknown> =>
      Boolean(item) && typeof item === 'object',
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
  const openLoops: Array<Record<string, unknown>> = rawGlobalOpenLoops.filter(
    (item): item is Record<string, unknown> =>
      Boolean(item) && typeof item === 'object',
  );

  const rawRisks = Array.isArray(globalSnapshot?.payload?.risks_and_unknowns)
    ? globalSnapshot.payload.risks_and_unknowns
    : [];
  const risksAndUnknowns: Array<Record<string, unknown>> = rawRisks.filter(
    (item): item is Record<string, unknown> =>
      Boolean(item) && typeof item === 'object',
  );

  const portfolio =
    typeof dbModule.getProjectPortfolio === 'function'
      ? dbModule.getProjectPortfolio()
      : [];

  const activeProjects = portfolio
    .filter((p) => p.status !== 'completed')
    .slice(0, 4);

  const recentMeetings = input.persistedMeetings.slice(0, 4);

  const sections: string[] = ['[Workspace Intelligence & Executive Briefing]'];

  if (currentRead?.headline) {
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

  const recentMeetingResults = recentMeetings
    .slice(0, 3)
    .map((meeting) =>
      buildMeetingRetrievalResult(meeting, 'Recent meeting context'),
    );

  return {
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
    synthesizedOnly?: boolean;
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
    });
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

    if (
      !options.meetingIds?.length &&
      !/\b(?:meetings|calls)\b/i.test(options.query || '')
    ) {
      const searchFn =
        dbModule.searchLocalArtifactsFts || dbModule.searchLocalArtifacts;
      for (const artifact of searchFn(allKeywords, 8)) {
        const titleLower = artifact.title.toLowerCase();
        const textLower = artifact.extracted_text.toLowerCase();
        const entityMatches = (parsed.entity_mentions || []).filter(
          (entity: string) =>
            titleLower.includes(entity.toLowerCase()) ||
            textLower.includes(entity.toLowerCase()),
        );
        const entityWeight = entityMatches.length * 0.15;
        const score = artifact.match_score * 0.4 + entityWeight;

        resultsMap[`artifact:${artifact.id}`] = {
          meeting_id: artifact.id,
          meeting_title: artifact.title,
          source_type: 'artifact',
          source_id: artifact.id,
          mid: null,
          evidence_text: [
            `[Local artifact]: ${artifact.title}`,
            `[Captured]: ${artifact.captured_at}`,
            `[Content]: ${artifact.extracted_text.slice(0, 3200)}`,
          ].join('\n'),
          score,
          score_breakdown: {
            fts_rank: artifact.match_score,
            graph_proximity: entityWeight,
            recency_decay: calculateRecencyDecay(artifact.captured_at),
            mention_weight: entityWeight,
          },
          evidence_kind: 'artifact',
          source_revision: artifact.content_hash,
          trust_status: artifact.trust_status,
        };
      }
    }

    // Transcript-only meetings are considered only after notes and headings
    // fail, and only when exact wording is explicitly requested and synthesizedOnly is not set.
    if (
      !options.synthesizedOnly &&
      Object.keys(resultsMap).length === 0 &&
      /\b(?:quote|verbatim|word for word|exact(?:ly)?(?: what| how)?|exact words?)\b/i.test(
        options.query || '',
      )
    ) {
      for (const [idx, meeting] of searchMeetingsFts(ftsQueryStr, {
        limit: 12,
      })
        .filter(
          (meeting) =>
            !options.meetingIds?.length ||
            options.meetingIds.includes(String(meeting.id)),
        )
        .entries()) {
        const prepared = buildMeetingRetrievalResult(
          meeting,
          'Transcript candidate',
        );
        resultsMap[String(meeting.id)] = {
          ...prepared,
          score_breakdown: {
            ...prepared.score_breakdown,
            fts_rank: 1 / (idx + 1),
          },
        };
      }
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
      const m = dbModule.getMeeting(mId) as
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
  const transcriptRequested =
    !options.synthesizedOnly &&
    /\b(?:quote|verbatim|word for word|exact(?:ly)?(?: what| how)?|exact words?)\b/i.test(
      options.query || '',
    );
  if (!transcriptRequested) return selected;

  const queryTokens = new Set(
    allKeywords
      .flatMap((keyword) => keyword.toLocaleLowerCase().split(/\s+/))
      .filter((token) => token.length > 2),
  );
  return selected.map((result) => {
    const meeting = dbModule.getMeeting(result.meeting_id) as
      | dbModule.PersistedMeeting
      | undefined;
    if (!meeting?.transcript_json) return result;
    const segments = parseTranscriptSegments(meeting.transcript_json);
    const transcriptRevision = createHash('sha256')
      .update(meeting.transcript_json)
      .digest('hex');
    const transcriptTrust =
      meeting.transcript_status === 'validated'
        ? ('grounded' as const)
        : ('weak_evidence' as const);
    const preferredRanges = result.retrieved_sections
      ?.map((section) => section.transcript_range)
      .filter((range): range is [number, number] => Boolean(range));
    const ranked = segments
      .map((segment, index) => {
        const record = segment as Record<string, unknown>;
        const text = typeof record.text === 'string' ? record.text.trim() : '';
        const normalized = text.toLocaleLowerCase();
        const keywordScore = [...queryTokens].filter((token) =>
          normalized.includes(token),
        ).length;
        const rangeScore = preferredRanges?.some(
          ([start, end]) => index >= start && index <= end,
        )
          ? 2
          : 0;
        return { index, record, text, score: keywordScore + rangeScore };
      })
      .filter((candidate) => candidate.text && candidate.score > 0)
      .sort(
        (left, right) => right.score - left.score || left.index - right.index,
      )
      .slice(0, 3);
    const used = new Set<number>();
    const passages = ranked.flatMap((candidate) => {
      if (used.has(candidate.index)) return [];
      const startIndex = Math.max(0, candidate.index - 1);
      const endIndex = Math.min(segments.length - 1, candidate.index + 1);
      for (let index = startIndex; index <= endIndex; index += 1)
        used.add(index);
      const window = segments.slice(startIndex, endIndex + 1);
      const lines = window.flatMap((segment) => {
        const record = segment as Record<string, unknown>;
        const text = typeof record.text === 'string' ? record.text.trim() : '';
        if (!text) return [];
        const speaker =
          typeof record.speaker === 'string' && record.speaker.trim()
            ? record.speaker.trim()
            : 'Speaker';
        return [`${speaker}: ${text}`];
      });
      const first = window[0] as Record<string, unknown> | undefined;
      const last = window.at(-1) as Record<string, unknown> | undefined;
      const secondsToMs = (value: unknown) =>
        typeof value === 'number' && Number.isFinite(value)
          ? Math.max(0, Math.round(value * 1000))
          : undefined;
      const startMs = first
        ? secondsToMs(first.start ?? first.startTime)
        : undefined;
      const endMs = last ? secondsToMs(last.end ?? last.endTime) : undefined;
      return [
        {
          quote: lines.join('\n').slice(0, 1200),
          speaker:
            typeof candidate.record.speaker === 'string'
              ? candidate.record.speaker
              : 'Speaker',
          ...(startMs !== undefined ? { start_ms: startMs } : {}),
          ...(endMs !== undefined ? { end_ms: endMs } : {}),
          start_segment_index: startIndex,
          end_segment_index: endIndex,
          source_revision: transcriptRevision,
          trust_status: transcriptTrust,
        },
      ];
    });
    if (!passages.length) return result;
    return {
      ...result,
      evidence_text: `${result.evidence_text}\n${passages
        .map(
          (passage) =>
            `[Transcript passage${passage.start_ms !== undefined ? ` at ${Math.round(passage.start_ms / 1000)}s` : ''}]: ${passage.quote}`,
        )
        .join('\n')}`,
      evidence_kind: 'transcript' as const,
      transcript_passages: passages,
      source_revision: transcriptRevision,
      trust_status: transcriptTrust,
    };
  });
};
