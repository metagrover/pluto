import fs from 'node:fs';
import { afterAll, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  directory: `/tmp/pluto-package-notes-${process.pid}`,
}));

vi.mock('electron', () => ({ app: { getPath: () => fixture.directory } }));
import * as db from '../../electron/db';
import { packageEntityNotes } from '../../electron/dreaming/packageEntityNotes';

afterAll(() => fs.rmSync(fixture.directory, { recursive: true, force: true }));

describe('packageEntityNotes', () => {
  it('extracts notes-first package for a project without raw transcripts', () => {
    const project = db.upsertEntity({
      type: 'project',
      name: 'Billing Redesign',
    });

    db.saveMeeting({
      id: 'meeting-notes-1',
      title: 'Billing Kickoff',
      started_at: '2026-08-15T10:00:00Z',
      enhanced_notes:
        '## Executive Overview\nDiscussed moving to Stripe Elements.\n\n## Action Items\n- Alice to draft PCI architecture',
      transcript_json: JSON.stringify([
        {
          id: '1',
          text: 'Hey can you hear me? Yes, let us start the meeting... [thousands of words of raw audio]',
        },
      ]),
    });

    db.addMeetingEntity({
      meeting_id: 'meeting-notes-1',
      entity_id: project.id,
      context: 'Stripe migration discussion',
    });

    // Add a negative constraint (dismissed milestone)
    db.recordEntityCorrection({
      entityId: project.id,
      itemType: 'milestone',
      fingerprint: 'paypal-checkout',
      reason: 'inaccurate',
    });

    const pkg = packageEntityNotes(project.id, {
      getEntity: db.getEntity,
      getEntityMeetings: db.getEntityMeetings,
      getMeeting: db.getMeeting,
      getEntityCorrections: db.getEntityCorrections,
    });

    expect(pkg).not.toBeNull();
    expect(pkg?.entityId).toBe(project.id);
    expect(pkg?.entityType).toBe('project');
    expect(pkg?.entityName).toBe('Billing Redesign');
    expect(pkg?.negativeConstraints).toContain('paypal-checkout');

    expect(pkg?.recentMeetingNotes).toHaveLength(1);
    const note = pkg?.recentMeetingNotes[0];
    expect(note?.meetingId).toBe('meeting-notes-1');
    expect(note?.notesContent).toContain('Discussed moving to Stripe Elements');
    // Must NOT contain raw transcript text
    expect(note?.notesContent).not.toContain('thousands of words of raw audio');
  });

  it('returns null if entity does not exist', () => {
    const pkg = packageEntityNotes('non-existent-id', {
      getEntity: db.getEntity,
      getEntityMeetings: db.getEntityMeetings,
      getMeeting: db.getMeeting,
      getEntityCorrections: db.getEntityCorrections,
    });
    expect(pkg).toBeNull();
  });
});
