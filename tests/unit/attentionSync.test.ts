import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbState = vi.hoisted(() => ({
  items: [] as Array<Record<string, unknown>>,
  overdueActions: [] as Array<Record<string, unknown>>,
  staleActions: [] as Array<Record<string, unknown>>,
  meetingsByEntity: new Map<string, Array<{ meeting_id: string }>>(),
}));

vi.mock('../../electron/db', () => ({
  getOverdueActionItems: vi.fn(() => dbState.overdueActions),
  getStaleActionItems: vi.fn(() => dbState.staleActions),
  getMeetingsForEntity: vi.fn(
    (entityId: string) => dbState.meetingsByEntity.get(entityId) ?? [],
  ),
  listAttentionItems: vi.fn(() => [...dbState.items]),
  upsertAttentionItem: vi.fn((item) => {
    const existingIndex = dbState.items.findIndex(
      (entry) => entry.dedupe_key === item.dedupe_key,
    );
    if (existingIndex >= 0) {
      dbState.items[existingIndex] = {
        ...dbState.items[existingIndex],
        ...item,
      };
      return dbState.items[existingIndex];
    }

    const created = {
      id: `attention-${dbState.items.length + 1}`,
      created_at: '2026-05-10T00:00:00.000Z',
      updated_at: '2026-05-10T00:00:00.000Z',
      last_seen_at: '2026-05-10T00:00:00.000Z',
      resolved_at: null,
      ...item,
    };
    dbState.items.push(created);
    return created;
  }),
}));

import type { KnowledgeV2Document } from '../../electron/knowledgeV2';
import {
  syncActionTrackerAttentionQueue,
  syncGlobalKnowledgeAttentionQueue,
} from '../../electron/intelligence/attentionSync';

const makeKnowledgeDoc = (): KnowledgeV2Document => ({
  schema_version: 2,
  scope: {
    type: 'global',
    title: 'Global',
  },
  current_read: {
    headline: 'Global current read',
    supporting_bullets: [],
    freshness: 'fresh',
    source_count: 2,
    cited_item_count: 2,
    cited_meeting_count: 2,
    trust_message: 'Grounded.',
    evidence_quality: {
      mode: 'direct',
      confidence: 0.82,
      cited_meeting_count: 2,
      source_count: 2,
      last_reinforced_at: '2026-05-10T00:00:00.000Z',
      freshness: 'fresh',
    },
  },
  active_streams: [],
  needs_attention: [
    {
      id: 'item-followup',
      title: 'Follow up with launch owner',
      summary: 'Follow up with launch owner.',
      kind: 'follow_up',
      severity: 'watch',
      why_now: 'Unresolved follow-up.',
      stream_ids: ['stream-launch'],
      citations: [{ meeting_id: 'meeting-1', quote: 'Follow up with launch owner' }],
      evidence_quality: {
        mode: 'direct',
        confidence: 0.74,
        cited_meeting_count: 1,
        source_count: 1,
        last_reinforced_at: '2026-05-10T00:00:00.000Z',
        freshness: 'fresh',
      },
    },
  ],
  patterns: [],
  risks_and_unknowns: [
    {
      id: 'item-risk',
      title: 'Launch timeline may slip',
      summary: 'Launch timeline may slip.',
      kind: 'risk',
      severity: 'needs_attention',
      why_now: 'Evidence points to a delivery risk.',
      stream_ids: ['stream-launch'],
      citations: [{ meeting_id: 'meeting-2', quote: 'Timeline still looks risky' }],
      evidence_quality: {
        mode: 'inferred',
        confidence: 0.88,
        cited_meeting_count: 2,
        source_count: 2,
        last_reinforced_at: '2026-05-10T00:00:00.000Z',
        freshness: 'fresh',
      },
    },
    {
      id: 'item-noisy',
      title: 'Maybe revisit the roadmap someday',
      summary: 'Maybe revisit the roadmap someday.',
      kind: 'open_question',
      severity: 'watch',
      why_now: 'Weakly grounded question.',
      stream_ids: ['stream-roadmap'],
      citations: [{ meeting_id: 'meeting-3', quote: 'Maybe revisit later' }],
      evidence_quality: {
        mode: 'inferred',
        confidence: 0.41,
        cited_meeting_count: 1,
        source_count: 1,
        last_reinforced_at: '2026-02-01T00:00:00.000Z',
        freshness: 'stale',
      },
    },
  ],
  evidence_index: [],
  source_quality_summary: {
    included_count: 2,
    excluded_count: 0,
    weak_count: 0,
    records: [],
  },
  change_summary: {
    generated_at: '2026-05-10T00:00:00.000Z',
    added_count: 2,
    removed_count: 0,
    updated_count: 0,
    notable_changes: [],
  },
});

