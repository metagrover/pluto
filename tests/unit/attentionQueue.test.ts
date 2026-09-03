import { beforeEach, describe, expect, it, vi } from 'vitest';

const storeState = vi.hoisted(() => ({
  items: [] as Array<Record<string, unknown>>,
}));

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp',
  },
}));

vi.mock('better-sqlite3', () => {
  class FakeStatement {
    constructor(private sql: string) {}

    run(...args: unknown[]) {
      if (this.sql.includes('INSERT INTO attention_items')) {
        const [
          id,
          dedupe_key,
          kind,
          severity,
          score,
          status,
          title,
          reason,
          source,
          score_breakdown_json,
          evidence_json,
          related_entity_ids_json,
          related_stream_ids_json,
          related_meeting_ids_json,
          created_at,
          updated_at,
          last_seen_at,
          resolved_at,
        ] = args;
        storeState.items.push({
          id,
          dedupe_key,
          kind,
          severity,
          score,
          status,
          title,
          reason,
          source,
          score_breakdown_json,
          evidence_json,
          related_entity_ids_json,
          related_stream_ids_json,
          related_meeting_ids_json,
          created_at,
          updated_at,
          last_seen_at,
          resolved_at,
        });
      }

      if (this.sql.includes('UPDATE attention_items')) {
        const [
          severity,
          score,
          status,
          title,
          reason,
          source,
          score_breakdown_json,
          evidence_json,
          related_entity_ids_json,
          related_stream_ids_json,
          related_meeting_ids_json,
          updated_at,
          last_seen_at,
          resolved_at,
          dedupe_key,
        ] = args;
        const existing = storeState.items.find(
          (item) => item.dedupe_key === dedupe_key,
        );
        if (existing) {
          Object.assign(existing, {
            severity,
            score,
            status,
            title,
            reason,
            source,
            score_breakdown_json,
            evidence_json,
            related_entity_ids_json,
            related_stream_ids_json,
            related_meeting_ids_json,
            updated_at,
            last_seen_at,
            resolved_at,
          });
        }
      }

      if (this.sql.includes('DELETE FROM attention_items WHERE id = ?')) {
        const [id] = args;
        storeState.items = storeState.items.filter((item) => item.id !== id);
      }

      return { changes: 1 };
    }

    get(...args: unknown[]) {
      if (this.sql.includes('PRAGMA table_info')) return undefined;
      if (
        this.sql.includes('SELECT * FROM attention_items WHERE dedupe_key = ?')
      ) {
        const [dedupeKey] = args;
        return (
          storeState.items.find((item) => item.dedupe_key === dedupeKey) ?? null
        );
      }
      return undefined;
    }

    all() {
      if (this.sql.includes('PRAGMA table_info')) return [];
      if (this.sql.includes('SELECT * FROM attention_items')) {
        return [...storeState.items];
      }
      return [];
    }
  }

  class FakeDatabase {
    prepare(sql: string) {
      return new FakeStatement(sql);
    }

    exec() {}

    transaction<T extends (...args: never[]) => unknown>(fn: T): T {
      return fn;
    }
  }

  return {
    default: FakeDatabase,
  };
});

vi.mock('../../electron/database/applicationDatabase', async () => {
  const { default: Database } = await import('better-sqlite3');
  const connection = new Database(':memory:');
  return { getApplicationDatabase: () => connection };
});

import {
  clearAttentionItemsForMeeting,
  listAttentionItems,
  updateAttentionItemStatus,
  upsertAttentionItem,
} from '../../electron/db';

