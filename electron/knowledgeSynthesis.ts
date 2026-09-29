import { createHash } from 'node:crypto';
import { parseAnalysisDocumentV3Json } from '../src/utils/analysisDocument';
import { applySpeakerDisplayNamesToText } from '../src/utils/meetingNotesDocument';
import { projectMeetingNotesSpeakerReferences } from '../src/utils/meetingNotesSpeakerReferences';
import * as db from './db';
import {
  type AskPlutoClaimCorrection,
  parseAskPlutoCorrectionRecords,
} from './intelligence/askPlutoCorrections';
import { syncGlobalKnowledgeAttentionQueue } from './intelligence/attentionSync';
import {
  type KnowledgeSourceChunk,
  buildKnowledgeSourceChunks,
  chooseKnowledgeMergeResult,
  mergeChunkStructuredDocuments,
  splitKnowledgeSourceChunk,
} from './knowledgeChunking';
import {
  PERSON_CONTEXT_SYNTHESIS_VERSION,
  getKnowledgeSynthesisInputConfig,
  knowledgeDocNeedsSynthesis,
  knowledgeDocSatisfiesMeetingRefresh,
  parseKnowledgeDocConfig,
  withCurrentKnowledgeSynthesisConfig,
} from './knowledgeDocConfig';
import { parseKnowledgeJsonResponse } from './knowledgeJson';
import {
  type KnowledgeV2Document,
  applyKnowledgeCorrectionsToDocument,
  buildDeterministicKnowledgeV2Document,
  groundPersonKnowledgeV2Document,
  isKnowledgeV2Document,
  mergeKnowledgeV2Documents,
  parseKnowledgeV2Document,
  repairKnowledgeV2Document,
} from './knowledgeV2';
import { parseAnalysisMarkdown } from './llm/analysisDocument';
import { getAllSettings, getProvider } from './llm/factory';
import {
  getEntitySummaryPrompt,
  getKnowledgeDocumentMergePrompt,
  getKnowledgeDocumentPrompt,
} from './llm/prompts';
import {
  collectPersonSynthesisActivity,
  focusPersonSynthesisSources,
} from './personSynthesisSources';
import {
  createSerializedTaskGate,
  isSerializedTaskPreemption,
} from './serializedTaskGate';
import {
  persistGlobalWorkingMemorySnapshot,
  persistPersonContextWorkingMemorySnapshot,
  persistProjectWorkingMemorySnapshot,
  persistTeamTrackerWorkingMemorySnapshot,
} from './workingMemory';

const SYNTHESIS_DEBOUNCE_MS = 2500;
const MAX_SOURCE_MEETINGS = 80;
const MAX_SOURCE_MEETINGS_PER_SYNTHESIS_CHUNK = 6; // smaller chunks fit in 8k ctx
const MIN_RETRY_CHUNK_SOURCE_MEETINGS = 2;
const MAX_EVIDENCE_CHARS = 1400; // ~350 tokens per meeting — fits 6 meetings in 8k ctx
const MIN_EVIDENCE_CHARS = 140;
const MIN_SOURCE_MEETINGS = 6;
const MAX_TRANSCRIPT_HIGHLIGHTS = 10;
const MAX_ENTITY_CONTEXTS = 6;
const MAX_CONTEXT_CHARS = 220;
const ENTITY_SUMMARY_MAX_MEETINGS = 12;

export interface EntitySummarySentence {
  text: string;
  source_meeting_ids: string[];
}

export interface EntitySummary {
  sentences: EntitySummarySentence[];
  isInitialExtraction: boolean;
}

type KnowledgeSectionKey =
  | 'decisions'
  | 'topic_evolution'
  | 'open_risks'
  | 'signals';

interface KnowledgeCitation {
  meeting_id: string;
  quote: string;
}

interface KnowledgeStatement {
  id: string;
  text: string;
  why_it_matters: string;
  citations: KnowledgeCitation[];
}

type KnowledgeDependencyRelationship =
  | 'depends_on'
  | 'blocked_by'
  | 'owns'
  | 'impacts';

interface KnowledgeDependencySuggestion {
  source_name: string;
  target_name: string;
  relationship: KnowledgeDependencyRelationship;
  why: string;
  citations: KnowledgeCitation[];
}

interface KnowledgeChapter {
  chapter_id: string;
  title: string;
  decisions: KnowledgeStatement[];
  topic_evolution: KnowledgeStatement[];
  open_risks: KnowledgeStatement[];
  signals: KnowledgeStatement[];
}

interface KnowledgeStructuredDocument {
  schema_version: number;
  scope: {
    type: db.KnowledgeDocScopeType;
    title: string;
  };
  chapters: KnowledgeChapter[];
  dependency_suggestions: KnowledgeDependencySuggestion[];
}

type KnowledgeCompiledDocument =
  | KnowledgeStructuredDocument
  | KnowledgeV2Document;

interface KnowledgeSectionChange {
  section: string;
  added_count: number;
  removed_count: number;
  updated_count: number;
  sample_items: string[];
}

interface KnowledgeChangelog {
  generated_at: string;
  sections: KnowledgeSectionChange[];
}

interface SynthSourceMeeting {
  id: string;
  title: string;
  occurred_at: string | null;
  evidence: string;
  duration_seconds?: number | null;
  analysis_format_pass?: boolean | number | null;
  enhanced_notes?: string | null;
  user_notes?: string | null;
  entity_names?: string[];
}

type QueueState = {
  timer: ReturnType<typeof setTimeout> | null;
  inFlight: boolean;
  pending: boolean;
};

const queueByDocId = new Map<string, QueueState>();
let queuedSynthesisPaused = false;
type KnowledgeDocBackgroundScheduler = (docId: string) => void;
let knowledgeDocBackgroundScheduler: KnowledgeDocBackgroundScheduler | null =
  null;

export const configureKnowledgeDocBackgroundScheduler = (
  scheduler: KnowledgeDocBackgroundScheduler | null,
): void => {
  knowledgeDocBackgroundScheduler = scheduler;
};

// Different documents run serially because local Ollama is capacity-bound.
// Entity summaries use the same gate, so every local knowledge request respects
// the model's single generation slot. Matching requests share one result.
type GlobalSynthesisResult = db.KnowledgeDoc | EntitySummary | undefined;
const runWithGlobalSynthesisGate = createSerializedTaskGate<
  string,
  GlobalSynthesisResult
>();

const runKnowledgeDocWithGlobalSynthesisGate = (
  key: string,
  task: () => Promise<db.KnowledgeDoc | undefined>,
): Promise<db.KnowledgeDoc | undefined> =>
  runWithGlobalSynthesisGate(key, task) as Promise<db.KnowledgeDoc | undefined>;

const runEntitySummaryWithGlobalSynthesisGate = (
  key: string,
  task: () => Promise<EntitySummary>,
): Promise<EntitySummary> =>
  runWithGlobalSynthesisGate(key, task) as Promise<EntitySummary>;

const normalizeText = (value: string): string =>
  value.toLowerCase().replace(/\s+/g, ' ').trim();

