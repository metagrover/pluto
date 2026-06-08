import type { WorkingMemorySnapshot } from '../../../electron/db';
import type { AttentionItem } from '../../../electron/intelligence/intelligenceTypes';
import type {
  KnowledgeDoc,
  KnowledgeDocScopeType,
} from '../../api/knowledgeDocs';
import type { KnowledgeProjectHealthCard } from '../../api/knowledgeWorkspace';
import type { TrustStatus } from '../../utils/trustStatus';
import {
  deriveKnowledgeTrustStatus,
  getTrustStatusMeta,
} from '../../utils/trustStatus';

export type KnowledgeSectionKey =
  | 'decisions'
  | 'topic_evolution'
  | 'open_risks'
  | 'signals';

export interface KnowledgeCitation {
  meeting_id: string;
  quote: string;
}

export interface KnowledgeStatement {
  id: string;
  text: string;
  why_it_matters: string;
  citations: KnowledgeCitation[];
}

export interface KnowledgeDependencySuggestion {
  source_name: string;
  target_name: string;
  relationship: 'depends_on' | 'blocked_by' | 'owns' | 'impacts';
  why: string;
  citations: KnowledgeCitation[];
}

export interface KnowledgeChapter {
  chapter_id: string;
  title: string;
  decisions: KnowledgeStatement[];
  topic_evolution: KnowledgeStatement[];
  open_risks: KnowledgeStatement[];
  signals: KnowledgeStatement[];
}

export interface StructuredKnowledgeDoc {
  schema_version: number;
  scope: {
    type: KnowledgeDocScopeType;
    title: string;
  };
  chapters: KnowledgeChapter[];
  dependency_suggestions: KnowledgeDependencySuggestion[];
}

export interface KnowledgeDocGroup {
  scopeType: KnowledgeDocScopeType;
  label: string;
  docs: KnowledgeDoc[];
}

export type KnowledgeBriefLaneId =
  | 'priorities'
  | 'risks'
  | 'patterns'
  | 'dependencies';

export interface KnowledgeBriefLane {
  id: KnowledgeBriefLaneId;
  label: string;
  description: string;
  items: KnowledgeStatement[];
}

export interface KnowledgeBriefCoverage {
  sourceCount: number | null;
  statementCount: number;
  citedMeetingCount: number;
  dependencyCount: number;
}

export interface KnowledgeV2EvidenceQuality {
  mode: 'direct' | 'inferred';
  confidence: number;
  cited_meeting_count: number;
  source_count: number;
  last_reinforced_at: string | null;
  freshness: 'fresh' | 'aging' | 'stale' | 'unknown';
}

export interface KnowledgeV2Item {
  id: string;
  title: string;
  summary: string;
  kind: string;
  severity: 'needs_attention' | 'watch' | 'steady';
  why_now: string;
  stream_ids: string[];
  citations: KnowledgeCitation[];
  evidence_quality: KnowledgeV2EvidenceQuality;
}

export interface KnowledgeV2Stream {
  id: string;
  title: string;
  domain: string;
  status: string;
  current_read: string;
  last_touched_at: string | null;
  source_count: number;
  open_follow_up_count: number;
  decision_count: number;
  unresolved_question_count: number;
  pinned: boolean;
  evidence_quality: KnowledgeV2EvidenceQuality;
}

export interface KnowledgeV2EvidenceEntry {
  id: string;
  meeting_id: string;
  meeting_title: string;
  captured_at: string | null;
  quote: string;
  stream_ids: string[];
  item_ids: string[];
  mode: 'direct' | 'inferred';
  confidence: number;
}

export interface KnowledgeV2SourceQualitySummary {
  included_count: number;
  excluded_count: number;
  weak_count: number;
  records: Array<{
    meeting_id: string;
    title: string;
    usable: boolean;
    domain: string;
    score: number;
    reasons: string[];
  }>;
}

export interface StructuredKnowledgeV2Doc {
  schema_version: 2;
  scope: {
    type: KnowledgeDocScopeType;
    title: string;
  };
  current_read: {
    headline: string;
    supporting_bullets: string[];
    freshness: 'fresh' | 'aging' | 'stale' | 'unknown';
    source_count: number;
    cited_item_count: number;
    cited_meeting_count: number;
    trust_message: string;
    evidence_quality: KnowledgeV2EvidenceQuality;
  };
  active_streams: KnowledgeV2Stream[];
  needs_attention: KnowledgeV2Item[];
  patterns: KnowledgeV2Item[];
  risks_and_unknowns: KnowledgeV2Item[];
  evidence_index: KnowledgeV2EvidenceEntry[];
  source_quality_summary: KnowledgeV2SourceQualitySummary;
  change_summary: {
    generated_at: string | null;
    added_count: number;
    removed_count: number;
    updated_count: number;
    notable_changes: string[];
  };
}

type StructuredKnowledgeV2Source = Pick<
  KnowledgeDoc,
  'scope_type' | 'title'
> & {
  structured_json: string | null;
};

export interface KnowledgeBrief {
  isCompiled: boolean;
  backingSource: 'snapshot' | 'doc' | 'none';
  headline: string;
  freshnessAt: string | null;
  supportingBullets: string[];
  lanes: KnowledgeBriefLane[];
  coverage: KnowledgeBriefCoverage;
  evidenceQuality: KnowledgeV2EvidenceQuality | null;
  activeStreams: KnowledgeV2Stream[];
  patterns: KnowledgeV2Item[];
  risksAndUnknowns: KnowledgeV2Item[];
  evidenceIndex: KnowledgeV2EvidenceEntry[];
  sourceQuality: KnowledgeV2SourceQualitySummary | null;
  trustMessage: string | null;
  trustStatus: TrustStatus | null;
  trustDescription: string | null;
}

export type AttentionSeverity = 'critical' | 'watch' | 'steady';

export type NeedsAttentionKind =
  | 'risk'
  | 'blocker'
  | 'project'
  | 'dependency'
  | 'follow_up';

