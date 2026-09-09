import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { NotesDraft } from '../../electron/llm/meetingNotesTypes';
import { createMeetingNotesPreviewStore } from '../../electron/meetingNotesPreview';
import {
  MeetingNotesDraftPreview,
  currentNotesPreview,
} from '../../src/components/features/MeetingNotesDraftPreview';
import type { Meeting } from '../../src/types';

const draft: NotesDraft = {
  meetingType: 'general',
  overview: null,
  sections: [
    {
      title: { text: 'Context', sources: [] },
      items: [
        {
          kind: 'point',
          text: '<script>alert(1)</script>',
          sources: [],
        },
      ],
    },
  ],
};
describe('ephemeral notes previews', () => {
  it('isolates meetings, clones content, and removes stale source/run previews', () => {
    const store = createMeetingNotesPreviewStore();
    let current = true;
    store.set('meeting', 'run', draft, () => current);
    expect(store.get('other')).toBeNull();
    const read = store.get('meeting')!;
    read.sections[0].title = 'mutated';
    expect(store.get('meeting')!.sections[0].title).toBe('Context');
    current = false;
    expect(store.get('meeting')).toBeNull();
    current = true;
    expect(store.get('meeting')).toBeNull();
  });
  it('does not let old cleanup erase a new run, and bounds retained data', () => {
    const store = createMeetingNotesPreviewStore();
    store.set('meeting', 'new', draft, () => true);
    store.clear('meeting', 'old');
    expect(store.get('meeting')?.runId).toBe('new');
    store.set(
      'meeting',
      'new',
      {
        ...draft,
        sections: [
          {
            ...draft.sections[0],
            title: { text: 'x'.repeat(64001), sources: [] },
          },
        ],
      },
      () => true,
    );
    expect(store.get('meeting')).toBeNull();
    store.set('meeting', 'new', draft, () => false);
    expect(store.get('meeting')).toBeNull();
  });
  it('shows only the matching running draft and renders model markup as text', () => {
    const store = createMeetingNotesPreviewStore();
    store.set('meeting', 'run', draft, () => true);
    const meeting = {
      notes_preview: store.get('meeting'),
      analysis_run_json: JSON.stringify({
        run_id: 'run',
        notes_status: 'running',
      }),
    } as Meeting;
    expect(currentNotesPreview(meeting)).not.toBeNull();
    for (const run of [
      { run_id: 'old', notes_status: 'running' },
      { run_id: 'run', notes_status: 'failed' },
      { run_id: 'run', notes_status: 'cancelled' },
      { run_id: 'run', notes_status: 'published' },
    ])
      expect(
        currentNotesPreview({
          ...meeting,
          analysis_run_json: JSON.stringify(run),
        }),
      ).toBeNull();
    const html = renderToStaticMarkup(
      <MeetingNotesDraftPreview preview={meeting.notes_preview!} />,
    );
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).toContain('not saved yet');
    expect(html).not.toContain('<button');
  });
});