const normalizeForMatch = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const clipText = (value: string, maxChars: number): string => {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars).trim()}...`;
};

const countWords = (value: string): number => {
  return value.trim().split(/\s+/).filter(Boolean).length;
};

const MIN_STATEMENT_LENGTH = 24;
const MIN_WHY_LENGTH = 18;
const MAX_SECTION_ITEMS = 5;

const isWeakStatement = (text: string): boolean => {
  const normalized = normalizeText(text);
  if (normalized.length < MIN_STATEMENT_LENGTH) return true;
  if (
    /^(there (is|was)|it was|discussion about|talked about|the participants|the documents mention|based on the|in this meeting|i have summarized)/i.test(
      text,
    )
  ) {
    return true;
  }
  return false;
};

const isWeakWhy = (text: string): boolean => {
  const normalized = normalizeText(text);
  if (normalized.length < MIN_WHY_LENGTH) return true;
  if (
    /^(important|matters|useful|relevant|it's worth noting|note that)\b/i.test(
      text,
    )
  )
    return true;
  return false;
};

const getState = (docId: string): QueueState => {
  const existing = queueByDocId.get(docId);
  if (existing) return existing;
  const created: QueueState = { timer: null, inFlight: false, pending: false };
  queueByDocId.set(docId, created);
  return created;
};

const flushPendingKnowledgeDocRefreshes = (delayMs = 250): void => {
  for (const [docId, state] of queueByDocId.entries()) {
    if (!state.pending || state.inFlight || state.timer) continue;
    if (knowledgeDocBackgroundScheduler) {
      knowledgeDocBackgroundScheduler(docId);
      continue;
    }
    state.timer = setTimeout(() => {
      state.timer = null;
      void runQueuedSynthesis(docId);
    }, delayMs);
  }
};

const extractTranscriptSegments = (
  raw: string | null | undefined,
): string[] => {
  if (!raw || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    const segments = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as { segments?: unknown[] })?.segments)
        ? ((parsed as { segments?: unknown[] }).segments as unknown[])
        : [];
    return segments
      .map((segment) => {
        if (!segment || typeof segment !== 'object') return '';
        const text = (segment as { text?: unknown }).text;
        return typeof text === 'string' ? text.trim() : '';
      })
      .filter(Boolean);
  } catch {
    return [];
  }
};

const extractTranscriptText = (raw: string | null | undefined): string => {
  return extractTranscriptSegments(raw).join(' ');
};

type AnalysisEvidence = {
  summary: string[];
  key_points: string[];
  action_items: string[];
  decisions: string[];
};

const emptyAnalysisEvidence = (): AnalysisEvidence => ({
  summary: [],
  key_points: [],
  action_items: [],
  decisions: [],
});

const hasAnalysisEvidence = (doc: AnalysisEvidence): boolean => {
  return (
    doc.summary.length > 0 ||
    doc.key_points.length > 0 ||
    doc.action_items.length > 0 ||
    doc.decisions.length > 0
  );
};

const normalizeList = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
};

const parseAnalysisJson = (
  raw: string | null | undefined,
): AnalysisEvidence => {
  if (!raw || !raw.trim()) return emptyAnalysisEvidence();
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    // v3 schema: extract from topic-structured document
    if (parsed.analysis_schema_version === 3) {
      const topics = Array.isArray(parsed.topics) ? parsed.topics : [];
      const key_points = (topics as Array<Record<string, unknown>>).flatMap(
        (t) =>
          Array.isArray(t.key_points)
            ? (t.key_points as Array<Record<string, unknown>>)
                .map((p) => (typeof p.text === 'string' ? p.text.trim() : ''))
                .filter(Boolean)
            : [],
      );
      const allDecisions = Array.isArray(parsed.all_decisions)
        ? (parsed.all_decisions as Array<Record<string, unknown>>)
            .map((d) => (typeof d.text === 'string' ? d.text.trim() : ''))
            .filter(Boolean)
        : [];
      const allActionItems = Array.isArray(parsed.all_action_items)
        ? (parsed.all_action_items as Array<Record<string, unknown>>)
            .map((a) => {
              const text = typeof a.text === 'string' ? a.text.trim() : '';
              const assignee =
                typeof a.assignee === 'string' ? a.assignee.trim() : '';
              return assignee ? `${assignee}: ${text}` : text;
            })
            .filter(Boolean)
        : [];

      return {
        summary: [
          typeof parsed.overview === 'string' ? parsed.overview.trim() : '',
        ]
          .filter(Boolean)
          .slice(0, 6),
        key_points: key_points.slice(0, 8),
        action_items: allActionItems.slice(0, 6),
        decisions: allDecisions.slice(0, 6),
      };
    }

    // v2 schema: flat arrays
    return {
      summary: normalizeList(parsed.summary).slice(0, 6),
      key_points: normalizeList(parsed.key_points).slice(0, 8),
      action_items: normalizeList(parsed.action_items).slice(0, 6),
      decisions: normalizeList(parsed.decisions).slice(0, 6),
    };
  } catch {
    return emptyAnalysisEvidence();
  }
};

const parseAnalysisNotes = (
  raw: string | null | undefined,
): AnalysisEvidence => {
  if (!raw || !raw.trim()) return emptyAnalysisEvidence();
  const parsed = parseAnalysisMarkdown(raw);
  return {
    summary: parsed.document.summary.slice(0, 6),
    key_points: parsed.document.key_points.slice(0, 8),
    action_items: parsed.document.action_items.slice(0, 6),
    decisions: parsed.document.decisions.slice(0, 6),
  };
};

const formatEvidenceList = (label: string, items: string[]): string => {
  if (items.length === 0) return '';
  const clipped = items.map((item) => clipText(item, 180));
  return `${label}: ${clipped.join(' | ')}`;
};

const extractAnalysisEvidence = (
  analysisRaw: string | null | undefined,
  notesRaw: string | null | undefined,
): { text: string; usedNotes: boolean } => {
  const fromJson = parseAnalysisJson(analysisRaw);
  const hasJson = hasAnalysisEvidence(fromJson);
  const fromNotes = hasJson
    ? emptyAnalysisEvidence()
    : parseAnalysisNotes(notesRaw);
  const hasNotes = hasAnalysisEvidence(fromNotes);
  const source = hasJson ? fromJson : fromNotes;
  if (!hasAnalysisEvidence(source)) {
    return { text: '', usedNotes: false };
  }

  const lines = [
    formatEvidenceList('Summary', source.summary),
    formatEvidenceList('Key points', source.key_points),
    formatEvidenceList('Action items', source.action_items),
    formatEvidenceList('Decisions', source.decisions),
  ].filter(Boolean);

  return { text: lines.join('\n'), usedNotes: !hasJson && hasNotes };
};

const extractNotesEvidence = (raw: string | null | undefined): string => {
  if (!raw || !raw.trim()) return '';
  const parsed = parseAnalysisNotes(raw);
  if (hasAnalysisEvidence(parsed)) {
    const lines = [
      formatEvidenceList('Notes summary', parsed.summary),
      formatEvidenceList('Notes highlights', parsed.key_points),
      formatEvidenceList('Notes action items', parsed.action_items),
      formatEvidenceList('Notes decisions', parsed.decisions),
    ].filter(Boolean);
    if (lines.length > 0) return lines.join('\n');
  }
  return `Notes excerpt: ${clipText(raw.trim(), 700)}`;
};

const extractUserNotesEvidence = (raw: string | null | undefined): string => {
  if (!raw || !raw.trim()) return '';
  return `User notes: ${clipText(raw.trim(), 400)}`;
};

const extractValueSignalsEvidence = (
  raw: string | null | undefined,
): string => {
  if (!raw || !raw.trim()) return '';
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const lines: string[] = [];
    const append = (label: string, value: unknown) => {
      if (!Array.isArray(value) || value.length === 0) return;
      const texts = value.filter(
        (item): item is string => typeof item === 'string',
      );
      if (texts.length === 0) return;
      lines.push(`${label}: ${texts.join(' | ')}`);
    };
    append('Continuity signals', parsed.continuity);
    append('Accountability risks', parsed.accountability_risks);
    append('Decision impacts', parsed.decision_impacts);
    if (Array.isArray(parsed.extra_tags) && parsed.extra_tags.length > 0) {
      const tags = parsed.extra_tags
        .map((tag) => {
          if (!tag || typeof tag !== 'object') return '';
          const record = tag as Record<string, unknown>;
          const label = typeof record.tag === 'string' ? record.tag.trim() : '';
          if (!label) return '';
          const confidence =
            typeof record.confidence === 'number'
              ? record.confidence.toFixed(2)
              : null;
          return confidence ? `${label} (${confidence})` : label;
        })
        .filter(Boolean)
        .slice(0, 8);
      if (tags.length > 0) {
        lines.push(`Signal tags: ${tags.join(' | ')}`);
      }
    }
    return lines.join('\n');
  } catch {
    return '';
  }
};

const buildEntityHints = (
  entities: Array<{ type: string; name: string; mention_count: number }>,
): string => {
  if (!entities.length) return '';
  const topByType = new Map<string, string[]>();
  for (const entity of entities.slice(0, 12)) {
    if (!topByType.has(entity.type)) {
      topByType.set(entity.type, []);
    }
    const label =
      entity.mention_count > 1
        ? `${entity.name} (${entity.mention_count})`
        : entity.name;
    topByType.get(entity.type)?.push(label);
  }
  const lines = Array.from(topByType.entries()).map(
    ([type, names]) => `${type}: ${names.slice(0, 5).join(', ')}`,
  );
  return lines.length ? `Entity hints:\n${lines.join('\n')}` : '';
};

const buildEntityContextEvidence = (
  entities: Array<{ name: string; context: string | null }>,
): string => {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const entity of entities) {
    if (!entity.context || !entity.context.trim()) continue;
    const normalized = normalizeText(entity.context);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    lines.push(
      `- ${entity.name}: ${clipText(entity.context.trim(), MAX_CONTEXT_CHARS)}`,
    );
    if (lines.length >= MAX_ENTITY_CONTEXTS) break;
  }
  return lines.length > 0
    ? `Entity mention contexts:\n${lines.join('\n')}`
    : '';
};

const extractTranscriptHighlights = (
  raw: string | null | undefined,
  entityNames: string[],
): string => {
  const segments = extractTranscriptSegments(raw);
  if (segments.length === 0) return '';
  const normalizedEntities = entityNames
    .map((name) => normalizeForMatch(name))
    .filter((name) => name.length >= 3)
    .slice(0, 10);
  const actionCues = [
    /\bdecid(ed|es|ing)?\b/i,
    /\bblock(ed|er|ing)?\b/i,
    /\brisk(s|y)?\b/i,
    /\bneed(s|ed)?\b/i,
    /\bplan(s|ned)?\b/i,
    /\bwill\b/i,
    /\bship(ped|ping)?\b/i,
    /\bdeadline\b/i,
  ];

  const scored = segments.map((text, index) => {
    const normalized = normalizeForMatch(text);
    if (!normalized) {
      return { index, text, score: -3, normalized };
    }
    let score = 0;
    if (normalizedEntities.some((entity) => normalized.includes(entity))) {
      score += 3;
    }
    if (actionCues.some((cue) => cue.test(text))) {
      score += 1;
    }
    if (/\b\d{1,4}\b/.test(text)) {
      score += 1;
    }
    const wordCount = countWords(text);
    if (wordCount < 4) score -= 2;
    else if (wordCount < 7) score -= 1;
    return { index, text, score, normalized };
  });

  let candidates = scored.filter((item) => item.score > 0);
  if (candidates.length === 0) {
    candidates = scored.slice(0, 4);
  }

  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return countWords(b.text) - countWords(a.text);
  });

  const picked = candidates.slice(0, MAX_TRANSCRIPT_HIGHLIGHTS);
  picked.sort((a, b) => a.index - b.index);

  const seen = new Set<string>();
  const lines: string[] = [];
  for (const item of picked) {
    if (!item.normalized || seen.has(item.normalized)) continue;
    seen.add(item.normalized);
    lines.push(`- ${clipText(item.text, 200)}`);
  }

  return lines.length > 0 ? `Transcript highlights:\n${lines.join('\n')}` : '';
};

type MeetingEvidenceBundle = {
  evidence: string;
  score: number;
};

const scoreMeetingEvidence = (params: {
  meeting: db.KnowledgeDocSourceMeeting;
  analysisText: string;
  notesText: string;
  userNotesText: string;
  valueSignalsText: string;
  entityContextText: string;
  transcriptHighlights: string;
}): number => {
  let score = 0;
  if (params.meeting.analysis_format_pass) score += 2;
  if (params.analysisText) score += 4;
  if (params.notesText) score += 2;
  if (params.userNotesText) score += 1;
  if (params.valueSignalsText) score += 1;
  if (params.entityContextText) score += 1;
  if (params.transcriptHighlights) score += 1;
  const mentions = Math.max(0, params.meeting.mention_count || 0);
  if (mentions > 0) score += Math.min(3, Math.log2(mentions + 1));
  return score;
};

const buildMeetingEvidence = (
  meeting: db.KnowledgeDocSourceMeeting,
): MeetingEvidenceBundle => {
  let entities: Array<{
    type: string;
    name: string;
    mention_count: number;
    context: string | null;
  }> = [];
  try {
    entities = db.getMeetingEntities(String(meeting.id));
  } catch {
    entities = [];
  }

  const entityHints = buildEntityHints(entities);
  const entityContextText = buildEntityContextEvidence(entities);
  const speakerDisplayNames = db.getMeetingNotesIdentityProjection(
    meeting.id,
  ).speakerDisplayNames;
  const parsedAnalysis = parseAnalysisDocumentV3Json(meeting.analysis_json);
  const projectedAnalysis = parsedAnalysis
    ? JSON.stringify(
        projectMeetingNotesSpeakerReferences(
          parsedAnalysis,
          speakerDisplayNames,
        ),
      )
    : meeting.analysis_json;
  const analysisEvidence = extractAnalysisEvidence(
    projectedAnalysis,
    meeting.enhanced_notes,
  );
  const analysisText = applySpeakerDisplayNamesToText(
    analysisEvidence.text,
    speakerDisplayNames,
  );
  const notesText = analysisEvidence.usedNotes
    ? ''
    : applySpeakerDisplayNamesToText(
        extractNotesEvidence(meeting.enhanced_notes),
        speakerDisplayNames,
      );
  const userNotesText = extractUserNotesEvidence(meeting.user_notes);
  const valueSignalsText = extractValueSignalsEvidence(
    meeting.value_signals_json,
  );
  const transcriptHighlights = extractTranscriptHighlights(
    meeting.transcript_json,
    entities.map((entity) => entity.name),
  );
  const context =
    typeof meeting.context === 'string' ? meeting.context.trim() : '';
  const transcriptText = extractTranscriptText(meeting.transcript_json);
  const transcriptExcerpt =
    !transcriptHighlights && transcriptText
      ? `Transcript excerpt: ${clipText(transcriptText, 600)}`
      : '';

  const combined = [
    entityHints,
    analysisText,
    notesText,
    userNotesText,
    valueSignalsText,
    entityContextText,
    context ? `Context snippet: ${clipText(context, MAX_CONTEXT_CHARS)}` : '',
    transcriptHighlights,
    transcriptExcerpt,
  ]
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
    .join('\n\n');

  if (!combined) {
    return { evidence: '', score: 0 };
  }

  const score = scoreMeetingEvidence({
    meeting,
    analysisText,
    notesText,
    userNotesText,
    valueSignalsText,
    entityContextText,
    transcriptHighlights,
  });

  const evidence =
    combined.length > MAX_EVIDENCE_CHARS
      ? `${combined.slice(0, MAX_EVIDENCE_CHARS)}...`
      : combined;

  return { evidence, score };
};

const sanitizeCitations = (
  list: unknown,
  sourceEvidenceByMeeting: Map<string, string>,
): { citations: KnowledgeCitation[]; citedMeetingIds: Set<string> } => {
  const output: KnowledgeCitation[] = [];
  const citedMeetingIds = new Set<string>();
  const rawCitations = Array.isArray(list) ? list : [];

  for (const entry of rawCitations) {
    if (!entry || typeof entry !== 'object') continue;
    const citation = entry as Record<string, unknown>;
    const meetingId =
      typeof citation.meeting_id === 'string' ? citation.meeting_id.trim() : '';
    const quote =
      typeof citation.quote === 'string' ? citation.quote.trim() : '';
    if (!meetingId || !quote || quote.length < 6) continue;

    const evidenceText = sourceEvidenceByMeeting.get(meetingId);
    if (!evidenceText) continue;
    if (!evidenceText.includes(normalizeText(quote))) continue;

    output.push({ meeting_id: meetingId, quote });
    citedMeetingIds.add(meetingId);
  }

  return { citations: output, citedMeetingIds };
};

const sanitizeStatementList = (params: {
  list: unknown;
  section: KnowledgeSectionKey;
  sourceEvidenceByMeeting: Map<string, string>;
  seenTexts: Set<string>;
}): KnowledgeStatement[] => {
  if (!Array.isArray(params.list)) return [];
  const output: KnowledgeStatement[] = [];

  for (const item of params.list) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const text = typeof record.text === 'string' ? record.text.trim() : '';
    if (!text || isWeakStatement(text)) continue;
    const why =
      typeof record.why_it_matters === 'string'
        ? record.why_it_matters.trim()
        : '';
    if (!why || isWeakWhy(why)) continue;

    const normalizedText = normalizeText(text);
    const dedupeKey = `${normalizedText}|${normalizeText(why)}`;
    if (params.seenTexts.has(dedupeKey)) continue;

    const { citations, citedMeetingIds } = sanitizeCitations(
      record.citations,
      params.sourceEvidenceByMeeting,
    );

    if (citations.length === 0) continue;
    if (params.section === 'topic_evolution' && citedMeetingIds.size < 2) {
      continue;
    }

    const id =
      typeof record.id === 'string' && record.id.trim().length > 0
        ? record.id.trim()
        : `item-${output.length + 1}`;

    output.push({ id, text, why_it_matters: why, citations });
    params.seenTexts.add(dedupeKey);

    if (output.length >= MAX_SECTION_ITEMS) {
      break;
    }
  }

  return output;
};

const sanitizeDependencySuggestions = (params: {
  value: unknown;
  sourceEvidenceByMeeting: Map<string, string>;
}): KnowledgeDependencySuggestion[] => {
  if (!Array.isArray(params.value)) return [];
  const out: KnowledgeDependencySuggestion[] = [];

  for (const item of params.value) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const sourceName =
      typeof record.source_name === 'string' ? record.source_name.trim() : '';
    const targetName =
      typeof record.target_name === 'string' ? record.target_name.trim() : '';
    const relationship =
      typeof record.relationship === 'string' ? record.relationship.trim() : '';
    const why = typeof record.why === 'string' ? record.why.trim() : '';
    if (!sourceName || !targetName || sourceName === targetName) continue;
    if (!why || isWeakWhy(why)) continue;

    if (
      relationship !== 'depends_on' &&
      relationship !== 'blocked_by' &&
      relationship !== 'owns' &&
      relationship !== 'impacts'
    ) {
      continue;
    }

    const { citations } = sanitizeCitations(
      record.citations,
      params.sourceEvidenceByMeeting,
    );
    if (!citations.length) continue;

    out.push({
      source_name: sourceName,
      target_name: targetName,
      relationship,
      why,
      citations,
    });
    if (out.length >= 30) break;
  }

  return out;
};

const inferEntityTypeForDependency = (label: string): db.EntityType => {
  const normalized = normalizeText(label);
  if (
    /\b(project|initiative|platform|workspace|migration|launch|roadmap)\b/i.test(
      normalized,
    )
  ) {
    return 'project';
  }
  if (/^(build|ship|fix|review|deploy|create|update|prepare)\b/i.test(label)) {
    return 'action_item';
  }
  return 'topic';
};

const resolveDependencyEntity = (name: string): db.Entity | undefined => {
  const entity = db.findEntity('project', name) || db.findEntity('topic', name);
  if (entity) return entity;

  const normalized = normalizeText(name);
  if (normalized.length < 3) return undefined;

  return db.upsertEntity({
    type: inferEntityTypeForDependency(name),
    name: name.trim(),
    status: 'active',
    metadata: { generated_by: 'knowledge_synthesis' },
  });
};

const persistDependencySuggestions = (
  suggestions: KnowledgeDependencySuggestion[],
): void => {
  for (const suggestion of suggestions) {
    const sourceEntity = resolveDependencyEntity(suggestion.source_name);
    const targetEntity = resolveDependencyEntity(suggestion.target_name);
    if (!sourceEntity || !targetEntity) continue;
    if (sourceEntity.id === targetEntity.id) continue;

    const primaryCitation = suggestion.citations[0];
    db.linkEntities({
      source_entity_id: sourceEntity.id,
      target_entity_id: targetEntity.id,
      relationship: suggestion.relationship,
      meeting_id: primaryCitation?.meeting_id || undefined,
      state: 'suggested',
      source: 'synthesis',
      evidence_meeting_id: primaryCitation?.meeting_id || null,
      evidence_quote:
        `${suggestion.why} — ${primaryCitation?.quote || ''}`.trim(),
      confidence: 0.72,
    });
  }
};

const sanitizeStructuredDocument = (params: {
  parsed: unknown;
  scopeType: db.KnowledgeDocScopeType;
  scopeTitle: string;
  sourceEvidenceByMeeting: Map<string, string>;
}): KnowledgeStructuredDocument => {
  const result: KnowledgeStructuredDocument = {
    schema_version: 1,
    scope: {
      type: params.scopeType,
      title: params.scopeTitle,
    },
    chapters: [],
    dependency_suggestions: [],
  };

  if (!params.parsed || typeof params.parsed !== 'object') {
    return result;
  }

  const top = params.parsed as Record<string, unknown>;
  const rawChapters = Array.isArray(top.chapters) ? top.chapters : [];
  const seenTexts = new Set<string>();
  result.dependency_suggestions = sanitizeDependencySuggestions({
    value: top.dependency_suggestions,
    sourceEvidenceByMeeting: params.sourceEvidenceByMeeting,
  });

  for (const chapter of rawChapters) {
    if (!chapter || typeof chapter !== 'object') continue;
    const record = chapter as Record<string, unknown>;
    const title = typeof record.title === 'string' ? record.title.trim() : '';
    if (!title) continue;

    const decisions = sanitizeStatementList({
      list: record.decisions,
      section: 'decisions',
      sourceEvidenceByMeeting: params.sourceEvidenceByMeeting,
      seenTexts,
    });
    const topicEvolution = sanitizeStatementList({
      list: record.topic_evolution,
      section: 'topic_evolution',
      sourceEvidenceByMeeting: params.sourceEvidenceByMeeting,
      seenTexts,
    });
    const openRisks = sanitizeStatementList({
      list: record.open_risks,
      section: 'open_risks',
      sourceEvidenceByMeeting: params.sourceEvidenceByMeeting,
      seenTexts,
    });
    const signals = sanitizeStatementList({
      list: record.signals,
      section: 'signals',
      sourceEvidenceByMeeting: params.sourceEvidenceByMeeting,
      seenTexts,
    });

    if (
      decisions.length === 0 &&
      topicEvolution.length === 0 &&
      openRisks.length === 0 &&
      signals.length === 0
    ) {
      continue;
    }

    const chapterId =
      typeof record.chapter_id === 'string' &&
      record.chapter_id.trim().length > 0
        ? record.chapter_id.trim()
        : `chapter-${result.chapters.length + 1}`;

    result.chapters.push({
      chapter_id: chapterId,
      title,
      decisions,
      topic_evolution: topicEvolution,
      open_risks: openRisks,
      signals,
    });
  }

  return result;
};

type SectionItemSnapshot = {
  raw: string;
  normalized: string;
};

const toSectionItems = (
  doc: KnowledgeStructuredDocument,
): Map<string, Map<string, SectionItemSnapshot>> => {
  const sectionMap = new Map<string, Map<string, SectionItemSnapshot>>();
  const sections: KnowledgeSectionKey[] = [
    'decisions',
    'topic_evolution',
    'open_risks',
    'signals',
  ];

  for (const section of sections) {
    sectionMap.set(section, new Map<string, SectionItemSnapshot>());
  }

  for (const chapter of doc.chapters) {
    for (const section of sections) {
      for (const item of chapter[section]) {
        const itemText = typeof item.text === 'string' ? item.text : '';
        const itemWhy =
          typeof item.why_it_matters === 'string' ? item.why_it_matters : '';
        const identity = `${chapter.chapter_id}|${item.id || normalizeText(itemText)}`;
        sectionMap.get(section)?.set(identity, {
          raw: `${itemText.trim()} - ${itemWhy.trim()}`,
          normalized: `${normalizeText(itemText)}|${normalizeText(itemWhy)}`,
        });
      }
    }
  }

  return sectionMap;
};

const parseStoredStructuredDoc = (
  raw: string | null,
): KnowledgeStructuredDocument | null => {
  if (!raw || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as KnowledgeStructuredDocument;
    if (!Array.isArray(parsed.chapters)) return null;
    if (!Array.isArray(parsed.dependency_suggestions)) {
      parsed.dependency_suggestions = [];
    }
    return parsed;
  } catch {
    return null;
  }
};

const parseStoredCompiledDoc = (
  raw: string | null,
): KnowledgeCompiledDocument | null => {
  return parseKnowledgeV2Document(raw) || parseStoredStructuredDoc(raw);
};

const isKnowledgeV1Document = (
  doc: KnowledgeCompiledDocument,
): doc is KnowledgeStructuredDocument => !isKnowledgeV2Document(doc);

const hasStructuredContent = (doc: KnowledgeCompiledDocument): boolean => {
  if (isKnowledgeV2Document(doc)) {
    return (
      doc.current_read.cited_item_count > 0 ||
      doc.active_streams.length > 0 ||
      doc.needs_attention.length > 0 ||
      doc.patterns.length > 0 ||
      doc.risks_and_unknowns.length > 0
    );
  }
  return (
    doc.chapters.some(
      (chapter) =>
        chapter.decisions.length > 0 ||
        chapter.topic_evolution.length > 0 ||
        chapter.open_risks.length > 0 ||
        chapter.signals.length > 0,
    ) || doc.dependency_suggestions.length > 0
  );
};

const countStructuredStatements = (doc: KnowledgeCompiledDocument): number =>
  isKnowledgeV2Document(doc)
    ? doc.needs_attention.length +
      doc.patterns.length +
      doc.risks_and_unknowns.length +
      doc.active_streams.length
    : doc.chapters.reduce(
        (sum, chapter) =>
          sum +
          chapter.decisions.length +
          chapter.topic_evolution.length +
          chapter.open_risks.length +
          chapter.signals.length,
        0,
      );

const MIN_USEFUL_SYNTHESIS_STATEMENTS = 4;

const promptScopeTitle = (doc: db.KnowledgeDoc): string =>
  doc.scope_type === 'person_context'
    ? db.getEntity(doc.scope_key)?.name || doc.title
    : doc.title;

const synthesizeStructuredFromPrompt = async (params: {
  provider: Awaited<ReturnType<typeof getProvider>>;
  prompt: string;
  scopeType: db.KnowledgeDocScopeType;
  scopeTitle: string;
  sourceEvidenceByMeeting: Map<string, string>;
  signal?: AbortSignal;
}): Promise<KnowledgeCompiledDocument> => {
  params.signal?.throwIfAborted();
  const raw = await params.provider.synthesizeKnowledgeDocument(params.prompt, {
    signal: params.signal,
  });
  params.signal?.throwIfAborted();
  const parsed = parseKnowledgeJsonResponse(raw);
  if (isKnowledgeV2Document(parsed)) {
    return repairKnowledgeV2Document(parsed);
  }
  return sanitizeStructuredDocument({
    parsed,
    scopeType: params.scopeType,
    scopeTitle: params.scopeTitle,
    sourceEvidenceByMeeting: params.sourceEvidenceByMeeting,
  });
};

const synthesizeKnowledgeChunkWithRetry = async (params: {
  provider: Awaited<ReturnType<typeof getProvider>>;
  doc: db.KnowledgeDoc;
  chunk: KnowledgeSourceChunk;
  sourceEvidenceByMeeting: Map<string, string>;
  claimCorrections: AskPlutoClaimCorrection[];
  signal?: AbortSignal;
}): Promise<KnowledgeCompiledDocument[]> => {
  try {
    const prompt = getKnowledgeDocumentPrompt({
      scopeType: params.doc.scope_type,
      scopeTitle:
        params.doc.scope_type === 'person_context'
          ? promptScopeTitle(params.doc)
          : `${params.doc.title} - ${params.chunk.label}`,
      sourceMeetings: params.chunk.sourceMeetings,
      previousStructuredJson: null,
      claimCorrections: params.claimCorrections,
    });
    const structured = await synthesizeStructuredFromPrompt({
      provider: params.provider,
      prompt,
      scopeType: params.doc.scope_type,
      scopeTitle: params.doc.title,
      sourceEvidenceByMeeting: params.sourceEvidenceByMeeting,
      signal: params.signal,
    });
    return hasStructuredContent(structured) ? [structured] : [];
  } catch (error) {
    if (params.signal?.aborted) throw error;
    if (isSerializedTaskPreemption(error)) throw error;
    if (params.chunk.sourceMeetings.length <= MIN_RETRY_CHUNK_SOURCE_MEETINGS) {
      console.warn(
        `[KnowledgeDoc] Chunk synthesis failed for ${params.doc.id} (${params.chunk.label}) at minimum retry size:`,
        error,
      );
      return [];
    }

    console.warn(
      `[KnowledgeDoc] Chunk synthesis failed for ${params.doc.id} (${params.chunk.label}); retrying smaller chunks:`,
      error,
    );

    const retryDocs: KnowledgeCompiledDocument[] = [];
    for (const retryChunk of splitKnowledgeSourceChunk(params.chunk)) {
      const nestedDocs = await synthesizeKnowledgeChunkWithRetry({
        ...params,
        chunk: retryChunk,
      });
      retryDocs.push(...nestedDocs);
    }
    return retryDocs;
  }
};

const synthesizeStructuredKnowledgeDoc = async (params: {
  provider: Awaited<ReturnType<typeof getProvider>>;
  doc: db.KnowledgeDoc;
  sourceMeetings: SynthSourceMeeting[];
  sourceEvidenceByMeeting: Map<string, string>;
  claimCorrections: AskPlutoClaimCorrection[];
  signal?: AbortSignal;
  onChunkProgress?: (partial: KnowledgeCompiledDocument) => void;
}): Promise<KnowledgeCompiledDocument> => {
  const chunks = buildKnowledgeSourceChunks(
    params.sourceMeetings,
    MAX_SOURCE_MEETINGS_PER_SYNTHESIS_CHUNK,
    params.doc.scope_type === 'person_context'
      ? 2
      : MAX_SOURCE_MEETINGS_PER_SYNTHESIS_CHUNK,
  );

  if (chunks.length > 1) {
    console.log(
      `[KnowledgeDoc] Synthesizing ${params.doc.id} in ${chunks.length} chunks`,
    );
  }

  const chunkDocs: Array<{
    label: string;
    structured: KnowledgeCompiledDocument;
  }> = [];

  for (const chunk of chunks) {
    if (queuedSynthesisPaused) {
      throw new DOMException('foreground_preempted', 'AbortError');
    }
    const structuredDocs = await synthesizeKnowledgeChunkWithRetry({
      provider: params.provider,
      doc: params.doc,
      chunk,
      sourceEvidenceByMeeting: params.sourceEvidenceByMeeting,
      claimCorrections: params.claimCorrections,
      signal: params.signal,
    });
    if (queuedSynthesisPaused) {
      throw new DOMException('foreground_preempted', 'AbortError');
    }
    for (const [index, structured] of structuredDocs.entries()) {
      chunkDocs.push({
        label:
          structuredDocs.length === 1
            ? chunk.label
            : `${chunk.label} part ${index + 1}`,
        structured,
      });
    }

    // Emit a deterministic partial merge after each chunk so the UI can
    // render real content immediately instead of waiting for all chunks.
    if (chunkDocs.length > 0 && params.onChunkProgress) {
      const partial = chunkDocs.some((chunkDoc) =>
        isKnowledgeV2Document(chunkDoc.structured),
      )
        ? mergeKnowledgeV2Documents(
            { type: params.doc.scope_type, title: params.doc.title },
            chunkDocs.map((c) =>
              isKnowledgeV2Document(c.structured)
                ? c.structured
                : buildDeterministicKnowledgeV2Document(
                    { type: params.doc.scope_type, title: params.doc.title },
                    params.sourceMeetings,
                  ),
            ),
          )
        : (mergeChunkStructuredDocuments(
            { type: params.doc.scope_type, title: params.doc.title },
            chunkDocs.map((c) => c.structured as KnowledgeStructuredDocument),
          ) as KnowledgeStructuredDocument);
      params.onChunkProgress(partial);
    }
  }

  if (chunkDocs.length === 0) {
    console.log(
      `[KnowledgeDoc] Synthesis returned no structured facts for ${params.doc.id}`,
    );
    return buildDeterministicKnowledgeV2Document(
      { type: params.doc.scope_type, title: params.doc.title },
      params.sourceMeetings,
    );
  }

  if (chunkDocs.length === 1) {
    const deterministic = buildDeterministicKnowledgeV2Document(
      { type: params.doc.scope_type, title: params.doc.title },
      params.sourceMeetings,
    );
    return countStructuredStatements(chunkDocs[0].structured) >=
      MIN_USEFUL_SYNTHESIS_STATEMENTS
      ? chunkDocs[0].structured
      : mergeKnowledgeV2Documents(
          { type: params.doc.scope_type, title: params.doc.title },
          [
            isKnowledgeV2Document(chunkDocs[0].structured)
              ? chunkDocs[0].structured
              : deterministic,
            deterministic,
          ],
        );
  }

  const deterministic = buildDeterministicKnowledgeV2Document(
    { type: params.doc.scope_type, title: params.doc.title },
    params.sourceMeetings,
  );
  const fallbackMerged = chunkDocs.some((chunk) =>
    isKnowledgeV2Document(chunk.structured),
  )
    ? mergeKnowledgeV2Documents(
        { type: params.doc.scope_type, title: params.doc.title },
        chunkDocs.map((chunk) =>
          isKnowledgeV2Document(chunk.structured)
            ? chunk.structured
            : deterministic,
        ),
      )
    : (mergeChunkStructuredDocuments(
        { type: params.doc.scope_type, title: params.doc.title },
        chunkDocs.map(
          (chunk) => chunk.structured as KnowledgeStructuredDocument,
        ),
      ) as KnowledgeStructuredDocument);
  const usefulFallback =
    countStructuredStatements(fallbackMerged) >= MIN_USEFUL_SYNTHESIS_STATEMENTS
      ? fallbackMerged
      : mergeKnowledgeV2Documents(
          { type: params.doc.scope_type, title: params.doc.title },
          [
            isKnowledgeV2Document(fallbackMerged)
              ? fallbackMerged
              : deterministic,
            deterministic,
          ],
        );

  if (params.provider.name.startsWith('Ollama')) {
    console.log(
      `[KnowledgeDoc] Performing LLM merge pass for ${params.doc.id}`,
    );
  }

  try {
    const mergePrompt = getKnowledgeDocumentMergePrompt({
      scopeType: params.doc.scope_type,
      scopeTitle: promptScopeTitle(params.doc),
      chunkDocuments: chunkDocs.map((chunk) => ({
        label: chunk.label,
        structuredJson: JSON.stringify(chunk.structured),
      })),
      previousStructuredJson:
        params.doc.scope_type === 'person_context' &&
        (parseKnowledgeDocConfig(params.doc.config).synthesis_version ?? 0) <
          PERSON_CONTEXT_SYNTHESIS_VERSION
          ? null
          : params.doc.structured_json,
      claimCorrections: params.claimCorrections,
    });
    const merged = await synthesizeStructuredFromPrompt({
      provider: params.provider,
      prompt: mergePrompt,
      scopeType: params.doc.scope_type,
      scopeTitle: params.doc.title,
      sourceEvidenceByMeeting: params.sourceEvidenceByMeeting,
      signal: params.signal,
    });
    return hasStructuredContent(merged)
      ? isKnowledgeV2Document(merged) && isKnowledgeV2Document(usefulFallback)
        ? repairKnowledgeV2Document(
            mergeKnowledgeV2Documents(
              { type: params.doc.scope_type, title: params.doc.title },
              [usefulFallback, merged],
            ),
            usefulFallback,
          )
        : isKnowledgeV1Document(merged) && isKnowledgeV1Document(usefulFallback)
          ? (chooseKnowledgeMergeResult(
              usefulFallback,
              merged,
            ) as KnowledgeStructuredDocument)
          : usefulFallback
      : usefulFallback;
  } catch (error) {
    if (params.signal?.aborted) throw error;
    console.warn(
      `[KnowledgeDoc] Merge synthesis failed for ${params.doc.id}; using deterministic chunk merge:`,
      error,
    );
    return usefulFallback;
  }
};

const computeChangelog = (
  previousDoc: KnowledgeCompiledDocument | null,
  nextDoc: KnowledgeCompiledDocument,
): KnowledgeChangelog => {
  if (isKnowledgeV2Document(nextDoc)) {
    const previousItems = new Set(
      previousDoc && isKnowledgeV2Document(previousDoc)
        ? [
            ...previousDoc.active_streams.map((item) => item.title),
            ...previousDoc.needs_attention.map((item) => item.title),
            ...previousDoc.patterns.map((item) => item.title),
            ...previousDoc.risks_and_unknowns.map((item) => item.title),
          ].map(normalizeText)
        : [],
    );
    const nextItems = [
      ...nextDoc.active_streams.map((item) => item.title),
      ...nextDoc.needs_attention.map((item) => item.title),
      ...nextDoc.patterns.map((item) => item.title),
      ...nextDoc.risks_and_unknowns.map((item) => item.title),
    ];
    const added = nextItems.filter(
      (item) => !previousItems.has(normalizeText(item)),
    );
    return {
      generated_at: new Date().toISOString(),
      sections: [
        {
          section: 'Knowledge V2',
          added_count: added.length,
          removed_count: 0,
          updated_count: 0,
          sample_items: added.slice(0, 3),
        },
      ],
    };
  }
  const previousV1Doc =
    previousDoc && isKnowledgeV1Document(previousDoc) ? previousDoc : null;
  const previousSections = previousV1Doc
    ? toSectionItems(previousV1Doc)
    : new Map<string, Map<string, SectionItemSnapshot>>();
  const nextSections = toSectionItems(nextDoc);
  const sectionLabels: Array<{ key: KnowledgeSectionKey; label: string }> = [
    { key: 'decisions', label: 'Decisions' },
    { key: 'topic_evolution', label: 'Topic Evolution' },
    { key: 'open_risks', label: 'Open Risks' },
    { key: 'signals', label: 'Signals' },
  ];

  const sections: KnowledgeSectionChange[] = sectionLabels.map(
    ({ key, label }) => {
      const prev =
        previousSections.get(key) || new Map<string, SectionItemSnapshot>();
      const next =
        nextSections.get(key) || new Map<string, SectionItemSnapshot>();

      const added: string[] = [];
      const removed: string[] = [];
      const updated: string[] = [];

      for (const [identity, nextItem] of next.entries()) {
        const prevItem = prev.get(identity);
        if (!prevItem) {
          added.push(nextItem.raw);
          continue;
        }
        if (prevItem.normalized !== nextItem.normalized) {
          updated.push(nextItem.raw);
        }
      }

      for (const [identity, prevItem] of prev.entries()) {
        if (!next.has(identity)) {
          removed.push(prevItem.raw);
        }
      }

      return {
        section: label,
        added_count: added.length,
        removed_count: removed.length,
        updated_count: updated.length,
        sample_items: [...added, ...updated].slice(0, 3),
      };
    },
  );

  return {
    generated_at: new Date().toISOString(),
    sections,
  };
};

const renderStructuredDocument = (doc: KnowledgeCompiledDocument): string => {
  if (isKnowledgeV2Document(doc)) {
    const lines: string[] = [
      `# ${doc.scope.title}`,
      '',
      `Auto-synthesized on ${new Date().toLocaleString()}.`,
      '',
      '## Current Read',
      '',
      doc.current_read.headline,
      '',
    ];

    if (doc.current_read.supporting_bullets.length > 0) {
      for (const bullet of doc.current_read.supporting_bullets) {
        lines.push(`- ${bullet}`);
      }
      lines.push('');
    }

    const sections = [
      [
        'Active Streams',
        doc.active_streams.map(
          (stream) => `${stream.title}: ${stream.current_read}`,
        ),
      ],
      [
        'Needs Attention',
        doc.needs_attention.map(
          (item) => `${item.title} (${item.kind}; ${item.severity})`,
        ),
      ],
      ['Patterns', doc.patterns.map((item) => item.title)],
      [
        'Risks and Unknowns',
        doc.risks_and_unknowns.map((item) => `${item.title} (${item.kind})`),
      ],
    ] as const;

    for (const [title, items] of sections) {
      if (items.length === 0) continue;
      lines.push(`## ${title}`);
      lines.push('');
      for (const item of items) lines.push(`- ${item}`);
      lines.push('');
    }

    lines.push('## Trust');
    lines.push('');
    lines.push(`- ${doc.current_read.trust_message}`);
    lines.push(
      `- Sources included: ${doc.source_quality_summary.included_count}`,
    );
    lines.push(
      `- Sources excluded: ${doc.source_quality_summary.excluded_count}`,
    );
    return lines.join('\n').trim();
  }

  const lines: string[] = [
    `# ${doc.scope.title}`,
    '',
    `Auto-synthesized on ${new Date().toLocaleString()}.`,
    '',
  ];

  if (doc.chapters.length === 0) {
    lines.push('No citation-backed context is available yet.');
    return lines.join('\n');
  }

  const sections: Array<{ key: KnowledgeSectionKey; title: string }> = [
    { key: 'decisions', title: 'Decisions' },
    { key: 'topic_evolution', title: 'Topic Evolution' },
    { key: 'open_risks', title: 'Open Risks' },
    { key: 'signals', title: 'Signals' },
  ];

  for (const chapter of doc.chapters) {
    lines.push(`## ${chapter.title}`);
    lines.push('');

    for (const section of sections) {
      const items = chapter[section.key];
      if (items.length === 0) continue;
      lines.push(`### ${section.title}`);
      for (const item of items) {
        const refs = item.citations
          .map((citation) => `[${citation.meeting_id}]`)
          .join(' ');
        lines.push(`- ${item.text} (${item.why_it_matters}) ${refs}`.trim());
      }
      lines.push('');
    }
  }

  if (doc.dependency_suggestions.length > 0) {
    lines.push('## Dependency Suggestions');
    lines.push('');
    for (const suggestion of doc.dependency_suggestions) {
      const refs = suggestion.citations
        .map((citation) => `[${citation.meeting_id}]`)
        .join(' ');
      lines.push(
        `- ${suggestion.source_name} ${suggestion.relationship.replace(/_/g, ' ')} ${suggestion.target_name} (${suggestion.why}) ${refs}`.trim(),
      );
    }
    lines.push('');
  }

  return lines.join('\n').trim();
};

