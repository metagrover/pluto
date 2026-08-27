import { expect, it } from 'vitest';
import { rebaseMeetingNotesEdits } from '../../src/utils/meetingNotesEditRebase';

it('does not preserve a trailing-space-only edit over regenerated notes', () => {
  const result = rebaseMeetingNotesEdits({
    edits: {
      overview: {
        original: 'Old overview. ',
        edited: 'Old overview.',
        edited_at: '2026-01-01T00:00:00Z',
      },
    },
    previousBlocks: [
      { path: 'overview', text: 'Old overview. ', sourceKey: 'old' },
    ],
    nextBlocks: [{ path: 'overview', text: 'New overview.', sourceKey: 'new' }],
  });

  expect(result.edits.overview).toBeUndefined();
  expect(result.conflicts).toEqual([]);
});

it('reattaches a genuine edit only to a unique unchanged source block', () => {
  const result = rebaseMeetingNotesEdits({
    edits: {
      'topics.0.summary': {
        original: 'Original',
        edited: 'User clarification',
        edited_at: '2026-01-01T00:00:00Z',
      },
    },
    previousBlocks: [
      { path: 'topics.0.summary', text: 'Original', sourceKey: 's0:item:0' },
    ],
    nextBlocks: [
      {
        path: 'topics.1.summary',
        text: 'Original',
        sourceKey: 's0:item:0',
      },
    ],
  });

  expect(result.edits['topics.1.summary']?.edited).toBe('User clarification');
  expect(result.conflicts).toEqual([]);
});

it('preserves a conflict instead of overwriting changed generated text', () => {
  const result = rebaseMeetingNotesEdits({
    edits: {
      overview: {
        original: 'Original',
        edited: 'User clarification',
        edited_at: '2026-01-01T00:00:00Z',
      },
    },
    previousBlocks: [{ path: 'overview', text: 'Original', sourceKey: 'old' }],
    nextBlocks: [
      { path: 'overview', text: 'New generated text', sourceKey: 'old' },
    ],
  });

  expect(result.edits).toEqual({});
  expect(result.conflicts).toEqual([
    expect.objectContaining({ edited: 'User clarification', path: 'overview' }),
  ]);
});
