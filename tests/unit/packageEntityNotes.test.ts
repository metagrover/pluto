import fs from 'node:fs';
import { afterAll, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  directory: `/tmp/pluto-package-notes-${process.pid}`,
}));

vi.mock('electron', () => ({ app: { getPath: () => fixture.directory } }));
import * as db from '../../electron/db';
import { packageEntityNotes } from '../../electron/dreaming/packageEntityNotes';

afterAll(() => fs.rmSync(fixture.directory, { recursive: true, force: true }));

const entity = (overrides: Partial<db.Entity> = {}): db.Entity => ({
  id: 'project-586',
  type: 'project',
  name: 'Memory Dreaming',
  normalized_name: 'memory dreaming',
  status: 'active',
  due_date: null,
  assigned_to: null,
  metadata: null,
  saliency_score: 1,
  domain_tag: 'work',
  created_at: '2026-09-01T00:00:00.000Z',
  updated_at: '2026-09-01T00:00:00.000Z',
  ...overrides,
});

const note = (
  id: string,
  startedAt: string,
  content: string,
): db.DreamingEntityNoteSource => ({
  id,
  title: `Meeting ${id}`,
  started_at: startedAt,
  created_at: startedAt,
  user_notes: null,
  enhanced_notes: content,
});

const packageDeps = (
  overrides: Partial<Parameters<typeof packageEntityNotes>[1]> = {},
) => ({
  getEntity: vi.fn(() => entity()),
  resolvePersonIdentityId: vi.fn((id: string) => id),
  resolveProjectIdentityId: vi.fn((id: string) => id),
  getDreamingEntityNotes: vi.fn(() => [
    note('meeting-new', '2026-09-02T10:00:00.000Z', 'Newest note'),
  ]),
  getDreamingEntityBaseline: vi.fn(() => ({ summary: 'Accepted summary' })),
  getEntityCorrections: vi.fn(() => []),
  ...overrides,
});