const buildSourceMeetings = (doc: db.KnowledgeDoc): SynthSourceMeeting[] => {
  const excludedMeetingIds = new Set(
    db
      .getKnowledgeCorrections(doc.id)
      .filter(
        (correction) =>
          correction.target_kind === 'source' &&
          correction.action === 'exclude_source',
      )
      .map((correction) => correction.target_id),
  );
  const sourceMeetings = db
    .getKnowledgeDocSourceMeetings(doc.id, MAX_SOURCE_MEETINGS)
    .filter((meeting) => !excludedMeetingIds.has(String(meeting.id)));

  if (doc.scope_type === 'person_context') {
    const person = db.getPersonBriefing(doc.scope_key);
    const activity = person
      ? collectPersonSynthesisActivity(
          person.meetings,
          sourceMeetings.map((meeting) => ({
            id: String(meeting.id),
            analysis_json: meeting.analysis_json,
          })),
          person.person.name,
          person.recentActivity ?? [],
        )
      : [];
    return focusPersonSynthesisSources(
      sourceMeetings.map((meeting) => ({
        id: String(meeting.id),
        title: meeting.title || 'Untitled Session',
        occurred_at: meeting.started_at || meeting.created_at || null,
        evidence: '',
        duration_seconds: meeting.duration_seconds,
      })),
      activity,
      person?.person.name ?? doc.title,
    );
  }

  const scored = sourceMeetings.map((meeting) => {
    const bundle = buildMeetingEvidence(meeting);
    return {
      meeting,
      evidence: bundle.evidence,
      score: bundle.score,
      occurred_at: meeting.started_at || meeting.created_at || null,
    };
  });

  const nonEmpty = scored.filter((item) => item.evidence.length > 0);
  if (nonEmpty.length === 0) return [];

  const viable = nonEmpty.filter(
    (item) => item.evidence.length >= MIN_EVIDENCE_CHARS,
  );
  const candidates = viable.length >= MIN_SOURCE_MEETINGS ? viable : nonEmpty;

  candidates.sort((a, b) => {
    const aTime = a.occurred_at ? new Date(a.occurred_at).getTime() : 0;
    const bTime = b.occurred_at ? new Date(b.occurred_at).getTime() : 0;
    if (doc.scope_type === 'person_context' && bTime !== aTime)
      return bTime - aTime;
    if (b.score !== a.score) return b.score - a.score;
    return bTime - aTime;
  });

  return candidates.slice(0, MAX_SOURCE_MEETINGS).map((item) => ({
    id: String(item.meeting.id),
    title: item.meeting.title || 'Untitled Session',
    occurred_at: item.occurred_at,
    evidence: item.evidence,
    duration_seconds: item.meeting.duration_seconds,
    analysis_format_pass: item.meeting.analysis_format_pass,
    enhanced_notes: item.meeting.enhanced_notes,
    user_notes: item.meeting.user_notes,
    entity_names: (() => {
      try {
        return db
          .getMeetingEntities(String(item.meeting.id))
          .map((entity) => entity.name)
          .filter(Boolean);
      } catch {
        return [];
      }
    })(),
  }));
};

