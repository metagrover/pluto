/**
 * Proactive Intelligence Engine (Phase 4)
 *
 * Post-meeting triggers that surface cross-meeting intelligence automatically.
 * Runs after MID generation and emits durable attention items stored in SQLite.
 *
 * Scope: Post-meeting triggers only (MVP). Three trigger types:
 *   1. cross_reference    — same entities/topics appear in a previous meeting
 *   2. duplicate_action   — new action items overlap existing open items (fuzzy match)
 *   3. decision_conflict  — new decisions conflict with prior decisions on same topic
 */

import { randomUUID } from 'node:crypto';
import * as db from '../db';
import { findSimilarEntity } from '../entityPipeline';
import { scoreAttentionItem } from './attentionScoring';
import type {
  AttentionItem,
  AttentionItemKind,
  AttentionItemUpsert,
  MidFrontmatter,
} from './intelligenceTypes';
import { retrieveContext } from './queryEngine';

/**
 * Retrieve stored attention items. Pass `meetingId` to scope to one meeting.
 */
export function getAlerts(options?: {
  meetingId?: string;
  limit?: number;
}): AttentionItem[] {
  return db.listAttentionItems(options);
}

/**
 * Clear attention items for a meeting (called when meeting is deleted).
 */
export function clearAlertsForMeeting(meetingId: string): void {
  db.clearAttentionItemsForMeeting(meetingId);
  console.log(
    `[ProactiveEngine] Cleared attention items for meeting ${meetingId}`,
  );
}

export function updateAlertStatus(
  id: string,
  status: AttentionItem['status'],
): AttentionItem | null {
  return db.updateAttentionItemStatus(id, status);
}

function sanitizeDedupePart(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function buildDedupeKey(
  kind: AttentionItemKind,
  parts: Array<string | undefined | null>,
): string {
  const suffix = parts
    .map((part) => sanitizeDedupePart(part ?? ''))
    .filter(Boolean)
    .join(':');
  return suffix ? `${kind}:${suffix}` : `${kind}:${randomUUID()}`;
}

function makeAttentionItem(
  partial: Omit<
    AttentionItemUpsert,
    'score' | 'severity' | 'status' | 'source' | 'score_breakdown'
  > & {
    status?: AttentionItemUpsert['status'];
    confidence?: number;
    evidence_mode?: 'direct' | 'inferred' | 'unknown';
    freshness?: 'fresh' | 'aging' | 'stale' | 'unknown';
    due_at?: string | null;
    updated_at?: string | null;
    last_reinforced_at?: string | null;
    source_count?: number;
    cited_meeting_count?: number;
    related_stream_count?: number;
    is_explicit_commitment?: boolean;
  },
): AttentionItemUpsert {
  const status = partial.status ?? 'active';
  const scored = scoreAttentionItem({
    kind: partial.kind,
    status,
    confidence: partial.confidence,
    evidence_mode: partial.evidence_mode,
    freshness: partial.freshness,
    due_at: partial.due_at,
    updated_at: partial.updated_at,
    last_reinforced_at: partial.last_reinforced_at,
    source_count:
      partial.source_count ?? Math.max(1, partial.related_meeting_ids.length),
    cited_meeting_count:
      partial.cited_meeting_count ??
      Math.max(1, partial.related_meeting_ids.length),
    related_stream_count: partial.related_stream_count ?? 0,
    is_explicit_commitment: partial.is_explicit_commitment,
  });

  return {
    ...partial,
    score: scored.score,
    severity: scored.severity,
    status,
    source: 'proactive_engine',
    score_breakdown: scored.score_breakdown,
  };
}

/**
 * Simple token-level Jaccard similarity between two strings.
 * Used for fuzzy action-item duplicate detection without an LLM call.
 */
function jaccardSimilarity(a: string, b: string): number {
  const tokenize = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((t) => t.length >= 3),
    );
  const setA = tokenize(a);
  const setB = tokenize(b);
  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return intersection / union;
}

