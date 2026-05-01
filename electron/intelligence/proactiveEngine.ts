/**
 * Proactive Intelligence Engine (Phase 4)
 *
 * Post-meeting triggers that surface cross-meeting intelligence automatically.
 * Runs after MID generation and emits IntelligenceAlert objects stored in SQLite.
 *
 * Scope: Post-meeting triggers only (MVP). Three trigger types:
 *   1. cross_reference    — same entities/topics appear in a previous meeting
 *   2. duplicate_action   — new action items overlap existing open items (fuzzy match)
 *   3. decision_conflict  — new decisions conflict with prior decisions on same topic
 */

import { randomUUID } from 'node:crypto';
import * as db from '../db';
import { findSimilarEntity } from '../entityPipeline';
import type { IntelligenceAlert, MidFrontmatter } from './intelligenceTypes';
import { retrieveContext } from './queryEngine';

// =============================================
// In-memory alert store (persisted per session)
// Production: replace with SQLite table.
// =============================================

const alertStore: IntelligenceAlert[] = [];

/**
 * Retrieve stored alerts, newest first. Pass `meetingId` to scope to one meeting.
 */
export function getAlerts(options?: {
  meetingId?: string;
  limit?: number;
}): IntelligenceAlert[] {
  let results = [...alertStore];

  const meetingId = options?.meetingId;
  if (meetingId) {
    results = results.filter((a) => a.related_meeting_ids.includes(meetingId));
  }

  results.sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );

  return results.slice(0, options?.limit ?? 50);
}

/**
 * Clear alerts for a meeting (called when meeting is deleted).
 */
export function clearAlertsForMeeting(meetingId: string): void {
  const before = alertStore.length;
  for (let i = alertStore.length - 1; i >= 0; i--) {
    if (alertStore[i].related_meeting_ids.includes(meetingId)) {
      alertStore.splice(i, 1);
    }
  }
  console.log(
    `[ProactiveEngine] Cleared ${before - alertStore.length} alerts for meeting ${meetingId}`,
  );
}

// =============================================
// Helpers
// =============================================