type KnowledgeSynthesisRequest = {
  key: string;
  inputHash: string;
  doc: db.KnowledgeDoc;
  corrections: ReturnType<typeof db.getKnowledgeCorrections>;
  sourceMeetings: SynthSourceMeeting[];
  canCommit?: () => boolean;
  signal?: AbortSignal;
};

class KnowledgeSynthesisSupersededError extends Error {
  constructor() {
    super('knowledge_synthesis_superseded');
    this.name = 'KnowledgeSynthesisSupersededError';
  }
}

const assertKnowledgeSynthesisCurrent = (
  request: KnowledgeSynthesisRequest,
): void => {
  if (request.canCommit?.() === false) {
    throw new KnowledgeSynthesisSupersededError();
  }
  request.signal?.throwIfAborted();
};

const buildKnowledgeSynthesisRequest = (
  docId: string,
): KnowledgeSynthesisRequest | null => {
  const doc = db.getKnowledgeDoc(docId);
  if (!doc) return null;
  const corrections = db.getKnowledgeCorrections(docId);
  const sourceMeetings = buildSourceMeetings(doc);
  const inputHash = createHash('sha256')
    .update(
      JSON.stringify({
        config: getKnowledgeSynthesisInputConfig(doc.config, doc.scope_type),
        corrections,
        sourceMeetings,
      }),
    )
    .digest('hex');
  return {
    key: `${docId}:${inputHash}`,
    inputHash,
    doc,
    corrections,
    sourceMeetings,
  };
};

