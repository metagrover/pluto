import fs from 'node:fs';
import { afterAll, describe, expect, it, vi } from 'vitest';

const testDatabase = vi.hoisted(() => ({
  directory: `/tmp/pluto-meeting-action-sync-db-${process.pid}-${Math.random()
    .toString(16)
    .slice(2)}`,
}));

vi.mock('electron', () => ({
  app: {
    getPath: () => testDatabase.directory,
  },
}));

import {
  syncAllMeetingActionEntitiesFromUserEdits,
  syncMeetingActionEntitiesFromUserEdits,
} from '../../electron/database/meetingActionSync';
import {
  db,
  ensureMeetingEntity,
  getEntity,
  getMeeting,
  saveMeeting,
  updateActionCommitmentState,
  updateEntityStatus,
  upsertEntity,
} from '../../electron/db';
import { parseActionMetadata } from '../../src/utils/actionCommitment';
import { applyMeetingNotesUserEdit } from '../../src/utils/meetingNotesEditRebase';

afterAll(() => {
  fs.rmSync(testDatabase.directory, { recursive: true, force: true });
});

describe('meeting action entity and user edit synchronization', () => {
  it('synchronizes text edits (typos, product names) from user_edits_json to action entities', () => {
    const meetingId = 'meeting-typo-sync-1';
    const originalText =
      'Chase Diana to get time and feedback on how they are using the PsyQ product';
    const editedText =
      'Chase Deanna to get time and feedback on how they are using the HoldingsIQ product';

    saveMeeting({
      id: meetingId,
      title: '1-1: Anu',
      analysis_json: JSON.stringify({
        all_action_items: [
          {
            text: originalText,
            assignee: null,
            due: null,
          },
        ],
      }),
      user_edits_json: JSON.stringify({
        'all_action_items:0': {
          original: originalText,
          edited: editedText,
          edited_at: '2026-09-16T12:00:00.000Z',
        },
      }),
    });

    const actionEntity = upsertEntity({
      id: 'action-extraction-test-1',
      type: 'action_item',
      name: originalText,
      status: 'active',
      dedupe_by_name: false,
      metadata: {
        full_description: originalText,
        original_description: originalText,
        source_meeting_id: meetingId,
        source_path: 'all_action_items:0',
        source_index: 0,
        commitment_state: 'possible',
        origin: 'extraction',
      },
    });

    ensureMeetingEntity({
      meeting_id: meetingId,
      entity_id: actionEntity.id,
      context: originalText,
    });

    // Run synchronization
    const result = syncMeetingActionEntitiesFromUserEdits(db, meetingId);
    expect(result.actionsUpdated).toBe(1);

    // Verify entity was updated
    const updated = getEntity(actionEntity.id);
    expect(updated).toBeDefined();
    expect(updated?.name).toBe(editedText);

    const meta = parseActionMetadata(updated?.metadata ?? null);
    expect(meta.full_description).toBe(editedText);
    expect(meta.original_description).toBe(originalText);
    expect(meta.user_edited).toBe(true);
    expect(meta.user_edited_at).toBe('2026-09-16T12:00:00.000Z');
    expect(meta.commitment_state).toBe('possible');

    // Verify meeting_entities context was updated
    const link = db
      .prepare(
        'SELECT context FROM meeting_entities WHERE meeting_id = ? AND entity_id = ?',
      )
      .get(meetingId, actionEntity.id) as { context: string } | undefined;
    expect(link?.context).toBe(editedText);

    // Verify FTS search finds the entity by the corrected product name
    const fts = db
      .prepare('SELECT entity_id FROM entities_fts WHERE entities_fts MATCH ?')
      .all('HoldingsIQ') as Array<{ entity_id: string }>;
    expect(fts.some((row) => row.entity_id === actionEntity.id)).toBe(true);
  });

  it('synchronizes completion status toggles from user_edits_json', () => {
    const meetingId = 'meeting-completion-sync-2';
    const actionText = 'Submit budget report to finance';

    saveMeeting({
      id: meetingId,
      title: 'Finance Review',
      analysis_json: JSON.stringify({
        all_action_items: [{ text: actionText }],
      }),
      user_edits_json: JSON.stringify({
        'completion:all_action_items:0': {
          original: 'false',
          edited: 'true',
          edited_at: '2026-09-16T12:30:00.000Z',
        },
      }),
    });

    const actionEntity = upsertEntity({
      id: 'action-extraction-test-2',
      type: 'action_item',
      name: actionText,
      status: 'active',
      dedupe_by_name: false,
      metadata: {
        full_description: actionText,
        source_meeting_id: meetingId,
        source_path: 'all_action_items:0',
        commitment_state: 'possible',
        origin: 'extraction',
      },
    });

    syncMeetingActionEntitiesFromUserEdits(db, meetingId);

    const completedEntity = getEntity(actionEntity.id);
    expect(completedEntity?.status).toBe('completed');

    // Now uncheck completion
    saveMeeting({
      id: meetingId,
      title: 'Finance Review',
      analysis_json: JSON.stringify({
        all_action_items: [{ text: actionText }],
      }),
      user_edits_json: JSON.stringify({
        'completion:all_action_items:0': {
          original: 'false',
          edited: 'false',
          edited_at: '2026-09-16T12:35:00.000Z',
        },
      }),
    });

    syncMeetingActionEntitiesFromUserEdits(db, meetingId);

    const activeEntity = getEntity(actionEntity.id);
    expect(activeEntity?.status).toBe('active');
  });

  it('reverts entity to original description when user edit is deleted', () => {
    const meetingId = 'meeting-revert-sync-3';
    const originalText = 'Schedule demo with prospective client';
    const editedText = 'Schedule demo with Acronis team';

    saveMeeting({
      id: meetingId,
      title: 'Demo Call',
      analysis_json: JSON.stringify({
        all_action_items: [{ text: originalText }],
      }),
      user_edits_json: JSON.stringify({
        'all_action_items:0': {
          original: originalText,
          edited: editedText,
        },
      }),
    });

    const actionEntity = upsertEntity({
      id: 'action-extraction-test-3',
      type: 'action_item',
      name: editedText,
      status: 'active',
      dedupe_by_name: false,
      metadata: {
        full_description: editedText,
        original_description: originalText,
        source_meeting_id: meetingId,
        source_path: 'all_action_items:0',
        source_index: 0,
        user_edited: true,
      },
    });

    // Revert user edit by clearing user_edits_json
    saveMeeting({
      id: meetingId,
      title: 'Demo Call',
      analysis_json: JSON.stringify({
        all_action_items: [{ text: originalText }],
      }),
      user_edits_json: JSON.stringify({}),
    });

    syncMeetingActionEntitiesFromUserEdits(db, meetingId);

    const reverted = getEntity(actionEntity.id);
    expect(reverted?.name).toBe(originalText);
    const meta = parseActionMetadata(reverted?.metadata ?? null);
    expect(meta.full_description).toBe(originalText);
    expect(meta.user_edited).toBeUndefined();
  });

  it('synchronizes native continuations (+ Add item) as confirmed user commitments', () => {
    const meetingId = 'meeting-continuation-sync-4';
    const continuationId = 'continuation-item-123';
    const continuationText = 'Follow up with design on mobile layout';

    saveMeeting({
      id: meetingId,
      title: 'Design Call',
      analysis_json: JSON.stringify({
        all_action_items: [],
      }),
      user_edits_json: JSON.stringify({
        'continuation:all_action_items:0': {
          original: '[]',
          edited: JSON.stringify([
            {
              id: continuationId,
              text: continuationText,
              completed: false,
            },
          ]),
        },
      }),
    });

    const result = syncMeetingActionEntitiesFromUserEdits(db, meetingId);
    expect(result.continuationsCreated).toBe(1);

    const continuationEntityId = `action-continuation-${meetingId}-${continuationId}`;
    const entity = getEntity(continuationEntityId);
    expect(entity).toBeDefined();
    expect(entity?.name).toBe(continuationText);
    expect(entity?.status).toBe('active');

    const meta = parseActionMetadata(entity?.metadata ?? null);
    expect(meta.origin).toBe('user');
    expect(meta.commitment_state).toBe('confirmed');
    expect(meta.continuation_id).toBe(continuationId);

    // Delete continuation from user edits
    saveMeeting({
      id: meetingId,
      title: 'Design Call',
      user_edits_json: JSON.stringify({
        'continuation:all_action_items:0': {
          original: '[]',
          edited: JSON.stringify([]),
        },
      }),
    });

    const deleteResult = syncMeetingActionEntitiesFromUserEdits(db, meetingId);
    expect(deleteResult.continuationsRemoved).toBe(1);
    expect(getEntity(continuationEntityId)).toBeUndefined();
  });

  it('preserves existing confirmed and rejected commitment review states when editing text', () => {
    const meetingId = 'meeting-review-preserve-5';
    const originalText = 'Set up staging environment';
    const editedText = 'Set up staging environment with HTTPS';

    saveMeeting({
      id: meetingId,
      title: 'Staging Setup',
      analysis_json: JSON.stringify({
        all_action_items: [{ text: originalText }],
      }),
      user_edits_json: JSON.stringify({
        'all_action_items:0': {
          original: originalText,
          edited: editedText,
        },
      }),
    });

    const actionEntity = upsertEntity({
      id: 'action-extraction-test-5',
      type: 'action_item',
      name: originalText,
      status: 'active',
      dedupe_by_name: false,
      metadata: {
        full_description: originalText,
        original_description: originalText,
        source_meeting_id: meetingId,
        source_path: 'all_action_items:0',
        source_index: 0,
        commitment_state: 'possible',
        origin: 'extraction',
      },
    });

    // User confirmed the commitment
    updateActionCommitmentState(
      actionEntity.id,
      'confirmed',
      '2026-09-16T12:00:00.000Z',
    );

    // Now sync the user text edit
    syncMeetingActionEntitiesFromUserEdits(db, meetingId);

    const updated = getEntity(actionEntity.id);
    expect(updated?.name).toBe(editedText);
    const meta = parseActionMetadata(updated?.metadata ?? null);
    expect(meta.commitment_state).toBe('confirmed');
    expect(meta.reviewed_at).toBe('2026-09-16T12:00:00.000Z');
  });

  it('bulk synchronizes multiple meetings with user edits on startup recovery', () => {
    const meetingA = 'meeting-recovery-bulk-a';
    const meetingB = 'meeting-recovery-bulk-b';

    saveMeeting({
      id: meetingA,
      title: 'Meeting A',
      analysis_json: JSON.stringify({
        all_action_items: [{ text: 'Old task A' }],
      }),
      user_edits_json: JSON.stringify({
        'all_action_items:0': {
          original: 'Old task A',
          edited: 'Updated task A',
        },
      }),
    });

    saveMeeting({
      id: meetingB,
      title: 'Meeting B',
      analysis_json: JSON.stringify({
        all_action_items: [{ text: 'Old task B' }],
      }),
      user_edits_json: JSON.stringify({
        'all_action_items:0': {
          original: 'Old task B',
          edited: 'Updated task B',
        },
      }),
    });

    const entityA = upsertEntity({
      id: 'action-recovery-a',
      type: 'action_item',
      name: 'Old task A',
      status: 'active',
      dedupe_by_name: false,
      metadata: {
        full_description: 'Old task A',
        source_meeting_id: meetingA,
        source_path: 'all_action_items:0',
      },
    });

    const entityB = upsertEntity({
      id: 'action-recovery-b',
      type: 'action_item',
      name: 'Old task B',
      status: 'active',
      dedupe_by_name: false,
      metadata: {
        full_description: 'Old task B',
        source_meeting_id: meetingB,
        source_path: 'all_action_items:0',
      },
    });

    const result = syncAllMeetingActionEntitiesFromUserEdits(db);
    expect(result.meetingsProcessed).toBeGreaterThanOrEqual(2);
    expect(result.totalActionsUpdated).toBeGreaterThanOrEqual(2);

    expect(getEntity(entityA.id)?.name).toBe('Updated task A');
    expect(getEntity(entityB.id)?.name).toBe('Updated task B');
  });
});