export interface NeedsAttentionItem {
  id: string;
  title: string;
  summary: string;
  severity: AttentionSeverity;
  kind: NeedsAttentionKind;
  reasons: string[];
  citations: KnowledgeCitation[];
}

export const SECTION_LABELS: Record<KnowledgeSectionKey, string> = {
  decisions: 'Decisions',
  topic_evolution: 'Topic Evolution',
  open_risks: 'Open Risks',
  signals: 'Signals',
};

export const SECTION_DESCRIPTIONS: Record<KnowledgeSectionKey, string> = {
  decisions: 'Durable choices Pluto found across the source meetings.',
  topic_evolution: 'Themes whose meaning or direction changed over time.',
  open_risks: 'Unresolved risks, blockers, and unclear commitments.',
  signals: 'Patterns worth keeping in working memory.',
};

const GROUP_LABELS: Record<KnowledgeDocScopeType, string> = {
  global: 'Workspace Memory',
  project: 'Project Docs',
  person_context: 'People',
  team_tracker: 'Team Trackers',
};

const GROUP_ORDER: KnowledgeDocScopeType[] = [
  'global',
  'project',
  'person_context',
  'team_tracker',
];

const WORKING_MEMORY_SNAPSHOT_SCOPE_TYPES: KnowledgeDocScopeType[] = [
  'global',
  'project',
  'person_context',
  'team_tracker',
];

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const asString = (value: unknown): string =>
  typeof value === 'string' ? value : '';

const looksLikeRawId = (value: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value.trim(),
  );

const EMPTY_BRIEF_COVERAGE: KnowledgeBriefCoverage = {
  sourceCount: null,
  statementCount: 0,
  citedMeetingCount: 0,
  dependencyCount: 0,
};

const EMPTY_V2_QUALITY: KnowledgeV2EvidenceQuality = {
  mode: 'direct',
  confidence: 0,
  cited_meeting_count: 0,
  source_count: 0,
  last_reinforced_at: null,
  freshness: 'unknown',
};

const parseCitations = (value: unknown): KnowledgeCitation[] => {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isObject)
    .map((citation) => ({
      meeting_id: asString(citation.meeting_id),
      quote: asString(citation.quote),
    }))
    .filter((citation) => citation.meeting_id || citation.quote);
};

const parseStatements = (value: unknown): KnowledgeStatement[] => {
  if (!Array.isArray(value)) return [];
  return value.filter(isObject).map((statement, index) => ({
    id: asString(statement.id) || `statement-${index}`,
    text: asString(statement.text),
    why_it_matters: asString(statement.why_it_matters),
    citations: parseCitations(statement.citations),
  }));
};

const parseV2Quality = (value: unknown): KnowledgeV2EvidenceQuality => {
  if (!isObject(value)) return EMPTY_V2_QUALITY;
  return {
    mode: asString(value.mode) === 'inferred' ? 'inferred' : 'direct',
    confidence: typeof value.confidence === 'number' ? value.confidence : 0,
    cited_meeting_count:
      typeof value.cited_meeting_count === 'number'
        ? value.cited_meeting_count
        : 0,
    source_count:
      typeof value.source_count === 'number' ? value.source_count : 0,
    last_reinforced_at: asString(value.last_reinforced_at) || null,
    freshness:
      asString(value.freshness) === 'fresh' ||
      asString(value.freshness) === 'aging' ||
      asString(value.freshness) === 'stale'
        ? (asString(value.freshness) as KnowledgeV2EvidenceQuality['freshness'])
        : 'unknown',
  };
};

const parseV2Items = (value: unknown): KnowledgeV2Item[] => {
  if (!Array.isArray(value)) return [];
  return value.filter(isObject).map((item, index) => ({
    id: asString(item.id) || `v2-item-${index}`,
    title: asString(item.title),
    summary: asString(item.summary),
    kind: asString(item.kind) || 'reference_context',
    severity:
      asString(item.severity) === 'needs_attention' ||
      asString(item.severity) === 'watch'
        ? (asString(item.severity) as KnowledgeV2Item['severity'])
        : 'steady',
    why_now: asString(item.why_now),
    stream_ids: Array.isArray(item.stream_ids)
      ? item.stream_ids.filter((id): id is string => typeof id === 'string')
      : [],
    citations: parseCitations(item.citations),
    evidence_quality: parseV2Quality(item.evidence_quality),
  }));
};

const WEAK_V2_HEADLINE_PATTERN =
  /^(the team discusses|the team discussed|the meeting opened|the conversation revolves|conversation captured|the user is planning)\b/i;

const WEAK_V2_STREAM_TITLE_PATTERN =
  /^(you|me|i|them|they|we|someone|language|conversation|topic|unknown|none specified|not specified|aldo|adam)$/i;

const WEAK_V2_STREAM_READ_PATTERN =
  /^(conversation captured|key themes and follow-ups are summarized|the conversation revolves|the team discusses|discussion about)\b/i;

const normalizeStreamId = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);

const titleFromStreamRead = (value: string): string | null => {
  const cleaned = value.replace(/\.$/, '').trim();
  if (cleaned.length < 8 || cleaned.length > 90) return null;
  if (WEAK_V2_STREAM_READ_PATTERN.test(cleaned)) return null;
  if (!/[A-Z]/.test(cleaned)) return null;
  return cleaned;
};

const repairV2Stream = (
  stream: KnowledgeV2Stream,
): KnowledgeV2Stream | null => {
  if (WEAK_V2_STREAM_READ_PATTERN.test(stream.current_read.trim())) return null;
  if (WEAK_V2_STREAM_TITLE_PATTERN.test(stream.title.trim())) {
    const replacement = titleFromStreamRead(stream.current_read);
    if (!replacement) return null;
    return {
      ...stream,
      id: normalizeStreamId(replacement) || stream.id,
      title: replacement,
    };
  }
  return stream;
};

