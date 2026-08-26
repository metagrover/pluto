import type { AskPlutoActiveMeetingSnapshot } from '../../src/types/askPlutoQuery';
import { searchMeetingsFts, walkEntityGraph } from '../db';

import type {
  MidFrontmatter,
  ParsedQuery,
  RetrievalResult,
} from './intelligenceTypes';

import * as dbModule from '../db';
// We import the llm provider factory
import { getAllSettings, getProvider } from '../llm/factory';
import { getIntentClassificationPrompt } from './queryPrompts';
import { removeTemporalPhrase, resolveTemporalQuery } from './temporalScope';

interface AnalysisPoint {
  text?: string;
}

interface AnalysisTopic {
  title?: string;
  summary?: string;
  key_points?: AnalysisPoint[];
}

interface V3AnalysisDocument {
  analysis_schema_version?: number;
  topics?: AnalysisTopic[];
  overview?: string;
  summary?: string;
}

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
  const evidence: string[] = [
    `[${label}]: ${meeting.title || 'Untitled meeting'}`,
  ];
  if (typeof meeting.analysis_json === 'string') {
    try {
      const analysis = JSON.parse(meeting.analysis_json) as V3AnalysisDocument;
      const analysisText =
        analysis.overview ||
        analysis.summary ||
        analysis.topics
          ?.map((topic) => `${topic.title || ''}: ${topic.summary || ''}`)
          .filter(Boolean)
          .join('\n');
      if (analysisText)
        evidence.push(`[Analysis]: ${analysisText.slice(0, 1800)}`);
    } catch {
      // Other evidence remains usable.
    }
  }
  const notes = meeting.enhanced_notes || meeting.user_notes;
  if (typeof notes === 'string' && notes.trim()) {
    evidence.push(`[Notes]: ${notes.trim().slice(0, 1200)}`);
  }
  if (typeof meeting.transcript_json === 'string') {
    try {
      const transcript = JSON.parse(meeting.transcript_json) as {
        segments?: Array<{ speaker?: unknown; text?: unknown }>;
      };
      const transcriptText = transcript.segments
        ?.slice(-24)
        .map((segment) => {
          const text =
            typeof segment.text === 'string' ? segment.text.trim() : '';
          const speaker =
            typeof segment.speaker === 'string' ? segment.speaker : 'Speaker';
          return text ? `${speaker}: ${text}` : '';
        })
        .filter(Boolean)
        .join('\n');
      if (transcriptText) {
        evidence.push(`[Transcript]:\n${transcriptText.slice(0, 2400)}`);
      }
    } catch {
      // Other evidence remains usable.
    }
  }

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

/**
 * Core Retrieval logic: Vectorless RAG
 */
export const retrieveContext = async (
  parsed: ParsedQuery,
  options: { pinnedResults?: RetrievalResult[] } = {},
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

  // 2. FTS Search
  if (ftsQueryStr) {
    const meetings = searchMeetingsFts(ftsQueryStr, { limit: 20 });
    for (const [idx, m] of meetings.entries()) {
      // rank is an implicit SQLite FTS score, we mock it via idx if it's not exposed
      // Assuming return order is rank order
      const fts_rank = 1.0 / (idx + 1);
      let mid: MidFrontmatter | null = null;
      try {
        const midJsonStr = m.mid_json;
        if (typeof midJsonStr === 'string' && midJsonStr.trim()) {
          mid = JSON.parse(midJsonStr);
        }
      } catch (e) {
        // ignore JSON errors
      }

      let evidence_text = `[FTS Match]: ${m.snippet || 'No snippet'}\n`;

      // Prefer v3 analysis (topic-structured, richest content)
      if (typeof m.analysis_json === 'string') {
        try {
          const analysis = JSON.parse(m.analysis_json) as V3AnalysisDocument;
          if (
            analysis.analysis_schema_version === 3 &&
            Array.isArray(analysis.topics)
          ) {
            const topicSummaries = analysis.topics
              .map((t) => {
                const points = Array.isArray(t.key_points)
                  ? t.key_points.map((p) => `  - ${p.text || ''}`).join('\n')
                  : '';
                return `### ${t.title}\n${t.summary || ''}${
                  points ? `\n${points}` : ''
                }`;
              })
              .join('\n');
            evidence_text += `[Analysis]:\n${topicSummaries.substring(0, 1500)}`;
          } else if (analysis.overview) {
            evidence_text += `[Overview]: ${String(analysis.overview).substring(0, 1500)}`;
          } else if (analysis.summary) {
            evidence_text += `[Summary]: ${String(analysis.summary).substring(0, 1500)}`;
          }
        } catch (e) {
          // Fall through to enhanced_notes
        }
      }
      // Fallback to enhanced_notes if evidence is still thin
      if (
        evidence_text.length < 200 &&
        typeof m.enhanced_notes === 'string' &&
        m.enhanced_notes.length > 50
      ) {
        evidence_text += `[Notes]: ${m.enhanced_notes.substring(0, 1500)}`;
      }

      resultsMap[m.id as string] = {
        meeting_id: m.id as string,
        meeting_title: m.title || 'Untitled meeting',
        mid,
        evidence_text,
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

      let mid: MidFrontmatter | null = null;
      try {
        if (typeof m.mid_json === 'string') mid = JSON.parse(m.mid_json);
      } catch {
        // failed mid parse
      }

      resultsMap[mId] = {
        meeting_id: mId,
        meeting_title: m.title || 'Untitled meeting',
        mid,
        evidence_text:
          m.title +
          (m.user_notes ? ` - ${m.user_notes.substring(0, 200)}` : ''),
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

  for (const pinnedResult of options.pinnedResults || []) {
    resultsMap[pinnedResult.meeting_id] = pinnedResult;
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

  if (!options.pinnedResults?.length) return filteredResults.slice(0, 6);
  const pinnedIds = new Set(
    options.pinnedResults.map((result) => result.meeting_id),
  );
  return [
    ...options.pinnedResults,
    ...filteredResults.filter((result) => !pinnedIds.has(result.meeting_id)),
  ].slice(0, 6);
};
