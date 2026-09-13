import fs from 'node:fs';
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

const directory = vi.hoisted(() => {
  const filesystem = require('node:fs') as typeof import('node:fs');
  return filesystem.mkdtempSync('/tmp/pluto-identity-shipping-');
});
vi.mock('electron', () => ({ app: { getPath: () => directory } }));
import { getMeetingIdentityContext } from '../../electron/commitmentIdentity';
import type { SemanticGenerate } from '../../electron/commitmentSemanticReview';
import * as db from '../../electron/db';
import { processExtractedEntities } from '../../electron/entityPipeline';
import { handleIdentityRequest } from '../../electron/identityHandlers';
import { startIdentityReconciliation } from '../../electron/identityReconciliation';

const same = () =>
  JSON.stringify({
    decisions: [
      {
        candidateId: 'c0',
        decision: 'same',
        matchId: 'p0',
        reason: 'Same explicitly owned obligation.',
      },
    ],
  });
let stop: (() => void) | undefined;
let sequence = 0;
let meetingId = '';
let personId = '';
let canonicalId = '';
let candidateId = '';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-28T12:00:00Z'));
  sequence++;
  meetingId = `shipping-${sequence}`;
  personId = `${meetingId}-person`;
  canonicalId = `${meetingId}-a`;
  candidateId = `${meetingId}-b`;
  db.saveMeeting({
    id: meetingId,
    title: 'Release review',
    transcript_json: JSON.stringify([
      { speaker: 'Speaker 1', text: 'I will publish the release checklist.' },
    ]),
  });
  db.upsertEntity({
    id: personId,
    type: 'person',
    name: 'Casey',
    dedupe_by_name: false,
  });
  for (const [id, state] of [
    [canonicalId, 'rejected'],
    [candidateId, 'possible'],
  ]) {
    db.upsertEntity({
      id,
      type: 'action_item',
      name: 'Publish the release checklist',
      assigned_to: personId,
      dedupe_by_name: false,
      metadata: {
        origin: 'extraction',
        owner_source: 'user',
        commitment_state: state,
        source_meeting_id: meetingId,
      },
    });
    db.ensureMeetingEntity({ meeting_id: meetingId, entity_id: id });
  }
});

afterEach(async () => {
  stop?.();
  stop = undefined;
  await vi.advanceTimersByTimeAsync(0);
  vi.restoreAllMocks();
  vi.useRealTimers();
  db.deleteMeeting(meetingId);
});
afterAll(() => fs.rmSync(directory, { recursive: true, force: true }));

const launch = (
  generate: SemanticGenerate,
  pauseReasons: () => Record<string, number> = () => ({}),
) => {
  stop = startIdentityReconciliation({ generate, pauseReasons });
};