describe('attention queue persistence', () => {
  beforeEach(() => {
    storeState.items = [];
  });

  it('upserts by dedupe key instead of creating duplicates', () => {
    upsertAttentionItem({
      dedupe_key: 'duplicate_action:ship-followup',
      kind: 'duplicate_commitment',
      severity: 'watch',
      score: 0.45,
      status: 'active',
      title: 'Duplicate follow-up',
      reason: 'Two meetings committed to the same ship task.',
      source: 'proactive_engine',
      evidence: [{ meeting_id: 'm1', quote: 'Ship it this week.' }],
      related_entity_ids: ['action-1'],
      related_stream_ids: ['stream-ship'],
      related_meeting_ids: ['m1'],
    });

    upsertAttentionItem({
      dedupe_key: 'duplicate_action:ship-followup',
      kind: 'duplicate_commitment',
      severity: 'critical',
      score: 0.91,
      status: 'active',
      title: 'Duplicate follow-up',
      reason: 'The duplicate commitment still appears unresolved.',
      source: 'proactive_engine',
      evidence: [{ meeting_id: 'm2', quote: 'We are still both tracking it.' }],
      related_entity_ids: ['action-1', 'action-2'],
      related_stream_ids: ['stream-ship'],
      related_meeting_ids: ['m1', 'm2'],
    });

    const items = listAttentionItems();

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      dedupe_key: 'duplicate_action:ship-followup',
      severity: 'critical',
      score: 0.91,
      reason: 'The duplicate commitment still appears unresolved.',
    });
    expect(items[0].related_meeting_ids).toEqual(['m1', 'm2']);
  });

  it('returns active attention items ahead of resolved ones, then by score', () => {
    upsertAttentionItem({
      dedupe_key: 'risk:blocker',
      kind: 'blocker',
      severity: 'critical',
      score: 0.99,
      status: 'resolved',
      title: 'Resolved blocker',
      reason: 'Already handled.',
      source: 'knowledge_v2',
      evidence: [],
      related_entity_ids: [],
      related_stream_ids: [],
      related_meeting_ids: [],
    });

    upsertAttentionItem({
      dedupe_key: 'follow_up:brief',
      kind: 'follow_up',
      severity: 'watch',
      score: 0.4,
      status: 'active',
      title: 'Prepare brief',
      reason: 'Needs action before tomorrow.',
      source: 'dashboard',
      evidence: [],
      related_entity_ids: [],
      related_stream_ids: [],
      related_meeting_ids: [],
    });

    upsertAttentionItem({
      dedupe_key: 'risk:dependency',
      kind: 'dependency',
      severity: 'critical',
      score: 0.8,
      status: 'active',
      title: 'Waiting on dependency',
      reason: 'External blocker remains open.',
      source: 'knowledge_v2',
      evidence: [],
      related_entity_ids: [],
      related_stream_ids: [],
      related_meeting_ids: [],
    });

    const titles = listAttentionItems().map((item) => item.title);

    expect(titles).toEqual([
      'Waiting on dependency',
      'Prepare brief',
      'Resolved blocker',
    ]);
  });

  it('round-trips score breakdown metadata with queue items', () => {
    upsertAttentionItem({
      dedupe_key: 'risk:scored',
      kind: 'risk',
      severity: 'critical',
      score: 0.87,
      status: 'active',
      title: 'Scored risk',
      reason: 'Evidence-backed attention score is persisted.',
      source: 'knowledge_v2',
      score_breakdown: {
        urgency: 0.14,
        recency: 0.08,
        repetition: 0.09,
        commitment: 0,
        blocker: 0.24,
        project_relevance: 0.04,
        evidence: 0.18,
        feedback: 0,
        stale_penalty: 0,
        weak_evidence_penalty: 0,
        total: 0.87,
      },
      evidence: [],
      related_entity_ids: [],
      related_stream_ids: ['stream-risk'],
      related_meeting_ids: ['m1', 'm2'],
    });

    const [item] = listAttentionItems();
    expect(item.score_breakdown).toMatchObject({
      blocker: 0.24,
      evidence: 0.18,
      total: 0.87,
    });
  });

  it('clears items for a deleted meeting without touching unrelated rows', () => {
    upsertAttentionItem({
      dedupe_key: 'meeting:m1',
      kind: 'open_question',
      severity: 'watch',
      score: 0.5,
      status: 'active',
      title: 'Question from m1',
      reason: 'Pending answer.',
      source: 'proactive_engine',
      evidence: [],
      related_entity_ids: [],
      related_stream_ids: [],
      related_meeting_ids: ['m1'],
    });

    upsertAttentionItem({
      dedupe_key: 'meeting:m2',
      kind: 'open_question',
      severity: 'watch',
      score: 0.5,
      status: 'active',
      title: 'Question from m2',
      reason: 'Still open.',
      source: 'proactive_engine',
      evidence: [],
      related_entity_ids: [],
      related_stream_ids: [],
      related_meeting_ids: ['m2'],
    });

    clearAttentionItemsForMeeting('m1');

    expect(listAttentionItems().map((item) => item.title)).toEqual([
      'Question from m2',
    ]);
  });

  it('persists manual lifecycle transitions for existing items', () => {
    const created = upsertAttentionItem({
      dedupe_key: 'follow_up:launch-brief',
      kind: 'follow_up',
      severity: 'watch',
      score: 0.62,
      status: 'active',
      title: 'Send launch brief',
      reason: 'The launch brief still needs a reply.',
      source: 'action_tracker',
      evidence: [{ meeting_id: 'm1', quote: 'Send the launch brief today.' }],
      related_entity_ids: ['action-1'],
      related_stream_ids: [],
      related_meeting_ids: ['m1'],
    });

    const dismissed = updateAttentionItemStatus(created.id, 'dismissed');
    expect(dismissed).toMatchObject({
      id: created.id,
      status: 'dismissed',
    });
    expect(dismissed?.resolved_at).toBeTruthy();

    const reactivated = updateAttentionItemStatus(created.id, 'active');
    expect(reactivated).toMatchObject({
      id: created.id,
      status: 'active',
      resolved_at: null,
    });
  });
});
