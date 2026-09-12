import fs from 'node:fs';
import { afterAll, describe, expect, it, vi } from 'vitest';

const testDatabase = vi.hoisted(() => ({
  directory: `/tmp/pluto-entity-pipeline-idempotency-${process.pid}-${Math.random()
    .toString(16)
    .slice(2)}`,
}));

vi.mock('electron', () => ({
  app: { getPath: () => testDatabase.directory },
}));

import {
  getEntitiesByType,
  getEntity,
  getEntityLinks,
  getMeetingEntities,
  saveMeeting,
  updateActionCommitmentState,
} from '../../electron/db';
import {
  extractAndProcessEntities,
  processExtractedEntities as processWithIdentity,
} from '../../electron/entityPipeline';
import type { ExtractedEntities } from '../../electron/llm/provider';

const processExtractedEntities = (
  extracted: ExtractedEntities,
  meetingId: string,
) =>
  processWithIdentity(extracted, meetingId, undefined, undefined, {
    generate: async () =>
      JSON.stringify({
        status: 'unresolved',
        personId: null,
        speaker: null,
        ownershipKind: 'ambiguous',
        evidence: [],
        identityEvidence: [],
        reason: 'No source identity.',
      }),
  });

afterAll(() => {
  fs.rmSync(testDatabase.directory, { recursive: true, force: true });
});

const extractedAction = (description: string): ExtractedEntities => ({
  people: [],
  topics: [],
  action_items: [{ description }],
  decisions: [],
  projects: [],
  relationships: [],
});

