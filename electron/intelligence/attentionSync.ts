import * as db from '../db';
import type { Entity } from '../db';
import type { KnowledgeV2Document, KnowledgeV2Item } from '../knowledgeV2';
import type {
  AttentionEvidenceReference,
  AttentionItem,
  AttentionItemKind,
  AttentionItemUpsert,
} from './intelligenceTypes';
import { scoreAttentionItem } from './attentionScoring';

const KNOWLEDGE_PREFIX = 'knowledge_v2:global:';
const ACTION_PREFIX = 'action_tracker:';
const STALE_ACTION_DAYS = 7;

const normalizeText = (value: string): string =>
  value.toLowerCase().replace(/\s+/g, ' ').trim();

const sanitizeKeyPart = (value: string): string =>
  normalizeText(value)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72);

const mapKnowledgeKind = (item: KnowledgeV2Item): AttentionItemKind => {
  switch (item.kind) {
    case 'follow_up':
      return 'follow_up';
    case 'blocker':
      return 'blocker';
    case 'risk':
      return 'risk';
    case 'dependency':
      return 'dependency';
    case 'open_question':
      return 'open_question';
    case 'stale_context':
      return 'stale_context';
    default:
      return 'reference_context';
  }
};

const unique = (values: string[]): string[] => Array.from(new Set(values));

const syncResolvedItems = (
  prefix: string,
  activeKeys: Set<string>,
  source: AttentionItemUpsert['source'],
): void => {
  for (const item of db.listAttentionItems()) {
    if (item.source !== source || !item.dedupe_key.startsWith(prefix)) continue;
    if (activeKeys.has(item.dedupe_key)) continue;
    if (
      item.status === 'resolved' ||
      item.status === 'dismissed' ||
      item.status === 'superseded'
    ) {
      continue;
    }

    db.upsertAttentionItem({
      dedupe_key: item.dedupe_key,
      kind: item.kind,
      severity: item.severity,
      score: item.score,
      status: 'resolved',
      title: item.title,
      reason: item.reason,
      source: item.source,
      score_breakdown: item.score_breakdown,
      evidence: item.evidence,
      related_entity_ids: item.related_entity_ids,
      related_stream_ids: item.related_stream_ids,
      related_meeting_ids: item.related_meeting_ids,
      resolved_at: new Date().toISOString(),
    });
  }
};

const buildKnowledgeAttentionItem = (
  item: KnowledgeV2Item,
): AttentionItemUpsert | null => {
  const kind = mapKnowledgeKind(item);
  const confidence = item.evidence_quality.confidence;
  if (confidence < 0.55) return null;
  const keyParts = [item.stream_ids.join('-'), item.kind, item.id, item.title]
    .map(sanitizeKeyPart)
    .filter(Boolean)
    .join(':');
  const dedupeKey = `${KNOWLEDGE_PREFIX}${keyParts}`;
  const evidence: AttentionEvidenceReference[] = item.citations.map(
    (citation) => ({
      meeting_id: citation.meeting_id,
      quote: citation.quote,
      source_kind: 'knowledge_v2',
    }),
  );
  const scored = scoreAttentionItem({
    kind,
    status: 'active',
    confidence,
    evidence_mode: item.evidence_quality.mode,
    freshness: item.evidence_quality.freshness,
    last_reinforced_at: item.evidence_quality.last_reinforced_at,
    cited_meeting_count: item.evidence_quality.cited_meeting_count,
    source_count: item.evidence_quality.source_count,
    related_stream_count: item.stream_ids.length,
    is_explicit_commitment: kind === 'follow_up',
  });

  return {
    dedupe_key: dedupeKey,
    kind,
    severity: scored.severity,
    score: scored.score,
    status: 'active',
    title: item.title,
    reason: item.why_now,
    source: 'knowledge_v2',
    score_breakdown: scored.score_breakdown,
    evidence,
    related_entity_ids: [],
    related_stream_ids: item.stream_ids,
    related_meeting_ids: unique(
      item.citations.map((citation) => citation.meeting_id),
    ),
  };
};

