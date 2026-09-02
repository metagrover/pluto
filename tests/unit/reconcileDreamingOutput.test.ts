import fs from 'node:fs';
import { afterAll, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  directory: `/tmp/pluto-reconcile-dreaming-${process.pid}`,
}));

vi.mock('electron', () => ({ app: { getPath: () => fixture.directory } }));
import * as db from '../../electron/db';
import { reconcileDreamingOutput } from '../../electron/dreaming/reconcileDreamingOutput';
import type {
  PersonDreamingOutput,
  ProjectDreamingOutput,
} from '../../electron/dreaming/types';

afterAll(() => fs.rmSync(fixture.directory, { recursive: true, force: true }));

describe('reconcileDreamingOutput', () => {
  it('applies project output: updates summary, adds milestones, and stages alias suggestions', async () => {
    const project = db.upsertEntity({
      type: 'project',
      name: 'Checkout Revamp',
    });

    const projectOutput: ProjectDreamingOutput = {
      status: 'updated',
      dossier_summary:
        'Migrating to Stripe Elements for lower latency checkout.',
      milestones: [
        {
          name: 'PCI Compliance Verified',
          status: 'completed',
          source_meeting_id: 'm-1',
          evidence_snippet: 'Security team signed off.',
        },
      ],
      suggested_aliases: ['Checkout V2'],
    };

    await reconcileDreamingOutput(project.id, 'project', projectOutput, {
      getEntity: db.getEntity,
      upsertEntity: db.upsertEntity,
      saveAliasSuggestion: db.saveEntityAliasSuggestion,
      isItemDismissed: db.isItemDismissed,
    });

    const updated = db.getEntity(project.id);
    expect(updated).toBeDefined();
    const metadata = JSON.parse(updated?.metadata || '{}');
    expect(metadata.dossierSummary).toBe(
      'Migrating to Stripe Elements for lower latency checkout.',
    );
    expect(metadata.projectMilestones).toHaveLength(1);
    expect(metadata.projectMilestones[0].title).toBe('PCI Compliance Verified');
    expect(metadata.projectMilestones[0].status).toBe('completed');

    const aliases = db.getEntityAliasSuggestions(project.id);
    expect(aliases).toHaveLength(1);
    expect(aliases[0].suggested_name).toBe('Checkout V2');
    expect(aliases[0].status).toBe('pending');
  });

  it('applies person output: updates headline and stages alias suggestions', async () => {
    const person = db.upsertEntity({
      type: 'person',
      name: 'Bob',
    });

    const personOutput: PersonDreamingOutput = {
      status: 'updated',
      headline: 'Tech Lead, Payments',
      current_focus: 'Webhook reliability',
      suggested_aliases: ['Robert'],
    };

    await reconcileDreamingOutput(person.id, 'person', personOutput, {
      getEntity: db.getEntity,
      upsertEntity: db.upsertEntity,
      saveAliasSuggestion: db.saveEntityAliasSuggestion,
      isItemDismissed: db.isItemDismissed,
    });

    const updated = db.getEntity(person.id);
    expect(updated).toBeDefined();
    const metadata = JSON.parse(updated?.metadata || '{}');
    expect(metadata.headline).toBe('Tech Lead, Payments');
    expect(metadata.currentFocus).toBe('Webhook reliability');

    const aliases = db.getEntityAliasSuggestions(person.id);
    expect(aliases).toHaveLength(1);
    expect(aliases[0].suggested_name).toBe('Robert');
  });
});
