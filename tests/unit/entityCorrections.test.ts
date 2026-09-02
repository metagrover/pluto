import fs from 'node:fs';
import { afterAll, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  directory: `/tmp/pluto-entity-corrections-${process.pid}`,
}));

vi.mock('electron', () => ({ app: { getPath: () => fixture.directory } }));
import * as db from '../../electron/db';

afterAll(() => fs.rmSync(fixture.directory, { recursive: true, force: true }));

describe('Entity Corrections Persistence', () => {
  it('records corrections and checks dismissed items idempotently', () => {
    const entityId = 'proj-alpha-123';
    const itemType = 'milestone';
    const fingerprint = 'stripe-checkout-v1';

    expect(db.isItemDismissed(entityId, itemType, fingerprint)).toBe(false);

    const saved = db.recordEntityCorrection({
      entityId,
      itemType,
      fingerprint,
      reason: 'reported_inaccurate',
    });

    expect(saved).toMatchObject({
      entity_id: entityId,
      item_type: itemType,
      fingerprint,
      reason: 'reported_inaccurate',
    });
    expect(saved.id).toBeDefined();

    expect(db.isItemDismissed(entityId, itemType, fingerprint)).toBe(true);
    expect(db.isItemDismissed(entityId, itemType, 'other-milestone')).toBe(false);
    expect(db.isItemDismissed('other-entity', itemType, fingerprint)).toBe(false);

    const list = db.getEntityCorrections(entityId);
    expect(list).toHaveLength(1);
    expect(list[0].fingerprint).toBe(fingerprint);

    // Recording again is idempotent and doesn't duplicate
    db.recordEntityCorrection({
      entityId,
      itemType,
      fingerprint,
      reason: 'duplicate_attempt',
    });
    const listAfterDuplicate = db.getEntityCorrections(entityId);
    expect(listAfterDuplicate).toHaveLength(1);
  });
});