async function detectCrossReferences(
  newMeetingId: string,
  mid: MidFrontmatter,
): Promise<AttentionItemUpsert[]> {
  const items: AttentionItemUpsert[] = [];
  const queryParts: string[] = [
    ...mid.topics.map((topic) => topic.name),
    ...mid.participants.map((participant) => participant.name),
    ...mid.projects.map((project) => project.name),
  ].slice(0, 8);

  if (queryParts.length === 0) return items;

  try {
    const context = await retrieveContext({
      keywords: queryParts,
      expanded_keywords: [],
      entity_mentions: mid.participants.map(
        (participant) => participant.entity_id,
      ),
      temporal_range: null,
      intent: 'factual',
    });

    const relatedMeetings = context.filter(
      (result) => result.meeting_id !== newMeetingId && result.score > 0.15,
    );

    if (relatedMeetings.length === 0) return items;

    const relatedIds = relatedMeetings.map((result) => result.meeting_id);
    const topicSummary =
      mid.topics
        .map((topic) => topic.name)
        .slice(0, 3)
        .join(', ') || mid.title;

    items.push(
      makeAttentionItem({
        dedupe_key: buildDedupeKey('reference_context', [
          newMeetingId,
          ...mid.topics.map((topic) => topic.entity_id).sort(),
        ]),
        kind: 'reference_context',
        title: `Cross-reference: ${mid.title}`,
        reason: `This meeting shares themes (${topicSummary}) with ${relatedMeetings.length} previous meeting(s). Consider reviewing for continuity.`,
        evidence: [
          {
            meeting_id: newMeetingId,
            quote: topicSummary,
            source_kind: 'cross_reference',
          },
          ...relatedIds.slice(0, 3).map((meetingId) => ({
            meeting_id: meetingId,
            quote: topicSummary,
            source_kind: 'cross_reference',
          })),
        ],
        related_meeting_ids: [newMeetingId, ...relatedIds.slice(0, 3)],
        related_entity_ids: [
          ...mid.topics.map((topic) => topic.entity_id),
          ...mid.participants.map((participant) => participant.entity_id),
        ].slice(0, 6),
        related_stream_ids: [],
        confidence: 0.68,
        evidence_mode: 'direct',
        freshness: 'fresh',
        source_count: relatedMeetings.length + 1,
        cited_meeting_count: relatedMeetings.length + 1,
      }),
    );
  } catch (err) {
    console.warn('[ProactiveEngine] Cross-reference detection failed:', err);
  }

  return items;
}

function detectDuplicateActions(
  newMeetingId: string,
  mid: MidFrontmatter,
): AttentionItemUpsert[] {
  const items: AttentionItemUpsert[] = [];
  const newActiveItems = mid.action_items.filter(
    (item) => item.status === 'active',
  );
  if (newActiveItems.length === 0) return items;

  const existingActionEntities = db
    .getAllEntities()
    .filter(
      (entity) => entity.type === 'action_item' && entity.status === 'active',
    );

  if (existingActionEntities.length === 0) return items;

  for (const newItem of newActiveItems) {
    const newText = newItem.description;
    const fuzzyMatch = existingActionEntities.find(
      (existing) => jaccardSimilarity(newText, existing.name) >= 0.45,
    );
    const entityMatch =
      !fuzzyMatch &&
      findSimilarEntity('action_item', newText, existingActionEntities, 0.75);
    const duplicate = fuzzyMatch || entityMatch;
    if (!duplicate) continue;

    const duplicateMeetingIds = db
      .getMeetingsForEntity(duplicate.id)
      .map((meeting) => meeting.meeting_id)
      .filter((meetingId) => meetingId !== newMeetingId);

    if (duplicateMeetingIds.length === 0) continue;

    items.push(
      makeAttentionItem({
        dedupe_key: buildDedupeKey('duplicate_commitment', [
          newItem.entity_id,
          duplicate.id,
          newMeetingId,
          ...duplicateMeetingIds.slice(0, 2),
        ]),
        kind: 'duplicate_commitment',
        title: 'Duplicate action item detected',
        reason: `"${newText.slice(0, 80)}" appears to overlap with an existing open action item: "${duplicate.name.slice(0, 80)}"`,
        evidence: [
          {
            meeting_id: newMeetingId,
            quote: newText.slice(0, 160),
            entity_id: newItem.entity_id,
            source_kind: 'duplicate_action',
          },
          ...duplicateMeetingIds.slice(0, 2).map((meetingId) => ({
            meeting_id: meetingId,
            quote: duplicate.name.slice(0, 160),
            entity_id: duplicate.id,
            source_kind: 'duplicate_action',
          })),
        ],
        related_meeting_ids: [newMeetingId, ...duplicateMeetingIds.slice(0, 2)],
        related_entity_ids: [newItem.entity_id, duplicate.id],
        related_stream_ids: [],
        confidence: 0.76,
        evidence_mode: 'direct',
        freshness: 'fresh',
        source_count: duplicateMeetingIds.length + 1,
        cited_meeting_count: duplicateMeetingIds.length + 1,
        is_explicit_commitment: true,
      }),
    );
  }

  return items;
}

