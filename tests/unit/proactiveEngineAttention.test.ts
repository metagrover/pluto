import { beforeEach, describe, expect, it, vi } from 'vitest';

const attentionItems: Array<Record<string, unknown>> = [];

vi.mock('../../electron/db', () => ({
  getAllEntities: vi.fn(() => [
    {
      id: 'action-existing',
      type: 'action_item',
      name: 'Ship launch checklist',
      status: 'active',
    },
  ]),
  getMeetingsForEntity: vi.fn(() => [{ meeting_id: 'meeting-prev' }]),
  upsertAttentionItem: vi.fn((item) => {
    const existingIndex = attentionItems.findIndex(
      (entry) => entry.dedupe_key === item.dedupe_key,
    );
    if (existingIndex >= 0) {
      attentionItems[existingIndex] = {
        ...attentionItems[existingIndex],
        ...item,
      };
      return attentionItems[existingIndex];
    }
    const created = { id: `attention-${attentionItems.length + 1}`, ...item };
    attentionItems.push(created);
    return created;
  }),
  listAttentionItems: vi.fn(() => [...attentionItems]),
  clearAttentionItemsForMeeting: vi.fn((meetingId: string) => {
    for (let index = attentionItems.length - 1; index >= 0; index -= 1) {
      const relatedMeetingIds = attentionItems[index].related_meeting_ids as
        | string[]
        | undefined;
      if (relatedMeetingIds?.includes(meetingId)) {
        attentionItems.splice(index, 1);
      }
    }
  }),
}));

vi.mock('../../electron/intelligence/queryEngine', () => ({
  retrieveContext: vi.fn(async () => []),
}));

vi.mock('../../electron/entityPipeline', () => ({
  findSimilarEntity: vi.fn(() => null),
}));

import type { MidFrontmatter } from '../../electron/intelligence/intelligenceTypes';
import {
  clearAlertsForMeeting,
  getAlerts,
  runPostMeetingTriggers,
} from '../../electron/intelligence/proactiveEngine';

const makeMid = (): MidFrontmatter => ({
  mid_version: 1,
  meeting_id: 'meeting-new',
  title: 'Launch review',
  occurred_at: '2026-05-10T18:00:00.000Z',
  duration_seconds: 1800,
  participants: [],
  projects: [],
  topics: [],
  action_items: [
    {
      entity_id: 'action-new',
      description: 'Ship launch checklist',
      status: 'active',
    },
  ],
  decisions: [],
  signals: {
    continuity: [],
    accountability_risks: [],
    decision_impacts: [],
  },
  evidence_spans: [],
});

describe('proactiveEngine attention queue', () => {
  beforeEach(() => {
    attentionItems.length = 0;
  });

  it('persists duplicate action alerts into the durable attention queue idempotently', async () => {
    await runPostMeetingTriggers('meeting-new', makeMid());
    await runPostMeetingTriggers('meeting-new', makeMid());

    const items = getAlerts();

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: 'duplicate_commitment',
      status: 'active',
      related_meeting_ids: ['meeting-new', 'meeting-prev'],
    });
  });

  it('clears persisted items for a meeting through the existing API', async () => {
    await runPostMeetingTriggers('meeting-new', makeMid());

    clearAlertsForMeeting('meeting-new');

    expect(getAlerts()).toEqual([]);
  });
});