const synthesizeKnowledgeDocNowInternal = async (
  request: KnowledgeSynthesisRequest,
): Promise<db.KnowledgeDoc | undefined> => {
  const currentDoc = db.getKnowledgeDoc(request.doc.id);
  if (!currentDoc) return undefined;
  if (queuedSynthesisPaused) {
    const deferred = db.upsertKnowledgeDoc({
      id: request.doc.id,
      scope_type: request.doc.scope_type,
      scope_key: request.doc.scope_key,
      title: request.doc.title,
      status: 'stale',
    });
    queueKnowledgeDocRefresh(request.doc.id, 750);
    return deferred;
  }
  const doc = request.doc;
  const knowledgeCorrections = request.corrections;
  const claimCorrections = parseAskPlutoCorrectionRecords(knowledgeCorrections);
  const applyCorrections = (structured: KnowledgeCompiledDocument) =>
    isKnowledgeV2Document(structured)
      ? applyKnowledgeCorrectionsToDocument(structured, knowledgeCorrections)
      : structured;

  assertKnowledgeSynthesisCurrent(request);

  db.upsertKnowledgeDoc({
    id: doc.id,
    scope_type: doc.scope_type,
    scope_key: doc.scope_key,
    title: doc.title,
    status: 'synthesizing',
  });

  const sourceMeetings = request.sourceMeetings;
  const sourceMeetingIds = sourceMeetings.map((meeting) => meeting.id);

  if (sourceMeetings.length === 0) {
    const emptyDoc = applyKnowledgeCorrectionsToDocument(
      buildDeterministicKnowledgeV2Document(
        { type: doc.scope_type, title: doc.title },
        [],
      ),
      knowledgeCorrections,
    );
    const rendered = renderStructuredDocument(emptyDoc);
    const previous = parseStoredCompiledDoc(doc.structured_json);
    const changelog = computeChangelog(previous, emptyDoc);

    db.replaceKnowledgeDocSources(doc.id, []);
    db.saveKnowledgeDocVersion({
      doc_id: doc.id,
      structured_json: JSON.stringify(emptyDoc),
      rendered_content: rendered,
      changelog_json: JSON.stringify(changelog),
      source_count: 0,
    });
    if (doc.scope_type === 'global') {
      try {
        syncGlobalKnowledgeAttentionQueue(emptyDoc);
      } catch (error) {
        console.warn(
          '[KnowledgeDoc] Failed to sync global attention queue:',
          error,
        );
      }
    }
    db.rebuildKnowledgeBacklinks(doc.id);

    const savedDoc = db.upsertKnowledgeDoc({
      id: doc.id,
      scope_type: doc.scope_type,
      scope_key: doc.scope_key,
      title: doc.title,
      structured_json: JSON.stringify(emptyDoc),
      rendered_content: rendered,
      config: withCurrentKnowledgeSynthesisConfig(
        doc.config,
        request.inputHash,
        doc.scope_type,
      ),
      status: 'up_to_date',
      last_synthesized_at: new Date().toISOString(),
      last_source_cursor: null,
    });

    if (savedDoc.scope_type === 'global') {
      persistGlobalWorkingMemorySnapshot({
        knowledgeDoc: savedDoc,
        structured: emptyDoc,
        generatedAt: savedDoc.last_synthesized_at ?? undefined,
      });
    } else if (savedDoc.scope_type === 'project') {
      persistProjectWorkingMemorySnapshot({
        knowledgeDoc: savedDoc,
        structured: emptyDoc,
        generatedAt: savedDoc.last_synthesized_at ?? undefined,
      });
    } else if (savedDoc.scope_type === 'team_tracker') {
      persistTeamTrackerWorkingMemorySnapshot({
        knowledgeDoc: savedDoc,
        structured: emptyDoc,
        generatedAt: savedDoc.last_synthesized_at ?? undefined,
      });
    } else if (savedDoc.scope_type === 'person_context') {
      persistPersonContextWorkingMemorySnapshot({
        knowledgeDoc: savedDoc,
        structured: emptyDoc,
        generatedAt: savedDoc.last_synthesized_at ?? undefined,
      });
    }

    return savedDoc;
  }

  const sourceEvidenceByMeeting = new Map<string, string>(
    sourceMeetings.map((meeting) => [
      meeting.id,
      normalizeText(meeting.evidence),
    ]),
  );

  try {
    const settings = await getAllSettings(db);
    const provider = await getProvider(settings);
    const structured = await synthesizeStructuredKnowledgeDoc({
      provider,
      doc,
      sourceMeetings,
      sourceEvidenceByMeeting,
      claimCorrections,
      signal: request.signal,
      // Flush partial content to DB after each chunk so the UI can render
      // real content progressively instead of waiting for the full merge.
      onChunkProgress: (partial) => {
        if (request.canCommit?.() === false || request.signal?.aborted) return;
        try {
          const groundedPartial =
            doc.scope_type === 'person_context' &&
            isKnowledgeV2Document(partial)
              ? groundPersonKnowledgeV2Document(
                  partial,
                  sourceEvidenceByMeeting,
                  promptScopeTitle(doc),
                )
              : partial;
          const correctedPartial = applyCorrections(groundedPartial);
          const partialRendered = renderStructuredDocument(correctedPartial);
          db.upsertKnowledgeDoc({
            id: doc.id,
            scope_type: doc.scope_type,
            scope_key: doc.scope_key,
            title: doc.title,
            structured_json: JSON.stringify(correctedPartial),
            rendered_content: partialRendered,
            config: withCurrentKnowledgeSynthesisConfig(
              doc.config,
              request.inputHash,
              doc.scope_type,
            ),
            status: 'synthesizing', // stays 'synthesizing' until the full merge completes
          });
        } catch (flushErr) {
          // Non-fatal: if the partial flush fails, the final save will still work.
          console.warn('[KnowledgeDoc] Partial flush failed:', flushErr);
        }
      },
    });
    assertKnowledgeSynthesisCurrent(request);
    const grounded =
      doc.scope_type === 'person_context' && isKnowledgeV2Document(structured)
        ? groundPersonKnowledgeV2Document(
            structured,
            sourceEvidenceByMeeting,
            promptScopeTitle(doc),
          )
        : structured;
    const correctedStructured = applyCorrections(grounded);

    const rendered = renderStructuredDocument(correctedStructured);
    const previous = parseStoredCompiledDoc(doc.structured_json);
    const changelog = computeChangelog(previous, correctedStructured);

    db.replaceKnowledgeDocSources(doc.id, sourceMeetingIds);
    db.saveKnowledgeDocVersion({
      doc_id: doc.id,
      structured_json: JSON.stringify(correctedStructured),
      rendered_content: rendered,
      changelog_json: JSON.stringify(changelog),
      source_count: sourceMeetings.length,
    });
    if (
      doc.scope_type === 'global' &&
      isKnowledgeV2Document(correctedStructured)
    ) {
      try {
        syncGlobalKnowledgeAttentionQueue(correctedStructured);
      } catch (error) {
        console.warn(
          '[KnowledgeDoc] Failed to sync global attention queue:',
          error,
        );
      }
    }
    if (isKnowledgeV1Document(correctedStructured)) {
      persistDependencySuggestions(correctedStructured.dependency_suggestions);
    }
    db.rebuildKnowledgeBacklinks(doc.id);

    const latestSource = sourceMeetings[0];

    const savedDoc = db.upsertKnowledgeDoc({
      id: doc.id,
      scope_type: doc.scope_type,
      scope_key: doc.scope_key,
      title: doc.title,
      structured_json: JSON.stringify(correctedStructured),
      rendered_content: rendered,
      config: withCurrentKnowledgeSynthesisConfig(
        doc.config,
        request.inputHash,
        doc.scope_type,
      ),
      status: 'up_to_date',
      last_synthesized_at: new Date().toISOString(),
      last_source_cursor: latestSource
        ? `${latestSource.occurred_at || ''}:${latestSource.id}`
        : null,
    });

    if (
      (savedDoc.scope_type === 'global' ||
        savedDoc.scope_type === 'project' ||
        savedDoc.scope_type === 'team_tracker' ||
        savedDoc.scope_type === 'person_context') &&
      isKnowledgeV2Document(correctedStructured)
    ) {
      const persistSnapshot =
        savedDoc.scope_type === 'global'
          ? persistGlobalWorkingMemorySnapshot
          : savedDoc.scope_type === 'project'
            ? persistProjectWorkingMemorySnapshot
            : savedDoc.scope_type === 'team_tracker'
              ? persistTeamTrackerWorkingMemorySnapshot
              : persistPersonContextWorkingMemorySnapshot;
      persistSnapshot({
        knowledgeDoc: savedDoc,
        structured: correctedStructured,
        generatedAt: savedDoc.last_synthesized_at ?? undefined,
      });
    }

    return savedDoc;
  } catch (error) {
    if (
      error instanceof KnowledgeSynthesisSupersededError ||
      request.canCommit?.() === false
    ) {
      return db.getKnowledgeDoc(doc.id);
    }
    if (request.signal?.aborted) {
      return db.upsertKnowledgeDoc({
        id: doc.id,
        scope_type: doc.scope_type,
        scope_key: doc.scope_key,
        title: doc.title,
        status: 'stale',
      });
    }
    if (isSerializedTaskPreemption(error)) {
      const deferred = db.upsertKnowledgeDoc({
        id: doc.id,
        scope_type: doc.scope_type,
        scope_key: doc.scope_key,
        title: doc.title,
        status: 'stale',
      });
      queueKnowledgeDocRefresh(doc.id, 750);
      return deferred;
    }
    console.error(`[KnowledgeDoc] Synthesis failed for doc ${doc.id}:`, error);
    return db.upsertKnowledgeDoc({
      id: doc.id,
      scope_type: doc.scope_type,
      scope_key: doc.scope_key,
      title: doc.title,
      status: 'failed',
    });
  }
};