export const syncGlobalKnowledgeAttentionQueue = (
  doc: KnowledgeV2Document,
): AttentionItem[] => {
  const candidates = [
    ...doc.needs_attention,
    ...doc.risks_and_unknowns.filter(
      (item) =>
        (item.kind === 'risk' ||
          item.kind === 'blocker' ||
          item.kind === 'open_question') &&
        item.evidence_quality.confidence >= 0.7,
    ),
  ];

  const deduped = new Map<string, AttentionItemUpsert>();
  for (const item of candidates) {
    const mapped = buildKnowledgeAttentionItem(item);
    if (!mapped) continue;
    deduped.set(mapped.dedupe_key, mapped);
  }

  const activeKeys = new Set(deduped.keys());
  const persisted = Array.from(deduped.values()).map((item) =>
    db.upsertAttentionItem(item),
  );
  syncResolvedItems(KNOWLEDGE_PREFIX, activeKeys, 'knowledge_v2');
  return persisted;
};

const actionEvidence = (
  action: Entity,
  sourceKind: string,
): AttentionEvidenceReference[] =>
  db
    .getMeetingsForEntity(action.id)
    .slice(0, 3)
    .map((meeting) => ({
      meeting_id: meeting.meeting_id,
      quote: action.name,
      entity_id: action.id,
      source_kind: sourceKind,
    }));

const buildOverdueActionItem = (action: Entity): AttentionItemUpsert => {
  const relatedMeetingIds = unique(
    db.getMeetingsForEntity(action.id).map((meeting) => meeting.meeting_id),
  );
  const scored = scoreAttentionItem({
    kind: 'follow_up',
    status: 'active',
    confidence: 0.95,
    evidence_mode: 'direct',
    freshness: 'fresh',
    due_at: action.due_date ?? null,
    updated_at: action.updated_at ?? null,
    cited_meeting_count: relatedMeetingIds.length || 1,
    source_count: relatedMeetingIds.length || 1,
    related_stream_count: 0,
    is_explicit_commitment: true,
  });

  return {
    dedupe_key: `${ACTION_PREFIX}overdue:${sanitizeKeyPart(action.id)}`,
    kind: 'follow_up',
    severity: scored.severity,
    score: scored.score,
    status: 'active',
    title: action.name,
    reason: action.due_date
      ? `This action item is overdue since ${action.due_date}.`
      : 'This action item is overdue.',
    source: 'action_tracker',
    score_breakdown: scored.score_breakdown,
    evidence: actionEvidence(action, 'overdue_action'),
    related_entity_ids: [action.id],
    related_stream_ids: [],
    related_meeting_ids: relatedMeetingIds,
  };
};

const buildStaleActionItem = (action: Entity): AttentionItemUpsert => {
  const relatedMeetingIds = unique(
    db.getMeetingsForEntity(action.id).map((meeting) => meeting.meeting_id),
  );
  const scored = scoreAttentionItem({
    kind: 'stale_context',
    status: 'active',
    confidence: 0.72,
    evidence_mode: 'direct',
    freshness: 'stale',
    updated_at: action.updated_at ?? null,
    cited_meeting_count: relatedMeetingIds.length || 1,
    source_count: relatedMeetingIds.length || 1,
    related_stream_count: 0,
    is_explicit_commitment: true,
  });

  return {
    dedupe_key: `${ACTION_PREFIX}stale:${sanitizeKeyPart(action.id)}`,
    kind: 'stale_context',
    severity: scored.severity,
    score: scored.score,
    status: 'active',
    title: action.name,
    reason: `This action item has not been updated in ${STALE_ACTION_DAYS}+ days.`,
    source: 'action_tracker',
    score_breakdown: scored.score_breakdown,
    evidence: actionEvidence(action, 'stale_action'),
    related_entity_ids: [action.id],
    related_stream_ids: [],
    related_meeting_ids: relatedMeetingIds,
  };
};

export const syncActionTrackerAttentionQueue = (): AttentionItem[] => {
  const overdue = db.getOverdueActionItems();
  const overdueIds = new Set(overdue.map((action) => action.id));
  const stale = db
    .getStaleActionItems(STALE_ACTION_DAYS)
    .filter((action) => !overdueIds.has(action.id));

  const items = [
    ...overdue.map(buildOverdueActionItem),
    ...stale.map(buildStaleActionItem),
  ];
  const activeKeys = new Set(items.map((item) => item.dedupe_key));
  const persisted = items.map((item) => db.upsertAttentionItem(item));
  syncResolvedItems(ACTION_PREFIX, activeKeys, 'action_tracker');
  return persisted;
};
