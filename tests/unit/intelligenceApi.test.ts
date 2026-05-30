import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AttentionItem } from '../../electron/intelligence/intelligenceTypes';

const invoke = vi.fn();

vi.stubGlobal('window', {
  ipcRenderer: {
    invoke,
  },
});

const makeAttentionItem = (
  overrides: Partial<AttentionItem> = {},
): AttentionItem => ({
  id: 'attention-1',
  dedupe_key: 'follow_up:ship-release',
  kind: 'follow_up',
  severity: 'watch',
  score: 0.62,
  status: 'active',
  title: 'Ship the release notes',
  reason: 'The release notes are still open.',
  source: 'action_tracker',
  score_breakdown: null,
  evidence: [],
  related_entity_ids: ['action-1'],
  related_stream_ids: ['stream-release'],
  related_meeting_ids: ['meeting-1'],
  created_at: '2026-05-30T00:00:00.000Z',
  updated_at: '2026-05-30T00:00:00.000Z',
  last_seen_at: '2026-05-30T00:00:00.000Z',
  resolved_at: null,
  ...overrides,
});

describe('intelligence API', () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it('lists attention items with optional meeting filters', async () => {
    const items = [
      makeAttentionItem(),
      makeAttentionItem({
        id: 'attention-2',
        dedupe_key: 'blocker:legal-signoff',
        kind: 'blocker',
        severity: 'critical',
        title: 'Legal signoff is still blocking launch',
      }),
    ];
    invoke.mockResolvedValue(items);

    const { getAttentionItems } = await import('../../src/api/intelligence');

    await expect(
      getAttentionItems({ meetingId: 'meeting-1', limit: 5 }),
    ).resolves.toEqual(items);
    expect(invoke).toHaveBeenCalledWith('intelligence:alerts', {
      meetingId: 'meeting-1',
      limit: 5,
    });
  });

  it('updates the status of a durable attention item', async () => {
    const updated = makeAttentionItem({
      status: 'snoozed',
      resolved_at: null,
    });
    invoke.mockResolvedValue(updated);

    const { updateAttentionItemStatus } = await import(
      '../../src/api/intelligence'
    );

    await expect(
      updateAttentionItemStatus('attention-1', 'snoozed'),
    ).resolves.toEqual(updated);
    expect(invoke).toHaveBeenCalledWith(
      'intelligence:alerts:update-status',
      'attention-1',
      'snoozed',
    );
  });

  it('keeps the legacy meeting alerts helper compatible', async () => {
    const items = [makeAttentionItem()];
    invoke.mockResolvedValue(items);

    const { getMeetingAlerts } = await import('../../src/api/intelligence');

    await expect(getMeetingAlerts('meeting-1')).resolves.toEqual(items);
    expect(invoke).toHaveBeenCalledWith('intelligence:alerts', {
      meetingId: 'meeting-1',
      status: ['active', 'dismissed'],
    });
  });

  it('clears meeting-scoped attention items', async () => {
    invoke.mockResolvedValue(true);

    const { clearAttentionItemsForMeeting } = await import(
      '../../src/api/intelligence'
    );

    await expect(clearAttentionItemsForMeeting('meeting-1')).resolves.toBe(
      true,
    );
    expect(invoke).toHaveBeenCalledWith(
      'intelligence:alerts:clear',
      'meeting-1',
    );
  });
});
