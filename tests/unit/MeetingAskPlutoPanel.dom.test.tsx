// @vitest-environment happy-dom

import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingAskPlutoPanel } from '../../src/components/features/MeetingAskPlutoPanel';
import type { Meeting } from '../../src/types';
import type {
  MeetingAskPlutoAnswerDelta,
  MeetingAskPlutoConversationMessage,
  MeetingAskPlutoResponse,
} from '../../src/types/askPluto';
import { MEETING_ASK_PLUTO_LIMITS } from '../../src/utils/meetingAskPlutoRequest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const flushPromises = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

const meeting: Meeting = {
  id: 'meeting-1',
  title: 'Architecture Review',
  created_at: '2026-08-18T10:00:00.000Z',
  started_at: '2026-08-18T10:00:00.000Z',
  transcript_json: JSON.stringify({
    segments: [{ speaker: 'Avery', text: 'We decided to use GraphQL.' }],
  }),
  transcript_status: 'validated',
  finalization_status: 'finalized',
};

const response: MeetingAskPlutoResponse = {
  status: 'answered',
  answer: 'The team decided to use GraphQL for the API layer.',
  scope: {
    type: 'meeting',
    meetingId: 'meeting-1',
    title: 'Architecture Review',
  },
  trustStatus: 'grounded',
  claims: [
    {
      text: 'The team decided to use GraphQL for the API layer.',
      trustStatus: 'grounded',
      citationIds: ['citation-1'],
    },
  ],
  citations: [
    {
      id: 'citation-1',
      claim: 'The team decided to use GraphQL for the API layer.',
      meeting_id: 'meeting-1',
      meeting_title: 'Architecture Review',
      evidence_span: 'We decided to use GraphQL.',
      evidence_valid: true,
      trust_status: 'grounded',
    },
  ],
};