describe('packageEntityNotes', () => {
  it('uses one bounded note projection instead of per-meeting detail reads', () => {
    const getDreamingEntityNotes = vi.fn(() => [
      note('meeting-1', '2026-09-02T10:00:00.000Z', 'Structured notes'),
    ]);
    const pkg = packageEntityNotes(
      'project-586',
      packageDeps({ getDreamingEntityNotes }),
    );

    expect(pkg?.recentMeetingNotes).toHaveLength(1);
    expect(getDreamingEntityNotes).toHaveBeenCalledOnce();
    expect(getDreamingEntityNotes).toHaveBeenCalledWith('project-586', 8);
  });

  it('aggregates an alias through its canonical family in the bounded projection', () => {
    const canonical = db.upsertEntity({
      type: 'project',
      name: 'Canonical Dreaming Project',
    });
    const alias = db.upsertEntity({
      type: 'project',
      name: 'Dream Agent Alias',
    });
    db.mergeProject(alias.id, canonical.id);
    for (const [meetingId, linkedEntityId] of [
      ['canonical-family-meeting', canonical.id],
      ['alias-family-meeting', alias.id],
    ] as const) {
      db.saveMeeting({
        id: meetingId,
        title: meetingId,
        started_at: '2026-09-02T10:00:00.000Z',
        enhanced_notes: `Structured notes for ${meetingId}`,
        transcript_json: JSON.stringify([{ text: `raw ${meetingId}` }]),
      });
      db.addMeetingEntity({
        meeting_id: meetingId,
        entity_id: linkedEntityId,
        context: 'canonical family test',
      });
    }

    const pkg = packageEntityNotes(alias.id);
    expect(pkg?.entityId).toBe(canonical.id);
    expect(pkg?.entityName).toBe(canonical.name);
    expect(pkg?.recentMeetingNotes.map((meeting) => meeting.meetingId)).toEqual(
      expect.arrayContaining([
        'canonical-family-meeting',
        'alias-family-meeting',
      ]),
    );
  });

  it('keeps only the newest eight non-empty structured-note meetings in deterministic order', () => {
    const notes = Array.from({ length: 11 }, (_, index) =>
      note(
        `meeting-${String(index).padStart(2, '0')}`,
        `2026-09-${String(index + 1).padStart(2, '0')}T10:00:00.000Z`,
        index === 10 ? '   ' : `note ${index}`,
      ),
    ).reverse();
    const pkg = packageEntityNotes(
      'project-586',
      packageDeps({ getDreamingEntityNotes: vi.fn(() => notes) }),
    );

    expect(pkg?.recentMeetingNotes.map((meeting) => meeting.meetingId)).toEqual(
      [
        'meeting-09',
        'meeting-08',
        'meeting-07',
        'meeting-06',
        'meeting-05',
        'meeting-04',
        'meeting-03',
        'meeting-02',
      ],
    );
  });

  it('caps the total structured-note package at 1,600 whitespace-delimited words', () => {
    const pkg = packageEntityNotes(
      'project-586',
      packageDeps({
        getDreamingEntityNotes: vi.fn(() => [
          note(
            'meeting-a',
            '2026-09-02T10:00:00.000Z',
            Array.from({ length: 1_000 }, (_, index) => `a${index}`).join(' '),
          ),
          note(
            'meeting-b',
            '2026-09-01T10:00:00.000Z',
            Array.from({ length: 1_000 }, (_, index) => `b${index}`).join('\n'),
          ),
          note('meeting-c', '2026-08-31T10:00:00.000Z', 'excluded tail'),
        ]),
      }),
    );

    const words = pkg?.recentMeetingNotes.flatMap(
      (meeting) => meeting.notesContent.match(/\S+/g) ?? [],
    );
    expect(words).toHaveLength(1_600);
    expect(pkg?.recentMeetingNotes).toHaveLength(2);
    expect(pkg?.recentMeetingNotes[1].notesContent).toContain('b599');
    expect(pkg?.recentMeetingNotes[1].notesContent).not.toContain('b600');
  });

  it('returns only structured-note projection fields and excludes transcript and audio data', () => {
    const project = db.upsertEntity({
      type: 'project',
      name: 'Transcript Exclusion Project',
    });
    db.saveMeeting({
      id: 'transcript-exclusion-meeting',
      title: 'Notes only',
      started_at: '2026-09-02T12:00:00.000Z',
      user_notes: 'User-authored structured note',
      enhanced_notes: 'Enhanced structured note',
      transcript_json: JSON.stringify([{ text: 'SECRET RAW TRANSCRIPT' }]),
      audio_file_path: '/tmp/secret-audio.wav',
    });
    db.addMeetingEntity({
      meeting_id: 'transcript-exclusion-meeting',
      entity_id: project.id,
    });

    const [projected] = db.getDreamingEntityNotes(project.id, 8);
    const pkg = packageEntityNotes(project.id);
    expect(Object.keys(projected).sort()).toEqual([
      'created_at',
      'enhanced_notes',
      'id',
      'started_at',
      'title',
      'user_notes',
    ]);
    expect(JSON.stringify(projected)).not.toContain('SECRET RAW TRANSCRIPT');
    expect(JSON.stringify(projected)).not.toContain('secret-audio');
    expect(pkg?.recentMeetingNotes[0].notesContent).toContain(
      'User-authored structured note',
    );
    expect(JSON.stringify(pkg)).not.toContain('SECRET RAW TRANSCRIPT');
  });

  it('includes the current canonical baseline and sorted correction fingerprints', () => {
    const currentBaseline = {
      summary: 'Current accepted summary',
      milestones: ['Proposal-first pipeline'],
    };
    const pkg = packageEntityNotes(
      'project-586',
      packageDeps({
        getDreamingEntityBaseline: vi.fn(() => currentBaseline),
        getEntityCorrections: vi.fn(() => [
          { fingerprint: ' Zeta ' },
          { fingerprint: 'alpha' },
        ]),
      }),
    );

    expect(pkg?.currentBaseline).toEqual(currentBaseline);
    expect(pkg?.correctionFingerprints).toEqual(['alpha', 'zeta']);
    expect(pkg?.negativeConstraints).toEqual(['alpha', 'zeta']);
  });

  it('computes a stable SHA-256 revision for equivalent package inputs', () => {
    const first = packageEntityNotes(
      'project-586',
      packageDeps({
        getDreamingEntityBaseline: vi.fn(() => ({ z: 1, a: { y: 2, x: 3 } })),
        getEntityCorrections: vi.fn(() => [
          { fingerprint: 'zeta' },
          { fingerprint: 'alpha' },
        ]),
      }),
    );
    const second = packageEntityNotes(
      'project-586',
      packageDeps({
        getDreamingEntityBaseline: vi.fn(() => ({ a: { x: 3, y: 2 }, z: 1 })),
        getEntityCorrections: vi.fn(() => [
          { fingerprint: 'alpha' },
          { fingerprint: 'zeta' },
        ]),
      }),
    );

    expect(first?.sourceRevision).toMatch(/^[a-f0-9]{64}$/);
    expect(second?.sourceRevision).toBe(first?.sourceRevision);
  });

  it.each([
    [
      'meeting id',
      {
        notes: [
          note('meeting-other', '2026-09-02T10:00:00.000Z', 'Newest note'),
        ],
      },
    ],
    [
      'note content',
      {
        notes: [
          note('meeting-new', '2026-09-02T10:00:00.000Z', 'Changed note'),
        ],
      },
    ],
    ['baseline', { baseline: { summary: 'Changed accepted summary' } }],
    ['correction', { corrections: [{ fingerprint: 'new-correction' }] }],
  ])('changes the revision when the included %s changes', (_label, change) => {
    const original = packageEntityNotes('project-586', packageDeps());
    const changed = packageEntityNotes(
      'project-586',
      packageDeps({
        getDreamingEntityNotes: vi.fn(
          () =>
            change.notes ?? [
              note('meeting-new', '2026-09-02T10:00:00.000Z', 'Newest note'),
            ],
        ),
        getDreamingEntityBaseline: vi.fn(
          () => change.baseline ?? { summary: 'Accepted summary' },
        ),
        getEntityCorrections: vi.fn(() => change.corrections ?? []),
      }),
    );
    expect(changed?.sourceRevision).not.toBe(original?.sourceRevision);
  });

  it('returns null if entity does not exist', () => {
    const pkg = packageEntityNotes(
      'non-existent-id',
      packageDeps({ getEntity: vi.fn(() => undefined) }),
    );
    expect(pkg).toBeNull();
  });
});