describe('identity shipping lifecycle coverage', () => {
  it('builds capture-backed identity only from the immutable self snapshot and reliable acoustic attribution', () => {
    db.identityStore.setSelfPersonId(personId);
    db.identityStore.recordCapture(meetingId, 'local');
    db.identityStore.setSelfPersonId(null);
    db.saveMeeting({
      id: meetingId,
      title: 'Local source',
      transcript_json: JSON.stringify({
        segments: [
          { speaker: 'Me', text: 'I will publish the release checklist.' },
        ],
        speakerAttribution: {
          source: 'local_diarization_acoustic',
          mappingApplied: true,
          confidence: 0.9,
        },
      }),
    });
    const context = getMeetingIdentityContext(meetingId);
    expect(context.bindings).toEqual([
      expect.objectContaining({
        speaker: 'Me',
        personId,
        source: 'capture',
        captureEvidence: expect.objectContaining({
          selfPersonId: personId,
          sourceRevision: context.sourceRevision,
        }),
      }),
    ]);
  });

  it('does not generate a self binding for imported capture even with acoustic metadata', () => {
    db.identityStore.setSelfPersonId(personId);
    db.identityStore.recordCapture(meetingId, 'imported');
    db.saveMeeting({
      id: meetingId,
      title: 'Imported source',
      transcript_json: JSON.stringify({
        segments: [
          { speaker: 'Me', text: 'I will publish the release checklist.' },
        ],
        speakerAttribution: {
          source: 'local_diarization_acoustic',
          mappingApplied: true,
          confidence: 0.95,
        },
      }),
    });
    expect(getMeetingIdentityContext(meetingId).bindings).toEqual([]);
  });

  it('generates a user-backed self binding for historical capture with unknown origin', () => {
    db.identityStore.setSelfPersonId(personId);
    db.identityStore.recordCapture(meetingId, 'unknown');
    db.saveMeeting({
      id: meetingId,
      title: 'Historical source',
      transcript_json: JSON.stringify({
        segments: [
          { speaker: 'Me', text: 'I will publish the release checklist.' },
        ],
        speakerAttribution: {
          source: 'local_diarization_acoustic',
          mappingApplied: true,
          confidence: 0.95,
        },
      }),
    });

    const context = getMeetingIdentityContext(meetingId);
    expect(context.bindings).toEqual([
      expect.objectContaining({
        speaker: 'Me',
        personId,
        individual: true,
        source: 'user',
      }),
    ]);
    expect(context.bindings[0]).not.toHaveProperty('captureEvidence');
  });

  it('lets a user correction override otherwise reliable capture attribution', () => {
    db.identityStore.setSelfPersonId(personId);
    db.identityStore.recordCapture(meetingId, 'local');
    db.saveMeeting({
      id: meetingId,
      title: 'Shared microphone',
      transcript_json: JSON.stringify({
        segments: [
          { speaker: 'Me', text: 'I will publish the release checklist.' },
        ],
        speakerAttribution: {
          source: 'local_diarization_acoustic',
          mappingApplied: true,
          confidence: 0.9,
        },
      }),
    });
    handleIdentityRequest('SET_MEETING_IDENTITY_BINDING', {
      meetingId,
      speaker: 'Me',
      personId: null,
      individual: true,
      expectedRevision: db.identityStore.getRevision(),
    });
    expect(getMeetingIdentityContext(meetingId).bindings).toEqual([
      expect.objectContaining({
        speaker: 'Me',
        personId: null,
        source: 'user',
      }),
    ]);
  });

  it('discovers and completes persisted pending suggestions without manual worker calls', async () => {
    const canonical = db.getEntity(canonicalId);
    const generate = vi.fn(async () => same());
    launch(generate);
    await vi.advanceTimersByTimeAsync(2000);
    expect(db.isRetiredCommitment(candidateId)).toBe(true);
    expect(db.getEntity(canonicalId)).toEqual(canonical);
    expect(db.identityStore.getStatus(meetingId)?.state).toBe('complete');
    expect(generate).toHaveBeenCalled();
  });

  it('does not infer while capture is paused and automatically resumes afterward', async () => {
    let paused = true;
    const generate = vi.fn(async () => same());
    const discovery = vi.spyOn(db, 'getIdentityReconciliationInputs');
    launch(generate, () => ({ capture: paused ? 1 : 0 }));
    await vi.advanceTimersByTimeAsync(1000);
    expect(generate).not.toHaveBeenCalled();
    expect(db.identityStore.getStatus(meetingId)).toBeNull();
    expect(discovery).not.toHaveBeenCalled();
    paused = false;
    await vi.advanceTimersByTimeAsync(2000);
    expect(db.isRetiredCommitment(candidateId)).toBe(true);
    expect(discovery).toHaveBeenCalled();
  });

  it('does not reload complete source inputs while discovery revisions remain unchanged', async () => {
    const discovery = vi.spyOn(db, 'getIdentityReconciliationInputs');
    launch(async () => same());
    await vi.advanceTimersByTimeAsync(10_000);
    const completedReads = discovery.mock.calls.length;
    expect(completedReads).toBeGreaterThan(0);
    expect(db.identityStore.getStatus(meetingId)?.state).toBe('complete');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(discovery).toHaveBeenCalledTimes(completedReads);
    db.saveMeeting({ id: meetingId, title: 'Changed source title' });
    await vi.advanceTimersByTimeAsync(6000);
    expect(discovery.mock.calls.length).toBeGreaterThan(completedReads);
  });

  it('notifies its caller after automatic publication so the renderer can refresh', async () => {
    const onChange = vi.fn();
    stop = startIdentityReconciliation({
      generate: async () => same(),
      pauseReasons: () => ({}),
      onChange,
    });
    await vi.advanceTimersByTimeAsync(2000);
    expect(db.isRetiredCommitment(candidateId)).toBe(true);
    expect(onChange).toHaveBeenCalled();
  });

  it('aborts an active inference when foreground capture begins without consuming retries', async () => {
    let capture = 0;
    let observed: AbortSignal | undefined;
    const generate: SemanticGenerate = (_prompt, _schema, signal) => {
      observed = signal;
      return new Promise((_resolve, reject) =>
        signal?.addEventListener(
          'abort',
          () => reject(new Error('cancelled')),
          { once: true },
        ),
      );
    };
    launch(generate, () => ({ capture }));
    await vi.advanceTimersByTimeAsync(1000);
    expect(observed).toBeDefined();
    capture = 1;
    await vi.advanceTimersByTimeAsync(250);
    expect(observed?.aborted).toBe(true);
    expect(db.identityStore.getStatus(meetingId)).toMatchObject({
      state: 'pending',
      attempts: 0,
    });
    expect(db.isRetiredCommitment(candidateId)).toBe(false);
  });

  it('does not abort its own active generation solely because llm_active is paused', async () => {
    let llm = 0;
    let observed: AbortSignal | undefined;
    let finish!: (value: string) => void;
    const generate = vi
      .fn<SemanticGenerate>()
      .mockImplementationOnce((_prompt, _schema, signal) => {
        observed = signal;
        llm = 1;
        return new Promise((resolve, reject) => {
          finish = resolve;
          signal?.addEventListener(
            'abort',
            () => reject(new Error('cancelled')),
            { once: true },
          );
        });
      })
      .mockResolvedValue(same());
    launch(generate, () => ({ llm_active: llm }));
    await vi.advanceTimersByTimeAsync(1000);
    expect(observed?.aborted).toBe(false);
    llm = 0;
    finish(same());
    await vi.advanceTimersByTimeAsync(1000);
    expect(db.isRetiredCommitment(candidateId)).toBe(true);
  });

  it('aborts on shutdown, keeps its checkpoint, and never runs again after stopping', async () => {
    let observed: AbortSignal | undefined;
    const generate = vi.fn<SemanticGenerate>((_prompt, _schema, signal) => {
      observed = signal;
      return new Promise((_resolve, reject) =>
        signal?.addEventListener(
          'abort',
          () => reject(new Error('cancelled')),
          { once: true },
        ),
      );
    });
    launch(generate);
    await vi.advanceTimersByTimeAsync(1000);
    const cursor = db.identityStore.getStatus(meetingId)?.cursor;
    stop?.();
    stop = undefined;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(observed?.aborted).toBe(true);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(db.identityStore.getStatus(meetingId)).toMatchObject({
      cursor,
      attempts: 0,
      state: 'pending',
    });
  });

  it('retries transient generation failure automatically and preserves canonical review state', async () => {
    const before = db.getEntity(canonicalId);
    const generate = vi
      .fn<SemanticGenerate>()
      .mockRejectedValueOnce(new Error('provider unavailable'))
      .mockResolvedValue(same());
    launch(generate);
    await vi.advanceTimersByTimeAsync(2000);
    expect(db.identityStore.getStatus(meetingId)).toMatchObject({
      state: 'pending',
      attempts: 1,
      error: 'provider unavailable',
    });
    expect(db.isRetiredCommitment(candidateId)).toBe(false);
    await vi.advanceTimersByTimeAsync(6000);
    expect(db.identityStore.getStatus(meetingId)?.state).toBe('complete');
    expect(db.isRetiredCommitment(candidateId)).toBe(true);
    expect(db.getEntity(canonicalId)).toEqual(before);
  });

  it('stops after three failures and resumes through the actual retry IPC service', async () => {
    const generate = vi
      .fn<SemanticGenerate>()
      .mockRejectedValue(new Error('provider unavailable'));
    launch(generate);
    await vi.advanceTimersByTimeAsync(40_000);
    expect(generate).toHaveBeenCalledTimes(3);
    expect(db.identityStore.getStatus(meetingId)).toMatchObject({
      state: 'failed',
      attempts: 3,
    });
    generate.mockResolvedValue(same());
    handleIdentityRequest('RETRY_IDENTITY_RECONCILIATION', { meetingId });
    await vi.advanceTimersByTimeAsync(2000);
    expect(db.identityStore.getStatus(meetingId)?.state).toBe('complete');
    expect(db.isRetiredCommitment(candidateId)).toBe(true);
  });

  it('discovers a later source change after completion without a manual enqueue', async () => {
    const generate = vi.fn(async () => same());
    launch(generate);
    await vi.advanceTimersByTimeAsync(2000);
    expect(db.isRetiredCommitment(candidateId)).toBe(true);
    db.correctActionOwner(candidateId, null);
    await vi.advanceTimersByTimeAsync(7000);
    expect(db.isRetiredCommitment(candidateId)).toBe(false);
    expect(db.wasCommitmentRestored(candidateId)).toBe(true);
  });

  it('recovers from one discovery read failure at the next timer tick', async () => {
    vi.spyOn(db, 'getIdentityReconciliationInputs').mockImplementationOnce(
      () => {
        throw new Error('temporarily unavailable');
      },
    );
    launch(async () => same());
    await vi.advanceTimersByTimeAsync(2500);
    expect(db.isRetiredCommitment(candidateId)).toBe(true);
  });

  it('publishes a fresh commitment set after its speaker identity is corrected', async () => {
    db.deleteEntity(candidateId);
    const speaker = 'Speaker 1';
    handleIdentityRequest('SET_MEETING_IDENTITY_BINDING', {
      meetingId,
      speaker,
      personId,
      individual: true,
      expectedRevision: db.identityStore.getRevision(),
    });
    const generate = vi.fn<SemanticGenerate>();
    const extracted = {
      people: [],
      topics: [],
      projects: [],
      decisions: [],
      relationships: [],
      action_items: [
        {
          description: 'Publish the release checklist',
          assignee: speaker,
          evidence: 'I will publish the release checklist.',
        },
      ],
    };
    const first = await processExtractedEntities(
      extracted,
      meetingId,
      undefined,
      undefined,
      { generate },
    );
    const firstAction = first.entities.find(
      (entity) => entity.type === 'action_item',
    );
    expect(firstAction?.id).toBeDefined();
    expect(firstAction?.id).not.toBe(canonicalId);
    expect(db.isRetiredCommitment(canonicalId)).toBe(true);
    const other = db.upsertEntity({
      type: 'person',
      name: 'Drew',
      dedupe_by_name: false,
    });
    handleIdentityRequest('SET_MEETING_IDENTITY_BINDING', {
      meetingId,
      speaker,
      personId: other.id,
      individual: true,
      expectedRevision: db.identityStore.getRevision(),
    });
    const second = await processExtractedEntities(
      extracted,
      meetingId,
      undefined,
      undefined,
      { generate },
    );
    const secondAction = second.entities.find(
      (entity) => entity.type === 'action_item',
    );
    expect(secondAction?.id).toBeDefined();
    expect(secondAction?.id).not.toBe(firstAction?.id);
    expect(db.isRetiredCommitment(firstAction?.id ?? '')).toBe(true);
    expect(db.getEntity(canonicalId)?.assigned_to).toBe(personId);
    expect(generate).not.toHaveBeenCalled();
  });
});
