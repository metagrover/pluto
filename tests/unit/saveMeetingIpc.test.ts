import { describe, expect, it, vi } from 'vitest';

import { saveMeetingWithParticipantSideEffects } from '../../electron/saveMeetingIpc';

describe('SAVE_MEETING participant side effects', () => {
  it('upserts and links participants from the initial participant-bearing save', () => {
    const order: string[] = [];
    const saveMeeting = vi.fn(() => {
      order.push('save');
      return 'saved' as const;
    });
    const upsertEntity = vi.fn(
      (input: { type: string; name: string; status: string }) => {
        order.push(`upsert:${input.name}`);
        return { id: `entity-${input.name}` };
      },
    );
    const addMeetingEntity = vi.fn(
      (input: {
        meeting_id: string;
        entity_id: string;
        mention_count: number;
        context: string;
      }) => {
        order.push(`link:${input.entity_id}`);
      },
    );

    const result = saveMeetingWithParticipantSideEffects({
      meeting: {
        id: 'meeting-validated',
        transcript_status: 'validated',
        enhanced_notes: null,
        participants: [' Ada ', 'Grace'],
      },
      saveMeeting,
      upsertEntity,
      addMeetingEntity,
    });

    expect(result).toBe('saved');
    expect(saveMeeting).toHaveBeenCalledOnce();
    expect(upsertEntity).toHaveBeenNthCalledWith(1, {
      type: 'person',
      name: 'Ada',
      status: 'active',
    });
    expect(upsertEntity).toHaveBeenNthCalledWith(2, {
      type: 'person',
      name: 'Grace',
      status: 'active',
    });
    expect(addMeetingEntity).toHaveBeenNthCalledWith(1, {
      meeting_id: 'meeting-validated',
      entity_id: 'entity-Ada',
      mention_count: 1,
      context: 'Manual participant',
    });
    expect(addMeetingEntity).toHaveBeenNthCalledWith(2, {
      meeting_id: 'meeting-validated',
      entity_id: 'entity-Grace',
      mention_count: 1,
      context: 'Manual participant',
    });
    expect(order).toEqual([
      'save',
      'upsert:Ada',
      'link:entity-Ada',
      'upsert:Grace',
      'link:entity-Grace',
    ]);
  });
});
