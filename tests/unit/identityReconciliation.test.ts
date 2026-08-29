import fs from 'node:fs';
import { afterAll, describe, expect, it, vi } from 'vitest';
const directory = vi.hoisted(
  () =>
    `/tmp/pluto-identity-worker-${process.pid}-${Math.random().toString(16).slice(2)}`,
);
vi.mock('electron', () => ({ app: { getPath: () => directory } }));
import { commitmentRecord } from '../../electron/commitmentReconciliation';
import * as db from '../../electron/db';
import {
  createIdentityReconciler,
  discoverIdentityReconciliation,
} from '../../electron/identityReconciliation';
afterAll(() => fs.rmSync(directory, { recursive: true, force: true }));
const semantic = async () =>
  JSON.stringify({
    decisions: [
      {
        candidateId: 'c0',
        decision: 'same',
        matchId: 'p0',
        reason: 'Same obligation and occurrence.',
      },
    ],
  });
function seed(prefix: string) {
  db.saveMeeting({ id: prefix, title: 'Release' });
  db.upsertEntity({
    id: `${prefix}-person`,
    type: 'person',
    name: prefix,
    dedupe_by_name: false,
  });
  for (const [id, state] of [
    [`${prefix}-a`, 'rejected'],
    [`${prefix}-b`, 'possible'],
  ]) {
    db.upsertEntity({
      id,
      type: 'action_item',
      name: 'Publish the release checklist',
      assigned_to: `${prefix}-person`,
      dedupe_by_name: false,
      metadata: {
        origin: 'extraction',
        owner_source: 'user',
        commitment_state: state,
        source_meeting_id: prefix,
      },
    });
    db.ensureMeetingEntity({ meeting_id: prefix, entity_id: id });
  }
}
async function drain(worker: ReturnType<typeof createIdentityReconciler>) {
  for (let n = 0; n < 300; n++) if (!(await worker.runNext())) return;
  throw new Error('worker_did_not_finish');
}
describe('automatic identity reconciliation', () => {
  it('keeps alias source project evidence separate from presentation projections', () => {
    seed('raw');
    for (const suffix of ['a', 'b']) {
      db.upsertEntity({
        id: `raw-project-${suffix}`,
        type: 'project',
        name: `Launch ${suffix}`,
        dedupe_by_name: false,
      });
      db.linkEntities({
        source_entity_id: `raw-${suffix}`,
        target_entity_id: `raw-project-${suffix}`,
        relationship: 'relates_to',
      });
    }
    db.commitCommitmentAliases(db.getCommitmentQueueRevision(), [
      {
        extractionId: 'raw-b',
        canonicalId: 'raw-a',
        meetingId: 'raw',
        description: 'Publish checklist',
        reason: 'Prior decision',
      },
    ]);
    expect(commitmentRecord(db.getEntity('raw-b')!).context).toContain(
      'Projects: Launch b',
    );
    expect(commitmentRecord(db.getEntity('raw-b')!).context).not.toContain(
      'Launch a',
    );
    expect(commitmentRecord(db.getEntity('raw-a')!).context).not.toContain(
      'Launch b',
    );
  });
  it('discovers legacy pending work once, checkpoints, and preserves rejected canonical state', async () => {
    seed('auto');
    const before = db.getEntity('auto-a');
    discoverIdentityReconciliation();
    const worker = createIdentityReconciler({ generate: semantic });
    expect(await worker.runNext()).toBe(true);
    const cursor = db.identityStore.getStatus('auto')?.cursor;
    expect(cursor).toBeTruthy();
    discoverIdentityReconciliation();
    expect(db.identityStore.getStatus('auto')?.cursor).toBe(cursor);
    await drain(createIdentityReconciler({ generate: semantic }));
    expect(db.isRetiredCommitment('auto-b')).toBe(true);
    expect(db.getEntity('auto-a')).toEqual(before);
    discoverIdentityReconciliation();
    expect(db.identityStore.getStatus('auto')?.state).toBe('complete');
  });
  it('automatically restores an alias when owner evidence is revoked, without editing the canonical', async () => {
    seed('revoke');
    discoverIdentityReconciliation();
    await drain(createIdentityReconciler({ generate: semantic }));
    expect(db.isRetiredCommitment('revoke-b')).toBe(true);
    const canonical = db.getEntity('revoke-a');
    db.correctActionOwner('revoke-b', null);
    discoverIdentityReconciliation();
    await drain(createIdentityReconciler({ generate: semantic }));
    expect(db.isRetiredCommitment('revoke-b')).toBe(false);
    expect(db.wasCommitmentRestored('revoke-b')).toBe(true);
    expect(db.getEntity('revoke-a')).toEqual(canonical);
    expect(db.getEntity('revoke-b')?.assigned_to).toBeNull();
  });
  it('pauses before claiming work and resumes after a cancellation without spending retries', async () => {
    seed('pause');
    discoverIdentityReconciliation();
    let paused = true;
    const controller = new AbortController();
    const worker = createIdentityReconciler({
      generate: async () => {
        controller.abort();
        throw new Error('cancelled');
      },
      isPaused: () => paused,
    });
    expect(await worker.runNext()).toBe(false);
    expect(db.identityStore.getStatus('pause')?.state).toBe('pending');
    paused = false;
    for (let n = 0; n < 100 && !controller.signal.aborted; n++)
      await worker.runNext(controller.signal);
    expect(controller.signal.aborted).toBe(true);
    expect(db.identityStore.getStatus('pause')?.attempts).toBe(0);
    await drain(createIdentityReconciler({ generate: semantic }));
    expect(db.identityStore.getStatus('pause')?.state).toBe('complete');
  });
  it('rechecks aliases after deadline and project-scope edits', async () => {
    seed('scope');
    discoverIdentityReconciliation();
    await drain(createIdentityReconciler({ generate: semantic }));
    expect(db.isRetiredCommitment('scope-b')).toBe(true);
    db.upsertEntity({
      id: 'scope-a',
      type: 'action_item',
      name: 'Publish the release checklist',
      due_date: '2026-10-01',
    });
    discoverIdentityReconciliation();
    const distinct = vi.fn(async () =>
      JSON.stringify({
        decisions: [
          {
            candidateId: 'c0',
            decision: 'distinct',
            matchId: null,
            reason: 'Different occurrence deadline.',
          },
        ],
      }),
    );
    await drain(createIdentityReconciler({ generate: distinct }));
    expect(db.isRetiredCommitment('scope-b')).toBe(false);
    expect(distinct).toHaveBeenCalled();
    const before = db.identityStore.getStatus('scope')?.revision;
    const project = db.upsertEntity({
      id: 'scope-project',
      type: 'project',
      name: 'Different launch',
    });
    db.linkEntities({
      source_entity_id: 'scope-b',
      target_entity_id: project.id,
      relationship: 'relates_to',
    });
    discoverIdentityReconciliation();
    expect(db.identityStore.getStatus('scope')?.revision).toBeGreaterThan(
      before!,
    );
  });
  it('does not publish a stale comparison after a user edit during inference', async () => {
    seed('race');
    discoverIdentityReconciliation();
    let edited = false;
    const worker = createIdentityReconciler({
      generate: async () => {
        edited = true;
        db.correctActionOwner('race-b', null);
        return semantic();
      },
    });
    for (let n = 0; n < 200 && !edited; n++) await worker.runNext();
    expect(edited).toBe(true);
    expect(db.isRetiredCommitment('race-b')).toBe(false);
    discoverIdentityReconciliation();
    await drain(createIdentityReconciler({ generate: semantic }));
    expect(db.isRetiredCommitment('race-b')).toBe(false);
  });
});
