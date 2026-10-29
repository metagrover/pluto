import { expect, it } from 'vitest';
import {
  applyMeetingNotesUserEdit,
  rebaseMeetingNotesEdits,
} from '../../src/utils/meetingNotesEditRebase';

it('retains an explicit empty continuation list so synchronization can remove its tasks', () => {
  const path = 'native_continuations:all_decisions:0';
  const result = applyMeetingNotesUserEdit(
    {
      [path]: {
        original: '[]',
        edited: '[{"id":"row","text":""}]',
        edited_at: '2026-01-01T00:00:00Z',
      },
    },
    path,
    '[]',
    '[]',
    '2026-01-02T00:00:00Z',
  );

  expect(result.changed).toBe(true);
  expect(result.edits[path]?.edited).toBe('[]');
  expect(applyMeetingNotesUserEdit({}, path, '[]', '[]', 'now').changed).toBe(
    false,
  );
});

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
      'topic:0:summary': {
        original: 'Original',
        edited: 'User clarification',
        edited_at: '2026-01-01T00:00:00Z',
      },
    },
    previousBlocks: [
      { path: 'topic:0:summary', text: 'Original', sourceKey: 's0:item:0' },
    ],
    nextBlocks: [
      {
        path: 'topic:1:summary',
        text: 'Original',
        sourceKey: 's0:item:0',
      },
    ],
  });

  expect(result.edits['topic:1:summary']?.edited).toBe('User clarification');
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

it('keeps an intentional empty-string deletion when its source block moves', () => {
  const result = rebaseMeetingNotesEdits({
    edits: {
      'topic:0:point:0': {
        original: 'Remove this detail.',
        edited: '',
        edited_at: '2026-01-01T00:00:00Z',
      },
    },
    previousBlocks: [
      {
        path: 'topic:0:point:0',
        text: 'Remove this detail.',
        sourceKey: 's0:item:1',
      },
    ],
    nextBlocks: [
      {
        path: 'topic:2:point:1',
        text: 'Remove this detail.',
        sourceKey: 's0:item:1',
      },
    ],
  });

  expect(result.edits['topic:2:point:1']).toMatchObject({ edited: '' });
  expect(result.conflicts).toEqual([]);
});

it('preserves meaningful Markdown checklist whitespace', () => {
  const result = rebaseMeetingNotesEdits({
    edits: {
      overview: {
        original: '- [ ] Ship the draft\n  with the evidence attached.',
        edited: '- [ ] Ship the draft\n    with the evidence attached.',
        edited_at: '2026-01-01T00:00:00Z',
      },
    },
    previousBlocks: [
      {
        path: 'overview',
        text: '- [ ] Ship the draft\n  with the evidence attached.',
        sourceKey: 'overview-source',
      },
    ],
    nextBlocks: [
      {
        path: 'overview',
        text: '- [ ] Ship the draft\n  with the evidence attached.',
        sourceKey: 'overview-source',
      },
    ],
  });

  expect(result.edits.overview?.edited).toBe(
    '- [ ] Ship the draft\n    with the evidence attached.',
  );
  expect(result.conflicts).toEqual([]);
});

it('keeps native continuation rows with their source-backed parent after a reorder', () => {
  const continuation = JSON.stringify([
    { id: 'follow-up', text: 'Ask design to review the draft.' },
  ]);
  const result = rebaseMeetingNotesEdits({
    edits: {
      'native_continuations:all_action_items:0': {
        original: '[]',
        edited: continuation,
        edited_at: '2026-01-01T00:00:00Z',
      },
    },
    previousBlocks: [
      {
        path: 'native_continuations:all_action_items:0',
        text: '[]',
        sourceKey: 's0:item:0',
      },
    ],
    nextBlocks: [
      {
        path: 'native_continuations:all_action_items:1',
        text: '[]',
        sourceKey: 's0:item:0',
      },
    ],
  });

  expect(result.edits['native_continuations:all_action_items:1']?.edited).toBe(
    continuation,
  );
  expect(result.conflicts).toEqual([]);
});