const runQueuedSynthesis = (docId: string): void => {
  const state = getState(docId);
  if (queuedSynthesisPaused) {
    state.pending = true;
    return;
  }
  if (state.inFlight) {
    state.pending = true;
    return;
  }

  // Mark in-flight immediately so subsequent debounced calls see it.
  state.inFlight = true;
  state.pending = false;

  const request = buildKnowledgeSynthesisRequest(docId);
  if (!request) {
    state.inFlight = false;
    return;
  }
  const synthesis = runKnowledgeDocWithGlobalSynthesisGate(
    request.key,
    async () => synthesizeKnowledgeDocNowInternal(request),
  );
  const settleQueueState = () => {
    state.inFlight = false;
    if (state.pending) {
      queueKnowledgeDocRefresh(docId, 750);
    }
  };
  void synthesis.then(settleQueueState, settleQueueState);
};

export const queueKnowledgeDocRefresh = (
  docId: string,
  delayMs = SYNTHESIS_DEBOUNCE_MS,
): void => {
  const state = getState(docId);
  state.pending = true;

  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }

  if (queuedSynthesisPaused) {
    return;
  }

  if (knowledgeDocBackgroundScheduler) {
    knowledgeDocBackgroundScheduler(docId);
    return;
  }

  state.timer = setTimeout(() => {
    state.timer = null;
    void runQueuedSynthesis(docId);
  }, delayMs);
};

