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

/**
 * Parses a query string to extract intent, entities and semantic bounds.
 */
export const parseQuery = async (
  text: string,
  options: {
    signal?: AbortSignal;
    useModelClassification?: boolean;
    now?: Date;
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
    // Query-framing words that add FTS noise
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
  if (
    /^hi|hello|hey|thanks|thank you|who are you|what can you do|what is this/i.test(
      trimmed,
    )
  ) {
    console.log('[QueryEngine] Greeting detected, providing canned response');

    let cannedResponse =
      "Hi! I'm Pluto, your AI meeting assistant. Ask me anything about your meeting history.";
    if (/^who are you|what is this/i.test(trimmed)) {
      cannedResponse =
        "I'm Pluto, an AI meeting intelligence assistant. I can help you search through your meeting history, summarize discussions, and track action items.";
    } else if (/^what can you do/i.test(trimmed)) {
      cannedResponse =
        'I can extract entities, search through meeting transcripts using semantic retrieval, and answer factual questions using your recording history as context.';
    } else if (/^thanks|thank you/i.test(trimmed)) {
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

  if (options.useModelClassification === false) {
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

const ASSIGNEE_ACTION_QUERY_PATTERNS = [
  /\b(?:what(?:'s| is)|what else is|show me (?:what(?:'s| is))?)\s+assigned to\s+(.+?)(?:\?|$)/i,
  /\bwhat\s+does\s+(.+?)\s+own(?:\?|$)/i,
  /\bwhat\s+(?:are|were)\s+(.+?)(?:'s|’s)\s+action items?(?:\?|$)/i,
];

const parseAssigneeActionQuery = (query: string): string | null => {
  if (
    /\b(?:what (?:are|is)|show me|list)?\s*my\s+(?:(?:open|completed|done|closed)\s+)?(?:commitments?|action items?|tasks?)\b/i.test(
      query,
    ) ||
    /\bwhat\s+do\s+i\s+own\b/i.test(query) ||
    /\b(?:commitments?|action items?|tasks?)\s+(?:are\s+)?mine\b/i.test(query)
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
      /\b(?:completed|complete|done|closed|finished)\b/i.test(query);
    const confirmed = completedRequested
      ? canonicalCommitments.delivered
      : canonicalCommitments.open;
    const possible = completedRequested ? [] : canonicalCommitments.candidates;
    const selected = [
      ...confirmed.map((item) => ({ ...item, confirmed: true as const })),
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
            `${item.confirmed ? (completedRequested ? 'Completed commitment' : 'Confirmed assignment') : 'Possible follow-up'}: ${item.text}${item.dueDate ? ` Due ${formatActionDueDate(item.dueDate) || item.dueDate}.` : ''}${item.evidence ? ` Evidence: ${item.evidence}` : ''}`,
        )
        .join('\n');
      return {
        ...source,
        evidence_text: `[Commitments]:\n${evidence}`,
        evidence_kind: 'commitment' as const,
      };
    });
    const sourceIndex = new Map(
      groups.map((group, index) => [String(group.meeting.id), index + 1]),
    );
    const lines = [
      ...confirmed.map(
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
          : `I couldn't find any confirmed ${completedRequested ? 'completed' : 'open'} commitments assigned to ${subject}.`,
      context,
      coverageLimited: false,
      mentionedMeetingCount: context.length,
      commitmentCount: confirmed.length,
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

export const buildWorkingMemoryOverviewRecall = (
  query: string,
  entityMentions: string[],
): { context: RetrievalResult[]; scope: 'global' | 'project' } | null => {
  if (
    !/\b(?:overview|brief(?:ing)?|what(?:'s| is) going on|current priorities|active streams|risks and unknowns|across meetings)\b/i.test(
      query,
    )
  ) {
    return null;
  }
  const project = entityMentions
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
  return context.length
    ? { context, scope: project ? 'project' : 'global' }
    : null;
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

  if (!/\b(?:recent|latest)\s+(?:meetings|calls)\b/i.test(query)) {
    return null;
  }
  return {
    kind: 'recent',
    label: 'your recent meetings',
    meetings: meetings.slice(0, recentLimit),
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

    // Legacy note-level fallback covers databases while a section index is
    // being backfilled and notes that predate structured sections.
    const meetings =
      sectionMatches.length === 0
        ? searchMeetingNotesFts(ftsQueryStr, { limit: 20 }).filter(
            (meeting) =>
              !options.meetingIds?.length ||
              options.meetingIds.includes(String(meeting.id)),
          )
        : [];
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
    // fail, and only the matching meetings are eligible for deepening below.
    if (
      Object.keys(resultsMap).length === 0 &&
      /\b(?:quote|verbatim|exact|transcript|said|go deeper|why|rationale)\b/i.test(
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
    /\b(?:quote|verbatim|word for word|exact|transcript|what did .+ say|go deeper|why|rationale)\b/i.test(
      options.query || '',
    ) ||
    selected.some(
      (result) =>
        !result.evidence_text.includes('[Analysis]') &&
        !result.retrieved_sections?.length,
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