function detectDecisionConflicts(
  newMeetingId: string,
  mid: MidFrontmatter,
): AttentionItemUpsert[] {
  const items: AttentionItemUpsert[] = [];
  if (mid.decisions.length === 0) return items;

  const existingDecisionEntities = db
    .getAllEntities()
    .filter(
      (entity) => entity.type === 'decision' && entity.status === 'active',
    );

  if (existingDecisionEntities.length === 0) return items;

  for (const newDecision of mid.decisions) {
    const newText = newDecision.description;
    const conflictCandidates = existingDecisionEntities.filter((existing) => {
      const similarity = jaccardSimilarity(newText, existing.name);
      return similarity >= 0.4 && similarity < 0.85;
    });

    for (const candidate of conflictCandidates) {
      const candidateMeetingIds = db
        .getMeetingsForEntity(candidate.id)
        .map((meeting) => meeting.meeting_id)
        .filter((meetingId) => meetingId !== newMeetingId);

      if (candidateMeetingIds.length === 0) continue;

      items.push(
        makeAttentionItem({
          dedupe_key: buildDedupeKey('decision_conflict', [
            newDecision.entity_id,
            candidate.id,
            newMeetingId,
            ...candidateMeetingIds.slice(0, 2),
          ]),
          kind: 'decision_conflict',
          title: 'Potential decision conflict',
          reason: `New decision: "${newText.slice(0, 80)}" may conflict with a prior decision: "${candidate.name.slice(0, 80)}"`,
          evidence: [
            {
              meeting_id: newMeetingId,
              quote: newText.slice(0, 160),
              entity_id: newDecision.entity_id,
              source_kind: 'decision_conflict',
            },
            ...candidateMeetingIds.slice(0, 2).map((meetingId) => ({
              meeting_id: meetingId,
              quote: candidate.name.slice(0, 160),
              entity_id: candidate.id,
              source_kind: 'decision_conflict',
            })),
          ],
          related_meeting_ids: [
            newMeetingId,
            ...candidateMeetingIds.slice(0, 2),
          ],
          related_entity_ids: [newDecision.entity_id, candidate.id],
          related_stream_ids: [],
          confidence: 0.84,
          evidence_mode: 'direct',
          freshness: 'fresh',
          source_count: candidateMeetingIds.length + 1,
          cited_meeting_count: candidateMeetingIds.length + 1,
        }),
      );
    }
  }

  return items;
}

/**
 * Run all post-meeting proactive triggers for a newly processed meeting.
 * Called after MID generation completes in the main process pipeline.
 */
export async function runPostMeetingTriggers(
  meetingId: string,
  mid: MidFrontmatter,
): Promise<AttentionItem[]> {
  console.log(
    `[ProactiveEngine] Running post-meeting triggers for: ${meetingId}`,
  );

  const candidates: AttentionItemUpsert[] = [];

  try {
    candidates.push(...detectDuplicateActions(meetingId, mid));
    candidates.push(...detectDecisionConflicts(meetingId, mid));
    candidates.push(...(await detectCrossReferences(meetingId, mid)));
  } catch (err) {
    console.error('[ProactiveEngine] Trigger run failed:', err);
  }

  const persisted = candidates.map((item) => db.upsertAttentionItem(item));

  console.log(
    `[ProactiveEngine] Generated ${persisted.length} attention item(s) for meeting ${meetingId}`,
  );

  return persisted;
}