describe('MeetingAskPlutoPanel', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let invoke: ReturnType<typeof vi.fn>;
  let deltaListener:
    | ((event: unknown, packet: MeetingAskPlutoAnswerDelta) => void)
    | undefined;

  const render = async (
    props: Partial<React.ComponentProps<typeof MeetingAskPlutoPanel>> = {},
  ) => {
    await act(async () => {
      root.render(
        <MeetingAskPlutoPanel
          meeting={meeting}
          onClose={() => {}}
          {...props}
        />,
      );
      await flushPromises();
    });
  };

  const input = () =>
    container.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Ask about this meeting"]',
    )!;

  const typeInto = async (value: string) => {
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        'value',
      )?.set?.call(input(), value);
      input().dispatchEvent(new Event('input', { bubbles: true }));
      await flushPromises();
    });
  };

  const askQuestion = async (value: string) => {
    await typeInto(value);
    await act(async () => {
      input().form?.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      );
      await flushPromises();
    });
  };

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    invoke = vi.fn(async () => response);
    deltaListener = undefined;
    Object.defineProperty(window, 'ipcRenderer', {
      configurable: true,
      value: {
        invoke,
        on: vi.fn(
          (
            channel: string,
            listener: (
              event: unknown,
              packet: MeetingAskPlutoAnswerDelta,
            ) => void,
          ) => {
            if (channel === 'intelligence:meeting-chat:delta') {
              deltaListener = listener;
            }
            return () => {
              deltaListener = undefined;
            };
          },
        ),
      },
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it('renders an action preview returned by meeting chat without applying it', async () => {
    invoke.mockImplementation(async (channel: string) =>
      channel === 'PLUTO_ACTION_GET'
        ? {
            id: 'batch',
            state: 'pending',
            items: [
              {
                id: 'action',
                action: {
                  kind: 'append_meeting',
                  meetingId: 'meeting-1',
                  content: 'Decision',
                },
                destination: 'Architecture Review',
                preview: 'Decision',
                revision: 'r',
              },
            ],
          }
        : { ...response, actionBatchId: 'batch' },
    );
    await render();
    await askQuestion('Add this decision to the meeting notes');
    expect(
      container.querySelector('[aria-label="Proposed changes"]'),
    ).not.toBeNull();
    expect(
      invoke.mock.calls.some(([channel]) => channel === 'PLUTO_ACTION_APPLY'),
    ).toBe(false);
  });
  it('is the Notes Ask Pluto panel, scoped to this meeting', async () => {
    await render();

    const panel = container.querySelector('aside.note-ask-panel');
    expect(panel?.getAttribute('aria-label')).toBe(
      'Ask Pluto about this meeting',
    );
    expect(panel?.textContent).toContain('About this meeting');
    expect(panel?.textContent).toContain('Answers use only this meeting.');
    expect(document.activeElement).toBe(input());
    expect(input().placeholder).not.toContain('beta');
    await typeInto('/');
    expect(container.querySelector('[role="listbox"]')).toBeNull();
  });

  it('submits a meeting-scoped question with collapsed supporting evidence', async () => {
    await render();
    await askQuestion('What did we decide?');

    expect(invoke).toHaveBeenCalledWith('intelligence:meeting-chat', {
      requestId: expect.stringMatching(/^ask-pluto-/),
      query: 'What did we decide?',
      scope: {
        type: 'meeting',
        meetingId: 'meeting-1',
      },
      turns: [],
    });
    expect(
      container.querySelector('.note-ask-panel__question')?.textContent,
    ).toBe('What did we decide?');
    expect(
      container.querySelector('.note-ask-panel__answer')?.textContent,
    ).toContain('The team decided to use GraphQL for the API layer.');
    expect(container.textContent).not.toContain('Grounded');
    const evidence = container.querySelector<HTMLDetailsElement>(
      'details.note-ask-panel__evidence',
    );
    expect(evidence?.open).toBe(false);
    expect(evidence?.querySelector('summary')?.textContent).toBe(
      'View evidence',
    );
    expect(evidence?.textContent).toContain('We decided to use GraphQL.');
    expect(input().value).toBe('');
  });

  it('offers to-do and Next time actions under an answer', async () => {
    invoke.mockResolvedValue({
      ...response,
      answer: 'Send the API proposal to Priya.',
    });
    await render({ person: { id: 'person-1', name: 'Priya' } });
    await askQuestion('What did we decide?');

    const labels = Array.from(
      container.querySelectorAll('.answer-actions button'),
    ).map((button) => button.textContent);
    expect(labels).toContain('Add as to-do');
    expect(labels).toContain('Add to Next time with Priya');
  });

  it('streams the active answer, then can stop it and keep the partial text', async () => {
    let resolveAnswer: (value: MeetingAskPlutoResponse) => void = () => {};
    invoke.mockImplementation(async (channel: string) =>
      channel === 'intelligence:meeting-chat'
        ? new Promise((resolve) => {
            resolveAnswer = resolve;
          })
        : null,
    );
    await render();
    await askQuestion('What did we decide?');

    expect(container.textContent).toContain('Reading this meeting…');
    const requestId = invoke.mock.calls[0][1].requestId as string;
    await act(async () => {
      deltaListener?.({}, { requestId: 'other-request', delta: 'Ignored. ' });
      deltaListener?.({}, { requestId, delta: 'The team decided' });
    });
    expect(container.textContent).toContain('The team decided');
    expect(container.textContent).not.toContain('Ignored.');

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Stop answer"]')!
        .click();
    });
    expect(invoke).toHaveBeenCalledWith(
      'intelligence:meeting-chat:cancel',
      requestId,
    );
    expect(container.textContent).toContain('Stopped');
    expect(
      container.querySelector('button[aria-label="Send question"]'),
    ).not.toBeNull();

    await act(async () => {
      resolveAnswer(response);
      await flushPromises();
    });
    expect(container.textContent).not.toContain(
      'The team decided to use GraphQL for the API layer.',
    );
  });

  it('closes on Escape when nothing is running', async () => {
    const onClose = vi.fn();
    await render({ onClose });
    await act(async () => {
      input().dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('surfaces an unavailable answer and clears the loading state', async () => {
    invoke.mockResolvedValue({
      ...response,
      status: 'unavailable',
      answer: '',
    });
    await render();
    await askQuestion('What did we decide?');

    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'Pluto could not answer this meeting right now.',
    );
    expect(container.textContent).not.toContain('Reading this meeting…');
  });

  it('shows the memory message and offers ChatGPT for the refused question', async () => {
    invoke.mockResolvedValueOnce({
      ...response,
      status: 'unavailable',
      answer: 'I stopped answering to protect your Mac’s memory.',
      citations: [],
      claims: [],
      chatGPTFallback: 'available',
    });
    await render();
    await askQuestion('What did we decide?');

    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain(
      'I stopped answering to protect your Mac’s memory.',
    );
    expect(alert?.textContent).toContain('just this once');
    const button = [...container.querySelectorAll('button')].find(
      (candidate) => candidate.textContent === 'Answer with ChatGPT',
    );
    expect(button).toBeDefined();

    await act(async () => {
      button?.click();
      await flushPromises();
    });
    expect(invoke).toHaveBeenLastCalledWith('intelligence:meeting-chat', {
      requestId: expect.stringMatching(/^ask-pluto-/),
      query: 'What did we decide?',
      scope: { type: 'meeting', meetingId: 'meeting-1' },
      turns: [],
      answerWith: 'chatgpt',
    });
    // The question is asked once, answered, and labelled.
    expect(
      container.querySelectorAll('.note-ask-panel__question'),
    ).toHaveLength(1);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.textContent).toContain('Answered by ChatGPT');
  });

  it('does not offer ChatGPT when the main process does not', async () => {
    invoke.mockResolvedValueOnce({
      ...response,
      status: 'unavailable',
      answer: 'I stopped answering to protect your Mac’s memory.',
    });
    await render();
    await askQuestion('What did we decide?');
    expect(container.textContent).not.toContain('Answer with ChatGPT');
  });

  it('sends bounded prior meeting turns for follow-up questions', async () => {
    await render();
    await askQuestion('What did we decide?');
    await askQuestion('Why?');

    expect(invoke).toHaveBeenLastCalledWith('intelligence:meeting-chat', {
      requestId: expect.stringMatching(/^ask-pluto-/),
      query: 'Why?',
      scope: {
        type: 'meeting',
        meetingId: 'meeting-1',
      },
      turns: [
        {
          role: 'user',
          content: 'What did we decide?',
        },
        {
          role: 'assistant',
          content: 'The team decided to use GraphQL for the API layer.',
          citationIds: ['citation-1'],
          evidenceHints: ['We decided to use GraphQL.'],
        },
      ],
    });
  });

  it('bounds long conversation history before crossing IPC', async () => {
    const conversation: MeetingAskPlutoConversationMessage[] = Array.from(
      { length: 8 },
      (_, index) =>
        index % 2 === 0
          ? {
              id: `user-${index}`,
              role: 'user' as const,
              content: `question-${index}`,
            }
          : {
              id: `assistant-${index}`,
              role: 'assistant' as const,
              content: `answer-${index}`,
              packet: response,
            },
    );
    await render({ conversation, onConversationChange: () => {} });
    await askQuestion('Why?');

    const request = invoke.mock.calls
      .filter(([channel]) => channel === 'intelligence:meeting-chat')
      .at(-1)?.[1];
    expect(request.turns).toHaveLength(MEETING_ASK_PLUTO_LIMITS.turns);
    expect(request.turns[0]).toMatchObject({ content: 'question-2' });
    expect(request.turns.at(-1)).toMatchObject({
      content: 'answer-7',
      evidenceHints: ['We decided to use GraphQL.'],
    });
    expect(request.turns[1]).not.toHaveProperty('evidenceHints');
  });

  it('cancels a running answer when the panel closes', async () => {
    invoke.mockImplementation(async (channel: string) =>
      channel === 'intelligence:meeting-chat' ? new Promise(() => {}) : null,
    );
    await render();
    await askQuestion('What did we decide?');
    const requestId = invoke.mock.calls[0][1].requestId as string;

    await act(async () => root.render(<div />));
    expect(invoke).toHaveBeenCalledWith(
      'intelligence:meeting-chat:cancel',
      requestId,
    );
  });
});
