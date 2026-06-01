import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbState = vi.hoisted(() => ({
  items: [] as Array<Record<string, unknown>>,
  blockedActions: [] as Array<Record<string, unknown>>,
  overdueActions: [] as Array<Record<string, unknown>>,
  staleActions: [] as Array<Record<string, unknown>>,
  meetingsByEntity: new Map<string, Array<{ meeting_id: string }>>(),
}));

vi.mock('../../electron/db', () => ({
  getBlockedActionItems: vi.fn(() => dbState.blockedActions),
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
      const existing = dbState.items[existingIndex];
      const nextStatus =
        item.preserve_status !== false &&
        item.status === 'active' &&
        (existing.status === 'resolved' ||
          existing.status === 'dismissed' ||
          existing.status === 'snoozed' ||
          existing.status === 'pinned')
          ? existing.status
          : item.status;
      dbState.items[existingIndex] = {
        ...existing,
        ...item,
        status: nextStatus,
        resolved_at:
          nextStatus === 'resolved' ||
          nextStatus === 'dismissed' ||
          nextStatus === 'superseded'
            ? (existing.resolved_at ?? '2026-05-10T00:00:00.000Z')
            : null,
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

import {
  syncActionTrackerAttentionQueue,
  syncGlobalKnowledgeAttentionQueue,
} from '../../electron/intelligence/attentionSync';
import type { KnowledgeV2Document } from '../../electron/knowledgeV2';

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
      citations: [
        { meeting_id: 'meeting-1', quote: 'Follow up with launch owner' },
      ],
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
      citations: [
        { meeting_id: 'meeting-2', quote: 'Timeline still looks risky' },
      ],
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
    dbState.blockedActions = [];
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
        .filter(
          (item) => item.source === 'knowledge_v2' && item.status === 'active',
        )
        .map((item) => item.title),
    ).toEqual(['Follow up with launch owner', 'Launch timeline may slip']);
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
    dbState.meetingsByEntity.set('action-overdue', [
      { meeting_id: 'meeting-1' },
    ]);
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
      dbState.items.find(
        (item) => item.dedupe_key === 'action_tracker:stale:action-retired',
      )?.status,
    ).toBe('resolved');
  });

  it('syncs blocked actions as blocker items and suppresses duplicate routine follow-up alerts', () => {
    dbState.blockedActions = [
      {
        id: 'action-blocked',
        name: 'Ship launch checklist',
        due_date: '2026-05-09T00:00:00.000Z',
        updated_at: '2026-05-08T00:00:00.000Z',
        blocker_entity_id: 'topic-legal-review',
        blocker_name: 'Legal review',
        blocker_meeting_id: 'meeting-9',
        blocker_evidence_quote: 'We cannot ship until legal signs off.',
        blocker_updated_at: '2026-05-10T00:00:00.000Z',
        blocker_relationship_state: 'confirmed',
      },
    ];
    dbState.overdueActions = [
      {
        id: 'action-blocked',
        name: 'Ship launch checklist',
        due_date: '2026-05-09T00:00:00.000Z',
        updated_at: '2026-05-08T00:00:00.000Z',
      },
    ];
    dbState.staleActions = [
      {
        id: 'action-blocked',
        name: 'Ship launch checklist',
        due_date: '2026-05-09T00:00:00.000Z',
        updated_at: '2026-05-08T00:00:00.000Z',
      },
    ];
    dbState.meetingsByEntity.set('action-blocked', [
      { meeting_id: 'meeting-1' },
      { meeting_id: 'meeting-9' },
    ]);

    syncActionTrackerAttentionQueue();

    const blockedItem = dbState.items.find(
      (item) => item.dedupe_key === 'action_tracker:blocked:action-blocked',
    );

    expect(blockedItem).toMatchObject({
      kind: 'blocker',
      status: 'active',
      title: 'Blocked: Ship launch checklist',
      reason: 'Blocked by Legal review.',
      source: 'action_tracker',
      related_entity_ids: ['action-blocked', 'topic-legal-review'],
    });
    expect(blockedItem?.evidence).toContainEqual({
      meeting_id: 'meeting-9',
      quote: 'We cannot ship until legal signs off.',
      entity_id: 'topic-legal-review',
      source_kind: 'blocked_action',
    });
    expect(
      dbState.items.some(
        (item) =>
          item.dedupe_key === 'action_tracker:overdue:action-blocked' ||
          item.dedupe_key === 'action_tracker:stale:action-blocked',
      ),
    ).toBe(false);
  });

  it('preserves manual lifecycle states when the same action signal syncs again', () => {
    dbState.items.push({
      id: 'attention-action-dismissed',
      dedupe_key: 'action_tracker:overdue:action-overdue',
      kind: 'follow_up',
      severity: 'critical',
      score: 0.83,
      status: 'dismissed',
      title: 'Send launch brief',
      reason: 'Previously dismissed by the user.',
      source: 'action_tracker',
      evidence: [],
      related_entity_ids: ['action-overdue'],
      related_stream_ids: [],
      related_meeting_ids: ['meeting-1'],
      created_at: '2026-05-10T00:00:00.000Z',
      updated_at: '2026-05-10T00:00:00.000Z',
      last_seen_at: '2026-05-10T00:00:00.000Z',
      resolved_at: '2026-05-10T00:00:00.000Z',
    });
    dbState.items.push({
      id: 'attention-action-pinned',
      dedupe_key: 'action_tracker:stale:action-stale',
      kind: 'stale_context',
      severity: 'watch',
      score: 0.51,
      status: 'pinned',
      title: 'Review backlog cleanup',
      reason: 'Previously pinned by the user.',
      source: 'action_tracker',
      evidence: [],
      related_entity_ids: ['action-stale'],
      related_stream_ids: [],
      related_meeting_ids: ['meeting-2'],
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
        id: 'action-stale',
        name: 'Review backlog cleanup',
        due_date: null,
        updated_at: '2026-04-20T00:00:00.000Z',
      },
    ];
    dbState.meetingsByEntity.set('action-overdue', [
      { meeting_id: 'meeting-1' },
    ]);
    dbState.meetingsByEntity.set('action-stale', [{ meeting_id: 'meeting-2' }]);

    syncActionTrackerAttentionQueue();

    expect(
      dbState.items.find(
        (item) => item.dedupe_key === 'action_tracker:overdue:action-overdue',
      )?.status,
    ).toBe('dismissed');
    expect(
      dbState.items.find(
        (item) => item.dedupe_key === 'action_tracker:stale:action-stale',
      )?.status,
    ).toBe('pinned');
  });

  it('preserves manual lifecycle state when the same blocked action syncs again', () => {
    dbState.items.push({
      id: 'attention-action-blocked-dismissed',
      dedupe_key: 'action_tracker:blocked:action-blocked',
      kind: 'blocker',
      severity: 'critical',
      score: 0.81,
      status: 'dismissed',
      title: 'Blocked: Ship launch checklist',
      reason: 'Blocked by Legal review.',
      source: 'action_tracker',
      evidence: [],
      related_entity_ids: ['action-blocked', 'topic-legal-review'],
      related_stream_ids: [],
      related_meeting_ids: ['meeting-9'],
      created_at: '2026-05-10T00:00:00.000Z',
      updated_at: '2026-05-10T00:00:00.000Z',
      last_seen_at: '2026-05-10T00:00:00.000Z',
      resolved_at: '2026-05-10T00:00:00.000Z',
    });

    dbState.blockedActions = [
      {
        id: 'action-blocked',
        name: 'Ship launch checklist',
        due_date: null,
        updated_at: '2026-05-08T00:00:00.000Z',
        blocker_entity_id: 'topic-legal-review',
        blocker_name: 'Legal review',
        blocker_meeting_id: 'meeting-9',
        blocker_evidence_quote: 'We cannot ship until legal signs off.',
        blocker_updated_at: '2026-05-10T00:00:00.000Z',
        blocker_relationship_state: 'confirmed',
      },
    ];
    dbState.meetingsByEntity.set('action-blocked', [
      { meeting_id: 'meeting-9' },
    ]);

    syncActionTrackerAttentionQueue();

    expect(
      dbState.items.find(
        (item) => item.dedupe_key === 'action_tracker:blocked:action-blocked',
      )?.status,
    ).toBe('dismissed');
  });
});