const repairedV2Headline = (
  headline: string,
  streams: KnowledgeV2Stream[],
  attention: KnowledgeV2Item[],
  patterns: KnowledgeV2Item[],
): string => {
  const weak =
    WEAK_V2_HEADLINE_PATTERN.test(headline.trim()) || headline.length > 170;
  if (!weak) return headline;
  const attentionByStream = new Map<string, KnowledgeV2Item>();
  for (const item of attention) {
    const streamId = item.stream_ids[0];
    if (streamId && !attentionByStream.has(streamId)) {
      attentionByStream.set(streamId, item);
    }
  }
  const reads = streams.slice(0, 2).map((stream) => {
    const item = attentionByStream.get(stream.id);
    return `${stream.title}: ${item?.title || stream.current_read}`;
  });
  if (reads.length >= 2) return `${reads[0]}; ${reads[1]}.`;
  return reads[0] || patterns[0]?.title || 'No reliable compiled brief yet.';
};

const isReliableV2Headline = (headline: string): boolean => {
  const normalized = headline.trim();
  return (
    Boolean(normalized) &&
    normalized !== 'No reliable compiled brief yet.' &&
    !WEAK_V2_HEADLINE_PATTERN.test(normalized)
  );
};

const isReliableLegacyHeadline = (headline: string): boolean => {
  const normalized = headline.trim();
  return (
    Boolean(normalized) &&
    normalized !== 'No reliable compiled brief yet.' &&
    normalized !== 'Indexed knowledge needs a stronger synthesis.' &&
    !looksLikeRawId(normalized) &&
    !/^(the team discusses|the meeting opened|the conversation revolves|the user is planning)\b/i.test(
      normalized,
    ) &&
    normalized.length <= 170
  );
};

const parseStructuredKnowledgeV2Value = (
  doc: StructuredKnowledgeV2Source | null | undefined,
): StructuredKnowledgeV2Doc | null => {
  if (!doc?.structured_json) return null;
  try {
    const parsed = JSON.parse(doc.structured_json) as unknown;
    if (!isObject(parsed) || parsed.schema_version !== 2) return null;
    const currentRead = isObject(parsed.current_read)
      ? parsed.current_read
      : {};
    const sourceQuality = isObject(parsed.source_quality_summary)
      ? parsed.source_quality_summary
      : {};
    const changeSummary = isObject(parsed.change_summary)
      ? parsed.change_summary
      : {};
    const activeStreams = (
      Array.isArray(parsed.active_streams)
        ? parsed.active_streams.filter(isObject).map((stream, index) => ({
            id: asString(stream.id) || `stream-${index}`,
            title: asString(stream.title),
            domain: asString(stream.domain) || 'unknown',
            status: asString(stream.status),
            current_read: asString(stream.current_read),
            last_touched_at: asString(stream.last_touched_at) || null,
            source_count:
              typeof stream.source_count === 'number' ? stream.source_count : 0,
            open_follow_up_count:
              typeof stream.open_follow_up_count === 'number'
                ? stream.open_follow_up_count
                : 0,
            decision_count:
              typeof stream.decision_count === 'number'
                ? stream.decision_count
                : 0,
            unresolved_question_count:
              typeof stream.unresolved_question_count === 'number'
                ? stream.unresolved_question_count
                : 0,
            pinned: Boolean(stream.pinned),
            evidence_quality: parseV2Quality(stream.evidence_quality),
          }))
        : []
    )
      .map(repairV2Stream)
      .filter((stream): stream is KnowledgeV2Stream => Boolean(stream));
    const needsAttention = parseV2Items(parsed.needs_attention);
    const patterns = parseV2Items(parsed.patterns).filter(
      (pattern) =>
        pattern.evidence_quality.cited_meeting_count >= 2 ||
        /\b(repeated|multiple|recurring|again|across)\b/i.test(
          `${pattern.title} ${pattern.why_now}`,
        ),
    );
    return {
      schema_version: 2,
      scope: {
        type: doc.scope_type,
        title: doc.title,
      },
      current_read: {
        headline: repairedV2Headline(
          asString(currentRead.headline),
          activeStreams,
          needsAttention,
          patterns,
        ),
        supporting_bullets: Array.isArray(currentRead.supporting_bullets)
          ? currentRead.supporting_bullets.filter(
              (item): item is string => typeof item === 'string',
            )
          : [],
        freshness:
          asString(currentRead.freshness) === 'fresh' ||
          asString(currentRead.freshness) === 'aging' ||
          asString(currentRead.freshness) === 'stale'
            ? (asString(
                currentRead.freshness,
              ) as StructuredKnowledgeV2Doc['current_read']['freshness'])
            : 'unknown',
        source_count:
          typeof currentRead.source_count === 'number'
            ? currentRead.source_count
            : 0,
        cited_item_count:
          typeof currentRead.cited_item_count === 'number'
            ? currentRead.cited_item_count
            : 0,
        cited_meeting_count:
          typeof currentRead.cited_meeting_count === 'number'
            ? currentRead.cited_meeting_count
            : 0,
        trust_message: asString(currentRead.trust_message),
        evidence_quality: parseV2Quality(currentRead.evidence_quality),
      },
      active_streams: activeStreams,
      needs_attention: needsAttention,
      patterns,
      risks_and_unknowns: parseV2Items(parsed.risks_and_unknowns),
      evidence_index: Array.isArray(parsed.evidence_index)
        ? parsed.evidence_index.filter(isObject).map((entry, index) => ({
            id: asString(entry.id) || `evidence-${index}`,
            meeting_id: asString(entry.meeting_id),
            meeting_title: asString(entry.meeting_title),
            captured_at: asString(entry.captured_at) || null,
            quote: asString(entry.quote),
            stream_ids: Array.isArray(entry.stream_ids)
              ? entry.stream_ids.filter(
                  (id): id is string => typeof id === 'string',
                )
              : [],
            item_ids: Array.isArray(entry.item_ids)
              ? entry.item_ids.filter(
                  (id): id is string => typeof id === 'string',
                )
              : [],
            mode: asString(entry.mode) === 'inferred' ? 'inferred' : 'direct',
            confidence:
              typeof entry.confidence === 'number' ? entry.confidence : 0,
          }))
        : [],
      source_quality_summary: {
        included_count:
          typeof sourceQuality.included_count === 'number'
            ? sourceQuality.included_count
            : 0,
        excluded_count:
          typeof sourceQuality.excluded_count === 'number'
            ? sourceQuality.excluded_count
            : 0,
        weak_count:
          typeof sourceQuality.weak_count === 'number'
            ? sourceQuality.weak_count
            : 0,
        records: Array.isArray(sourceQuality.records)
          ? sourceQuality.records.filter(isObject).map((record) => ({
              meeting_id: asString(record.meeting_id),
              title: asString(record.title),
              usable: Boolean(record.usable),
              domain: asString(record.domain) || 'unknown',
              score: typeof record.score === 'number' ? record.score : 0,
              reasons: Array.isArray(record.reasons)
                ? record.reasons.filter(
                    (reason): reason is string => typeof reason === 'string',
                  )
                : [],
            }))
          : [],
      },
      change_summary: {
        generated_at: asString(changeSummary.generated_at) || null,
        added_count:
          typeof changeSummary.added_count === 'number'
            ? changeSummary.added_count
            : 0,
        removed_count:
          typeof changeSummary.removed_count === 'number'
            ? changeSummary.removed_count
            : 0,
        updated_count:
          typeof changeSummary.updated_count === 'number'
            ? changeSummary.updated_count
            : 0,
        notable_changes: Array.isArray(changeSummary.notable_changes)
          ? changeSummary.notable_changes.filter(
              (item): item is string => typeof item === 'string',
            )
          : [],
      },
    };
  } catch {
    return null;
  }
};