export const setKnowledgeDocSynthesisPaused = (paused: boolean): void => {
  if (queuedSynthesisPaused === paused) return;
  queuedSynthesisPaused = paused;
  if (queuedSynthesisPaused) {
    for (const state of queueByDocId.values()) {
      if (state.timer) {
        clearTimeout(state.timer);
        state.timer = null;
        state.pending = true;
      }
    }
  } else {
    flushPendingKnowledgeDocRefreshes();
  }
};

export const refreshKnowledgeDocNow = async (
  docId: string,
  options: { signal?: AbortSignal } = {},
): Promise<db.KnowledgeDoc | undefined> => {
  if (queuedSynthesisPaused) {
    const state = getState(docId);
    state.pending = true;
    return db.getKnowledgeDoc(docId);
  }
  const baseRequest = buildKnowledgeSynthesisRequest(docId);
  if (!baseRequest) return undefined;
  const request = { ...baseRequest, signal: options.signal };
  return runKnowledgeDocWithGlobalSynthesisGate(request.key, async () =>
    synthesizeKnowledgeDocNowInternal(request),
  );
};

export const synthesizeEntitySummary = async (
  entityId: string,
): Promise<EntitySummary> => {
  const entity = db.getEntity(entityId);
  if (!entity) {
    throw new Error(`Entity not found: ${entityId}`);
  }

  const meetings = db.getEntityMeetings(entityId);

  // Handle "Dummy" State (Fallback for 1 mention)
  if (meetings.length <= 1) {
    return {
      sentences: [
        {
          text: `Initial extraction for **${entity.name}**.`,
          source_meeting_ids: meetings.map((m) => String(m.id)),
        },
      ],
      isInitialExtraction: true,
    };
  }

  const sourceMeetings = meetings
    .slice(0, ENTITY_SUMMARY_MAX_MEETINGS)
    .map((m) => ({
      id: String(m.id),
      title: m.title,
      evidence: m.context || '',
    }));

  const inputHash = createHash('sha256')
    .update(
      JSON.stringify({
        entityName: entity.name,
        entityType: entity.type,
        sourceMeetings,
      }),
    )
    .digest('hex');
  return runEntitySummaryWithGlobalSynthesisGate(
    `entity-summary:${entityId}:${inputHash}`,
    async () => {
      const settings = await getAllSettings(db);
      const provider = await getProvider(settings);
      const prompt = getEntitySummaryPrompt({
        entityName: entity.name,
        entityType: entity.type,
        sources: sourceMeetings,
      });

      const raw = await provider.synthesizeKnowledgeDocument(prompt);
      try {
        const parsed = parseKnowledgeJsonResponse(raw) as {
          sentences: EntitySummarySentence[];
        };
        return {
          sentences: parsed.sentences || [],
          isInitialExtraction: false,
        };
      } catch (err) {
        console.error('[KnowledgeDoc] Entity summary parse failed:', err);
        return {
          sentences: [
            {
              text: `Synthesis failed for **${entity.name}**. Please try again.`,
              source_meeting_ids: [],
            },
          ],
          isInitialExtraction: false,
        };
      }
    },
  );
};