it('round trips a peer completion between the entity and both meeting-note formats', () => {
  const meetingId = 'meeting-peer-completion';
  saveMeeting({
    id: meetingId,
    title: 'Launch handoff',
    analysis_json: JSON.stringify({
      all_action_items: [{ text: 'Send launch checklist', assignee: 'Avery' }],
    }),
    user_edits_json: JSON.stringify({
      unrelated: { original: 'old', edited: 'kept', edited_at: '2026-09-30' },
    }),
  });
  upsertEntity({
    id: 'action-peer-completion',
    type: 'action_item',
    name: 'Send launch checklist',
    status: 'active',
    metadata: {
      origin: 'extraction',
      commitment_state: 'confirmed',
      source_meeting_id: meetingId,
      source_path: 'all_action_items:0',
      source_index: 0,
      assignee_name: 'Avery',
    },
  });
  updateEntityStatus('action-peer-completion', 'completed');
  const meeting = getMeeting(meetingId)!;
  const edits = JSON.parse(meeting.user_edits_json!);
  expect(edits['completion:all_action_items:0'].edited).toBe('true');
  expect(edits['completion:v2:action:0'].edited).toBe('true');
  expect(edits.unrelated.edited).toBe('kept');
  expect(getEntity('action-peer-completion')?.status).toBe('completed');
  const reopened = applyMeetingNotesUserEdit(
    edits,
    'completion:v2:action:0',
    'false',
    'false',
    '2026-09-30',
  );
  saveMeeting({ ...meeting, user_edits_json: JSON.stringify(reopened.edits) });
  syncMeetingActionEntitiesFromUserEdits(db, meetingId);
  expect(getEntity('action-peer-completion')?.status).toBe('active');
  expect(
    parseActionMetadata(getEntity('action-peer-completion')!.metadata)
      .commitment_state,
  ).toBe('confirmed');
  updateEntityStatus('action-peer-completion', 'completed');
  updateEntityStatus('action-peer-completion', 'active');
  syncMeetingActionEntitiesFromUserEdits(db, meetingId);
  expect(getEntity('action-peer-completion')?.status).toBe('active');
});

