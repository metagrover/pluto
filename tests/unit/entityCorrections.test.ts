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
    expect(db.isItemDismissed(entityId, itemType, 'other-milestone')).toBe(
      false,
    );
    expect(db.isItemDismissed('other-entity', itemType, fingerprint)).toBe(
      false,
    );

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

  it('unifies item fingerprints across mixed casing and whitespace', () => {
    const entityId = 'proj-beta-456';
    const itemType = 'milestone';
    const rawInput = '   Stripe Elements   Connected!  ';
    const expectedFingerprint = 'stripe-elements-connected';

    expect(db.generateItemFingerprint(rawInput)).toBe(expectedFingerprint);

    const saved = db.recordEntityCorrection({
      entityId,
      itemType,
      fingerprint: rawInput,
      reason: 'wrong_milestone',
    });

    expect(saved.fingerprint).toBe(expectedFingerprint);

    // Queries with different casing, whitespace, and slug format should all match
    expect(db.isItemDismissed(entityId, itemType, expectedFingerprint)).toBe(
      true,
    );
    expect(
      db.isItemDismissed(entityId, itemType, 'STRIPE ELEMENTS CONNECTED'),
    ).toBe(true);
    expect(
      db.isItemDismissed(
        entityId,
        itemType,
        '  Stripe   Elements   Connected! ',
      ),
    ).toBe(true);
    expect(
      db.isItemDismissed(entityId, itemType, 'stripe-elements-connected'),
    ).toBe(true);

    // Unrelated queries do not match
    expect(
      db.isItemDismissed(entityId, itemType, 'stripe-elements-pending'),
    ).toBe(false);
  });

  it('includes accepted person current-read fields in the dreaming baseline', () => {
    const person = db.upsertEntity({
      type: 'person',
      name: 'Dreaming Baseline Person',
    });
    db.upsertKnowledgeDoc({
      scope_type: 'person_context',
      scope_key: person.id,
      title: person.name,
      structured_json: JSON.stringify({
        schema_version: 2,
        current_read: {
          headline: 'Evidence-backed headline',
          supporting_bullets: ['Current focus'],
        },
      }),
    });

    expect(db.getDreamingEntityBaseline(person.id)).toMatchObject({
      currentRead: {
        headline: 'Evidence-backed headline',
        supportingBullets: ['Current focus'],
      },
    });
  });
});