it('does not guess between duplicate legacy text blocks', () => {
  const result = rebaseMeetingNotesEdits({
    edits: {
      overview: {
        original: 'Repeated detail.',
        edited: 'Clarified detail.',
        edited_at: '2026-01-01T00:00:00Z',
      },
    },
    previousBlocks: [
      { path: 'overview', text: 'Repeated detail.', sourceKey: null },
    ],
    nextBlocks: [
      { path: 'topic:0:summary', text: 'Repeated detail.', sourceKey: null },
      { path: 'topic:1:summary', text: 'Repeated detail.', sourceKey: null },
    ],
  });

  expect(result.edits).toEqual({});
  expect(result.conflicts).toEqual([
    expect.objectContaining({ path: 'overview', edited: 'Clarified detail.' }),
  ]);
});

it('treats changed source identity as a conflict even when generated text is unchanged', () => {
  const result = rebaseMeetingNotesEdits({
    edits: {
      overview: {
        original: 'Shared wording.',
        edited: 'Saved clarification.',
        edited_at: '2026-01-01T00:00:00Z',
      },
    },
    previousBlocks: [
      { path: 'overview', text: 'Shared wording.', sourceKey: 'old-revision' },
    ],
    nextBlocks: [
      { path: 'overview', text: 'Shared wording.', sourceKey: 'new-revision' },
    ],
  });

  expect(result.edits).toEqual({});
  expect(result.conflicts).toEqual([
    expect.objectContaining({ previousSourceKey: 'old-revision' }),
  ]);
});

const completionBlock = (
  path: string,
  text: string,
  owner: string | null = 'me',
  sourceKey: string | null = null,
  revision = 'same-source',
  start = 0,
) => ({
  path,
  text: 'false',
  sourceKey,
  completionIdentity: {
    text: text.toLowerCase(),
    owner,
    sourceRevision: revision,
    sources: [{ segment: 0, start, end: 50 }],
  },
});
const completedEdit = { original: 'false', edited: 'true', edited_at: 'now' };
it('keeps completion with the same owner and task when source evidence narrows after rewrite', () => {
  const result = rebaseMeetingNotesEdits({
    edits: { 'completion:all_action_items:0': completedEdit },
    previousBlocks: [
      completionBlock(
        'completion:all_action_items:0',
        'Prepare checklist',
        'me',
        'wide',
      ),
    ],
    nextBlocks: [
      completionBlock(
        'completion:all_action_items:2',
        'prepare checklist',
        'me',
        'narrow',
        'same-source',
        10,
      ),
    ],
  });
  expect(result.edits['completion:all_action_items:2']?.edited).toBe('true');
  expect(result.conflicts).toEqual([]);
});
it.each([
  completionBlock('completion:all_action_items:0', 'Different task'),
  completionBlock(
    'completion:all_action_items:0',
    'Prepare checklist',
    'other',
  ),
  completionBlock(
    'completion:all_action_items:0',
    'Prepare checklist',
    'me',
    'other',
    'other-source',
  ),
])(
  'does not transfer a checkbox to a different task, owner or source',
  (next) => {
    const result = rebaseMeetingNotesEdits({
      edits: { 'completion:all_action_items:0': completedEdit },
      previousBlocks: [
        completionBlock(
          'completion:all_action_items:0',
          'Prepare checklist',
          'me',
          'original',
        ),
      ],
      nextBlocks: [next],
    });
    expect(result.edits).toEqual({});
    expect(result.conflicts).toHaveLength(1);
  },
);
it('does not guess completion when two legacy tasks share the same wording', () => {
  const result = rebaseMeetingNotesEdits({
    edits: { 'completion:all_action_items:0': completedEdit },
    previousBlocks: [
      completionBlock('completion:all_action_items:0', 'Checklist'),
      completionBlock('completion:all_action_items:1', 'Checklist'),
    ],
    nextBlocks: [completionBlock('completion:all_action_items:0', 'Checklist')],
  });
  expect(result.edits).toEqual({});
  expect(result.conflicts).toHaveLength(1);
});
it('persists explicit unchecking rather than confusing it with archived completion', () => {
  const result = applyMeetingNotesUserEdit(
    { 'completion:all_action_items:0': completedEdit },
    'completion:all_action_items:0',
    'false',
    'false',
    'later',
  );
  expect(result.edits['completion:all_action_items:0']?.edited).toBe('false');
  expect(result.edits['completion:v2:action:0']?.edited).toBe('false');
});