export const parseStructuredKnowledgeV2Doc = (
  doc: KnowledgeDoc | null | undefined,
): StructuredKnowledgeV2Doc | null => parseStructuredKnowledgeV2Value(doc);

const toWorkingMemorySnapshotStructuredDoc = (
  snapshot: WorkingMemorySnapshot,
  options?: {
    allowStale?: boolean;
  },
): StructuredKnowledgeV2Doc | null => {
  const allowStale = options?.allowStale ?? false;
  if (!supportsWorkingMemorySnapshotScope(snapshot.scope_type)) {
    return null;
  }
  if (snapshot.freshness === 'stale' && !allowStale) {
    return null;
  }

  const payload = snapshot.payload;
  if (
    !payload?.scope ||
    !supportsWorkingMemorySnapshotScope(payload.scope.type) ||
    payload.current_read == null ||
    !Array.isArray(payload.active_streams) ||
    !Array.isArray(payload.open_loops) ||
    !Array.isArray(payload.patterns) ||
    !Array.isArray(payload.risks_and_unknowns) ||
    !Array.isArray(payload.evidence_index)
  ) {
    return null;
  }

  const syntheticStructuredJson = JSON.stringify({
    schema_version: 2,
    scope: {
      type: payload.scope.type,
      title: payload.scope.title || snapshot.title,
    },
    current_read: {
      headline: payload.current_read.headline,
      supporting_bullets: payload.current_read.supporting_bullets,
      freshness: payload.current_read.freshness,
      source_count: payload.current_read.source_count,
      cited_item_count: payload.current_read.cited_item_count,
      cited_meeting_count: payload.current_read.cited_meeting_count,
      trust_message: payload.current_read.trust_message,
      evidence_quality: payload.current_read.evidence_quality ?? {
        mode: snapshot.trust_status === 'inferred' ? 'inferred' : 'direct',
        confidence:
          snapshot.trust_status === 'grounded'
            ? 0.9
            : snapshot.trust_status === 'inferred'
              ? 0.72
              : snapshot.trust_status === 'stale'
                ? 0.45
                : 0,
        cited_meeting_count: snapshot.cited_meeting_count,
        source_count: snapshot.source_count,
        last_reinforced_at:
          snapshot.source_doc_last_synthesized_at || snapshot.generated_at,
        freshness: snapshot.freshness,
      },
    },
    active_streams: payload.active_streams,
    needs_attention: payload.open_loops,
    patterns: payload.patterns,
    risks_and_unknowns: payload.risks_and_unknowns,
    evidence_index: payload.evidence_index,
    source_quality_summary: payload.source_quality_summary ?? {
      included_count: snapshot.source_count,
      excluded_count: 0,
      weak_count: 0,
      records: [],
    },
    change_summary: payload.change_summary ?? {
      generated_at: snapshot.generated_at,
      added_count: 0,
      removed_count: 0,
      updated_count: 0,
      notable_changes: [],
    },
  });

  return parseStructuredKnowledgeV2Value({
    scope_type: payload.scope.type,
    title: payload.scope.title || snapshot.title,
    structured_json: syntheticStructuredJson,
  });
};

const getWorkingMemorySnapshotSynthesisMarker = (
  snapshot: WorkingMemorySnapshot,
): string | null =>
  snapshot.source_doc_last_synthesized_at ||
  snapshot.payload?.source?.knowledge_doc_last_synthesized_at ||
  null;

export const matchesWorkingMemorySnapshotToDoc = (
  doc: KnowledgeDoc | null | undefined,
  workingMemorySnapshot: WorkingMemorySnapshot | null | undefined,
  options?: {
    allowStale?: boolean;
  },
): workingMemorySnapshot is WorkingMemorySnapshot => {
  const allowStale = options?.allowStale ?? false;
  if (!doc || !workingMemorySnapshot) return false;
  if (!supportsWorkingMemorySnapshotScope(doc.scope_type)) return false;
  if (workingMemorySnapshot.scope_type !== doc.scope_type) return false;
  if (workingMemorySnapshot.freshness === 'stale' && !allowStale) {
    return false;
  }
  if (workingMemorySnapshot.scope_key !== doc.scope_key) return false;
  if (workingMemorySnapshot.source_doc_id !== doc.id) return false;

  if (!doc.last_synthesized_at) return true;
  return (
    getWorkingMemorySnapshotSynthesisMarker(workingMemorySnapshot) ===
    doc.last_synthesized_at
  );
};

export const supportsWorkingMemorySnapshotScope = (
  scopeType: KnowledgeDocScopeType,
): boolean => WORKING_MEMORY_SNAPSHOT_SCOPE_TYPES.includes(scopeType);