it('round trips native continuation completion without losing sibling notes', () => {
  const meetingId = 'meeting-continuation-roundtrip';
  const path = 'continuation:all_action_items';
  saveMeeting({
    id: meetingId,
    title: 'Checklist review',
    user_edits_json: JSON.stringify({
      [path]: {
        original: '',
        edited: JSON.stringify([
          { id: 'first', text: 'Send checklist' },
          { id: 'second', text: 'Review launch', completed: false },
        ]),
        edited_at: '2026-09-30',
      },
    }),
  });
  syncMeetingActionEntitiesFromUserEdits(db, meetingId);
  const id = `action-continuation-${meetingId}-first`;
  updateEntityStatus(id, 'completed');
  const items = JSON.parse(
    JSON.parse(getMeeting(meetingId)!.user_edits_json!)[path].edited,
  );
  expect(items[0].completed).toBe(true);
  expect(items[1]).toEqual({
    id: 'second',
    text: 'Review launch',
    completed: false,
  });
  syncMeetingActionEntitiesFromUserEdits(db, meetingId);
  expect(getEntity(id)?.status).toBe('completed');
  updateEntityStatus(id, 'active');
  expect(
    JSON.parse(
      JSON.parse(getMeeting(meetingId)!.user_edits_json!)[path].edited,
    )[0].completed,
  ).toBe(false);
});

it('rolls back completion if source edits cannot be safely read', () => {
  const meetingId = 'meeting-corrupt-completion';
  saveMeeting({
    id: meetingId,
    title: 'Checklist review',
    user_edits_json: '{broken',
  });
  upsertEntity({
    id: 'action-corrupt-completion',
    type: 'action_item',
    name: 'Send checklist',
    status: 'active',
    metadata: {
      source_meeting_id: meetingId,
      source_path: 'all_action_items:0',
    },
  });
  expect(() =>
    updateEntityStatus('action-corrupt-completion', 'completed'),
  ).toThrow();
  expect(getEntity('action-corrupt-completion')?.status).toBe('active');
  expect(getMeeting(meetingId)?.user_edits_json).toBe('{broken');
});
