import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { NotesDraft } from '../../electron/llm/meetingNotesTypes';
import { createNotesSourceFromText } from '../../electron/llm/meetingNotesSource';
import { createNotesStreamPreview } from '../../electron/llm/meetingNotesStreamPreview';
import { createNotesWireRequest } from '../../electron/llm/meetingNotesWire';
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
  it('renders a complete streamed item through the preview store and drops it on cancellation', () => {
    const source = createNotesSourceFromText('Wait for approval.');
    const spans = source.segments.map((segment) => ({
      segment: segment.index,
      start: 0,
      end: segment.text.length,
    }));
    const store = createMeetingNotesPreviewStore();
    const controller = new AbortController();
    const push = createNotesStreamPreview({
      source,
      spans,
      decode: createNotesWireRequest('', spans).decode,
      signal: controller.signal,
      onDraft: (value) =>
        store.set('meeting', 'run', value, () => !controller.signal.aborted),
    });
    const prefix =
      '{"sections":[{"title":"Next step","items":[{"kind":"point","text":"Wait for approval.","owner":null,"due":null,"sources":["R0"]}';
    push(prefix.slice(0, -1));
    expect(store.get('meeting')).toBeNull();
    push(prefix);
    const html = renderToStaticMarkup(
      <MeetingNotesDraftPreview preview={store.get('meeting')!} />,
    );
    expect(html).toContain('Wait for approval.');
    expect(html).toContain('not final');
    expect(html).not.toContain('<button');
    controller.abort();
    push(`${prefix}]}]}`);
    expect(store.get('meeting')).toBeNull();
  });
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