export const parseStructuredKnowledgeDoc = (
  doc: KnowledgeDoc | null | undefined,
): StructuredKnowledgeDoc | null => {
  if (!doc?.structured_json) return null;

  try {
    const parsed = JSON.parse(doc.structured_json) as unknown;
    if (!isObject(parsed)) return null;

    const scope = isObject(parsed.scope) ? parsed.scope : {};
    const chapters = Array.isArray(parsed.chapters) ? parsed.chapters : [];
    const dependencySuggestions = Array.isArray(parsed.dependency_suggestions)
      ? parsed.dependency_suggestions
      : [];

    return {
      schema_version:
        typeof parsed.schema_version === 'number' ? parsed.schema_version : 1,
      scope: {
        type: (asString(scope.type) || doc.scope_type) as KnowledgeDocScopeType,
        title: asString(scope.title) || doc.title,
      },
      chapters: chapters.filter(isObject).map((chapter, index) => ({
        chapter_id: asString(chapter.chapter_id) || `chapter-${index}`,
        title: asString(chapter.title) || doc.title,
        decisions: parseStatements(chapter.decisions),
        topic_evolution: parseStatements(chapter.topic_evolution),
        open_risks: parseStatements(chapter.open_risks),
        signals: parseStatements(chapter.signals),
      })),
      dependency_suggestions: dependencySuggestions
        .filter(isObject)
        .map((suggestion) => ({
          source_name: asString(suggestion.source_name),
          target_name: asString(suggestion.target_name),
          relationship: asString(
            suggestion.relationship,
          ) as KnowledgeDependencySuggestion['relationship'],
          why: asString(suggestion.why),
          citations: parseCitations(suggestion.citations),
        }))
        .filter(
          (suggestion) =>
            suggestion.source_name &&
            suggestion.target_name &&
            suggestion.relationship &&
            !looksLikeRawId(suggestion.source_name) &&
            !looksLikeRawId(suggestion.target_name),
        ),
    };
  } catch {
    return null;
  }
};

export const getSectionStatements = (
  structuredDoc: StructuredKnowledgeDoc | null,
  section: KnowledgeSectionKey,
): KnowledgeStatement[] => {
  if (!structuredDoc) return [];
  return structuredDoc.chapters.flatMap((chapter) => chapter[section]);
};

export const deriveKnowledgeDigest = (
  doc: KnowledgeDoc | null | undefined,
  maxItems = 4,
): string[] => {
  if (!doc) return [];
  const structured = parseStructuredKnowledgeDoc(doc);
  if (structured) {
    const orderedSections: KnowledgeSectionKey[] = [
      'decisions',
      'topic_evolution',
      'open_risks',
      'signals',
    ];
    const items = orderedSections.flatMap((section) =>
      getSectionStatements(structured, section).map((item) => item.text),
    );
    const structuredDigest = items
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, maxItems);
    if (structuredDigest.length > 0) return structuredDigest;
  }

  if (!doc.rendered_content) return [];
  return doc.rendered_content
    .split('\n')
    .map((line) =>
      line
        .trim()
        .replace(/^[-*]\s+/, '')
        .replace(/^#+\s+/, ''),
    )
    .filter(
      (line) =>
        line &&
        !/^auto-synthesized/i.test(line) &&
        line !== doc.title &&
        line !== 'No citation-backed context is available yet.',
    )
    .slice(0, maxItems);
};

const buildKnowledgeBriefFromV2 = ({
  v2,
  trustStatus,
  sourceQuality,
}: {
  v2: StructuredKnowledgeV2Doc;
  trustStatus: TrustStatus;
  sourceQuality: KnowledgeV2SourceQualitySummary | null;
}): KnowledgeBrief => {
  const hasCompiledSurface =
    v2.active_streams.length > 0 ||
    v2.needs_attention.length > 0 ||
    v2.patterns.length > 0 ||
    v2.risks_and_unknowns.length > 0;
  const isCompiled =
    isReliableV2Headline(v2.current_read.headline) &&
    v2.current_read.cited_meeting_count > 0 &&
    hasCompiledSurface;
  const emptyLanes: KnowledgeBriefLane[] = [
    {
      id: 'priorities',
      label: 'What matters now',
      description: 'Signals and decisions that should shape attention.',
      items: [],
    },
    {
      id: 'risks',
      label: 'Risks to watch',
      description: 'Failure modes, blockers, and unresolved commitments.',
      items: [],
    },
    {
      id: 'patterns',
      label: 'Patterns changing',
      description: 'How themes are evolving across conversations.',
      items: [],
    },
    {
      id: 'dependencies',
      label: 'Cross-project links',
      description: 'Potential dependencies and impact paths Pluto inferred.',
      items: [],
    },
  ];

  return {
    isCompiled,
    backingSource: sourceQuality ? 'doc' : 'snapshot',
    headline: v2.current_read.headline || 'No reliable compiled brief yet.',
    freshnessAt: v2.current_read.evidence_quality.last_reinforced_at,
    supportingBullets: v2.current_read.supporting_bullets.filter(Boolean),
    lanes: emptyLanes,
    coverage: {
      sourceCount: v2.current_read.source_count,
      statementCount: v2.current_read.cited_item_count,
      citedMeetingCount: v2.current_read.cited_meeting_count,
      dependencyCount: v2.needs_attention.filter((item) =>
        ['dependency', 'blocker'].includes(item.kind),
      ).length,
    },
    evidenceQuality: v2.current_read.evidence_quality,
    activeStreams: v2.active_streams,
    patterns: v2.patterns,
    risksAndUnknowns: v2.risks_and_unknowns,
    evidenceIndex: v2.evidence_index,
    sourceQuality,
    trustMessage: v2.current_read.trust_message,
    trustStatus,
    trustDescription: getTrustStatusMeta(trustStatus).description,
  };
};

