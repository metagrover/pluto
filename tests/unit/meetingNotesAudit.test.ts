import { expect, it } from 'vitest';
import {
  applyNotesAudit,
  projectAuditedNotes,
} from '../../electron/llm/meetingNotesAudit';
import { createNotesSource } from '../../electron/llm/meetingNotesSource';
import type {
  NotesAudit,
  NotesDraft,
} from '../../electron/llm/meetingNotesTypes';

it('adds a source-backed commitment omitted by the writer', () => {
  const sourceText = 'I will send the outline.';
  const source = createNotesSource(
    JSON.stringify({
      segments: [{ speaker: 'Me', text: sourceText }],
    }),
  );
  const span = { segment: 0, start: 0, end: sourceText.length };
  const draft: NotesDraft = {
    meetingType: 'general',
    overview: null,
    sections: [
      {
        id: 's0',
        title: { id: 't0', text: 'Outline', sources: [span] },
        items: [],
      },
    ],
  };
  const audit: NotesAudit = {
    changes: [
      {
        op: 'insert',
        section: 's0',
        value: {
          id: 'a1',
          kind: 'action',
          text: 'Send the outline',
          sources: [span],
          owner: 'Me',
          due: null,
        },
      },
    ],
    verdicts: [
      { target: 't0', status: 'supported', sources: [span] },
      { target: 'a1', status: 'supported', sources: [span] },
    ],
    dispositions: [],
    terminology: [],
  };

  const result = projectAuditedNotes(applyNotesAudit({ source, draft, audit }));
  expect(result.all_action_items).toEqual([
    expect.objectContaining({
      text: 'Send the outline',
      assignee: 'Me',
      evidence: 'I will send the outline.',
    }),
  ]);
});

it('rejects an atomic audit when a change targets an unknown block', () => {
  const source = createNotesSource(
    JSON.stringify({ segments: [{ speaker: 'Me', text: 'Keep this.' }] }),
  );
  const span = { segment: 0, start: 0, end: 'Keep this.'.length };
  const draft: NotesDraft = {
    meetingType: 'general',
    overview: null,
    sections: [
      {
        id: 's0',
        title: { id: 't0', text: 'Keep', sources: [span] },
        items: [],
      },
    ],
  };
  const audit: NotesAudit = {
    changes: [{ op: 'remove', target: 'unknown' }],
    verdicts: [{ target: 't0', status: 'supported', sources: [span] }],
    dispositions: [],
    terminology: [],
  };

  expect(() => applyNotesAudit({ source, draft, audit })).toThrow(
    'invalid_notes_audit',
  );
});
