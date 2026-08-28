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

  const openBlockEditor = async (blockText: string) => {
    const block = Array.from(
      container.querySelectorAll('.meeting-note-block'),
    ).find((node) => node.textContent?.includes(blockText)) as
      | HTMLDivElement
      | undefined;
    const preview = block?.querySelector<HTMLDivElement>(
      '.meeting-markdown-preview',
    );
    expect(preview).toBeTruthy();
    await act(async () => {
      preview?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    const textarea = block?.querySelector<HTMLTextAreaElement>('textarea');
    expect(textarea).toBeTruthy();
    return textarea;
  };

  const pressEnterAtEnd = async (textarea: HTMLTextAreaElement) => {
    const end = textarea.value.length;
    textarea.focus();
    textarea.setSelectionRange(end, end);
    await act(async () => {
      textarea.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          code: 'Enter',
          bubbles: true,
        }),
      );
    });
    return textarea.value;
  };

  const pressEnterAt = async (textarea: HTMLTextAreaElement, index: number) => {
    textarea.focus();
    textarea.setSelectionRange(index, index);
    await act(async () => {
      textarea.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          code: 'Enter',
          bubbles: true,
        }),
      );
    });
    return textarea.value;
  };

  it('renders one outcomes-first article with subtle authorship', async () => {
    await act(async () => renderDocument());

    const sectionHeadings = Array.from(
      container.querySelectorAll('[data-notes-section] > h2'),
    ).map((heading) => heading.textContent?.trim());
    expect(sectionHeadings).toEqual([
      'Decisions & next steps',
      'Documentation architecture',
    ]);
    expect(container.textContent).not.toContain('Written by you');
    expect(container.querySelectorAll('article')).toHaveLength(1);
    expect(
      container.querySelector('[data-analysis-quality-notice]'),
    ).toBeNull();
  });

  it('calmly discloses degraded analysis without hiding usable notes', async () => {
    await act(async () =>
      root.render(
        <MeetingNotesDocument
          meeting={{
            ...meeting,
            analysis_json: JSON.stringify({
              analysis_schema_version: 3,
              overview: 'A usable summary.',
              topics: [],
              all_action_items: [],
              all_decisions: [],
              meeting_type: 'one_on_one',
              quality: {
                format_pass: true,
                retry_count: 0,
                fallback_used: false,
                issues: [
                  'Meeting-wide consolidation was limited by local context capacity.',
                ],
              },
            }),
          }}
          model={model}
          transcriptSegments={transcript}
          onDocumentChanged={vi.fn()}
          onShowTranscript={vi.fn()}
        />,
      ),
    );

    expect(
      container.querySelector('[data-analysis-quality-notice]'),
    ).toBeNull();
    expect(container.textContent).toContain('Documentation architecture');
  });

  it('keeps the note focused when source browsing is not explicitly opened', async () => {
    await act(async () => renderDocument());

    const source = document.querySelector('[data-notes-source]');
    expect(source).toBeNull();
    expect(container.textContent).toContain('Documentation architecture');
  });

  it('does not render a duplicate scratchpad beside the meeting document', async () => {
    vi.useFakeTimers();
    await act(async () => renderDocument());

    const notes = container.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Your meeting notes"]',
    );
    expect(notes).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
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

  it('creates a native continuation record when pressing Enter at a decision block end', async () => {
    await act(async () => renderDocument());
    const textarea = await openBlockEditor('Use docs as code.');
    expect(textarea).toBeTruthy();

    const nextValue = await pressEnterAtEnd(textarea!);
    await act(async () => Promise.resolve());
    expect(nextValue).toBe('Use docs as code.');
    expect(invoke).toHaveBeenCalledWith(
      'SAVE_USER_EDIT',
      expect.objectContaining({
        path: 'native_continuations:all_decisions:0',
        original: '[]',
        edited: expect.stringMatching(/^\[{"id":".+","text":""}\]$/),
      }),
    );
  });

  it('continues note-like outcomes blocks as markdown list items without explicit type', async () => {
    const noteLikeModel: MeetingNotesDocumentModel = {
      hasAnalysis: true,
      sections: [
        {
          id: 'outcomes',
          kind: 'outcomes',
          title: 'Decisions & next steps',
          blocks: [
            {
              id: 'decision-text-without-type',
              path: 'v2:decision:0',
              text: 'Finalize the rollout plan.',
              originalText: 'Finalize the rollout plan.',
              authorship: 'ai',
              edited: false,
            },
          ],
        },
      ],
    };

    await act(async () =>
      root.render(
        <MeetingNotesDocument
          meeting={meeting}
          model={noteLikeModel}
          transcriptSegments={[]}
          onDocumentChanged={vi.fn()}
          onShowTranscript={vi.fn()}
        />,
      ),
    );

    const textarea = await openBlockEditor('Finalize the rollout plan.');
    const nextValue = await pressEnterAtEnd(textarea!);
    expect(nextValue).toBe('Finalize the rollout plan.');
  });

  it('continues discussion note blocks as markdown list items without an explicit block type', async () => {
    const discussionModel: MeetingNotesDocumentModel = {
      hasAnalysis: true,
      sections: [
        {
          id: 'topic-0',
          kind: 'discussion',
          title: 'Team alignment',
          blocks: [
            {
              id: 'topic-0-point-0',
              path: 'topic:0:point:0',
              text: 'Align on migration boundaries.',
              originalText: 'Align on migration boundaries.',
              authorship: 'ai',
              edited: false,
            },
          ],
        },
      ],
    };

    await act(async () =>
      root.render(
        <MeetingNotesDocument
          meeting={meeting}
          model={discussionModel}
          transcriptSegments={[]}
          onDocumentChanged={vi.fn()}
          onShowTranscript={vi.fn()}
        />,
      ),
    );

    const textarea = await openBlockEditor('Align on migration boundaries.');
    const nextValue = await pressEnterAtEnd(textarea!);
    expect(nextValue).toBe('Align on migration boundaries.');
  });

  it('keeps an existing valid Markdown plus line readable', async () => {
    const markdownListModel: MeetingNotesDocumentModel = {
      hasAnalysis: true,
      sections: [
        {
          id: 'outcomes',
          kind: 'outcomes',
          title: 'Decisions & next steps',
          blocks: [
            {
              id: 'native-list-preview',
              path: 'all_decisions:0',
              text: 'Use docs as code.\n+ Follow up with QA',
              originalText: 'Use docs as code.\n+ Follow up with QA',
              authorship: 'ai',
              edited: false,
              blockType: 'decision',
            },
          ],
        },
      ],
    };

    await act(async () =>
      root.render(
        <MeetingNotesDocument
          meeting={meeting}
          model={markdownListModel}
          transcriptSegments={[]}
          onDocumentChanged={vi.fn()}
          onShowTranscript={vi.fn()}
        />,
      ),
    );

    const block = Array.from(
      container.querySelectorAll('.meeting-note-block'),
    ).find((node) => node.textContent?.includes('Use docs as code.'));
    const preview = block?.querySelector<HTMLDivElement>(
      '.meeting-markdown-preview',
    );
    expect(preview).toBeTruthy();
    expect(preview?.querySelector('ul')).toBeTruthy();
  });

  it('does not reinterpret a literal plus line without a spacer', async () => {
    const markdownListModel: MeetingNotesDocumentModel = {
      hasAnalysis: true,
      sections: [
        {
          id: 'outcomes',
          kind: 'outcomes',
          title: 'Decisions & next steps',
          blocks: [
            {
              id: 'native-list-preview-no-space',
              path: 'all_decisions:0',
              text: 'Use docs as code.\n+Follow up with QA',
              originalText: 'Use docs as code.\n+Follow up with QA',
              authorship: 'ai',
              edited: false,
              blockType: 'decision',
            },
          ],
        },
      ],
    };

    await act(async () =>
      root.render(
        <MeetingNotesDocument
          meeting={meeting}
          model={markdownListModel}
          transcriptSegments={[]}
          onDocumentChanged={vi.fn()}
          onShowTranscript={vi.fn()}
        />,
      ),
    );

    const block = Array.from(
      container.querySelectorAll('.meeting-note-block'),
    ).find((node) => node.textContent?.includes('Use docs as code.'));
    const preview = block?.querySelector<HTMLDivElement>(
      '.meeting-markdown-preview',
    );
    expect(preview).toBeTruthy();
    expect(preview?.querySelector('ul')).toBeNull();
  });

  it('does not create an empty Markdown list from a literal plus line', async () => {
    const markdownListModel: MeetingNotesDocumentModel = {
      hasAnalysis: true,
      sections: [
        {
          id: 'outcomes',
          kind: 'outcomes',
          title: 'Decisions & next steps',
          blocks: [
            {
              id: 'native-list-placeholder',
              path: 'all_decisions:0',
              text: 'Use docs as code.\n+ ',
              originalText: 'Use docs as code.\n+ ',
              authorship: 'ai',
              edited: false,
              blockType: 'decision',
            },
          ],
        },
      ],
    };

    await act(async () =>
      root.render(
        <MeetingNotesDocument
          meeting={meeting}
          model={markdownListModel}
          transcriptSegments={[]}
          onDocumentChanged={vi.fn()}
          onShowTranscript={vi.fn()}
        />,
      ),
    );

    const block = Array.from(
      container.querySelectorAll('.meeting-note-block'),
    ).find((node) => node.textContent?.includes('Use docs as code.'));
    if (!block) throw new Error('Expected markdown block');
    const preview = block?.querySelector<HTMLDivElement>(
      '.meeting-markdown-preview',
    );
    expect(preview).toBeTruthy();
    expect(preview?.querySelector('ul')).toBeNull();
  });

  it('renders a persisted continuation as a native sibling with its checkbox', async () => {
    const continuationModel: MeetingNotesDocumentModel = {
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
              blockType: 'decision',
              nativeContinuations: [
                { id: 'follow-up', text: 'Follow up with QA.' },
              ],
            },
            {
              id: 'decision-0:continuation:follow-up',
              text: 'Follow up with QA.',
              originalText: 'Follow up with QA.',
              authorship: 'human',
              edited: true,
              blockType: 'decision',
              nativeContinuation: {
                parentPath: 'all_decisions:0',
                id: 'follow-up',
              },
              nativeContinuations: [
                { id: 'follow-up', text: 'Follow up with QA.' },
              ],
            },
          ],
        },
      ],
    };

    await act(async () =>
      root.render(
        <MeetingNotesDocument
          meeting={meeting}
          model={continuationModel}
          transcriptSegments={[]}
          onDocumentChanged={vi.fn()}
          onShowTranscript={vi.fn()}
        />,
      ),
    );

    expect(container.querySelectorAll('.meeting-note-block')).toHaveLength(2);
    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(
      2,
    );
    const continuation = container.querySelectorAll('.meeting-note-block')[1];
    expect(continuation.textContent).toContain('Follow up with QA.');
    expect(continuation.querySelector('ul')).toBeNull();

    await act(async () =>
      continuation
        .querySelector<HTMLInputElement>('input[type="checkbox"]')
        ?.click(),
    );
    expect(invoke).toHaveBeenCalledWith('SAVE_USER_EDIT', {
      meetingId: meeting.id,
      path: 'native_continuations:all_decisions:0',
      original: '[]',
      edited: JSON.stringify([
        { id: 'follow-up', text: 'Follow up with QA.', completed: true },
      ]),
    });
  });

  it('removes an abandoned empty native continuation row', async () => {
    const emptyContinuationModel: MeetingNotesDocumentModel = {
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
              blockType: 'decision',
              nativeContinuations: [{ id: 'empty', text: '' }],
            },
            {
              id: 'decision-0:continuation:empty',
              text: '',
              originalText: '',
              authorship: 'human',
              edited: true,
              blockType: 'decision',
              nativeContinuation: {
                parentPath: 'all_decisions:0',
                id: 'empty',
              },
              nativeContinuations: [{ id: 'empty', text: '' }],
            },
          ],
        },
      ],
    };

    await act(async () =>
      root.render(
        <MeetingNotesDocument
          meeting={meeting}
          model={emptyContinuationModel}
          transcriptSegments={[]}
          onDocumentChanged={vi.fn()}
          onShowTranscript={vi.fn()}
        />,
      ),
    );

    const emptyBlock = container.querySelectorAll('.meeting-note-block')[1];
    const preview = emptyBlock.querySelector<HTMLDivElement>(
      '.meeting-markdown-preview',
    );
    await act(async () =>
      preview?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })),
    );
    await act(async () => emptyBlock.querySelector('textarea')?.blur());

    expect(invoke).toHaveBeenCalledWith('SAVE_USER_EDIT', {
      meetingId: meeting.id,
      path: 'native_continuations:all_decisions:0',
      original: '[]',
      edited: '[]',
    });
  });

  it('does not prepend a native list item when Enter is not at the block end', async () => {
    const inlineModel: MeetingNotesDocumentModel = {
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
              blockType: 'decision',
            },
          ],
        },
      ],
    };

    await act(async () =>
      root.render(
        <MeetingNotesDocument
          meeting={meeting}
          model={inlineModel}
          transcriptSegments={[]}
          onDocumentChanged={vi.fn()}
          onShowTranscript={vi.fn()}
        />,
      ),
    );

    const textarea = await openBlockEditor('Use docs as code.');
    const nextValue = await pressEnterAt(textarea!, 4);
    expect(nextValue).toBe('Use docs as code.');
  });
});