const deriveSnapshotBackedKnowledgeTrustStatus = (
  evidenceQuality: KnowledgeV2EvidenceQuality | null,
): TrustStatus => {
  if (evidenceQuality?.freshness === 'unknown') {
    return 'weak_evidence';
  }

  const baseTrustStatus = deriveKnowledgeTrustStatus({
    docStatus: 'up_to_date',
    evidenceQuality,
  });

  if (
    evidenceQuality?.freshness === 'aging' &&
    baseTrustStatus === 'grounded'
  ) {
    return 'inferred';
  }

  return baseTrustStatus;
};

const shouldAllowStaleSnapshotFallback = (
  doc: KnowledgeDoc | null | undefined,
): boolean => {
  if (!doc) return false;
  if (doc.status === 'failed' || doc.status === 'synthesizing') {
    return true;
  }
  return !doc.structured_json && !doc.rendered_content;
};

export const compileKnowledgeBrief = (
  doc: KnowledgeDoc | null | undefined,
  workingMemorySnapshot?: WorkingMemorySnapshot | null,
): KnowledgeBrief => {
  const matchesFreshSnapshot = matchesWorkingMemorySnapshotToDoc(
    doc,
    workingMemorySnapshot,
  );
  const matchesStaleFallbackSnapshot =
    !matchesFreshSnapshot &&
    shouldAllowStaleSnapshotFallback(doc) &&
    matchesWorkingMemorySnapshotToDoc(doc, workingMemorySnapshot, {
      allowStale: true,
    });
  const snapshotV2 =
    workingMemorySnapshot &&
    (matchesFreshSnapshot || matchesStaleFallbackSnapshot)
      ? toWorkingMemorySnapshotStructuredDoc(workingMemorySnapshot, {
          allowStale: matchesStaleFallbackSnapshot,
        })
      : null;
  if (snapshotV2 && workingMemorySnapshot) {
    return buildKnowledgeBriefFromV2({
      v2: snapshotV2,
      trustStatus: deriveSnapshotBackedKnowledgeTrustStatus(
        snapshotV2.current_read.evidence_quality,
      ),
      sourceQuality: snapshotV2.source_quality_summary,
    });
  }

  const v2 = parseStructuredKnowledgeV2Doc(doc);
  const structured = v2 ? null : parseStructuredKnowledgeDoc(doc);
  const emptyLanes: KnowledgeBriefLane[] = [
    {
      id: 'priorities',
      label: 'What matters now',
      description: 'Signals and decisions that should shape attention.',
      items: [],
    },
    {
      id: 'risks',
      label: 'Risks to watch',
      description: 'Failure modes, blockers, and unresolved commitments.',
      items: [],
    },
    {
      id: 'patterns',
      label: 'Patterns changing',
      description: 'How themes are evolving across conversations.',
      items: [],
    },
    {
      id: 'dependencies',
      label: 'Cross-project links',
      description: 'Potential dependencies and impact paths Pluto inferred.',
      items: [],
    },
  ];

  if (v2) {
    return buildKnowledgeBriefFromV2({
      v2,
      trustStatus: deriveKnowledgeTrustStatus({
        docStatus: doc?.status ?? 'up_to_date',
        evidenceQuality: v2.current_read.evidence_quality,
      }),
      sourceQuality: v2.source_quality_summary,
    });
  }

  if (!structured) {
    return {
      isCompiled: false,
      backingSource: 'none',
      headline: 'No reliable compiled brief yet.',
      freshnessAt: doc?.last_synthesized_at || doc?.updated_at || null,
      supportingBullets: [],
      lanes: emptyLanes,
      coverage: EMPTY_BRIEF_COVERAGE,
      evidenceQuality: null,
      activeStreams: [],
      patterns: [],
      risksAndUnknowns: [],
      evidenceIndex: [],
      sourceQuality: null,
      trustMessage: null,
      trustStatus: null,
      trustDescription: null,
    };
  }

  const signals = getSectionStatements(structured, 'signals');
  const decisions = getSectionStatements(structured, 'decisions');
  const risks = getSectionStatements(structured, 'open_risks');
  const patterns = getSectionStatements(structured, 'topic_evolution');
  const dependencies =
    structured?.dependency_suggestions.map((suggestion, index) => ({
      id: `dependency-${index}`,
      text: `${suggestion.source_name} ${suggestion.relationship.replace(
        /_/g,
        ' ',
      )} ${suggestion.target_name}`,
      why_it_matters: suggestion.why,
      citations: suggestion.citations,
    })) || [];
  const lanes: KnowledgeBriefLane[] = [
    {
      id: 'priorities',
      label: 'What matters now',
      description: 'Signals and decisions that should shape attention.',
      items: [...signals, ...decisions],
    },
    {
      id: 'risks',
      label: 'Risks to watch',
      description: 'Failure modes, blockers, and unresolved commitments.',
      items: risks,
    },
    {
      id: 'patterns',
      label: 'Patterns changing',
      description: 'How themes are evolving across conversations.',
      items: patterns,
    },
    {
      id: 'dependencies',
      label: 'Cross-project links',
      description: 'Potential dependencies and impact paths Pluto inferred.',
      items: dependencies,
    },
  ];

  const statementItems = [...signals, ...decisions, ...risks, ...patterns];
  const citedMeetingIds = new Set(
    [...statementItems, ...dependencies].flatMap((item) =>
      item.citations
        .map((citation) => citation.meeting_id.trim())
        .filter(Boolean),
    ),
  );
  const coverage: KnowledgeBriefCoverage = {
    sourceCount: null,
    statementCount: statementItems.length,
    citedMeetingCount: citedMeetingIds.size,
    dependencyCount: dependencies.length,
  };
  const hasCompiledItems =
    statementItems.length >= 2 && citedMeetingIds.size >= 2;

  const scoreHeadlineCandidate = (
    item: KnowledgeStatement,
    section: KnowledgeSectionKey | 'dependencies',
  ): number => {
    const sectionScore: Record<KnowledgeSectionKey | 'dependencies', number> = {
      signals: 21,
      decisions: 20,
      open_risks: 18,
      topic_evolution: 14,
      dependencies: 10,
    };
    const citedMeetings = new Set(
      item.citations
        .map((citation) => citation.meeting_id.trim())
        .filter(Boolean),
    );
    const imperativePenalty =
      /^(commit|research|schedule|follow up|send|review|prepare|create|update|finish)\b/i.test(
        item.text.trim(),
      )
        ? 8
        : 0;
    const meetingSummaryPenalty =
      /^(the team discusses|the meeting opened|the conversation revolves|the user is planning)\b/i.test(
        item.text.trim(),
      )
        ? 10
        : 0;
    const lengthPenalty = item.text.length > 140 ? 4 : 0;
    const contextBonus = item.why_it_matters.trim().length >= 80 ? 2 : 0;
    return (
      sectionScore[section] +
      citedMeetings.size * 5 +
      Math.min(item.citations.length, 3) +
      contextBonus -
      imperativePenalty -
      meetingSummaryPenalty -
      lengthPenalty
    );
  };

  const headlineCandidates: Array<{
    item: KnowledgeStatement;
    section: KnowledgeSectionKey | 'dependencies';
    index: number;
  }> = [
    ...signals.map((item, index) => ({
      item,
      section: 'signals' as const,
      index,
    })),
    ...risks.map((item, index) => ({
      item,
      section: 'open_risks' as const,
      index,
    })),
    ...decisions.map((item, index) => ({
      item,
      section: 'decisions' as const,
      index,
    })),
    ...patterns.map((item, index) => ({
      item,
      section: 'topic_evolution' as const,
      index,
    })),
    ...dependencies.map((item, index) => ({
      item,
      section: 'dependencies' as const,
      index,
    })),
  ];
  headlineCandidates.sort((a, b) => {
    const scoreDelta =
      scoreHeadlineCandidate(b.item, b.section) -
      scoreHeadlineCandidate(a.item, a.section);
    if (scoreDelta !== 0) return scoreDelta;
    return a.index - b.index;
  });
  const weakSynthesisHeadline = headlineCandidates.find((candidate) =>
    isReliableLegacyHeadline(candidate.item.text),
  )?.item.text;

  return {
    isCompiled: hasCompiledItems,
    backingSource: 'doc',
    headline: hasCompiledItems
      ? headlineCandidates[0]?.item.text || 'No reliable compiled brief yet.'
      : weakSynthesisHeadline
        ? weakSynthesisHeadline
        : statementItems.length > 0 || dependencies.length > 0
          ? 'Indexed knowledge needs a stronger synthesis.'
          : 'No reliable compiled brief yet.',
    freshnessAt: doc?.last_synthesized_at || doc?.updated_at || null,
    supportingBullets: [],
    lanes,
    coverage,
    evidenceQuality: null,
    activeStreams: [],
    patterns: [],
    risksAndUnknowns: [],
    evidenceIndex: [],
    sourceQuality: null,
    trustMessage: null,
    trustStatus: null,
    trustDescription: null,
  };
};

