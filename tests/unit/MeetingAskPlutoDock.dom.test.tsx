// @vitest-environment happy-dom

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingAskPlutoDock } from '../../src/components/features/MeetingAskPlutoDock';
import type { Meeting } from '../../src/types';
import type {
  MeetingAskPlutoAnswerDelta,
  MeetingAskPlutoConversationMessage,
  MeetingAskPlutoLiveContext,
  MeetingAskPlutoResponse,
} from '../../src/types/askPluto';
import { MEETING_ASK_PLUTO_LIMITS } from '../../src/utils/meetingAskPlutoRequest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const flushPromises = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

const makeMeeting = (overrides: Partial<Meeting> = {}): Meeting => ({
  id: 'meeting-1',
  title: 'Architecture Review',
  created_at: '2026-08-18T10:00:00.000Z',
  started_at: '2026-08-18T10:00:00.000Z',
  transcript_json: JSON.stringify({
    segments: [{ speaker: 'Avery', text: 'We decided to use GraphQL.' }],
  }),
  transcript_status: 'validated',
  finalization_status: 'finalized',
  ...overrides,
});

const liveContext: MeetingAskPlutoLiveContext = {
  title: 'Launch review',
  participants: ['Avery'],
  notes: 'Remember to follow up on pricing.',
  transcript: [
    {
      id: 'segment-1',
      speaker: 'Me',
      text: 'We decided to launch on Friday.',
      timestampMs: 4_000,
      confirmed: true,
    },
  ],
  interimText: '',
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

const typeInto = async (input: HTMLTextAreaElement, value: string) => {
  const valueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    'value',
  )?.set;
  expect(valueSetter).toBeDefined();

  await act(async () => {
    valueSetter!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await flushPromises();
  });
};

