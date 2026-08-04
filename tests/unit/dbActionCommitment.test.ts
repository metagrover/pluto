import fs from 'node:fs';
import { afterAll, describe, expect, it, vi } from 'vitest';

const testDatabase = vi.hoisted(() => ({
  directory: `/tmp/pluto-action-commitment-db-${process.pid}-${Math.random()
    .toString(16)
    .slice(2)}`,
}));

vi.mock('electron', () => ({
  app: {
    getPath: () => testDatabase.directory,
  },
}));

import {
  getEntitiesByType,
  updateActionCommitmentState,
  upsertEntity,
} from '../../electron/db';

afterAll(() => {
  fs.rmSync(testDatabase.directory, { recursive: true, force: true });
});

describe('action commitment database persistence', () => {
  it.each([
    ['confirmed', 'rejected'],
    ['rejected', 'confirmed'],
  ] as const)(
    'does not allow a final %s review to transition to %s',
    (initialState, attemptedState) => {
      const action = upsertEntity({
        type: 'action_item',
        name: `Final ${initialState} action`,
        dedupe_by_name: false,
        metadata: {
          commitment_state: initialState,
          origin: initialState === 'confirmed' ? 'user' : 'extraction',
          reviewed_at: '2026-08-03T12:00:00.000Z',
        },
      });

      expect(() =>
        updateActionCommitmentState(action.id, attemptedState),
      ).toThrow(
        `Cannot transition action commitment from ${initialState} to ${attemptedState}`,
      );

      const persisted = getEntitiesByType('action_item').find(
        (entity) => entity.id === action.id,
      );
      expect(JSON.parse(persisted?.metadata ?? '{}')).toMatchObject({
        commitment_state: initialState,
        origin: initialState === 'confirmed' ? 'user' : 'extraction',
        reviewed_at: '2026-08-03T12:00:00.000Z',
      });
    },
  );

  it.each(['confirmed', 'rejected'] as const)(
    'allows possible to transition exactly once to %s and treats a retry as idempotent',
    (finalState) => {
      const action = upsertEntity({
        type: 'action_item',
        name: `Possible to ${finalState}`,
        status: 'overdue',
        dedupe_by_name: false,
        metadata: {
          commitment_state: 'possible',
          origin: 'extraction',
          source_meeting_id: 'meeting-transition',
        },
      });

      const first = updateActionCommitmentState(
        action.id,
        finalState,
        '2026-08-03T12:00:00.000Z',
      );
      const retry = updateActionCommitmentState(
        action.id,
        finalState,
        '2026-08-03T13:00:00.000Z',
      );

      expect(retry.status).toBe('overdue');
      expect(retry.metadata).toBe(first.metadata);
    },
  );

  it.each(['confirmed', 'rejected'] as const)(
    'persists a %s review without overwriting action metadata or completion status',
    (commitmentState) => {
      const action = upsertEntity({
        type: 'action_item',
        name: `Review ${commitmentState} action`,
        status: 'active',
        dedupe_by_name: false,
        metadata: {
          full_description: 'Send the rollout note with metrics',
          assignee_name: 'Alex',
          commitment_state: 'possible',
          origin: 'extraction',
          source_meeting_id: 'meeting-1',
        },
      });
      const reviewedAt = '2026-08-03T12:00:00.000Z';

      const updated = updateActionCommitmentState(
        action.id,
        commitmentState,
        reviewedAt,
      );

      expect(updated.status).toBe('active');
      expect(JSON.parse(updated.metadata ?? '{}')).toEqual({
        full_description: 'Send the rollout note with metrics',
        assignee_name: 'Alex',
        commitment_state: commitmentState,
        origin: 'extraction',
        source_meeting_id: 'meeting-1',
        reviewed_at: reviewedAt,
      });
    },
  );

  it('rejects missing and non-action entities', () => {
    const person = upsertEntity({ type: 'person', name: 'Alex Example' });

    expect(() =>
      updateActionCommitmentState('missing-action', 'confirmed'),
    ).toThrow('Entity not found');
    expect(() => updateActionCommitmentState(person.id, 'rejected')).toThrow(
      'not an action item',
    );
  });

  it.each([undefined, 'possible', 'invented-state'])(
    'rejects invalid runtime commitment state %j without mutating metadata',
    (invalidState) => {
      const action = upsertEntity({
        type: 'action_item',
        name: `Invalid state ${String(invalidState)}`,
        dedupe_by_name: false,
        metadata: {
          commitment_state: 'possible',
          origin: 'extraction',
          source_meeting_id: 'meeting-invalid-state',
        },
      });
      const metadataBefore = action.metadata;

      expect(() =>
        updateActionCommitmentState(
          action.id,
          invalidState as unknown as 'confirmed' | 'rejected',
        ),
      ).toThrow('Invalid commitment state');

      const persisted = getEntitiesByType('action_item').find(
        (entity) => entity.id === action.id,
      );
      expect(persisted?.metadata).toBe(metadataBefore);
    },
  );

  it('keeps same-name action creates distinct while explicit IDs still update', () => {
    const initialCount = getEntitiesByType('action_item').length;
    const userAction = upsertEntity({
      type: 'action_item',
      name: 'Send the rollout note',
      dedupe_by_name: false,
      metadata: {
        full_description: 'Send the rollout note',
        commitment_state: 'confirmed',
        origin: 'user',
      },
    });
    const extractedAction = upsertEntity({
      type: 'action_item',
      name: 'Send the rollout note',
      dedupe_by_name: false,
      metadata: {
        full_description: 'Send the rollout note',
        commitment_state: 'possible',
        origin: 'extraction',
      },
    });

    expect(extractedAction.id).not.toBe(userAction.id);
    expect(
      getEntitiesByType('action_item').map((entity) => ({
        id: entity.id,
        metadata: JSON.parse(entity.metadata ?? '{}'),
      })),
    ).toEqual(
      expect.arrayContaining([
        {
          id: userAction.id,
          metadata: expect.objectContaining({
            commitment_state: 'confirmed',
            origin: 'user',
          }),
        },
        {
          id: extractedAction.id,
          metadata: expect.objectContaining({
            commitment_state: 'possible',
            origin: 'extraction',
          }),
        },
      ]),
    );

    const updated = upsertEntity({
      id: userAction.id,
      type: 'action_item',
      name: 'Send the rollout note',
      status: 'completed',
    });

    expect(updated.id).toBe(userAction.id);
    expect(updated.status).toBe('completed');
    expect(getEntitiesByType('action_item')).toHaveLength(initialCount + 2);

    const defaultFirst = upsertEntity({
      type: 'action_item',
      name: 'Synthesize the project status',
    });
    const defaultSecond = upsertEntity({
      type: 'action_item',
      name: 'Synthesize the project status',
      status: 'completed',
    });

    expect(defaultSecond.id).toBe(defaultFirst.id);
    expect(defaultSecond.status).toBe('completed');
    expect(getEntitiesByType('action_item')).toHaveLength(initialCount + 3);
  });
});