export const groupKnowledgeDocs = (
  docs: KnowledgeDoc[],
): KnowledgeDocGroup[] => {
  return GROUP_ORDER.map((scopeType) => ({
    scopeType,
    label: GROUP_LABELS[scopeType],
    docs: docs
      .filter((doc) => doc.scope_type === scopeType)
      .sort(
        (a, b) =>
          new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
      ),
  })).filter((group) => group.docs.length > 0);
};

export const knowledgeDocsNeedPolling = (docs: KnowledgeDoc[]): boolean =>
  docs.some((doc) => doc.status === 'synthesizing' || doc.status === 'stale');

const severityRank: Record<AttentionSeverity, number> = {
  critical: 0,
  watch: 1,
  steady: 2,
};

const FOLLOW_UP_ACTION_PATTERN =
  /^(review|research|investigate|merge|prepare|validate|follow up|send|schedule|create|update|resolve|check|confirm|clarify|draft|share|coordinate)\b/i;

const FOLLOW_UP_SOURCE_PATTERN = /\bfollow-up or unresolved work\b/i;

const ESCALATION_CUE_PATTERN =
  /\b(approval|blocked?|confusion|delay|dependency|depends|failed|failure|missing|pending|risk|unresolved)\b/i;

const classifyOpenRiskStatement = (
  risk: KnowledgeStatement,
): Pick<NeedsAttentionItem, 'kind' | 'severity'> => {
  const isExtractedFollowUp =
    FOLLOW_UP_SOURCE_PATTERN.test(risk.why_it_matters) ||
    FOLLOW_UP_ACTION_PATTERN.test(risk.text.trim());

  if (isExtractedFollowUp) {
    return {
      kind: 'follow_up',
      severity: 'watch',
    };
  }

  return {
    kind: 'risk',
    severity: 'critical',
  };
};

const attentionSortScore = (item: NeedsAttentionItem): number => {
  const escalationBonus = ESCALATION_CUE_PATTERN.test(item.title) ? 0 : 1;
  const kindRank: Record<NeedsAttentionKind, number> = {
    risk: 0,
    blocker: 1,
    dependency: 2,
    project: 3,
    follow_up: 4,
  };
  return (
    severityRank[item.severity] * 10 + escalationBonus + kindRank[item.kind]
  );
};

const mapAttentionKind = (kind: AttentionItem['kind']): NeedsAttentionKind => {
  if (kind === 'follow_up' || kind === 'duplicate_commitment') {
    return 'follow_up';
  }
  if (kind === 'blocker') {
    return 'blocker';
  }
  if (kind === 'dependency') {
    return 'dependency';
  }
  return 'risk';
};

