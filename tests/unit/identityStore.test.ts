import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { createIdentityStore } from '../../electron/identityStore';

const connections: Database.Database[] = [];
function fixture() {
  const sql = new Database(':memory:');
  connections.push(sql);
  sql.exec(`CREATE TABLE entities (id TEXT PRIMARY KEY, type TEXT, name TEXT);
    CREATE TABLE meetings (id TEXT PRIMARY KEY);
    INSERT INTO entities VALUES ('p1','person','Alex'),('p2','person','Alex'),('project','project','Launch');
    INSERT INTO meetings VALUES ('m1'),('m2');`);
  return { sql, store: createIdentityStore(sql) };
}
afterEach(() => {
  for (const sql of connections.splice(0)) sql.close();
});

describe('workspace-local identity persistence', () => {
  it('isolates self identities and preserves capture-time snapshots', () => {
    const a = fixture().store;
    const b = fixture().store;
    a.setSelfPersonId('p1');
    a.recordCapture('future-meeting', 'local');
    a.setSelfPersonId('p2');
    expect(a.getSelfPersonId()).toBe('p2');
    expect(b.getSelfPersonId()).toBeNull();
    expect(a.getCapture('future-meeting')).toEqual({
      origin: 'local',
      selfPersonId: 'p1',
    });
    a.recordCapture('future-meeting', 'local');
    expect(a.getCapture('future-meeting').selfPersonId).toBe('p1');
    expect(a.getCapture('legacy')).toEqual({
      origin: 'unknown',
      selfPersonId: null,
    });
    a.recordCapture('import', 'imported');
    expect(a.getCapture('import').selfPersonId).toBeNull();
  });

  it('rejects non-person references without changing revision or selection', () => {
    const { store } = fixture();
    store.setSelfPersonId('p1');
    const revision = store.getRevision();
    expect(() => store.setSelfPersonId('project')).toThrow(
      'identity_person_invalid',
    );
    expect(() => store.setSelfPersonId('absent')).toThrow(
      'identity_person_invalid',
    );
    expect(store.getRevision()).toBe(revision);
    expect(store.getSelfPersonId()).toBe('p1');
    store.setSelfPersonId(null);
    expect(store.getSelfPersonId()).toBeNull();
  });

  it('persists scoped corrections and automatically queues their meeting', () => {
    const { sql, store } = fixture();
    const binding = {
      speaker: 'Speaker 2',
      personId: 'p2',
      individual: true,
      source: 'user' as const,
      sourceRevision: 'source1',
      evidence: [],
    };
    store.setBinding('m1', binding);
    expect(store.getBindings('m1')).toEqual([binding]);
    expect(store.getBindings('m2')).toEqual([]);
    const resumed = createIdentityStore(sql);
    expect(resumed.getBindings('m1')).toEqual([binding]);
    expect(resumed.nextJob()?.meetingId).toBe('m1');
    store.clearBinding('m1', 'Speaker 2');
    expect(store.getBindings('m1')).toEqual([]);
    expect(store.getStatus('m1')?.state).toBe('pending');
  });

  it('validates correction scope and rolls invalid writes back', () => {
    const { store } = fixture();
    const binding = {
      speaker: 'Them',
      personId: 'project',
      individual: true,
      source: 'user' as const,
      sourceRevision: 'v1',
      evidence: [],
    };
    expect(() => store.setBinding('m1', binding)).toThrow(
      'identity_person_invalid',
    );
    expect(() =>
      store.setBinding('missing', { ...binding, personId: 'p1' }),
    ).toThrow('identity_meeting_invalid');
    expect(() =>
      store.setBinding('m1', { ...binding, personId: 'p1', individual: false }),
    ).toThrow('identity_binding_invalid');
    expect(store.getBindings('m1')).toEqual([]);
  });

  it('caches complete owner decisions by a revision-sensitive fingerprint', () => {
    const { store } = fixture();
    const resolution = {
      status: 'resolved' as const,
      ownerKey: 'person:p1',
      personId: 'p1',
      source: 'binding' as const,
      evidence: [],
      reason: 'Explicit individual speaker correction',
    };
    store.saveResolution('a1', 'fingerprint1', resolution, 'm1');
    expect(store.getResolution('a1', 'fingerprint1')).toEqual(resolution);
    expect(store.getResolution('a1', 'fingerprint2')).toBeNull();
    store.saveResolution(
      'a1',
      'fingerprint2',
      {
        ...resolution,
        status: 'unresolved',
        ownerKey: null,
        personId: null,
        source: 'unresolved',
      },
      'm1',
    );
    expect(store.getResolution('a1', 'fingerprint1')).toEqual(resolution);
  });
});

describe('durable identity rechecks', () => {
  it('coalesces repeated inputs and resumes persisted checkpoints', () => {
    const { sql, store } = fixture();
    store.enqueue('m1', 'v1');
    const job = store.nextJob()!;
    store.checkpointJob(job, 'a1', false);
    store.enqueue('m1', 'v1');
    const resumed = createIdentityStore(sql).nextJob()!;
    expect(resumed.cursor).toBe('a1');
    expect(resumed.revision).toBe(job.revision);
    store.checkpointJob(resumed, 'a2', true);
    store.enqueue('m1', 'v1');
    expect(store.nextJob()).toBeNull();
    expect(store.getStatus('m1')?.state).toBe('complete');
  });

  it('does not let stale completion erase newer work', () => {
    const { store } = fixture();
    store.enqueue('m1', 'old');
    const stale = store.nextJob()!;
    store.enqueue('m1', 'new');
    expect(store.checkpointJob(stale, 'a1', true)).toBe(false);
    const current = store.nextJob()!;
    expect(current.fingerprint).toBe('new');
    expect(current.cursor).toBeNull();
    expect(current.revision).toBeGreaterThan(stale.revision);
  });

  it('bounds retries and permits an explicit retry without discarding progress', () => {
    const { store } = fixture();
    store.enqueue('m1', 'v1');
    let job = store.nextJob(0)!;
    store.checkpointJob(job, 'a1', false);
    for (let attempt = 1; attempt <= 3; attempt++) {
      job = store.nextJob(attempt * 100_000)!;
      store.failJob(job, 'provider_unavailable', attempt * 100_000);
    }
    expect(store.nextJob(1_000_000)).toBeNull();
    expect(store.getStatus('m1')).toMatchObject({
      state: 'failed',
      attempts: 3,
      cursor: 'a1',
      error: 'provider_unavailable',
    });
    store.retryJob('m1');
    expect(store.nextJob()?.cursor).toBe('a1');
  });
});