function makeAlert(
  partial: Omit<IntelligenceAlert, 'id' | 'created_at'>,
): IntelligenceAlert {
  return {
    ...partial,
    id: randomUUID(),
    created_at: new Date().toISOString(),
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
  for (const t of setA) {
    if (setB.has(t)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return intersection / union;
}

// =============================================
// Trigger 1: Cross-reference detection
// =============================================

/**
 * Finds previous meetings that share entities/topics with the new meeting.
 * Uses the query engine's retrieveContext to leverage FTS + graph walk.
 */
async function detectCrossReferences(
  newMeetingId: string,
  mid: MidFrontmatter,
): Promise<IntelligenceAlert[]> {
  const alerts: IntelligenceAlert[] = [];

  // Build a query string from the new meeting's key topics and participants
  const queryParts: string[] = [
    ...mid.topics.map((t) => t.name),
    ...mid.participants.map((p) => p.name),
    ...mid.projects.map((p) => p.name),
  ].slice(0, 8); // cap at 8 terms

  if (queryParts.length === 0) return alerts;

  try {
    const context = await retrieveContext({
      keywords: queryParts,
      expanded_keywords: [],
      entity_mentions: mid.participants.map((p) => p.entity_id),
      temporal_range: null,
      intent: 'factual',
    });

    // Filter out the meeting we just processed
    const relatedMeetings = context.filter(
      (r) => r.meeting_id !== newMeetingId && r.score > 0.15,
    );

    if (relatedMeetings.length === 0) return alerts;

    const relatedIds = relatedMeetings.map((r) => r.meeting_id);
    const topicNames = mid.topics
      .map((t) => t.name)
      .slice(0, 3)
      .join(', ');

    alerts.push(
      makeAlert({
        type: 'cross_reference',
        severity: 'info',
        title: `Cross-reference: ${mid.title}`,
        detail: `This meeting shares themes (${topicNames}) with ${relatedMeetings.length} previous meeting(s). Consider reviewing for continuity.`,
        related_meeting_ids: [newMeetingId, ...relatedIds.slice(0, 3)],
        related_entity_ids: [
          ...mid.topics.map((t) => t.entity_id),
          ...mid.participants.map((p) => p.entity_id),
        ].slice(0, 6),
      }),
    );
  } catch (err) {
    console.warn('[ProactiveEngine] Cross-reference detection failed:', err);
  }

  return alerts;
}

// =============================================
// Trigger 2: Duplicate action item detection
// =============================================

/**
 * Flags new action items that overlap with open items from previous meetings.
 * Uses Jaccard similarity (threshold 0.45) + findSimilarEntity fallback.
 */
function detectDuplicateActions(
  newMeetingId: string,
  mid: MidFrontmatter,
): IntelligenceAlert[] {
  const alerts: IntelligenceAlert[] = [];

  const newActiveItems = mid.action_items.filter((a) => a.status === 'active');
  if (newActiveItems.length === 0) return alerts;

  // Fetch existing action_item entities from the knowledge graph (confirmed only)
  const existingActionEntities = db
    .getAllEntities()
    .filter((e) => e.type === 'action_item' && e.status === 'active');

  if (existingActionEntities.length === 0) return alerts;

  for (const newItem of newActiveItems) {
    const newText = newItem.description;

    // 1. Fuzzy text similarity check
    const fuzzyMatch = existingActionEntities.find(
      (existing) => jaccardSimilarity(newText, existing.name) >= 0.45,
    );

    // 2. Entity name similarity via findSimilarEntity
    const entityMatch =
      !fuzzyMatch &&
      findSimilarEntity('action_item', newText, existingActionEntities, 0.75);

    const duplicate = fuzzyMatch || entityMatch;
    if (!duplicate) continue;

    // Find which meeting the duplicate belongs to
    const duplicateMeetings = db.getMeetingsForEntity(duplicate.id);
    const duplicateMeetingIds = duplicateMeetings
      .map((m) => m.meeting_id)
      .filter((id) => id !== newMeetingId);

    if (duplicateMeetingIds.length === 0) continue;

    alerts.push(
      makeAlert({
        type: 'duplicate_action',
        severity: 'warning',
        title: 'Duplicate action item detected',
        detail: `"${newText.slice(0, 80)}" appears to overlap with an existing open action item: "${duplicate.name.slice(0, 80)}"`,
        related_meeting_ids: [newMeetingId, ...duplicateMeetingIds.slice(0, 2)],
        related_entity_ids: [newItem.entity_id, duplicate.id],
      }),
    );
  }

  return alerts;
}

// =============================================
// Trigger 3: Decision conflict detection
// =============================================

/**
 * Flags new decisions that potentially conflict with prior decisions on the same topic.
 * Uses Jaccard similarity (threshold 0.4) for topic overlap detection.
 */
function detectDecisionConflicts(
  newMeetingId: string,
  mid: MidFrontmatter,
): IntelligenceAlert[] {
  const alerts: IntelligenceAlert[] = [];

  if (mid.decisions.length === 0) return alerts;

  // Fetch all decision entities from the knowledge graph
  const existingDecisionEntities = db
    .getAllEntities()
    .filter((e) => e.type === 'decision' && e.status === 'active');

  if (existingDecisionEntities.length === 0) return alerts;

  for (const newDecision of mid.decisions) {
    const newText = newDecision.description;

    // Detect potential conflicts: high similarity suggests same topic, possibly contradicting
    const conflictCandidates = existingDecisionEntities.filter((existing) => {
      const similarity = jaccardSimilarity(newText, existing.name);
      // High overlap (same topic) but not identical (different decision)
      return similarity >= 0.4 && similarity < 0.85;
    });

    for (const candidate of conflictCandidates) {
      const candidateMeetings = db.getMeetingsForEntity(candidate.id);
      const candidateMeetingIds = candidateMeetings
        .map((m) => m.meeting_id)
        .filter((id) => id !== newMeetingId);

      if (candidateMeetingIds.length === 0) continue;

      alerts.push(
        makeAlert({
          type: 'decision_conflict',
          severity: 'warning',
          title: 'Potential decision conflict',
          detail: `New decision: "${newText.slice(0, 80)}" may conflict with a prior decision: "${candidate.name.slice(0, 80)}"`,
          related_meeting_ids: [
            newMeetingId,
            ...candidateMeetingIds.slice(0, 2),
          ],
          related_entity_ids: [newDecision.entity_id, candidate.id],
        }),
      );
    }
  }

  return alerts;
}

// =============================================
// Main entry point
// =============================================

/**
 * Run all post-meeting proactive triggers for a newly processed meeting.
 * Called after MID generation completes in the main process pipeline.
 *
 * @param meetingId - The ID of the newly processed meeting
 * @param mid       - The generated MidFrontmatter for that meeting
 * @returns Array of generated IntelligenceAlerts (also stored in alertStore)
 */
export async function runPostMeetingTriggers(
  meetingId: string,
  mid: MidFrontmatter,
): Promise<IntelligenceAlert[]> {
  console.log(
    `[ProactiveEngine] Running post-meeting triggers for: ${meetingId}`,
  );

  const allAlerts: IntelligenceAlert[] = [];

  try {
    // Run sync triggers first (no async overhead)
    const duplicateAlerts = detectDuplicateActions(meetingId, mid);
    const conflictAlerts = detectDecisionConflicts(meetingId, mid);

    allAlerts.push(...duplicateAlerts, ...conflictAlerts);

    // Run async cross-reference trigger
    const crossRefAlerts = await detectCrossReferences(meetingId, mid);
    allAlerts.push(...crossRefAlerts);
  } catch (err) {
    console.error('[ProactiveEngine] Trigger run failed:', err);
  }

  // Store in memory
  alertStore.push(...allAlerts);

  console.log(
    `[ProactiveEngine] Generated ${allAlerts.length} alert(s) for meeting ${meetingId}`,
  );

  return allAlerts;
}
