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
  processExtractedEntities,
} from '../../electron/entityPipeline';
import type { ExtractedEntities } from '../../electron/llm/provider';

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
        extractedAction(' send the rollout note '),
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

  it('does not adopt a changed assignee when replaying a preserved action', async () => {
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
    expect(
      getEntitiesByType('person').map((person) => person.name),
    ).not.toContain('Taylor');
  });
});
