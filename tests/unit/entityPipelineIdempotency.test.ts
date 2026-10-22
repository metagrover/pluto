import fs from 'node:fs';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { isPersonalAction } from '../../src/utils/actionCommitment';

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
  requireSavedMeetingActions,
} from '../../electron/entityPipeline';
import type { ExtractedEntities } from '../../electron/llm/provider';

const processExtractedEntities = (
  extracted: ExtractedEntities,
  meetingId: string,
) => processWithIdentity(extracted, meetingId);

afterAll(() => {
  fs.rmSync(testDatabase.directory, { recursive: true, force: true });
});

it('requires saved task classification at legacy extraction entry points', () => {
  expect(
    requireSavedMeetingActions({
      analysis_json: '{"all_action_items":[{"text":"Removed task"}]}',
      user_edits_json:
        '{"all_action_items:0":{"original":"Removed task","edited":"","edited_at":"2026-10-14T12:00:00Z"}}',
    } as any),
  ).toEqual([]);
  expect(
    requireSavedMeetingActions({
      analysis_json: JSON.stringify({
        all_action_items: [{ text: 'Old wording' }],
      }),
      user_edits_json: JSON.stringify({
        'all_action_items:0': {
          original: 'Old wording',
          edited: 'Reviewed wording',
          edited_at: '2026-10-18T12:00:00Z',
        },
      }),
    } as any)?.[0].description,
  ).toBe('Reviewed wording');
  expect(() => requireSavedMeetingActions(undefined)).toThrow(
    'meeting_action_classification_unavailable',
  );
  expect(() =>
    requireSavedMeetingActions({
      analysis_format_pass: false,
      analysis_json: '{"all_action_items":[{"text":"Invented task"}]}',
    } as any),
  ).toThrow('meeting_action_classification_unavailable');
  expect(
    requireSavedMeetingActions({
      analysis_json: '{"all_action_items":[]}',
    } as any),
  ).toEqual([]);
  expect(
    requireSavedMeetingActions({
      analysis_format_pass: true,
      analysis_json:
        '{"all_action_items":[{"text":"Send the checklist","assignee":"Me","evidence":"I will send the checklist"}]}',
    } as any),
  ).toEqual([
    {
      description: 'Send the checklist',
      assignee: 'Me',
      evidence: 'I will send the checklist',
      due_date: undefined,
    },
  ]);
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
  it('resolves explicit project relationships against preserved canonical actions', async () => {
    const meetingId = 'secondary-project-link';
    const task = 'Send the review checklist';
    const quote = 'Send the review checklist for Project Atlas.';
    saveMeeting({ id: meetingId, title: 'Project relationship fixture' });
    const first = await processWithIdentity(extractedAction(task), meetingId);
    const action = updateActionCommitmentState(
      first.entities[0].id,
      'confirmed',
    );
    updateEntityStatus(action.id, 'completed');
    const before = getEntity(action.id)!;
    const project = upsertEntity({
      id: 'secondary-project-atlas',
      type: 'project',
      name: 'Project Atlas',
      metadata: {
        projectQualification: {
          version: 1,
          state: 'qualified',
          source: 'user',
          reason: 'Confirmed fictional project',
          assessedAt: '2026-10-18T12:00:00Z',
        },
      },
    });
    const replay = await processWithIdentity(
      {
        ...extractedAction('Ignored secondary task'),
        relationships: [
          {
            source: task,
            target: project.name,
            relationship: 'belongs_to',
            context: quote,
          },
        ],
      },
      meetingId,
      undefined,
      quote,
      { preserveMeetingActions: true },
    );
    expect(replay.created).toBe(0);
    expect(replay.entities.map((entity) => entity.id)).toContain(action.id);
    expect(getEntityLinks(action.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source_entity_id: action.id,
          target_entity_id: project.id,
          relationship: 'belongs_to',
        }),
      ]),
    );
    expect(getEntity(action.id)).toEqual(before);
  });

  it.each(['confirmed', 'rejected', 'completed'] as const)(
    'preserves %s tasks and user edits during secondary entity extraction',
    async (state) => {
      const meetingId = `secondary-preservation-${state}`;
      const original = 'Send the checklist';
      const edited = 'Send the reviewed checklist';
      saveMeeting({
        id: meetingId,
        title: 'Secondary extraction fixture',
        analysis_format_pass: true,
        analysis_json: JSON.stringify({
          all_action_items: [{ text: original, assignee: 'Me' }],
        }),
      });
      const first = await processWithIdentity(
        extractedAction(original),
        meetingId,
      );
      const id = first.entities[0].id;
      updateActionCommitmentState(
        id,
        state === 'rejected' ? 'rejected' : 'confirmed',
      );
      if (state === 'completed') updateEntityStatus(id, 'completed');
      const before = getEntity(id)!;
      upsertEntity({
        ...before,
        assigned_to: 'confirmed-owner',
        metadata: { ...JSON.parse(before.metadata!), owner_source: 'user' },
      });
      saveMeeting({
        id: meetingId,
        title: 'Secondary extraction fixture',
        user_edits_json: JSON.stringify({
          'all_action_items:0': {
            original,
            edited,
            edited_at: '2026-10-18T12:00:00Z',
          },
          ...(state === 'completed'
            ? {
                'completion:all_action_items:0': {
                  original: 'false',
                  edited: 'true',
                },
              }
            : {}),
        }),
      });
      const result = await extractAndProcessEntities(
        { extractEntities: async () => extractedAction(original) },
        'A fictional transcript.',
        meetingId,
        undefined,
        { preserveMeetingActions: true },
      );
      expect(result.created).toBe(0);
      const actions = getMeetingEntities(meetingId).filter(
        (entity) => entity.type === 'action_item',
      );
      expect(actions.map((entity) => entity.id)).toEqual([id]);
      expect(getEntity(id)).toMatchObject({
        assigned_to: 'confirmed-owner',
        status: state === 'completed' ? 'completed' : 'active',
      });
      expect(JSON.parse(getEntity(id)!.metadata!)).toMatchObject({
        full_description: edited,
        owner_source: 'user',
        commitment_state: state === 'rejected' ? 'rejected' : 'confirmed',
      });
      expect(
        JSON.parse(getEntity(id)!.metadata!).meeting_regeneration_retired_at,
      ).toBeUndefined();
    },
  );

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
    'preserves a prior %s user decision when the source operation is unchanged',
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
      expect(JSON.parse(actions[0].metadata ?? '{}')).toMatchObject({
        full_description: 'Send   the rollout note.',
        commitment_state: commitmentState,
        origin: 'extraction',
        source_meeting_id: meetingId,
      });
      expect(
        JSON.parse(getEntity(reviewed.id)?.metadata ?? '{}'),
      ).toMatchObject({
        commitment_state: commitmentState,
      });
      const associations = getMeetingEntities(meetingId);
      expect(associations).toHaveLength(1);
      expect(associations[0].mention_count).toBe(1);
      expect(replay.created).toBe(0);
      expect(replay.updated).toBe(1);
      expect(replay.linked).toBe(0);
      expect(JSON.parse(getEntity(reviewed.id)!.metadata!)).not.toHaveProperty(
        'meeting_regeneration_retired_at',
      );
    },
  );

  it('preserves completed user history when regeneration rephrases the source operation', async () => {
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
    ).toContain(first.entities[0].id);
    expect(
      JSON.parse(getEntity(first.entities[0].id)?.metadata ?? '{}'),
    ).not.toHaveProperty('meeting_regeneration_retired_at');
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

it('marks only exact actions from the saved contextual review as eligible extraction', async () => {
  const meetingId = 'semantic-classification-source';
  const task = {
    text: 'Send the launch checklist',
    assignee: 'Me',
    evidence: 'I will send the launch checklist.',
  };
  saveMeeting({
    id: meetingId,
    title: 'Source review',
    analysis_json: JSON.stringify({
      all_action_items: [task],
      generation_metadata: {
        pipeline_version: 'writer-audit-v1',
        source_action_review_version: 1,
      },
    }),
  });
  const extracted = {
    ...extractedAction(task.text),
    action_items: [
      {
        description: task.text,
        assignee: task.assignee,
        evidence: task.evidence,
      },
    ],
  };
  const result = await processExtractedEntities(extracted, meetingId);
  const item = result.entities.find((entity) => entity.type === 'action_item')!;
  expect(JSON.parse(item.metadata!)).toMatchObject({
    source_action_review_version: 1,
    commitment_state: 'possible',
  });
  const mismatched = await processExtractedEntities(
    {
      ...extracted,
      action_items: [
        {
          ...extracted.action_items[0]!,
          description: 'Invented checklist task',
        },
      ],
    },
    meetingId,
  );
  expect(
    JSON.parse(
      mismatched.entities.find((entity) => entity.type === 'action_item')!
        .metadata!,
    ),
  ).not.toHaveProperty('source_action_review_version');
});

it.each(['direct', 'legacy'] as const)(
  'requires review when regeneration encounters %s completed source history',
  async (kind) => {
    const meetingId = `protected-source-${kind}`;
    saveMeeting({
      id: meetingId,
      title: 'Protected source',
      analysis_json: JSON.stringify({
        all_action_items: [
          {
            text: 'Email the status report',
            assignee: 'Me',
            evidence: 'I will email the status report.',
          },
        ],
        generation_metadata: {
          pipeline_version: 'writer-audit-v1',
          source_action_review_version: 1,
        },
      }),
    });
    upsertEntity({
      id: `closed-source-${kind}`,
      type: 'action_item',
      name: 'Send the report',
      status: 'completed',
      dedupe_by_name: false,
      metadata: {
        commitment_state: 'confirmed',
        ...(kind === 'legacy'
          ? { dreamingSources: [{ meetingIds: [meetingId] }] }
          : { origin: 'extraction', source_meeting_id: meetingId }),
      },
    });
    const result = await processExtractedEntities(
      {
        ...extractedAction('Email the status report'),
        action_items: [
          {
            description: 'Email the status report',
            assignee: 'Me',
            evidence: 'I will email the status report.',
          },
        ],
      },
      meetingId,
    );
    const current = result.entities.find(
      (entity) => entity.type === 'action_item',
    )!;
    expect(JSON.parse(current.metadata!)).toMatchObject({
      source_action_review_version: 1,
      source_regeneration_review_required: true,
    });
    expect(isPersonalAction(current, { selfPersonId: 'self' })).toBe(false);
    expect(getEntity(`closed-source-${kind}`)?.status).toBe('completed');
    expect(
      isPersonalAction(updateActionCommitmentState(current.id, 'confirmed'), {
        selfPersonId: 'self',
      }),
    ).toBe(true);
  },
);

it('preserves an adopted open task when regeneration rephrases or omits it', async () => {
  const meetingId = 'adopted-open-source-continuity';
  saveMeeting({ id: meetingId, title: 'Open task continuity' });
  const first = await processExtractedEntities(
    extractedAction('Send the rollout note'),
    meetingId,
  );
  const id = first.entities[0]!.id;
  updateActionCommitmentState(id, 'confirmed');
  for (const replacement of [
    extractedAction('Send the revised rollout note'),
    { ...extractedAction('unused'), action_items: [] },
  ]) {
    await processExtractedEntities(replacement, meetingId);
    expect(getEntity(id)).toMatchObject({ status: 'active' });
    expect(JSON.parse(getEntity(id)!.metadata!)).toMatchObject({
      commitment_state: 'confirmed',
    });
    expect(JSON.parse(getEntity(id)!.metadata!)).not.toHaveProperty(
      'meeting_regeneration_retired_at',
    );
    expect(
      getActionItemsByStatus('active').map((entity) => entity.id),
    ).toContain(id);
  }
});
it('preserves explicit ownership and a user deadline when reusing a reviewed source task', async () => {
  const meetingId = 'explicit-owner-source-continuity';
  saveMeeting({ id: meetingId, title: 'Owned task continuity' });
  const task = upsertEntity({
    id: 'user-owned-source-task',
    type: 'action_item',
    name: 'Send the rollout note',
    status: 'active',
    due_date: '2026-10-20',
    dedupe_by_name: false,
    metadata: {
      origin: 'extraction',
      owner_source: 'user',
      source_meeting_id: meetingId,
      original_description: 'Send the rollout note',
    },
  });
  const result = await processExtractedEntities(
    extractedAction('Send the rollout note'),
    meetingId,
  );
  expect(
    result.entities.find((entity) => entity.type === 'action_item')?.id,
  ).toBe(task.id);
  expect(getEntity(task.id)).toMatchObject({
    status: 'active',
    due_date: '2026-10-20',
  });
  expect(JSON.parse(getEntity(task.id)!.metadata!)).not.toHaveProperty(
    'meeting_regeneration_retired_at',
  );
});

it.each([
  ['Friday, May 15', '2026-05-15'],
  ['Friday, May 15 after approval', null],
] as const)(
  'persists a source calendar deadline safely: %s',
  async (due, expected) => {
    const meetingId = `source-calendar-${expected ?? 'qualified'}`;
    saveMeeting({
      id: meetingId,
      title: 'Museum planning',
      started_at: '2026-05-11T12:00:00-07:00',
    });
    const result = await processExtractedEntities(
      {
        ...extractedAction('Send the museum programme'),
        action_items: [
          {
            description: 'Send the museum programme',
            evidence: `I will send the museum programme by ${due}.`,
            due_date: due,
          },
        ],
      },
      meetingId,
    );
    expect(
      result.entities.find((entity) => entity.type === 'action_item')?.due_date,
    ).toBe(expected);
  },
);
