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

import { getEntitiesByType, upsertEntity } from '../../electron/db';

afterAll(() => {
  fs.rmSync(testDatabase.directory, { recursive: true, force: true });
});

describe('action commitment database persistence', () => {
  it('keeps same-name action creates distinct while explicit IDs still update', () => {
    const userAction = upsertEntity({
      type: 'action_item',
      name: 'Send the rollout note',
      metadata: {
        full_description: 'Send the rollout note',
        commitment_state: 'confirmed',
        origin: 'user',
      },
    });
    const extractedAction = upsertEntity({
      type: 'action_item',
      name: 'Send the rollout note',
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
    expect(getEntitiesByType('action_item')).toHaveLength(2);
  });
});