describe('extracted action idempotency', () => {
  it('does not commit provider results after the owning run is superseded', async () => {
    const meetingId = 'meeting-superseded-extraction';
    saveMeeting({ id: meetingId, title: 'Superseded extraction fixture' });

    await expect(
      extractAndProcessEntities(
        { extractEntities: async () => extractedAction('Late synthetic task') },
        'Synthetic transcript evidence',
        meetingId,
        undefined,
        { canCommit: () => false },
      ),
    ).rejects.toThrow('entity_extraction_superseded');

    expect(getMeetingEntities(meetingId)).toEqual([]);
  });

  it.each(['confirmed', 'rejected'] as const)(
    'reuses one meeting-scoped action without resetting %s review metadata',
    async (commitmentState) => {
      const meetingId = `meeting-repeat-${commitmentState}`;
      saveMeeting({ id: meetingId, title: 'Repeat extraction fixture' });
      const first = await processExtractedEntities(
        extractedAction('Send   the rollout note.'),
        meetingId,
      );
      const reviewed = updateActionCommitmentState(
        first.entities[0].id,
        commitmentState,
        '2026-08-03T12:00:00.000Z',
      );

      const replay = await processExtractedEntities(
        extractedAction('Send   the rollout note.'),
        meetingId,
      );

      const actions = getEntitiesByType('action_item').filter((entity) => {
        const metadata = JSON.parse(entity.metadata ?? '{}');
        return metadata.source_meeting_id === meetingId;
      });
      expect(actions).toHaveLength(1);
      expect(actions[0].id).toBe(reviewed.id);
      expect(JSON.parse(actions[0].metadata ?? '{}')).toEqual({
        full_description: 'Send   the rollout note.',
        commitment_state: commitmentState,
        origin: 'extraction',
        source_meeting_id: meetingId,
        reviewed_at: '2026-08-03T12:00:00.000Z',
      });
      const associations = getMeetingEntities(meetingId);
      expect(associations).toHaveLength(1);
      expect(associations[0].mention_count).toBe(1);
      expect(replay.linked).toBe(0);
    },
  );

  it('keeps identical action descriptions distinct across meetings', async () => {
    saveMeeting({ id: 'meeting-a', title: 'First source fixture' });
    saveMeeting({ id: 'meeting-b', title: 'Second source fixture' });

    const first = await processExtractedEntities(
      extractedAction('Publish the launch memo'),
      'meeting-a',
    );
    const second = await processExtractedEntities(
      extractedAction('Publish the launch memo'),
      'meeting-b',
    );

    expect(first.entities[0].id).not.toBe(second.entities[0].id);
  });

  it('preserves the old action and keeps an unresolved changed assignee separate', async () => {
    saveMeeting({ id: 'meeting-assignee', title: 'Assignee drift fixture' });
    const first = await processExtractedEntities(
      {
        ...extractedAction('Publish the launch memo'),
        action_items: [
          { description: 'Publish the launch memo', assignee: 'Alex' },
        ],
      },
      'meeting-assignee',
    );

    await processExtractedEntities(
      {
        ...extractedAction(' publish the launch memo. '),
        action_items: [
          { description: ' publish the launch memo. ', assignee: 'Taylor' },
        ],
      },
      'meeting-assignee',
    );

    const action = getEntity(first.entities[0].id);
    expect(JSON.parse(action?.metadata ?? '{}')).toMatchObject({
      assignee_name: 'Alex',
      full_description: 'Publish the launch memo',
    });
    const assignmentLinks = getEntityLinks(first.entities[0].id).filter(
      (link) => link.relationship === 'assigned_to',
    );
    expect(assignmentLinks).toHaveLength(1);
    expect(getEntity(assignmentLinks[0].target_entity_id)?.name).toBe('Alex');
    expect(getEntitiesByType('person').map((person) => person.name)).toContain(
      'Taylor',
    );
  });
  it('requires a generator for every action-bearing processing path', async () => {
    await expect(
      processWithIdentity(extractedAction('Send note'), 'missing'),
    ).rejects.toThrow('commitment_generator_required');
  });

  it('keeps separately extracted actions distinct when only their wording overlaps', async () => {
    const meetingId = 'meeting-rephrased-action';
    saveMeeting({ id: meetingId, title: 'Sync with Arnold' });

    const first = await processExtractedEntities(
      {
        ...extractedAction(
          'Me will circle back with Arnold offline regarding the status of things and the timeline for tomorrow',
        ),
        action_items: [
          {
            description:
              'Me will circle back with Arnold offline regarding the status of things and the timeline for tomorrow',
            assignee: 'Me',
          },
        ],
      },
      meetingId,
    );

    expect(first.entities[0].name).toBe(
      'Circle back with Arnold offline regarding the status of things and the timeline for tomorrow',
    );

    // Replay with rephrased modal/infinitive description
    const replay = await processExtractedEntities(
      {
        ...extractedAction(
          'Me to circle back with Arnold offline regarding the status of things and the timeline for tomorrow.',
        ),
        action_items: [
          {
            description:
              'Me to circle back with Arnold offline regarding the status of things and the timeline for tomorrow.',
            assignee: 'Me',
          },
        ],
      },
      meetingId,
    );

    const actions = getEntitiesByType('action_item').filter((entity) => {
      const metadata = JSON.parse(entity.metadata ?? '{}');
      return metadata.source_meeting_id === meetingId;
    });

    expect(actions).toHaveLength(2);
    expect(actions.map((action) => action.id)).toContain(first.entities[0].id);
    expect(replay.updated).toBe(0);
    expect(replay.created).toBe(1);
  });

  it('keeps action entity identity stable when meeting summary changes', async () => {
    const meetingId = 'meeting-summary-change';
    saveMeeting({ id: meetingId, title: 'Quarterly Kickoff' });

    const first = await processWithIdentity(
      extractedAction('Finalize the Q4 launch dates'),
      meetingId,
      { summary: 'First draft summary of the meeting.' },
      undefined,
      {
        generate: async () =>
          JSON.stringify({
            status: 'unresolved',
            personId: null,
            speaker: null,
            ownershipKind: 'ambiguous',
            evidence: [],
            identityEvidence: [],
            reason: 'No source identity.',
          }),
      },
    );

    const second = await processWithIdentity(
      extractedAction('Finalize the Q4 launch dates'),
      meetingId,
      { summary: 'Updated and rewritten meeting summary.' },
      undefined,
      {
        generate: async () =>
          JSON.stringify({
            status: 'unresolved',
            personId: null,
            speaker: null,
            ownershipKind: 'ambiguous',
            evidence: [],
            identityEvidence: [],
            reason: 'No source identity.',
          }),
      },
    );

    const actions = getEntitiesByType('action_item').filter((entity) => {
      const metadata = JSON.parse(entity.metadata ?? '{}');
      return metadata.source_meeting_id === meetingId;
    });

    expect(actions).toHaveLength(1);
    expect(second.entities[0].id).toBe(first.entities[0].id);
    expect(second.created).toBe(0);
    expect(second.updated).toBe(1);
  });
});
