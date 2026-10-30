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
import {
  isPersonalAction,
  parseActionMetadata,
} from '../../src/utils/actionCommitment';
import { applyMeetingNotesUserEdit } from '../../src/utils/meetingNotesEditRebase';

afterAll(() => {
  fs.rmSync(testDatabase.directory, { recursive: true, force: true });
});

describe('meeting action entity and user edit synchronization', () => {
  it.each(['entity', 'notes', 'reordered', 'shared-owner', 'ambiguous'])(
    'preserves task identity for %s completion with identical task text',
    (direction) => {
      const meetingId = `duplicate-task-${direction}`;
      const actions = [
        {
          text: 'Send the checklist',
          assignee: 'Avery',
          evidence: 'Avery will send the checklist to Design.',
        },
        {
          text: 'Send the checklist',
          assignee: direction === 'shared-owner' ? 'Avery' : 'Blake',
          evidence: `${direction === 'shared-owner' ? 'Avery' : 'Blake'} will send the checklist to Finance.`,
        },
      ];
      saveMeeting({
        id: meetingId,
        title: 'Checklist review',
        analysis_json: JSON.stringify({ all_action_items: actions }),
      });
      const entities = actions.map((action, index) =>
        upsertEntity({
          id: `${meetingId}-${index}`,
          type: 'action_item',
          name: action.text,
          status: 'active',
          dedupe_by_name: false,
          metadata: {
            origin: 'extraction',
            commitment_state: 'confirmed',
            source_meeting_id: meetingId,
            source_path: `all_action_items:${index}`,
            source_index: index,
            original_description: action.text,
            source_evidence:
              direction === 'ambiguous' ? undefined : action.evidence,
            assignee_name:
              direction === 'ambiguous' ? undefined : action.assignee,
          },
        }),
      );
      const index = direction === 'reordered' ? 0 : 1;
      if (direction === 'reordered')
        db.prepare('UPDATE meetings SET analysis_json = ? WHERE id = ?').run(
          JSON.stringify({ all_action_items: [...actions].reverse() }),
          meetingId,
        );
      if (direction === 'notes') {
        db.prepare('UPDATE meetings SET user_edits_json = ? WHERE id = ?').run(
          JSON.stringify({
            [`completion:all_action_items:${index}`]: {
              original: 'false',
              edited: 'true',
            },
          }),
          meetingId,
        );
        syncMeetingActionEntitiesFromUserEdits(db, meetingId);
      } else updateEntityStatus(entities[1].id, 'completed');
      const edits = JSON.parse(getMeeting(meetingId)!.user_edits_json || '{}');
      expect(edits[`completion:all_action_items:${index}`]?.edited).toBe(
        direction === 'ambiguous' ? undefined : 'true',
      );
      expect(edits[`completion:all_action_items:${1 - index}`]).toBeUndefined();
      expect(getEntity(entities[1].id)?.status).toBe('completed');
      expect(getEntity(entities[0].id)?.status).toBe('active');
    },
  );
  it('preserves completed actions when the saved edit document is unreadable', () => {
    const meetingId = 'unreadable-edit-state';
    saveMeeting({
      id: meetingId,
      title: 'Edit recovery',
      analysis_json: JSON.stringify({
        all_action_items: [{ text: 'Send the checklist' }],
      }),
    });
    const task = upsertEntity({
      id: 'completed-unreadable-edit',
      type: 'action_item',
      name: 'Send the checklist',
      status: 'completed',
      dedupe_by_name: false,
      metadata: {
        source_meeting_id: meetingId,
        original_description: 'Send the checklist',
        origin: 'extraction',
        user_completed_edited: true,
      },
    });
    db.prepare('UPDATE meetings SET user_edits_json = ? WHERE id = ?').run(
      'not-json',
      meetingId,
    );
    expect(
      syncMeetingActionEntitiesFromUserEdits(db, meetingId).actionsUpdated,
    ).toBe(0);
    expect(getEntity(task.id)?.status).toBe('completed');
  });
  it('does not transfer completion by position to a different regenerated task', () => {
    const meetingId = 'regenerated-task-identity';
    saveMeeting({
      id: meetingId,
      title: 'Task identity review',
      analysis_json: JSON.stringify({
        all_action_items: [{ text: 'Send the new report' }],
      }),
      user_edits_json: JSON.stringify({
        'completion:all_action_items:0': { original: 'false', edited: 'true' },
      }),
    });
    const old = upsertEntity({
      id: 'old-task-identity',
      type: 'action_item',
      name: 'Prepare the old checklist',
      status: 'active',
      dedupe_by_name: false,
      metadata: {
        origin: 'extraction',
        original_description: 'Prepare the old checklist',
        source_meeting_id: meetingId,
        source_path: 'all_action_items:0',
        source_index: 0,
      },
    });
    syncMeetingActionEntitiesFromUserEdits(db, meetingId);
    expect(getEntity(old.id)?.status).toBe('active');
    expect(getEntity(old.id)?.name).toBe('Prepare the old checklist');
  });
  it('mirrors completion into the matching task after the note order changes', () => {
    const meetingId = 'reordered-task-identity';
    saveMeeting({
      id: meetingId,
      title: 'Task identity review',
      analysis_json: JSON.stringify({
        all_action_items: [
          { text: 'Send the new report' },
          { text: 'Prepare the checklist' },
        ],
      }),
    });
    const task = upsertEntity({
      id: 'reordered-task',
      type: 'action_item',
      name: 'Prepare the checklist',
      status: 'active',
      dedupe_by_name: false,
      metadata: {
        origin: 'extraction',
        original_description: 'Prepare the checklist',
        source_meeting_id: meetingId,
        source_path: 'all_action_items:0',
        source_index: 0,
      },
    });
    updateEntityStatus(task.id, 'completed');
    const edits = JSON.parse(getMeeting(meetingId)!.user_edits_json!);
    expect(edits['completion:all_action_items:0']).toBeUndefined();
    expect(edits['completion:all_action_items:1'].edited).toBe('true');
    expect(parseActionMetadata(getEntity(task.id)!.metadata).source_index).toBe(
      1,
    );
  });
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
        all_action_items: [{ text: 'Review mobile layout', assignee: 'Me' }],
      }),
      user_edits_json: JSON.stringify({
        'native_continuations:all_action_items:0': {
          original: '[]',
          edited: JSON.stringify([
            {
              id: continuationId,
              text: continuationText,
              kind: 'action',
              assignee: 'Me',
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
    expect(meta.assignee_name).toBe('Me');
    expect(isPersonalAction(entity!, {})).toBe(true);

    // Delete continuation from user edits
    saveMeeting({
      id: meetingId,
      title: 'Design Call',
      user_edits_json: JSON.stringify({
        'native_continuations:all_action_items:0': {
          original: '[]',
          edited: JSON.stringify([]),
        },
      }),
    });

    const deleteResult = syncMeetingActionEntitiesFromUserEdits(db, meetingId);
    expect(deleteResult.continuationsRemoved).toBe(1);
    expect(getEntity(continuationEntityId)).toBeUndefined();
  });

  it.each([
    'continuation:all_action_items:0',
    'native_continuations:all_action_items:0',
  ])(
    'does not invent task intent for an untyped row with no parent: %s',
    (path) => {
      const meetingId = `orphaned-${path}`;
      const edits = {
        [path]: {
          original: '[]',
          edited: JSON.stringify([
            { id: 'untyped', text: 'Follow up with design' },
          ]),
        },
      };
      saveMeeting({
        id: meetingId,
        title: 'Orphaned continuation',
        analysis_json: JSON.stringify({ all_action_items: [] }),
        user_edits_json: JSON.stringify(edits),
      });

      expect(
        syncMeetingActionEntitiesFromUserEdits(db, meetingId)
          .continuationsCreated,
      ).toBe(0);
      expect(
        getEntity(`action-continuation-${meetingId}-untyped`),
      ).toBeUndefined();
      expect(JSON.parse(getMeeting(meetingId)!.user_edits_json!)).toEqual(
        edits,
      );
    },
  );

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

describe('corrected saved evidence for pending dashboard suggestions', () => {
  const evidence =
    'I will arrange time with Rowan depending on how the plan feels.';
  const staleText = 'Schedule time with Rowan today or tomorrow';
  const correctedText =
    'Arrange time with Rowan depending on how the plan feels';
  const seed = (
    suffix: string,
    metadata: Record<string, unknown> = {},
    due?: string,
  ) => {
    const meetingId = `corrected-dashboard-${suffix}`;
    saveMeeting({
      id: meetingId,
      title: 'Fictional planning meeting',
      started_at: '2026-10-15T12:00:00Z',
      analysis_json: JSON.stringify({
        all_action_items: [
          {
            text: correctedText,
            assignee: 'Me',
            evidence,
            ...(due ? { due } : {}),
          },
        ],
      }),
    });
    const entity = upsertEntity({
      id: `corrected-action-${suffix}`,
      type: 'action_item',
      name: staleText,
      status: 'active',
      due_date: '2026-10-16',
      dedupe_by_name: false,
      metadata: {
        origin: 'extraction',
        commitment_state: 'possible',
        source_meeting_id: meetingId,
        source_path: 'all_action_items:0',
        source_index: 0,
        full_description: staleText,
        original_description: staleText,
        assignee_name: 'Remote Speaker 2',
        source_due_date: 'tomorrow',
        source_evidence: evidence,
        ...metadata,
      },
    });
    return { meetingId, entity };
  };

  it('repairs saved text, owner and unsupported deadline at startup without generation', () => {
    const { entity, meetingId } = seed('startup');
    const before = getMeeting(meetingId);
    syncAllMeetingActionEntitiesFromUserEdits(db);
    const updated = getEntity(entity.id)!;
    expect(updated.name).toBe(correctedText);
    expect(updated.due_date).toBeNull();
    expect(parseActionMetadata(updated.metadata)).toMatchObject({
      full_description: correctedText,
      original_description: correctedText,
      assignee_name: 'Me',
      source_evidence: evidence,
      commitment_state: 'possible',
    });
    expect(getMeeting(meetingId)).toEqual(before);
    expect(
      syncMeetingActionEntitiesFromUserEdits(db, meetingId).actionsUpdated,
    ).toBe(0);
  });

  it('refreshes an unchanged pending task when review expands its exact source quote', () => {
    const { entity, meetingId } = seed('expanded-evidence', {
      full_description: correctedText,
      original_description: correctedText,
    });
    const expanded = `Earlier request: arrange the planning discussion. ${evidence}`;
    db.prepare('UPDATE meetings SET analysis_json = ? WHERE id = ?').run(
      JSON.stringify({
        all_action_items: [
          { text: correctedText, assignee: 'Me', evidence: expanded },
        ],
      }),
      meetingId,
    );
    syncMeetingActionEntitiesFromUserEdits(db, meetingId);
    const updated = getEntity(entity.id)!;
    expect(updated.due_date).toBeNull();
    expect(parseActionMetadata(updated.metadata)).toMatchObject({
      assignee_name: 'Me',
      source_evidence: expanded,
    });
    expect(
      syncMeetingActionEntitiesFromUserEdits(db, meetingId).actionsUpdated,
    ).toBe(0);
  });
  it('refreshes evidence even when task, owner and deadline already match', () => {
    const { entity, meetingId } = seed('evidence-only');
    syncMeetingActionEntitiesFromUserEdits(db, meetingId);
    const expanded = `Earlier request: arrange the planning discussion. ${evidence}`;
    db.prepare('UPDATE meetings SET analysis_json = ? WHERE id = ?').run(
      JSON.stringify({
        all_action_items: [
          { text: correctedText, assignee: 'Me', evidence: expanded },
        ],
      }),
      meetingId,
    );
    expect(
      syncMeetingActionEntitiesFromUserEdits(db, meetingId).actionsUpdated,
    ).toBe(1);
    expect(
      parseActionMetadata(getEntity(entity.id)!.metadata).source_evidence,
    ).toBe(expanded);
    expect(
      syncMeetingActionEntitiesFromUserEdits(db, meetingId).actionsUpdated,
    ).toBe(0);
  });
  it.each([
    ['confirmed', { commitment_state: 'confirmed' }],
    ['rejected', { commitment_state: 'rejected' }],
    ['edited', { user_edited: true }],
    ['reviewed', { reviewed_at: '2026-10-16T10:00:00Z' }],
    ['user-owned', { owner_source: 'user' }],
  ])(
    'preserves %s state when an unchanged task gains wider source context',
    (suffix, metadata) => {
      const { entity, meetingId } = seed(`expanded-${suffix}`, {
        full_description: correctedText,
        original_description: correctedText,
        ...metadata,
      });
      const expanded = `Earlier request: arrange the planning discussion. ${evidence}`;
      db.prepare('UPDATE meetings SET analysis_json = ? WHERE id = ?').run(
        JSON.stringify({
          all_action_items: [
            { text: correctedText, assignee: 'Me', evidence: expanded },
          ],
        }),
        meetingId,
      );
      syncMeetingActionEntitiesFromUserEdits(db, meetingId);
      const current = getEntity(entity.id)!;
      expect(current.due_date).toBe('2026-10-16');
      expect(parseActionMetadata(current.metadata)).toMatchObject({
        assignee_name: 'Remote Speaker 2',
        source_evidence: evidence,
      });
    },
  );
  it('does not rebind a different task merely because its expanded quote contains the old quote', () => {
    const { entity, meetingId } = seed('expanded-different-task');
    const expanded = `Earlier request: arrange the planning discussion. ${evidence}`;
    db.prepare('UPDATE meetings SET analysis_json = ? WHERE id = ?').run(
      JSON.stringify({
        all_action_items: [
          { text: correctedText, assignee: 'Me', evidence: expanded },
        ],
      }),
      meetingId,
    );
    syncMeetingActionEntitiesFromUserEdits(db, meetingId);
    expect(getEntity(entity.id)?.name).toBe(staleText);
    expect(getEntity(entity.id)?.due_date).toBe('2026-10-16');
  });
  it('keeps a corrected suggestion anchored when the user later completes it', () => {
    const { entity, meetingId } = seed('corrected-completion');
    syncMeetingActionEntitiesFromUserEdits(db, meetingId);
    updateEntityStatus(entity.id, 'completed');
    const edits = JSON.parse(getMeeting(meetingId)!.user_edits_json || '{}');
    expect(edits['completion:all_action_items:0']?.edited).toBe('true');
    expect(getEntity(entity.id)?.status).toBe('completed');
    expect(
      parseActionMetadata(getEntity(entity.id)?.metadata ?? null)
        .original_description,
    ).toBe(correctedText);
  });

  it('does not move a completion edit through an evidence-only wording match', () => {
    const { entity, meetingId } = seed('completion-blocks-rebinding');
    db.prepare('UPDATE meetings SET user_edits_json = ? WHERE id = ?').run(
      JSON.stringify({
        'completion:all_action_items:0': { original: 'false', edited: 'true' },
      }),
      meetingId,
    );
    syncMeetingActionEntitiesFromUserEdits(db, meetingId);
    expect(getEntity(entity.id)?.name).toBe(staleText);
    expect(getEntity(entity.id)?.status).toBe('active');
  });

  it.each([
    ['monday', '2026-10-19'],
    ['Friday, November 13', '2026-11-13'],
  ] as const)('normalizes corrected source deadline %s', (due, expected) => {
    const { entity, meetingId } = seed(`due-${due}`, {}, due);
    syncMeetingActionEntitiesFromUserEdits(db, meetingId);
    expect(getEntity(entity.id)?.due_date).toBe(expected);
  });

  it.each([
    ['confirmed', { commitment_state: 'confirmed' }],
    ['rejected', { commitment_state: 'rejected' }],
    ['edited', { user_edited: true }],
    ['different-evidence', { source_evidence: 'An unrelated promise.' }],
  ])('preserves %s records', (suffix, metadata) => {
    const { entity, meetingId } = seed(suffix, metadata);
    syncMeetingActionEntitiesFromUserEdits(db, meetingId);
    expect(getEntity(entity.id)?.name).toBe(staleText);
    expect(getEntity(entity.id)?.due_date).toBe('2026-10-16');
  });

  it('preserves a user-corrected owner while refreshing pending source wording', () => {
    const { entity, meetingId } = seed('owner', {
      owner_source: 'user',
      assignee_name: 'Rowan',
    });
    syncMeetingActionEntitiesFromUserEdits(db, meetingId);
    expect(
      parseActionMetadata(getEntity(entity.id)?.metadata ?? null).assignee_name,
    ).toBe('Rowan');
  });

  it('keeps an explicit note edit while correcting the pending deadline and owner', () => {
    const { entity, meetingId } = seed('note-edit');
    db.prepare('UPDATE meetings SET user_edits_json = ? WHERE id = ?').run(
      JSON.stringify({
        'all_action_items:0': {
          original: correctedText,
          edited: 'Arrange the planning session with Rowan',
        },
      }),
      meetingId,
    );
    syncMeetingActionEntitiesFromUserEdits(db, meetingId);
    expect(getEntity(entity.id)?.name).toBe(
      'Arrange the planning session with Rowan',
    );
    expect(getEntity(entity.id)?.due_date).toBeNull();
  });
});

// Recovered behavior cases from the preserved local snapshot.
it('preserves completed source tasks when rewrite archives their checkbox overlay', () => {
  const meetingId = 'archived-completion';
  saveMeeting({
    id: meetingId,
    title: 'Checklist',
    analysis_json: JSON.stringify({
      all_action_items: [{ text: 'Send checklist' }],
    }),
    user_edits_json: '{}',
  });
  upsertEntity({
    id: 'archived-completion-task',
    dedupe_by_name: false,
    type: 'action_item',
    name: 'Send checklist',
    status: 'completed',
    metadata: {
      origin: 'extraction',
      source_meeting_id: meetingId,
      original_description: 'Send checklist',
      user_completed_edited: true,
    },
  });
  syncMeetingActionEntitiesFromUserEdits(db, meetingId);
  expect(getEntity('archived-completion-task')?.status).toBe('completed');
});
it('preserves native tasks through archived or malformed overlays, moves their host, and honors explicit removal', () => {
  const meetingId = 'native-overlay-continuity';
  const oldPath = 'native_continuations:all_action_items:0';
  const newPath = 'native_continuations:all_action_items:2';
  const rows = [
    { id: 'own', text: 'Review checklist', kind: 'action', assignee: 'Me' },
  ];
  const saveEdits = (edits: unknown) =>
    saveMeeting({
      id: meetingId,
      title: 'Checklist',
      user_edits_json: JSON.stringify(edits),
    });
  saveEdits({ [oldPath]: { original: '[]', edited: JSON.stringify(rows) } });
  syncMeetingActionEntitiesFromUserEdits(db, meetingId);
  const id = `action-continuation-${meetingId}-own`;
  expect(getEntity(id)).toBeTruthy();
  const metadata = parseActionMetadata(getEntity(id)!.metadata);
  db.prepare('UPDATE entities SET metadata = ? WHERE id = ?').run(
    JSON.stringify({
      ...metadata,
      assignee_name: 'Me',
      assignee_is_self: true,
    }),
    id,
  );
  for (const edits of [
    {},
    { [oldPath]: { edited: 'broken' } },
    { [oldPath]: { edited: '[{}]' } },
  ]) {
    saveEdits(edits);
    syncMeetingActionEntitiesFromUserEdits(db, meetingId);
    expect(getEntity(id)).toBeTruthy();
  }
  saveEdits({ [newPath]: { original: '[]', edited: JSON.stringify(rows) } });
  syncMeetingActionEntitiesFromUserEdits(db, meetingId);
  expect(parseActionMetadata(getEntity(id)!.metadata)).toMatchObject({
    source_path: newPath,
    assignee_name: 'Me',
    assignee_is_self: true,
  });
  updateEntityStatus(id, 'completed');
  expect(
    JSON.parse(
      JSON.parse(getMeeting(meetingId)!.user_edits_json!)[newPath].edited,
    )[0].completed,
  ).toBe(true);
  saveEdits({ [newPath]: { original: '[]', edited: '[]' } });
  syncMeetingActionEntitiesFromUserEdits(db, meetingId);
  expect(getEntity(id)).toBeUndefined();
});
it('keeps completion with the matching owner when two people have the same task wording', () => {
  const meetingId = 'same-wording-different-owners';
  saveMeeting({
    id: meetingId,
    title: 'Owner continuity',
    analysis_json: JSON.stringify({
      all_action_items: [
        { text: 'Send the checklist', assignee: 'Me' },
        { text: 'Send the checklist', assignee: 'Other' },
      ],
    }),
    user_edits_json: JSON.stringify({
      'completion:all_action_items:0': { original: 'false', edited: 'true' },
    }),
  });
  for (const owner of ['Me', 'Other'])
    upsertEntity({
      id: `owner-checklist-${owner}`,
      type: 'action_item',
      name: 'Send the checklist',
      status: 'active',
      dedupe_by_name: false,
      metadata: {
        origin: 'extraction',
        source_meeting_id: meetingId,
        original_description: 'Send the checklist',
        assignee_name: owner,
      },
    });
  syncMeetingActionEntitiesFromUserEdits(db, meetingId);
  expect(getEntity('owner-checklist-Me')?.status).toBe('completed');
  expect(getEntity('owner-checklist-Other')?.status).toBe('active');
});
it('does not transfer a source checkbox to a retained task whose owner changed in the rewritten notes', () => {
  const meetingId = 'changed-note-owner';
  saveMeeting({
    id: meetingId,
    title: 'Owner change',
    analysis_json: JSON.stringify({
      all_action_items: [{ text: 'Send the checklist', assignee: 'Other' }],
    }),
    user_edits_json: JSON.stringify({
      'completion:all_action_items:0': { original: 'false', edited: 'true' },
    }),
  });
  upsertEntity({
    id: 'retained-own-checklist',
    type: 'action_item',
    name: 'Send the checklist',
    status: 'active',
    dedupe_by_name: false,
    metadata: {
      origin: 'extraction',
      commitment_state: 'confirmed',
      source_meeting_id: meetingId,
      original_description: 'Send the checklist',
      assignee_name: 'Me',
    },
  });
  syncMeetingActionEntitiesFromUserEdits(db, meetingId);
  expect(getEntity('retained-own-checklist')?.status).toBe('active');
  expect(
    parseActionMetadata(getEntity('retained-own-checklist')!.metadata)
      .assignee_name,
  ).toBe('Me');
});
it('mirrors Home completion into a legacy string action after a case-only rewrite', () => {
  const meetingId = 'legacy-string-home-completion';
  saveMeeting({
    id: meetingId,
    title: 'Legacy completion',
    analysis_json: JSON.stringify({ action_items: ['send the checklist'] }),
  });
  upsertEntity({
    id: 'legacy-string-task',
    type: 'action_item',
    name: 'Send the checklist',
    status: 'active',
    dedupe_by_name: false,
    metadata: {
      origin: 'extraction',
      source_meeting_id: meetingId,
      source_path: 'v2:action:0',
      original_description: 'Send the checklist',
      assignee_name: 'Me',
    },
  });
  updateEntityStatus('legacy-string-task', 'completed');
  expect(
    JSON.parse(getMeeting(meetingId)!.user_edits_json!)[
      'completion:v2:action:0'
    ].edited,
  ).toBe('true');
});
it('keeps ordinary native notes out of tasks and removes an unreviewed erroneous projection without deleting the note', () => {
  const meetingId = 'plain-native-note';
  const path = 'native_continuations:topic:0:point:0';
  const edits = {
    [path]: {
      original: '[]',
      edited: JSON.stringify([
        { id: 'note', text: 'Ordinary discussion note' },
      ]),
    },
  };
  saveMeeting({
    id: meetingId,
    title: 'Ordinary notes',
    analysis_json: JSON.stringify({
      all_action_items: [],
      topics: [{ key_points: ['Background'] }],
    }),
    user_edits_json: JSON.stringify(edits),
  });
  const id = `action-continuation-${meetingId}-note`;
  upsertEntity({
    id,
    type: 'action_item',
    name: 'Ordinary discussion note',
    status: 'active',
    dedupe_by_name: false,
    metadata: {
      origin: 'user',
      commitment_state: 'confirmed',
      source_meeting_id: meetingId,
      source_path: path,
      continuation_id: 'note',
    },
  });
  syncMeetingActionEntitiesFromUserEdits(db, meetingId);
  expect(getEntity(id)).toBeUndefined();
  expect(JSON.parse(getMeeting(meetingId)!.user_edits_json!)).toEqual(edits);
});
it('uses declared task intent and inherited ownership instead of treating every authored line as mine', () => {
  const meetingId = 'typed-native-intent';
  const path = 'native_continuations:all_action_items:0';
  saveMeeting({
    id: meetingId,
    title: 'Native intent',
    analysis_json: JSON.stringify({
      all_action_items: [{ text: 'Parent task', assignee: 'Other' }],
    }),
    user_edits_json: JSON.stringify({
      [path]: {
        original: '[]',
        edited: JSON.stringify([
          { id: 'note', text: 'A plain comment', kind: 'note' },
          {
            id: 'decision',
            text: 'A decision acknowledgement',
            kind: 'decision',
            completed: false,
          },
          { id: 'other', text: 'Inherited task' },
          {
            id: 'own',
            text: 'Write checklist',
            kind: 'action',
            assignee: 'Me',
          },
          {
            id: 'unknown',
            text: 'Resolve question',
            kind: 'action',
            assignee: null,
          },
        ]),
      },
    }),
  });
  syncMeetingActionEntitiesFromUserEdits(db, meetingId);
  const task = (key: string) =>
    getEntity(`action-continuation-${meetingId}-${key}`);
  expect(task('note')).toBeUndefined();
  expect(task('decision')).toBeUndefined();
  expect(parseActionMetadata(task('other')!.metadata).assignee_name).toBe(
    'Other',
  );
  expect(isPersonalAction(task('other')!, {})).toBe(false);
  expect(isPersonalAction(task('own')!, {})).toBe(true);
  expect(isPersonalAction(task('unknown')!, {})).toBe(false);
  updateActionCommitmentState(task('unknown')!.id, 'confirmed');
  expect(isPersonalAction(task('unknown')!, {})).toBe(true);
});
it('does not reopen a completed native task when a restored note row omits its completion flag', () => {
  const meetingId = 'native-closed-continuity';
  const path = 'native_continuations:all_action_items:0';
  const row = {
    id: 'closed',
    text: 'Send checklist',
    kind: 'action',
    assignee: 'Me',
  };
  const setRow = (value: unknown) =>
    saveMeeting({
      id: meetingId,
      title: 'Closed continuity',
      user_edits_json: JSON.stringify({
        [path]: { original: '[]', edited: JSON.stringify([value]) },
      }),
    });
  setRow(row);
  syncMeetingActionEntitiesFromUserEdits(db, meetingId);
  const id = `action-continuation-${meetingId}-closed`;
  updateEntityStatus(id, 'completed');
  setRow(row);
  syncMeetingActionEntitiesFromUserEdits(db, meetingId);
  expect(getEntity(id)?.status).toBe('completed');
  setRow({ ...row, completed: false });
  syncMeetingActionEntitiesFromUserEdits(db, meetingId);
  expect(getEntity(id)?.status).toBe('active');
});

it('does not mirror completion into a source action with a different recorded owner', () => {
  const meetingId = 'completion-source-owner-changed';
  saveMeeting({
    id: meetingId,
    title: 'Fictional owner continuity',
    analysis_json: JSON.stringify({
      all_action_items: [{ text: 'Send checklist', assignee: 'Other' }],
    }),
    user_edits_json: '{}',
  });
  const task = upsertEntity({
    id: 'completion-owner-task',
    type: 'action_item',
    name: 'Send checklist',
    status: 'active',
    dedupe_by_name: false,
    metadata: {
      origin: 'extraction',
      commitment_state: 'confirmed',
      source_meeting_id: meetingId,
      source_path: 'all_action_items:0',
      original_description: 'Send checklist',
      assignee_name: 'Me',
    },
  });
  updateEntityStatus(task.id, 'completed');
  expect(getEntity(task.id)?.status).toBe('completed');
  expect(JSON.parse(getMeeting(meetingId)!.user_edits_json!)).toEqual({});
});
