import fs from 'node:fs';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const directory = vi.hoisted(() => {
  const filesystem = require('node:fs') as typeof import('node:fs');
  return filesystem.mkdtempSync('/tmp/pluto-live-speaker-identity-');
});
vi.mock('electron', () => ({ app: { getPath: () => directory } }));

import * as db from '../../electron/db';
import {
  LIVE_VOICE_CONFIRMED_ASSIGNMENT,
  persistLiveSpeakerIdentityConfirmation,
  reconcileLiveSpeakerIdentityConfirmations,
  removeLiveSpeakerIdentityConfirmation,
} from '../../electron/liveSpeakerIdentityPersistence';

afterAll(() => fs.rmSync(directory, { recursive: true, force: true }));

describe('live speaker identity confirmation persistence', () => {
  let fixture = 0;
  let meetingId: string;
  let personId: string;

  beforeEach(() => {
    fixture += 1;
    meetingId = `live-speaker-meeting-${fixture}`;
    personId = `live-speaker-person-${fixture}`;
    db.saveMeeting({
      id: meetingId,
      title: 'Live speaker identity test',
      transcript_json: JSON.stringify([
        {
          speaker: 'Remote Speaker 1',
          text: 'Synthetic remote sentence.',
          startTime: 10,
          endTime: 14,
        },
      ]),
    });
    db.upsertEntity({
      id: personId,
      type: 'person',
      name: 'Ada',
      dedupe_by_name: false,
    });
  });

  it('turns a persisted confirmation into an explicit final binding', () => {
    persistLiveSpeakerIdentityConfirmation({
      meetingId,
      suggestionId: 'suggestion-1',
      personId,
      generation: 1,
      revision: 3,
      ranges: [{ startMs: 10_000, endMs: 14_000 }],
    });

    const result = reconcileLiveSpeakerIdentityConfirmations(meetingId);

    expect(result.needsReview).toBe(0);
    expect(result.bound).toHaveLength(1);
    expect(result.bound[0]).toMatchObject({
      speaker: 'Remote Speaker 1',
      personId,
      source: 'user',
      assignment: { kind: LIVE_VOICE_CONFIRMED_ASSIGNMENT },
    });
    expect(
      db.db
        .prepare(
          'SELECT state FROM live_speaker_identity_confirmations WHERE suggestion_id = ?',
        )
        .get('suggestion-1'),
    ).toEqual({ state: 'bound' });
  });

  it('keeps ambiguous overlap out of canonical identity bindings', () => {
    db.saveMeeting({
      id: meetingId,
      title: 'Ambiguous live speaker identity test',
      transcript_json: JSON.stringify([
        {
          speaker: 'Remote Speaker 1',
          text: 'First synthetic voice.',
          startTime: 10,
          endTime: 12,
        },
        {
          speaker: 'Remote Speaker 2',
          text: 'Second synthetic voice.',
          startTime: 12,
          endTime: 14,
        },
      ]),
    });
    persistLiveSpeakerIdentityConfirmation({
      meetingId,
      suggestionId: 'suggestion-ambiguous',
      personId,
      generation: 1,
      revision: 3,
      ranges: [{ startMs: 10_000, endMs: 14_000 }],
    });

    const result = reconcileLiveSpeakerIdentityConfirmations(meetingId);

    expect(result).toEqual({ bound: [], needsReview: 1 });
    expect(db.identityStore.getBindings(meetingId)).toEqual([]);
  });

  it('removes a pending confirmation when the user undoes it', () => {
    persistLiveSpeakerIdentityConfirmation({
      meetingId,
      suggestionId: 'suggestion-undo',
      personId,
      generation: 1,
      revision: 3,
      ranges: [{ startMs: 10_000, endMs: 14_000 }],
    });

    removeLiveSpeakerIdentityConfirmation(meetingId, 'suggestion-undo');

    expect(
      db.db
        .prepare(
          'SELECT 1 FROM live_speaker_identity_confirmations WHERE suggestion_id = ?',
        )
        .get('suggestion-undo'),
    ).toBeUndefined();
  });
});
