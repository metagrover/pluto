// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingNotesDocument } from '../../src/components/features/MeetingNotesDocument';
import type { Meeting, TranscriptSegment } from '../../src/types';
import type { MeetingNotesDocumentModel } from '../../src/utils/meetingNotesDocument';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const meeting: Meeting = {
  id: 'meeting-document',
  title: 'Architecture review',
  meeting_type: 'Recording',
  created_at: '2026-08-19T17:00:00.000Z',
  started_at: '2026-08-19T17:00:00.000Z',
  user_notes: 'Keep the migration reversible.',
};

const model: MeetingNotesDocumentModel = {
  hasAnalysis: true,
  sections: [
    {
      id: 'outcomes',
      kind: 'outcomes',
      title: 'Decisions & next steps',
      blocks: [
        {
          id: 'decision-0',
          path: 'all_decisions:0',
          text: 'Use docs as code.',
          originalText: 'Use docs as code.',
          authorship: 'ai',
          edited: false,
          evidence: 'Maya: We will use docs as code.',
          blockType: 'decision',
        },
      ],
    },
    {
      id: 'scratchpad',
      kind: 'scratchpad',
      title: 'Your notes',
      blocks: [
        {
          id: 'scratchpad-content',
          text: 'Keep the migration reversible.',
          originalText: 'Keep the migration reversible.',
          authorship: 'human',
          edited: false,
        },
      ],
    },
    {
      id: 'topic-0',
      kind: 'discussion',
      title: 'Documentation architecture',
      transcriptRange: [0, 1],
      blocks: [
        {
          id: 'topic-0-point-0',
          path: 'topic:0:point:0',
          text: 'Markdown will live beside the code.',
          originalText: 'Markdown will live beside the code.',
          authorship: 'ai',
          edited: false,
          transcriptRange: [0, 1],
        },
      ],
    },
  ],
};

const transcript: TranscriptSegment[] = [
  { speaker: 'Maya', text: 'We will use docs as code.', start: 7, end: 10 },
  {
    speaker: 'Daniel',
    text: 'Markdown can live beside the code.',
    start: 10,
    end: 14,
  },
];

describe('MeetingNotesDocument', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let invoke: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    invoke = vi.fn(async () => null);
    Object.defineProperty(window, 'ipcRenderer', {
      configurable: true,
      value: { invoke },
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  const renderDocument = () =>
    root.render(
      <MeetingNotesDocument
        meeting={meeting}
        model={model}
        transcriptSegments={transcript}
        onDocumentChanged={vi.fn()}
        onShowTranscript={vi.fn()}
      />,
    );

  it('renders one outcomes-first article with subtle authorship', async () => {
    await act(async () => renderDocument());

    const sectionHeadings = Array.from(
      container.querySelectorAll('[data-notes-section] > h2'),
    ).map((heading) => heading.textContent?.trim());
    expect(sectionHeadings).toEqual([
      'Decisions & next steps',
      'Your notes',
      'Documentation architecture',
    ]);
    expect(container.textContent).toContain('Written by you');
    expect(container.querySelectorAll('article')).toHaveLength(1);
  });

  it('opens contextual evidence without replacing the note', async () => {
    await act(async () => renderDocument());

    const sourceButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Show source for Use docs as code."]',
    );
    await act(async () => sourceButton?.click());

    const source = document.querySelector('[data-notes-source]');
    expect(source?.textContent).toContain('Use docs as code.');
    expect(source?.textContent).toContain('Maya');
    expect(source?.textContent).toContain('Daniel');
    expect(source?.textContent).toContain('0:07');
    expect(container.textContent).toContain('Documentation architecture');
  });

  it('autosaves scratchpad changes and exposes save status', async () => {
    vi.useFakeTimers();
    await act(async () => renderDocument());

    const notes = container.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Your meeting notes"]',
    );
    const valueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      'value',
    )?.set;
    await act(async () => {
      valueSetter?.call(notes, 'Keep the migration reversible and documented.');
      notes?.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(container.textContent).toContain('Unsaved changes');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });

    expect(invoke).toHaveBeenCalledWith(
      'SAVE_MEETING',
      expect.objectContaining({
        id: meeting.id,
        user_notes: 'Keep the migration reversible and documented.',
      }),
    );
    expect(container.textContent).toContain('Saved locally');
  });

  it('uses a real persisted checkbox for generated actions', async () => {
    const actionModel: MeetingNotesDocumentModel = {
      hasAnalysis: true,
      sections: [
        {
          id: 'outcomes',
          kind: 'outcomes',
          title: 'Decisions & next steps',
          blocks: [
            {
              id: 'action-0',
              path: 'all_action_items:0',
              text: 'Publish the guide.',
              originalText: 'Publish the guide.',
              authorship: 'ai',
              edited: false,
              blockType: 'action',
            },
          ],
        },
      ],
    };
    await act(async () =>
      root.render(
        <MeetingNotesDocument
          meeting={meeting}
          model={actionModel}
          transcriptSegments={[]}
          onDocumentChanged={vi.fn()}
          onShowTranscript={vi.fn()}
        />,
      ),
    );

    const checkbox = container.querySelector<HTMLInputElement>(
      'input[type="checkbox"]',
    );
    await act(async () => checkbox?.click());

    expect(invoke).toHaveBeenCalledWith('SAVE_USER_EDIT', {
      meetingId: meeting.id,
      path: 'completion:all_action_items:0',
      original: 'false',
      edited: 'true',
    });
  });
});