export const compileNeedsAttention = (
  doc: KnowledgeDoc | null | undefined,
  docs: KnowledgeDoc[],
  projectCards: KnowledgeProjectHealthCard[],
  attentionItems: AttentionItem[] = [],
  workingMemorySnapshot?: WorkingMemorySnapshot | null,
): NeedsAttentionItem[] => {
  if (
    doc?.scope_type === 'global' &&
    attentionItems.some((item) => item.status === 'active')
  ) {
    return attentionItems
      .filter((item) => item.status === 'active')
      .map((item) => ({
        id: item.id,
        title: item.title,
        summary: item.reason,
        severity: item.severity,
        kind: mapAttentionKind(item.kind),
        reasons: item.reason ? [item.reason] : [],
        citations: item.evidence.map((evidence) => ({
          meeting_id: evidence.meeting_id,
          quote: evidence.quote,
        })),
      }));
  }

  const snapshotV2 = matchesWorkingMemorySnapshotToDoc(
    doc,
    workingMemorySnapshot,
  )
    ? toWorkingMemorySnapshotStructuredDoc(workingMemorySnapshot)
    : null;
  const v2 = snapshotV2 ?? parseStructuredKnowledgeV2Doc(doc);
  const structured = v2 ? null : parseStructuredKnowledgeDoc(doc);
  const v2Items: NeedsAttentionItem[] = v2
    ? v2.needs_attention.map((item) => ({
        id: item.id,
        title: item.title,
        summary: item.summary || item.why_now,
        severity:
          item.severity === 'needs_attention'
            ? 'critical'
            : item.severity === 'watch'
              ? 'watch'
              : 'steady',
        kind:
          item.kind === 'follow_up'
            ? 'follow_up'
            : item.kind === 'risk'
              ? 'risk'
              : item.kind === 'blocker'
                ? 'blocker'
                : item.kind === 'dependency'
                  ? 'dependency'
                  : 'project',
        reasons: [item.why_now || item.summary].filter(Boolean),
        citations: item.citations,
      }))
    : [];
  const riskItems: NeedsAttentionItem[] = structured
    ? getSectionStatements(structured, 'open_risks').map((risk) => {
        const classification = classifyOpenRiskStatement(risk);
        return {
          id: `risk-${risk.id}`,
          title: risk.text,
          summary:
            risk.why_it_matters ||
            (classification.kind === 'follow_up'
              ? 'This follow-up is still open.'
              : 'This risk is unresolved.'),
          ...classification,
          reasons: risk.why_it_matters ? [risk.why_it_matters] : [],
          citations: risk.citations,
        };
      })
    : [];

  const dependencyItems: NeedsAttentionItem[] =
    structured?.dependency_suggestions.map((suggestion, index) => ({
      id: `dependency-attention-${index}`,
      title: `${suggestion.source_name} ${suggestion.relationship.replace(
        /_/g,
        ' ',
      )} ${suggestion.target_name}`,
      summary: suggestion.why || 'This dependency may affect active work.',
      severity: suggestion.relationship === 'blocked_by' ? 'critical' : 'watch',
      kind: 'dependency',
      reasons: suggestion.why ? [suggestion.why] : [],
      citations: suggestion.citations,
    })) || [];

  if (snapshotV2 && doc?.scope_type !== 'global') {
    return [...v2Items, ...riskItems, ...dependencyItems].sort(
      (a, b) => compareAttentionPriority(b) - compareAttentionPriority(a),
    );
  }

  const projectDocs = docs.filter((doc) => doc.scope_type === 'project');
  const docsById = new Map(projectDocs.map((doc) => [doc.id, doc]));
  const cardItems = projectCards.map((card) => {
    const doc = docsById.get(card.doc_id);
    const reasons = [
      card.open_blockers > 0
        ? `${card.open_blockers} blocker${card.open_blockers === 1 ? '' : 's'}`
        : '',
      card.dependency_count > 0
        ? `${card.dependency_count} dependenc${
            card.dependency_count === 1 ? 'y' : 'ies'
          }`
        : '',
      card.recent_changes > 0
        ? `${card.recent_changes} recent change${
            card.recent_changes === 1 ? '' : 's'
          }`
        : '',
      card.staleness_days > 7 ? `${card.staleness_days}d stale` : '',
      doc?.status === 'failed' ? 'synthesis failed' : '',
      doc?.status === 'stale' ? 'doc stale' : '',
    ].filter(Boolean);

    const severity: AttentionSeverity =
      card.open_blockers > 0 || doc?.status === 'failed'
        ? 'critical'
        : card.dependency_count > 0 ||
            card.staleness_days > 7 ||
            doc?.status === 'stale'
          ? 'watch'
          : 'steady';

    return {
      id: `project-${card.doc_id}`,
      title: card.title || doc?.title || 'Untitled project',
      summary:
        severity === 'critical'
          ? 'This active project has blockers or a failed synthesis.'
          : severity === 'watch'
            ? 'This active project is showing drift, dependencies, or stale context.'
            : 'No blocker is currently surfaced for this project.',
      severity,
      kind: 'project' as const,
      reasons: reasons.length > 0 ? reasons : ['No blockers surfaced'],
      citations: [],
    };
  });

  const cardDocIds = new Set(projectCards.map((card) => card.doc_id));
  const docOnlyItems = projectDocs
    .filter((doc) => !cardDocIds.has(doc.id))
    .filter((doc) => doc.status !== 'inactive')
    .map((doc) => {
      const severity: AttentionSeverity =
        doc.status === 'failed'
          ? 'critical'
          : doc.status === 'stale'
            ? 'watch'
            : 'steady';
      return {
        id: `project-${doc.id}`,
        title: doc.title,
        summary:
          severity === 'critical'
            ? 'This project synthesis failed.'
            : severity === 'watch'
              ? 'This project context may be getting stale.'
              : 'This project is present in knowledge, with no surfaced blocker.',
        severity,
        kind: 'project' as const,
        reasons: [formatDocStatus(doc.status)],
        citations: [],
      };
    });

  return [
    ...v2Items,
    ...riskItems,
    ...dependencyItems,
    ...cardItems,
    ...docOnlyItems,
  ].sort((a, b) => attentionSortScore(a) - attentionSortScore(b));
};

export const formatDocStatus = (status: KnowledgeDoc['status']): string => {
  return status.replace(/_/g, ' ');
};

export const formatRelativeKnowledgeTime = (
  value: string | null | undefined,
): string => {
  if (!value) return 'Never synthesized';
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return 'Unknown freshness';

  const diffMs = Date.now() - timestamp;
  const minutes = Math.max(0, Math.floor(diffMs / 60_000));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
};