describe('MeetingAskPlutoDock', () => {
  let container: HTMLDivElement;
  let invoke: ReturnType<typeof vi.fn>;
  let ipcListeners: Map<
    string,
    (event: unknown, packet: MeetingAskPlutoAnswerDelta) => void
  >;
  let on: ReturnType<typeof vi.fn>;
  let scrollIntoView: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    invoke = vi.fn(async () => response);
    ipcListeners = new Map();
    on = vi.fn(
      (
        channel: string,
        listener: (event: unknown, packet: MeetingAskPlutoAnswerDelta) => void,
      ) => {
        ipcListeners.set(channel, listener);
        return () => ipcListeners.delete(channel);
      },
    );
    scrollIntoView = vi.fn();
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });
    Object.defineProperty(window, 'ipcRenderer', {
      configurable: true,
      value: {
        invoke,
        on,
      },
    });
  });

  afterEach(() => {
    container.remove();
    vi.restoreAllMocks();
  });

  it('submits a meeting-scoped question and renders only the conversational answer', async () => {
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <MeetingAskPlutoDock
          meeting={makeMeeting()}
          onOpenMeeting={() => {}}
        />,
      );
      await flushPromises();
    });

    const input = container.querySelector<HTMLTextAreaElement>(
      'textarea[placeholder="Ask about this meeting"]',
    );
    expect(input).not.toBeNull();

    await typeInto(input!, 'What did we decide?');
    await act(async () => {
      input!.form?.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      );
      await flushPromises();
    });

    expect(invoke).toHaveBeenCalledWith('intelligence:meeting-chat', {
      requestId: expect.stringMatching(/^ask-pluto-/),
      query: 'What did we decide?',
      scope: {
        type: 'meeting',
        meetingId: 'meeting-1',
      },
      turns: [],
    });
    expect(container.textContent).toContain(
      'The team decided to use GraphQL for the API layer.',
    );
    expect(
      container.querySelector('.meeting-ask-pluto-dock__pluto-mark'),
    ).not.toBeNull();
    expect(
      container.querySelector('.meeting-ask-pluto-dock__message--assistant'),
    ).not.toBeNull();
    expect(container.textContent).toContain('Architecture Review');
    expect(container.textContent).not.toContain('Grounded');
    expect(container.textContent).not.toContain('We decided to use GraphQL.');

    await act(async () => root.unmount());
  });

  it('streams only the active answer before replacing it with the final packet', async () => {
    const root = createRoot(container);
    let resolveResponse: (packet: MeetingAskPlutoResponse) => void = () => {};
    invoke.mockImplementationOnce(
      () =>
        new Promise<MeetingAskPlutoResponse>((resolve) => {
          resolveResponse = resolve;
        }),
    );

    await act(async () => {
      root.render(<MeetingAskPlutoDock liveContext={liveContext} />);
      await flushPromises();
    });

    expect(on).toHaveBeenCalledWith(
      'intelligence:meeting-chat:delta',
      expect.any(Function),
    );
    const input = container.querySelector<HTMLTextAreaElement>(
      'textarea[placeholder="Ask about this meeting"]',
    );
    await typeInto(input!, 'What did we decide?');
    await act(async () => {
      input!.form?.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      );
      await flushPromises();
    });

    const requestId = invoke.mock.calls[0]?.[1]?.requestId as string;
    const emitDelta = ipcListeners.get('intelligence:meeting-chat:delta');
    expect(emitDelta).toBeDefined();
    scrollIntoView.mockClear();

    await act(async () => {
      emitDelta?.(null, {
        requestId: 'stale-request',
        delta: 'This must stay hidden.',
      });
      emitDelta?.(null, { requestId, delta: '**GraphQL** was selected' });
      await flushPromises();
    });

    expect(container.textContent).not.toContain('This must stay hidden.');
    expect(container.querySelector('strong')?.textContent).toBe('GraphQL');
    expect(container.textContent).toContain('GraphQL was selected');
    expect(container.textContent).toContain('Pluto is responding…');
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(
      container.querySelector('.meeting-ask-pluto-dock__stream-caret'),
    ).toBeNull();
    expect(container.textContent).not.toContain('Reading live transcript');

    await act(async () => {
      resolveResponse(response);
      await flushPromises();
    });

    expect(container.textContent).toContain(response.answer);
    expect(container.textContent).not.toContain('GraphQL was selected');
    expect(container.textContent).not.toContain('Pluto is responding…');
    expect(
      container.querySelector('.meeting-ask-pluto-dock__stream-caret'),
    ).toBeNull();

    await act(async () => root.unmount());
    expect(ipcListeners.has('intelligence:meeting-chat:delta')).toBe(false);
  });

  it('leaves answering state after completion under React Strict Mode', async () => {
    const root = createRoot(container);
    let resolveResponse: (packet: MeetingAskPlutoResponse) => void = () => {};
    invoke.mockImplementationOnce(
      () =>
        new Promise<MeetingAskPlutoResponse>((resolve) => {
          resolveResponse = resolve;
        }),
    );

    await act(async () => {
      root.render(
        <StrictMode>
          <MeetingAskPlutoDock liveContext={liveContext} />
        </StrictMode>,
      );
      await flushPromises();
    });

    const input = container.querySelector<HTMLTextAreaElement>('textarea');
    await typeInto(input!, 'Summarize this discussion');
    await act(async () => {
      input!.form?.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      );
      await flushPromises();
    });

    const requestId = invoke.mock.calls[0]?.[1]?.requestId as string;
    await act(async () => {
      ipcListeners.get('intelligence:meeting-chat:delta')?.(null, {
        requestId,
        delta: 'A complete streamed answer.',
      });
      await flushPromises();
    });
    expect(container.textContent).toContain('Pluto is responding…');

    await act(async () => {
      resolveResponse(response);
      await flushPromises();
    });

    expect(container.textContent).toContain(response.answer);
    expect(container.textContent).not.toContain('Pluto is responding…');
    expect(
      container.querySelector('button[aria-label="Send question"]'),
    ).not.toBeNull();

    await act(async () => root.unmount());
  });

  it('keeps a follow-up draft editable and can stop a stuck answer', async () => {
    const root = createRoot(container);
    let resolveResponse: (packet: MeetingAskPlutoResponse) => void = () => {};
    invoke.mockImplementationOnce(
      () =>
        new Promise<MeetingAskPlutoResponse>((resolve) => {
          resolveResponse = resolve;
        }),
    );

    await act(async () => {
      root.render(<MeetingAskPlutoDock liveContext={liveContext} />);
      await flushPromises();
    });

    const input = container.querySelector<HTMLTextAreaElement>('textarea');
    await typeInto(input!, 'Give me a gist');
    await act(async () => {
      input!.form?.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      );
      await flushPromises();
    });

    await typeInto(input!, 'What kind of questions can I ask?');
    expect(input?.disabled).toBe(false);
    expect(input?.value).toBe('What kind of questions can I ask?');
    const stopButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Stop answering"]',
    );
    expect(stopButton).not.toBeNull();

    const requestId = invoke.mock.calls[0]?.[1]?.requestId as string;
    await act(async () => {
      ipcListeners.get('intelligence:meeting-chat:delta')?.(null, {
        requestId,
        delta: 'This is a useful partial answer.',
      });
      await flushPromises();
    });

    await act(async () => {
      stopButton!.click();
      await flushPromises();
    });

    expect(invoke).toHaveBeenCalledWith(
      'intelligence:meeting-chat:cancel',
      expect.stringMatching(/^ask-pluto-/),
    );
    expect(input?.value).toBe('What kind of questions can I ask?');
    expect(
      container.querySelector('button[aria-label="Send question"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('.meeting-ask-pluto-dock__loading'),
    ).toBeNull();
    expect(container.textContent).toContain('This is a useful partial answer.');
    expect(container.textContent).toContain('Stopped');

    await act(async () => {
      resolveResponse(response);
      await flushPromises();
    });
    expect(container.textContent).not.toContain(response.answer);

    await act(async () => {
      input!.form?.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      );
      await flushPromises();
    });
    const chatCalls = invoke.mock.calls.filter(
      ([channel]) => channel === 'intelligence:meeting-chat',
    );
    expect(chatCalls).toHaveLength(2);
    expect(chatCalls[1]?.[1]).toEqual(
      expect.objectContaining({
        query: 'What kind of questions can I ask?',
        turns: [{ role: 'user', content: 'Give me a gist' }],
      }),
    );

    await act(async () => root.unmount());
  });

  it('preserves structured Markdown in Pluto answers', async () => {
    const root = createRoot(container);
    const markdownAnswer = [
      'Here is the update:',
      '',
      '- **Isha** owns the review.',
      '- The transcript is live.',
      '',
      '1. Confirm the score.',
      '2. Share the result.',
      '',
      '[Open the meeting](https://example.com/meeting).',
    ].join('\n');

    await act(async () => {
      root.render(
        <MeetingAskPlutoDock
          liveContext={liveContext}
          conversation={[
            {
              id: 'assistant-markdown',
              role: 'assistant',
              content: markdownAnswer,
              packet: { ...response, answer: markdownAnswer },
            },
          ]}
        />,
      );
      await flushPromises();
    });

    const answer = container.querySelector(
      '.meeting-ask-pluto-dock__message--assistant',
    );
    expect(answer?.querySelectorAll('p')).toHaveLength(2);
    expect(answer?.querySelectorAll('ul > li')).toHaveLength(2);
    expect(answer?.querySelectorAll('ol > li')).toHaveLength(2);
    expect(answer?.querySelector('strong')?.textContent).toBe('Isha');
    expect(answer?.querySelector('a')).toBeNull();
    expect(answer?.textContent).toContain('Open the meeting');

    await act(async () => root.unmount());
  });

  it('does not append a completed answer after its dock unmounts', async () => {
    const root = createRoot(container);
    const onConversationChange = vi.fn();
    let resolveResponse: (packet: MeetingAskPlutoResponse) => void = () => {};
    invoke.mockImplementationOnce(
      () =>
        new Promise<MeetingAskPlutoResponse>((resolve) => {
          resolveResponse = resolve;
        }),
    );

    await act(async () => {
      root.render(
        <MeetingAskPlutoDock
          liveContext={liveContext}
          conversation={[]}
          onConversationChange={onConversationChange}
        />,
      );
      await flushPromises();
    });

    const input = container.querySelector<HTMLTextAreaElement>('textarea');
    await typeInto(input!, 'What did we decide?');
    await act(async () => {
      input!.form?.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      );
      await flushPromises();
    });
    expect(onConversationChange).toHaveBeenCalledTimes(1);

    await act(async () => root.unmount());
    expect(invoke).toHaveBeenCalledWith(
      'intelligence:meeting-chat:cancel',
      expect.stringMatching(/^ask-pluto-/),
    );
    await act(async () => {
      resolveResponse(response);
      await flushPromises();
    });

    expect(onConversationChange).toHaveBeenCalledTimes(1);
  });

  it('labels the send action and announces conversation updates', async () => {
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <MeetingAskPlutoDock
          liveContext={liveContext}
          conversation={[
            {
              id: 'assistant-answer',
              role: 'assistant',
              content: response.answer,
              packet: response,
            },
          ]}
        />,
      );
      await flushPromises();
    });

    expect(
      container.querySelector('[role="log"][aria-live="polite"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('button[aria-label="Send question"]'),
    ).not.toBeNull();
    expect(container.querySelector('textarea')?.maxLength).toBe(4_000);

    await act(async () => root.unmount());
  });

  it('starts as a compact live composer without pushing starter content', async () => {
    const root = createRoot(container);

    await act(async () => {
      root.render(<MeetingAskPlutoDock liveContext={liveContext} />);
      await flushPromises();
    });

    const dock = container.querySelector<HTMLElement>(
      '[aria-label="Ask Pluto"]',
    );
    expect(dock?.className).toContain('meeting-ask-pluto-dock--compact');
    expect(dock?.className).toContain('meeting-ask-pluto-dock--stable-width');
    expect(dock?.className).not.toContain('meeting-ask-pluto-dock--expanded');
    expect(container.textContent).not.toContain(
      'What decisions were made here?',
    );
    expect(container.textContent).not.toContain('Meeting only');

    const input = container.querySelector<HTMLTextAreaElement>(
      'textarea[placeholder="Ask about this meeting"]',
    );
    expect(input).not.toBeNull();
    expect(input?.getAttribute('rows')).toBe('1');

    await act(async () => root.unmount());
  });

  it('expands the live composer while typing and caps composer growth', async () => {
    const root = createRoot(container);

    await act(async () => {
      root.render(<MeetingAskPlutoDock liveContext={liveContext} />);
      await flushPromises();
    });

    const input = container.querySelector<HTMLTextAreaElement>(
      'textarea[placeholder="Ask about this meeting"]',
    );
    expect(input).not.toBeNull();

    await typeInto(input!, Array.from({ length: 10 }, () => 'line').join('\n'));

    const dock = container.querySelector<HTMLElement>(
      '[aria-label="Ask Pluto"]',
    );
    expect(dock?.className).toContain('meeting-ask-pluto-dock--expanded');
    expect(dock?.className).toContain('meeting-ask-pluto-dock--stable-width');
    expect(input?.getAttribute('rows')).toBe('5');

    await act(async () => root.unmount());
  });

  it('submits only recent bounded live transcript context', async () => {
    const root = createRoot(container);
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const longLiveContext: MeetingAskPlutoLiveContext = {
      ...liveContext,
      transcript: Array.from({ length: 80 }, (_, index) => ({
        id: `segment-${index}`,
        speaker: 'Me',
        text: `segment ${index} ${'detail '.repeat(80)}`,
        timestampMs: index * 1_000,
        confirmed: true,
      })),
      participants: Array.from({ length: 20 }, (_, index) => `Person ${index}`),
      notes: 'note '.repeat(1_000),
      interimText: 'interim '.repeat(500),
    };

    await act(async () => {
      root.render(<MeetingAskPlutoDock liveContext={longLiveContext} />);
      await flushPromises();
    });

    const input = container.querySelector<HTMLTextAreaElement>(
      'textarea[placeholder="Ask about this meeting"]',
    );
    expect(input).not.toBeNull();

    await typeInto(input!, 'help me understand whats going on');
    await act(async () => {
      input!.form?.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      );
      await flushPromises();
    });

    const request = invoke.mock.calls[0]?.[1];
    expect(request.requestId).toMatch(/^ask-pluto-/);
    expect(request.answerMode).toBeUndefined();
    expect(request.scope.type).toBe('live_meeting');
    expect(request.scope.transcript).toHaveLength(24);
    expect(request.scope.transcript[0].id).toBe('segment-56');
    expect(request.scope.transcript.at(-1).id).toBe('segment-79');
    expect(request.scope.transcript[0].text.length).toBeLessThanOrEqual(500);
    expect(request.scope.participants).toHaveLength(8);
    expect(request.scope.notes.length).toBeLessThanOrEqual(1800);
    expect(request.scope.interimText.length).toBeLessThanOrEqual(700);
    expect(infoSpy).toHaveBeenCalledWith(
      '[Pluto][Ask Pluto][renderer] request',
      expect.objectContaining({
        requestId: request.requestId,
        scopeType: 'live_meeting',
        transcriptSegments: 24,
        participantCount: 8,
      }),
    );
    expect(JSON.stringify(infoSpy.mock.calls)).not.toContain(
      'help me understand whats going on',
    );

    await act(async () => root.unmount());
  });

  it('uses a neutral title when asking about an untitled live meeting', async () => {
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <MeetingAskPlutoDock liveContext={{ ...liveContext, title: '' }} />,
      );
      await flushPromises();
    });

    const input = container.querySelector<HTMLTextAreaElement>(
      'textarea[placeholder="Ask about this meeting"]',
    );
    await typeInto(input!, 'What did we decide?');
    await act(async () => {
      input!.form?.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      );
      await flushPromises();
    });

    expect(invoke).toHaveBeenCalledWith(
      'intelligence:meeting-chat',
      expect.objectContaining({
        scope: expect.objectContaining({
          type: 'live_meeting',
          title: 'Meeting',
        }),
      }),
    );

    await act(async () => root.unmount());
  });

  it('surfaces an unavailable answer and clears the loading state', async () => {
    const root = createRoot(container);
    invoke.mockResolvedValueOnce({
      ...response,
      status: 'unavailable',
      answer: '',
      rationale: 'The meeting question request was invalid.',
    });

    await act(async () => {
      root.render(<MeetingAskPlutoDock liveContext={liveContext} />);
      await flushPromises();
    });

    const input = container.querySelector<HTMLTextAreaElement>(
      'textarea[placeholder="Ask about this meeting"]',
    );
    await typeInto(input!, 'What did we decide?');
    await act(async () => {
      input!.form?.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      );
      await flushPromises();
    });

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Pluto could not answer this meeting right now.',
    );
    expect(
      container.querySelector('.meeting-ask-pluto-dock__loading'),
    ).toBeNull();
    expect(
      container.querySelector('.meeting-ask-pluto-dock__message--assistant'),
    ).toBeNull();
    expect(
      container.querySelector('button[aria-label="Send question"]'),
    ).not.toBeNull();

    await act(async () => root.unmount());
  });

  it('minimizes outside and restores the active conversation without resubmitting', async () => {
    const root = createRoot(container);

    await act(async () => {
      root.render(<MeetingAskPlutoDock liveContext={liveContext} />);
      await flushPromises();
    });

    const input = container.querySelector<HTMLTextAreaElement>(
      'textarea[placeholder="Ask about this meeting"]',
    );
    expect(input).not.toBeNull();

    await typeInto(input!, 'What did we decide?');
    await act(async () => {
      input!.form?.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      );
      await flushPromises();
    });

    expect(container.textContent).toContain(response.answer);
    expect(
      container.querySelector('button[aria-label="Minimize Ask Pluto"]'),
    ).not.toBeNull();

    await act(async () => {
      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      await flushPromises();
    });

    expect(container.textContent).not.toContain(response.answer);
    const restoreButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Restore Ask Pluto conversation"]',
    );
    expect(restoreButton).not.toBeNull();

    await act(async () => {
      restoreButton!.click();
      await flushPromises();
    });

    expect(container.textContent).toContain(response.answer);
    expect(invoke).toHaveBeenCalledTimes(1);

    const minimizeButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Minimize Ask Pluto"]',
    );
    await act(async () => {
      minimizeButton!.click();
      await flushPromises();
    });
    expect(
      container.querySelector(
        'button[aria-label="Restore Ask Pluto conversation"]',
      ),
    ).not.toBeNull();

    await act(async () => root.unmount());
  });

  it('reports minimize and restore actions through controlled state', async () => {
    const root = createRoot(container);
    const onMinimizedChange = vi.fn();
    const conversation: MeetingAskPlutoConversationMessage[] = [
      { id: 'user-1', role: 'user', content: 'What did I miss?' },
      {
        id: 'assistant-1',
        role: 'assistant',
        content: response.answer,
        packet: response,
      },
    ];

    await act(async () => {
      root.render(
        <MeetingAskPlutoDock
          liveContext={liveContext}
          conversation={conversation}
          isMinimized={false}
          onMinimizedChange={onMinimizedChange}
        />,
      );
      await flushPromises();
    });

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Minimize Ask Pluto"]',
        )
        ?.click();
      await flushPromises();
    });
    expect(onMinimizedChange).toHaveBeenLastCalledWith(true);

    await act(async () => {
      root.render(
        <MeetingAskPlutoDock
          liveContext={liveContext}
          conversation={conversation}
          isMinimized
          onMinimizedChange={onMinimizedChange}
        />,
      );
      await flushPromises();
    });
    expect(
      container.querySelector(
        'button[aria-label="Restore Ask Pluto conversation"]',
      ),
    ).not.toBeNull();

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Restore Ask Pluto conversation"]',
        )
        ?.click();
      await flushPromises();
    });
    expect(onMinimizedChange).toHaveBeenLastCalledWith(false);

    await act(async () => root.unmount());
  });

  it('restores a controlled conversation after the Zen dock remounts', async () => {
    const root = createRoot(container);
    let conversation: MeetingAskPlutoConversationMessage[] = [];
    const setConversation = vi.fn(
      (
        update:
          | MeetingAskPlutoConversationMessage[]
          | ((
              previous: MeetingAskPlutoConversationMessage[],
            ) => MeetingAskPlutoConversationMessage[]),
      ) => {
        conversation =
          typeof update === 'function' ? update(conversation) : update;
      },
    );

    await act(async () => {
      root.render(
        <MeetingAskPlutoDock
          liveContext={liveContext}
          conversation={conversation}
          onConversationChange={setConversation}
        />,
      );
      await flushPromises();
    });

    const input = container.querySelector<HTMLTextAreaElement>(
      'textarea[placeholder="Ask about this meeting"]',
    );
    await typeInto(input!, 'What did we decide?');
    await act(async () => {
      input!.form?.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      );
      await flushPromises();
    });

    await act(async () => {
      root.render(null);
      await flushPromises();
    });
    await act(async () => {
      root.render(
        <MeetingAskPlutoDock
          liveContext={liveContext}
          conversation={conversation}
          onConversationChange={setConversation}
        />,
      );
      await flushPromises();
    });

    expect(container.textContent).toContain(response.answer);
    expect(invoke).toHaveBeenCalledTimes(1);

    await act(async () => root.unmount());
  });

  it('anchors each submitted question at the top of the reading area', async () => {
    const root = createRoot(container);

    await act(async () => {
      root.render(<MeetingAskPlutoDock liveContext={liveContext} />);
      await flushPromises();
    });

    const input = container.querySelector<HTMLTextAreaElement>(
      'textarea[placeholder="Ask about this meeting"]',
    );
    await typeInto(input!, 'What is happening?');
    await act(async () => {
      input!.form?.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      );
      await flushPromises();
    });

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'start',
    });
    expect(
      (scrollIntoView.mock.instances[0] as HTMLElement).getAttribute(
        'data-chat-turn-id',
      ),
    ).toMatch(/^user-/);

    await act(async () => root.unmount());
  });

  it('does not move the viewport when controlled conversation content changes', async () => {
    const root = createRoot(container);
    const firstConversation: MeetingAskPlutoConversationMessage[] = [
      { id: 'user-1', role: 'user', content: 'What happened?' },
      {
        id: 'assistant-1',
        role: 'assistant',
        content: response.answer,
        packet: response,
      },
    ];

    await act(async () => {
      root.render(
        <MeetingAskPlutoDock
          liveContext={liveContext}
          conversation={firstConversation}
        />,
      );
      await flushPromises();
    });

    expect(scrollIntoView).not.toHaveBeenCalled();

    const secondConversation: MeetingAskPlutoConversationMessage[] = [
      ...firstConversation,
      { id: 'user-2', role: 'user', content: 'What comes next?' },
    ];
    await act(async () => {
      root.render(
        <MeetingAskPlutoDock
          liveContext={liveContext}
          conversation={secondConversation}
        />,
      );
      await flushPromises();
    });
    expect(scrollIntoView).not.toHaveBeenCalled();

    await act(async () => {
      root.render(
        <MeetingAskPlutoDock
          liveContext={liveContext}
          conversation={[
            ...secondConversation,
            {
              id: 'assistant-2',
              role: 'assistant',
              content: 'Avery will confirm pricing on Friday.',
              packet: response,
            },
          ]}
        />,
      );
      await flushPromises();
    });
    expect(scrollIntoView).not.toHaveBeenCalled();

    await act(async () => root.unmount());
  });

  it('sends bounded prior meeting turns for follow-up questions', async () => {
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <MeetingAskPlutoDock
          meeting={makeMeeting()}
          onOpenMeeting={() => {}}
        />,
      );
      await flushPromises();
    });

    const input = container.querySelector<HTMLTextAreaElement>(
      'textarea[placeholder="Ask about this meeting"]',
    );
    expect(input).not.toBeNull();

    await typeInto(input!, 'What did we decide?');
    await act(async () => {
      input!.form?.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      );
      await flushPromises();
    });

    await typeInto(input!, 'Why?');
    await act(async () => {
      input!.form?.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      );
      await flushPromises();
    });

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

    await act(async () => root.unmount());
  });

  it('bounds long conversation history before crossing IPC', async () => {
    const root = createRoot(container);
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

    await act(async () => {
      root.render(
        <MeetingAskPlutoDock
          meeting={makeMeeting()}
          conversation={conversation}
          onConversationChange={() => {}}
          onOpenMeeting={() => {}}
        />,
      );
      await flushPromises();
    });

    const input = container.querySelector<HTMLTextAreaElement>(
      'textarea[placeholder="Ask about this meeting"]',
    );
    await typeInto(input!, 'Why?');
    await act(async () => {
      input!.form?.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      );
      await flushPromises();
    });

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

    await act(async () => root.unmount());
  });
});