const ensureDocsAndCollectActive = (): db.KnowledgeDoc[] => {
  const globalDoc = db.ensureGlobalKnowledgeDoc();
  db.syncKnowledgeProjectLifecycle({
    activeDays: 30,
    minMeetings: 2,
    minMentions: 3,
    inactiveDays: 45,
  });
  db.syncKnowledgePersonLifecycle({
    activeDays: 60,
    minMeetings: 2,
    minMentions: 3,
    inactiveDays: 90,
  });
  const docs = db.getKnowledgeDocs({ includeInactive: false });
  if (!docs.some((doc) => doc.id === globalDoc.id)) {
    return [globalDoc, ...docs];
  }
  return docs;
};

export const initializeKnowledgeDocs = async (
  options: { queue?: boolean } = {},
): Promise<string[]> => {
  const docs = ensureDocsAndCollectActive();
  // Skip docs that are already synthesized with the current synthesis
  // mechanics. Older up-to-date docs are intentionally refreshed once.
  const needsWork = docs.filter((doc) => {
    if (knowledgeDocNeedsSynthesis(doc)) return true;
    const request = buildKnowledgeSynthesisRequest(doc.id);
    return (
      !request ||
      parseKnowledgeDocConfig(doc.config).synthesis_input_hash !==
        request.inputHash
    );
  });
  if (needsWork.length === 0) {
    console.log(
      '[KnowledgeDoc] All docs up-to-date, skipping startup synthesis',
    );
    return [];
  }
  console.log(
    options.queue === false
      ? `[KnowledgeDoc] Found ${needsWork.length} of ${docs.length} docs needing synthesis; deferring to background`
      : `[KnowledgeDoc] Queuing ${needsWork.length} of ${docs.length} docs for synthesis`,
  );
  // The production scheduler owns pacing; the stagger is only a fallback for
  // callers that have not installed a background scheduler.
  const STAGGER_MS = 3000;
  if (options.queue !== false) {
    needsWork.forEach((doc, index) => {
      queueKnowledgeDocRefresh(doc.id, 15000 + index * STAGGER_MS);
    });
  }
  return needsWork.map((doc) => doc.id);
};

const getKnowledgeDocIdsForMeeting = (meetingId: string): Set<string> => {
  const docs = ensureDocsAndCollectActive();
  const docIds = new Set<string>();

  const globalDoc = db.getKnowledgeDocByScope('global', 'global');
  if (globalDoc) docIds.add(globalDoc.id);

  // Refresh project-scoped docs for projects mentioned in this meeting
  const projectIds = db.getProjectEntityIdsForMeeting(meetingId);
  for (const projectId of projectIds) {
    const projectDoc = db.getKnowledgeDocByScope('project', projectId);
    if (projectDoc && projectDoc.status !== 'inactive') {
      docIds.add(projectDoc.id);
    }
  }

  // Refresh person_context docs for people mentioned in this meeting
  const personIds = db.getPersonEntityIdsForMeeting(meetingId);
  for (const personId of personIds) {
    const personDoc = db.getKnowledgeDocByScope('person_context', personId);
    if (personDoc && personDoc.status !== 'inactive') {
      docIds.add(personDoc.id);
    }
  }

  // Refresh team_tracker docs whose members overlap with this meeting's people
  for (const doc of docs) {
    if (doc.scope_type === 'global') {
      docIds.add(doc.id);
    } else if (doc.scope_type === 'team_tracker' && doc.config) {
      try {
        const config = JSON.parse(doc.config) as db.KnowledgeDocConfig;
        const memberIds = config.member_entity_ids || [];
        if (memberIds.some((id) => personIds.includes(id))) {
          docIds.add(doc.id);
        }
      } catch {
        // skip malformed config
      }
    }
  }

  return docIds;
};

export const queueKnowledgeDocsRefreshForMeeting = (
  meetingId: string,
): void => {
  for (const docId of getKnowledgeDocIdsForMeeting(meetingId)) {
    queueKnowledgeDocRefresh(docId);
  }
};

export const refreshKnowledgeDocsForMeetingNow = async (
  meetingId: string,
  options: { canCommit?: () => boolean; signal?: AbortSignal } = {},
): Promise<{ requested: number; completed: number }> => {
  const docIds = [...getKnowledgeDocIdsForMeeting(meetingId)];
  if (queuedSynthesisPaused) {
    for (const docId of docIds) {
      const state = getState(docId);
      state.pending = true;
    }
    return { requested: docIds.length, completed: 0 };
  }
  let completed = 0;
  for (const docId of docIds) {
    options.signal?.throwIfAborted();
    if (queuedSynthesisPaused) {
      const state = getState(docId);
      state.pending = true;
      continue;
    }
    const satisfiesMeetingRefresh = (): boolean => {
      const doc = db.getKnowledgeDoc(docId);
      const currentRequest = buildKnowledgeSynthesisRequest(docId);
      return Boolean(
        doc &&
          knowledgeDocSatisfiesMeetingRefresh(doc, {
            meetingIsCandidate: buildSourceMeetings(doc).some(
              (meeting) => meeting.id === meetingId,
            ),
            meetingIsPersistedSource: db
              .getKnowledgeDocSources(docId)
              .some((source) => source.meeting_id === meetingId),
            currentSynthesisInputHash: currentRequest?.inputHash ?? null,
          }),
      );
    };
    if (satisfiesMeetingRefresh()) {
      completed += 1;
      continue;
    }
    const baseRequest = buildKnowledgeSynthesisRequest(docId);
    const request = baseRequest
      ? {
          ...baseRequest,
          canCommit: options.canCommit,
          signal: options.signal,
        }
      : null;
    if (!request) throw new Error('knowledge_document_refresh_failed');
    let refreshed = await runKnowledgeDocWithGlobalSynthesisGate(
      request.key,
      async () => synthesizeKnowledgeDocNowInternal(request),
    );
    if (!refreshed) throw new Error('knowledge_document_refresh_failed');
    if (!satisfiesMeetingRefresh()) {
      const retryBaseRequest = buildKnowledgeSynthesisRequest(docId);
      const retryRequest = retryBaseRequest
        ? {
            ...retryBaseRequest,
            canCommit: options.canCommit,
            signal: options.signal,
          }
        : null;
      if (!retryRequest) throw new Error('knowledge_document_refresh_failed');
      refreshed = await runKnowledgeDocWithGlobalSynthesisGate(
        retryRequest.key,
        async () => synthesizeKnowledgeDocNowInternal(retryRequest),
      );
      if (!refreshed || !satisfiesMeetingRefresh()) {
        throw new Error('knowledge_document_refresh_incomplete');
      }
    }
    completed += 1;
  }
  return { requested: docIds.length, completed };
};

export const queueAllKnowledgeDocsRefresh = (): void => {
  const docs = ensureDocsAndCollectActive();
  for (const doc of docs) {
    queueKnowledgeDocRefresh(doc.id);
  }
};
