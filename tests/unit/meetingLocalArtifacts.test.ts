import fs from 'node:fs';
import { afterAll, describe, expect, it, vi } from 'vitest';

const testDatabase = vi.hoisted(() => ({
  directory: `/tmp/pluto-meeting-artifacts-${process.pid}-${Math.random()
    .toString(16)
    .slice(2)}`,
}));

vi.mock('electron', () => ({
  app: { getPath: () => testDatabase.directory },
}));

import {
  attachArtifactToMeeting,
  deleteLocalArtifact,
  deleteMeeting,
  detachArtifactFromMeeting,
  getMeeting,
  getMeetingAnalysisPublicationRevisions,
  getMeetingAttachedArtifactsText,
  listArtifactsForMeeting,
  listLocalArtifacts,
  listMeetingsForArtifact,
  saveLocalArtifact,
  saveMeeting,
  setLocalArtifactStatus,
} from '../../electron/db';
import { createLocalArtifactRecord } from '../../electron/localArtifacts';

afterAll(() => {
  fs.rmSync(testDatabase.directory, { recursive: true, force: true });
});

describe('meeting local artifacts junction and notes synthesis', () => {
  const dummyTranscript = JSON.stringify({
    segments: [
      {
        speaker: 'Alex',
        text: 'Let us review the Q3 architecture and launch timeline.',
      },
    ],
  });

  it('attaches and lists artifacts for a meeting, including inverse meeting links', () => {
    const meetingId = `test-meet-${Date.now()}-1`;
    saveMeeting({
      id: meetingId,
      title: 'Sprint Planning',
      transcript_json: dummyTranscript,
      created_at: new Date().toISOString(),
    });

    const doc1 = saveLocalArtifact(
      createLocalArtifactRecord({
        path: '/tmp/test-spec.docx',
        content: 'Functional specification: User auth and data migration.',
      }),
    );
    const doc2 = saveLocalArtifact(
      createLocalArtifactRecord({
        path: '/tmp/test-notes.pages',
        content: 'Design decisions: Use local SQLite and zero cloud sync.',
      }),
    );

    expect(attachArtifactToMeeting(meetingId, doc1.id)).toBe(true);
    expect(attachArtifactToMeeting(meetingId, doc2.id)).toBe(true);

    const attached = listArtifactsForMeeting(meetingId);
    expect(attached.map((a) => a.id)).toContain(doc1.id);
    expect(attached.map((a) => a.id)).toContain(doc2.id);

    const meetingsForDoc1 = listMeetingsForArtifact(doc1.id);
    expect(meetingsForDoc1).toEqual([
      expect.objectContaining({ id: meetingId, title: 'Sprint Planning' }),
    ]);

    const allArtifacts = listLocalArtifacts();
    const doc1InList = allArtifacts.find((a) => a.id === doc1.id);
    expect(doc1InList?.attached_meetings).toEqual([
      expect.objectContaining({ id: meetingId, title: 'Sprint Planning' }),
    ]);
  });

  it('detaches an artifact from a meeting without deleting the underlying artifact', () => {
    const meetingId = `test-meet-${Date.now()}-2`;
    saveMeeting({
      id: meetingId,
      title: 'Roadmap Sync',
      transcript_json: dummyTranscript,
      created_at: new Date().toISOString(),
    });

    const doc = saveLocalArtifact(
      createLocalArtifactRecord({
        path: '/tmp/sync-notes.md',
        content: 'Roadmap notes: Deploy v2 in November.',
      }),
    );

    attachArtifactToMeeting(meetingId, doc.id);
    expect(listArtifactsForMeeting(meetingId)).toHaveLength(1);

    const detached = detachArtifactFromMeeting(meetingId, doc.id);
    expect(detached).toBe(true);
    expect(listArtifactsForMeeting(meetingId)).toHaveLength(0);

    // The local artifact record still exists in the local source library
    const all = listLocalArtifacts();
    expect(all.some((a) => a.id === doc.id)).toBe(true);
  });

  it('does not include attached artifacts in synthesis while Sources is disabled', () => {
    const meetingId = `test-meet-${Date.now()}-3`;
    saveMeeting({
      id: meetingId,
      title: 'Review Meeting',
      transcript_json: dummyTranscript,
      created_at: new Date().toISOString(),
    });

    const activeDoc = saveLocalArtifact(
      createLocalArtifactRecord({
        path: '/tmp/active-doc.docx',
        content: 'Product requirements: Must run completely offline.',
      }),
    );
    const excludedDoc = saveLocalArtifact(
      createLocalArtifactRecord({
        path: '/tmp/noisy-doc.pdf',
        content: 'Outdated requirements that should be ignored.',
      }),
    );
    setLocalArtifactStatus(excludedDoc.id, 'excluded');

    attachArtifactToMeeting(meetingId, activeDoc.id);
    attachArtifactToMeeting(meetingId, excludedDoc.id);

    expect(getMeetingAttachedArtifactsText(meetingId)).toBe('');
  });

  it('keeps publication revisions unchanged by attachments while Sources is disabled', () => {
    const meetingId = `test-meet-${Date.now()}-4`;
    saveMeeting({
      id: meetingId,
      title: 'Synthesis Test',
      user_notes: 'Initial user handwritten notes.',
      transcript_json: dummyTranscript,
      created_at: new Date().toISOString(),
    });

    const meeting = getMeeting(meetingId);
    const initialRevisions = getMeetingAnalysisPublicationRevisions(meeting);
    expect(initialRevisions).not.toBeNull();

    const doc = saveLocalArtifact(
      createLocalArtifactRecord({
        path: '/tmp/q3-architecture.docx',
        content: 'System architecture diagram and data pipeline specs.',
      }),
    );

    // Attach artifact to meeting
    attachArtifactToMeeting(meetingId, doc.id);

    const revisedWithAttachment =
      getMeetingAnalysisPublicationRevisions(meeting);
    expect(revisedWithAttachment).not.toBeNull();
    expect(revisedWithAttachment!.userNotesHash).toBe(
      initialRevisions!.userNotesHash,
    );

    // Detach artifact
    detachArtifactFromMeeting(meetingId, doc.id);
    const revisedAfterDetach = getMeetingAnalysisPublicationRevisions(meeting);
    expect(revisedAfterDetach!.userNotesHash).toBe(
      initialRevisions!.userNotesHash,
    );
  });

  it('cascades deletion cleanly when meeting is deleted', () => {
    const meetingId = `test-meet-${Date.now()}-5`;
    saveMeeting({
      id: meetingId,
      title: 'Ephemeral Meeting',
      transcript_json: dummyTranscript,
      created_at: new Date().toISOString(),
    });

    const doc = saveLocalArtifact(
      createLocalArtifactRecord({
        path: '/tmp/ephemeral-spec.pdf',
        content: 'Ephemeral spec content.',
      }),
    );

    attachArtifactToMeeting(meetingId, doc.id);
    expect(listArtifactsForMeeting(meetingId)).toHaveLength(1);

    deleteMeeting(meetingId);
    expect(listArtifactsForMeeting(meetingId)).toHaveLength(0);
    // Artifact remains intact
    expect(listMeetingsForArtifact(doc.id)).toHaveLength(0);
  });

  it('cascades deletion cleanly when artifact is deleted', () => {
    const meetingId = `test-meet-${Date.now()}-6`;
    saveMeeting({
      id: meetingId,
      title: 'Artifact Deletion Test',
      transcript_json: dummyTranscript,
      created_at: new Date().toISOString(),
    });

    const doc = saveLocalArtifact(
      createLocalArtifactRecord({
        path: '/tmp/to-be-purged.docx',
        content: 'Document to be deleted completely.',
      }),
    );

    attachArtifactToMeeting(meetingId, doc.id);
    expect(listArtifactsForMeeting(meetingId)).toHaveLength(1);

    deleteLocalArtifact(doc.id);
    expect(listArtifactsForMeeting(meetingId)).toHaveLength(0);
  });
});