describe('attention sync', () => {
  beforeEach(() => {
    dbState.items = [];
    dbState.overdueActions = [];
    dbState.staleActions = [];
    dbState.meetingsByEntity = new Map();
  });

  it('syncs global knowledge signals into the queue and resolves missing prior items', () => {
    dbState.items.push({
      id: 'attention-existing',
      dedupe_key: 'knowledge_v2:global:old-item',
      kind: 'follow_up',
      severity: 'watch',
      score: 0.52,
      status: 'active',
      title: 'Old item',
      reason: 'Superseded.',
      source: 'knowledge_v2',
      evidence: [],
      related_entity_ids: [],
      related_stream_ids: [],
      related_meeting_ids: [],
      created_at: '2026-05-10T00:00:00.000Z',
      updated_at: '2026-05-10T00:00:00.000Z',
      last_seen_at: '2026-05-10T00:00:00.000Z',
      resolved_at: null,
    });

    syncGlobalKnowledgeAttentionQueue(makeKnowledgeDoc());

    expect(
      dbState.items
        .filter((item) => item.source === 'knowledge_v2' && item.status === 'active')
        .map((item) => item.title),
    ).toEqual([
      'Follow up with launch owner',
      'Launch timeline may slip',
    ]);
    expect(
      dbState.items.find((item) => item.title === 'Old item')?.status,
    ).toBe('resolved');
    expect(
      dbState.items.some(
        (item) => item.title === 'Maybe revisit the roadmap someday',
      ),
    ).toBe(false);
  });

  it('syncs overdue and stale actions without duplicating the same action twice', () => {
    dbState.items.push({
      id: 'attention-action-old',
      dedupe_key: 'action_tracker:stale:action-retired',
      kind: 'stale_context',
      severity: 'watch',
      score: 0.5,
      status: 'active',
      title: 'Retired action',
      reason: 'Was stale.',
      source: 'action_tracker',
      evidence: [],
      related_entity_ids: ['action-retired'],
      related_stream_ids: [],
      related_meeting_ids: [],
      created_at: '2026-05-10T00:00:00.000Z',
      updated_at: '2026-05-10T00:00:00.000Z',
      last_seen_at: '2026-05-10T00:00:00.000Z',
      resolved_at: null,
    });

    dbState.overdueActions = [
      {
        id: 'action-overdue',
        name: 'Send launch brief',
        due_date: '2026-05-09T00:00:00.000Z',
        updated_at: '2026-05-08T00:00:00.000Z',
      },
    ];
    dbState.staleActions = [
      {
        id: 'action-overdue',
        name: 'Send launch brief',
        due_date: '2026-05-09T00:00:00.000Z',
        updated_at: '2026-05-08T00:00:00.000Z',
      },
      {
        id: 'action-stale',
        name: 'Review backlog cleanup',
        due_date: null,
        updated_at: '2026-04-20T00:00:00.000Z',
      },
    ];
    dbState.meetingsByEntity.set('action-overdue', [{ meeting_id: 'meeting-1' }]);
    dbState.meetingsByEntity.set('action-stale', [{ meeting_id: 'meeting-2' }]);

    syncActionTrackerAttentionQueue();

    const activeActionItems = dbState.items.filter(
      (item) => item.source === 'action_tracker' && item.status === 'active',
    );
    expect(activeActionItems.map((item) => item.dedupe_key)).toEqual([
      'action_tracker:overdue:action-overdue',
      'action_tracker:stale:action-stale',
    ]);
    expect(
      dbState.items.find((item) => item.dedupe_key === 'action_tracker:stale:action-retired')
        ?.status,
    ).toBe('resolved');
  });
});
