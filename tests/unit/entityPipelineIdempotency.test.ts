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
  getActionItemsByStatus,
  getEntitiesByType,
  getEntity,
  getEntityLinks,
  getMeetingEntities,
  saveMeeting,
  updateActionCommitmentState,
  updateEntityStatus,
  upsertEntity,
} from '../../electron/db';
import {
  extractAndProcessEntities,
  processExtractedEntities as processWithIdentity,
} from '../../electron/entityPipeline';
import type { ExtractedEntities } from '../../electron/llm/provider';

const processExtractedEntities = (
  extracted: ExtractedEntities,
  meetingId: string,
) => processWithIdentity(extracted, meetingId);

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
    'retires a prior %s meeting commitment when regeneration replaces the snapshot',
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
      expect(actions[0].id).not.toBe(reviewed.id);
      expect(JSON.parse(actions[0].metadata ?? '{}')).toEqual({
        full_description: 'Send   the rollout note.',
        commitment_state: 'possible',
        origin: 'extraction',
        source_meeting_id: meetingId,
      });
      expect(
        JSON.parse(getEntity(reviewed.id)?.metadata ?? '{}'),
      ).toMatchObject({
        commitment_state: commitmentState,
        meeting_regeneration_retired_at: expect.any(String),
      });
      const associations = getMeetingEntities(meetingId);
      expect(associations).toHaveLength(1);
      expect(associations[0].mention_count).toBe(1);
      expect(replay.created).toBe(1);
      expect(replay.linked).toBe(1);
      expect(
        getActionItemsByStatus('active').map((entity) => entity.id),
      ).not.toContain(reviewed.id);
    },
  );

  it('retires completed commitments from the previous meeting generation', async () => {
    const meetingId = 'meeting-completed-replacement';
    saveMeeting({ id: meetingId, title: 'Completed replacement fixture' });
    const first = await processExtractedEntities(
      extractedAction('Publish the launch memo'),
      meetingId,
    );
    updateActionCommitmentState(first.entities[0].id, 'confirmed');
    updateEntityStatus(first.entities[0].id, 'completed');

    await processExtractedEntities(
      extractedAction('Publish the revised launch memo'),
      meetingId,
    );

    expect(
      getActionItemsByStatus('completed').map((entity) => entity.id),
    ).not.toContain(first.entities[0].id);
    expect(
      JSON.parse(getEntity(first.entities[0].id)?.metadata ?? '{}'),
    ).toMatchObject({ meeting_regeneration_retired_at: expect.any(String) });
  });

  it('retires the previous set when successful regeneration finds no commitments', async () => {
    const meetingId = 'meeting-empty-replacement';
    saveMeeting({ id: meetingId, title: 'Empty replacement fixture' });
    const first = await processExtractedEntities(
      extractedAction('Publish the launch memo'),
      meetingId,
    );

    await processExtractedEntities(
      { ...extractedAction('unused'), action_items: [] },
      meetingId,
    );

    expect(getMeetingEntities(meetingId)).toEqual([]);
    expect(
      JSON.parse(getEntity(first.entities[0].id)?.metadata ?? '{}'),
    ).toMatchObject({ meeting_regeneration_retired_at: expect.any(String) });
  });

  it('does not retire the previous set when regeneration is superseded', async () => {
    const meetingId = 'meeting-failed-replacement';
    saveMeeting({ id: meetingId, title: 'Failed replacement fixture' });
    const first = await processExtractedEntities(
      extractedAction('Publish the launch memo'),
      meetingId,
    );

    await expect(
      extractAndProcessEntities(
        { extractEntities: async () => extractedAction('Late replacement') },
        'Synthetic transcript evidence',
        meetingId,
        undefined,
        { canCommit: () => false },
      ),
    ).rejects.toThrow('entity_extraction_superseded');

    expect(getMeetingEntities(meetingId).map((entity) => entity.id)).toEqual([
      first.entities[0].id,
    ]);
  });

  it('rolls retirement back when the run is superseded during publication', async () => {
    const meetingId = 'meeting-publication-rollback';
    saveMeeting({ id: meetingId, title: 'Publication rollback fixture' });
    const first = await processExtractedEntities(
      extractedAction('Publish the launch memo'),
      meetingId,
    );
    let checks = 0;

    await expect(
      processWithIdentity(
        extractedAction('Publish the replacement memo'),
        meetingId,
        undefined,
        undefined,
        { canCommit: () => ++checks < 3 },
      ),
    ).rejects.toThrow('entity_extraction_superseded');

    expect(getMeetingEntities(meetingId).map((entity) => entity.id)).toEqual([
      first.entities[0].id,
    ]);
    expect(
      JSON.parse(getEntity(first.entities[0].id)?.metadata ?? '{}'),
    ).not.toHaveProperty('meeting_regeneration_retired_at');
  });

  it('preserves manually created commitments when replacing meeting extraction', async () => {
    const meetingId = 'meeting-user-commitment';
    saveMeeting({ id: meetingId, title: 'User commitment fixture' });
    const manual = upsertEntity({
      id: 'manual-meeting-commitment',
      type: 'action_item',
      name: 'Keep my manual commitment',
      status: 'active',
      dedupe_by_name: false,
      metadata: {
        commitment_state: 'confirmed',
        origin: 'user',
        source_meeting_id: meetingId,
      },
    });

    await processExtractedEntities(
      extractedAction('Publish the launch memo'),
      meetingId,
    );
    await processExtractedEntities(
      extractedAction('Publish the replacement memo'),
      meetingId,
    );

    expect(getEntity(manual.id)).toEqual(manual);
    expect(
      getEntitiesByType('action_item').map((entity) => entity.id),
    ).toContain(manual.id);
  });

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

  it('retires the old action while preserving its prior assignee for audit', async () => {
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
      meeting_regeneration_retired_at: expect.any(String),
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
  it('publishes action replacements without a semantic generator', async () => {
    const meetingId = 'meeting-without-semantic-generator';
    saveMeeting({ id: meetingId, title: 'No semantic generator fixture' });

    await expect(
      processWithIdentity(extractedAction('Send note'), meetingId),
    ).resolves.toMatchObject({ created: 1, linked: 1 });
  });

  it('replaces a prior meeting action when regenerated wording changes', async () => {
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

    expect(actions).toHaveLength(1);
    expect(actions.map((action) => action.id)).not.toContain(
      first.entities[0].id,
    );
    expect(replay.updated).toBe(0);
    expect(replay.created).toBe(1);
  });

  it('replaces the action snapshot when meeting summary regeneration runs', async () => {
    const meetingId = 'meeting-summary-change';
    saveMeeting({ id: meetingId, title: 'Quarterly Kickoff' });

    const first = await processWithIdentity(
      extractedAction('Finalize the Q4 launch dates'),
      meetingId,
      { summary: 'First draft summary of the meeting.' },
      undefined,
    );

    const second = await processWithIdentity(
      extractedAction('Finalize the Q4 launch dates'),
      meetingId,
      { summary: 'Updated and rewritten meeting summary.' },
      undefined,
    );

    const actions = getEntitiesByType('action_item').filter((entity) => {
      const metadata = JSON.parse(entity.metadata ?? '{}');
      return metadata.source_meeting_id === meetingId;
    });

    expect(actions).toHaveLength(1);
    expect(second.entities[0].id).not.toBe(first.entities[0].id);
    expect(second.created).toBe(1);
    expect(second.updated).toBe(0);
  });
});
