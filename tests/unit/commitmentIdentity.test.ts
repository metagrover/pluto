import fs from 'node:fs';
import { afterAll, describe, expect, it, vi } from 'vitest';

const directory = vi.hoisted(
  () =>
    `/tmp/pluto-identity-integration-${process.pid}-${Math.random().toString(16).slice(2)}`,
);
vi.mock('electron', () => ({ app: { getPath: () => directory } }));
import * as identity from '../../electron/commitmentIdentity';
import * as db from '../../electron/db';
import { extractAndProcessEntities } from '../../electron/entityPipeline';

afterAll(() => fs.rmSync(directory, { recursive: true, force: true }));

describe('identity publication boundary', () => {
  it('reject stale inferred ownership when the action is edited during inference', async () => {
    db.saveMeeting({
      id: 'edit-race-source',
      title: 'Release',
      transcript_json: JSON.stringify([
        { speaker: 'Speaker 1', text: "I'll send the report." },
      ]),
    });
    db.upsertEntity({
      id: 'edit-race-person',
      type: 'person',
      name: 'Robin',
      dedupe_by_name: false,
    });
    db.identityStore.setBinding('edit-race-source', {
      speaker: 'Speaker 1',
      personId: 'edit-race-person',
      individual: true,
      source: 'user',
      sourceRevision: 'v1',
      evidence: [],
    });
    db.upsertEntity({
      id: 'edit-race-action',
      type: 'action_item',
      name: 'Send report',
      dedupe_by_name: false,
      metadata: { origin: 'extraction', source_meeting_id: 'edit-race-source' },
    });
    const generate = async () => {
      db.upsertEntity({
        id: 'edit-race-action',
        type: 'action_item',
        name: 'Do not send the report',
        metadata: { origin: 'extraction', owner_source: 'user' },
      });
      return JSON.stringify({
        status: 'resolved',
        personId: null,
        speaker: 'Speaker 1',
        ownershipKind: 'first_person',
        evidence: [{ turnId: 't0', quote: "I'll send the report." }],
        identityEvidence: [],
        reason: 'An individual speaker commits.',
      });
    };
    await expect(
      identity.resolveRecordIdentity(
        {
          id: 'edit-race-action',
          text: 'Send report',
          owner: 'Speaker 1',
          due: null,
          meetingId: 'edit-race-source',
          meetingDate: null,
          context: '',
          reviewState: 'possible',
          status: 'active',
        },
        generate,
      ),
    ).rejects.toThrow('identity_revision_stale');
  });
  it('reuses a reviewed obligation through resolved identities in normal extraction', async () => {
    db.saveMeeting({
      id: 'pipeline-identity',
      title: 'Release',
      transcript_json: JSON.stringify([
        { speaker: 'Me', text: "I'll publish the launch checklist." },
      ]),
    });
    db.upsertEntity({
      id: 'pipeline-person',
      type: 'person',
      name: 'Taylor',
      dedupe_by_name: false,
    });
    db.identityStore.setBinding('pipeline-identity', {
      speaker: 'Me',
      personId: 'pipeline-person',
      individual: true,
      source: 'user',
      sourceRevision: 'v1',
      evidence: [],
    });
    db.upsertEntity({
      id: 'reviewed-identity',
      type: 'action_item',
      name: 'Share the launch checklist',
      assigned_to: 'pipeline-person',
      dedupe_by_name: false,
      metadata: {
        origin: 'extraction',
        commitment_state: 'rejected',
        owner_source: 'user',
        source_meeting_id: 'pipeline-identity',
        assignee_name: 'Taylor',
      },
    });
    const before = db.getEntity('reviewed-identity');
    await extractAndProcessEntities(
      {
        extractEntities: async () => ({
          people: [],
          topics: [],
          decisions: [],
          action_items: [
            {
              description: 'Publish the launch checklist',
              assignee: 'Me',
              evidence: "I'll publish the launch checklist.",
            },
          ],
        }),
        synthesizeKnowledgeDocument: async (_prompt, options) =>
          options?.responseSchema?.properties &&
          'status' in (options.responseSchema.properties as object)
            ? JSON.stringify({
                status: 'resolved',
                personId: null,
                speaker: 'Me',
                ownershipKind: 'first_person',
                evidence: [
                  { turnId: 't0', quote: "I'll publish the launch checklist." },
                ],
                identityEvidence: [],
                reason:
                  'The corrected individual speaker committed to this action.',
              })
            : JSON.stringify({
                decisions: [
                  {
                    candidateId: 'c0',
                    decision: 'same',
                    matchId: 'p0',
                    reason: 'Same publishing obligation and occurrence.',
                  },
                ],
              }),
      },
      "Me: I'll publish the launch checklist.",
      'pipeline-identity',
    );
    expect(db.getEntity('reviewed-identity')).toEqual(before);
    expect(
      db
        .getEntitiesByType('action_item')
        .filter(
          (entity) =>
            JSON.parse(entity.metadata ?? '{}').source_meeting_id ===
            'pipeline-identity',
        )
        .map((entity) => entity.id),
    ).toEqual(['reviewed-identity']);
  });
  it('builds meeting-local context without guessing the owner of imported or fallback channels', () => {
    db.saveMeeting({
      id: 'imported-source',
      title: 'Imported source',
      transcript_json: JSON.stringify({
        segments: [{ speaker: 'Me', text: "I'll send it." }],
        speakerAttribution: {
          source: 'channel_fallback',
          confidence: 0,
          mappingApplied: true,
        },
      }),
    });
    expect(identity).toHaveProperty('getMeetingIdentityContext');
    const context = identity.getMeetingIdentityContext('imported-source');
    expect(context.capture).toEqual({ origin: 'unknown', selfPersonId: null });
    expect(context.bindings).toEqual([]);
    expect(context.turns).toEqual([
      { id: 't0', speaker: 'Me', text: "I'll send it." },
    ]);
  });
  it('uses source-backed resolutions and caches them without altering extracted ownership', async () => {
    db.saveMeeting({
      id: 'resolution-source',
      title: 'Release',
      transcript_json: JSON.stringify([
        { speaker: 'Speaker 1', text: "I'll publish the checklist." },
      ]),
    });
    db.upsertEntity({
      id: 'resolution-person',
      type: 'person',
      name: 'Morgan',
      dedupe_by_name: false,
    });
    db.identityStore.setBinding('resolution-source', {
      speaker: 'Speaker 1',
      personId: 'resolution-person',
      individual: true,
      source: 'user',
      sourceRevision: 'v1',
      evidence: [],
    });
    const record = {
      id: 'fresh',
      text: 'Publish checklist',
      owner: 'Wrong extracted name',
      due: null,
      meetingId: 'resolution-source',
      meetingDate: null,
      context: '',
      reviewState: 'possible',
      status: 'active',
    };
    let calls = 0;
    const generate = async () => {
      calls++;
      return JSON.stringify({
        status: 'resolved',
        personId: null,
        speaker: 'Speaker 1',
        ownershipKind: 'first_person',
        evidence: [{ turnId: 't0', quote: "I'll publish the checklist." }],
        identityEvidence: [],
        reason: 'The individual speaker commits to publishing.',
      });
    };
    const result = await identity.resolveRecordIdentity(record, generate);
    expect(result.ownerKey).toBe('person:resolution-person');
    expect(result.owner).toBe('Wrong extracted name');
    await identity.resolveRecordIdentity(record, generate);
    expect(calls).toBe(2);
    db.identityStore.clearBinding('resolution-source', 'Speaker 1');
    expect(
      (await identity.resolveRecordIdentity(record, generate)).ownerKey,
    ).toBeNull();
  });
  it('includes identity corrections in the commitment publication revision', () => {
    expect(db).toHaveProperty('identityStore');
    db.saveMeeting({
      id: 'identity-source',
      title: 'Identity source',
      transcript_json: JSON.stringify([
        { speaker: 'Speaker 1', text: "I'll publish the checklist." },
      ]),
    });
    db.upsertEntity({
      id: 'identity-person',
      type: 'person',
      name: 'Alex',
      dedupe_by_name: false,
    });
    const before = db.getCommitmentQueueRevision();
    db.identityStore.setBinding('identity-source', {
      speaker: 'Speaker 1',
      personId: 'identity-person',
      individual: true,
      source: 'user',
      sourceRevision: 'v1',
      evidence: [],
    });
    expect(db.getCommitmentQueueRevision()).not.toBe(before);
    expect(() => db.commitCommitmentAliases(before, [])).toThrow(
      'commitment_reconciliation_stale',
    );
  });
});
