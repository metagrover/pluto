import fs from 'node:fs';
import { afterAll, describe, expect, it, vi } from 'vitest';

const testDatabase = vi.hoisted(() => ({
  directory: `/tmp/pluto-transcription-people-${process.pid}-${Math.random()
    .toString(16)
    .slice(2)}`,
}));

vi.mock('electron', () => ({
  app: { getPath: () => testDatabase.directory },
}));

import {
  addMeetingEntity,
  getTranscriptionPersonCandidates,
  saveMeeting,
  upsertEntity,
} from '../../electron/db';

afterAll(() => {
  fs.rmSync(testDatabase.directory, { recursive: true, force: true });
});

describe('transcription person candidate query', () => {
  it('returns content needed for deterministic saliency, recency, and frequency ranking', () => {
    saveMeeting({
      id: 'candidate-meeting-a',
      title: 'Synthetic candidate fixture A',
      started_at: '2026-08-01T12:00:00.000Z',
    });
    saveMeeting({
      id: 'candidate-meeting-b',
      title: 'Synthetic candidate fixture B',
      started_at: '2026-08-10T12:00:00.000Z',
    });
    const person = upsertEntity({
      type: 'person',
      name: 'Nira Vale',
      saliency_score: 0.85,
    });
    const unlinkedPerson = upsertEntity({
      type: 'person',
      name: 'Milo North',
      saliency_score: 1,
    });
    addMeetingEntity({
      meeting_id: 'candidate-meeting-a',
      entity_id: person.id,
      mention_count: 2,
    });
    addMeetingEntity({
      meeting_id: 'candidate-meeting-b',
      entity_id: person.id,
      mention_count: 3,
    });

    expect(getTranscriptionPersonCandidates()).toEqual([
      {
        name: 'Nira Vale',
        saliencyScore: 0.85,
        meetingCount: 2,
        mentionCount: 5,
        lastMentionedAt: '2026-08-10T12:00:00.000Z',
      },
    ]);
    expect(
      getTranscriptionPersonCandidates().some(
        (candidate) => candidate.name === unlinkedPerson.name,
      ),
    ).toBe(false);
  });

  it('does not expose generic speaker placeholders as person candidates', () => {
    expect(() =>
      upsertEntity({
        type: 'person',
        name: 'Remote Speaker 3',
        saliency_score: 1,
      }),
    ).toThrow('person_name_invalid');
  });
});
