// @vitest-environment happy-dom

import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingAskPlutoDock } from '../../src/components/features/MeetingAskPlutoDock';
import type { Meeting } from '../../src/types';
import type {
  MeetingAskPlutoConversationMessage,
  MeetingAskPlutoLiveContext,
  MeetingAskPlutoResponse,
} from '../../src/types/askPluto';

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
  let scrollIntoView: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    invoke = vi.fn(async () => response);
    scrollIntoView = vi.fn();
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });
    Object.defineProperty(window, 'ipcRenderer', {
      configurable: true,
      value: {
        invoke,
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
    expect(request.answerMode).toBe('quick');
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

  it('follows submitted questions and their answers', async () => {
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

    expect(scrollIntoView).toHaveBeenCalled();

    await act(async () => root.unmount());
  });

  it('pauses follow-scroll while reading earlier turns and resumes near the bottom', async () => {
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

    const thread = container.querySelector<HTMLElement>(
      '.meeting-ask-pluto-dock__thread',
    );
    expect(thread).not.toBeNull();
    Object.defineProperties(thread!, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 400 },
      scrollTop: { configurable: true, writable: true, value: 0 },
    });

    await act(async () => {
      thread!.dispatchEvent(new Event('scroll', { bubbles: true }));
      await flushPromises();
    });
    const callsWhileReading = scrollIntoView.mock.calls.length;

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
    expect(scrollIntoView).toHaveBeenCalledTimes(callsWhileReading);

    thread!.scrollTop = 300;
    await act(async () => {
      thread!.dispatchEvent(new Event('scroll', { bubbles: true }));
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
    expect(scrollIntoView.mock.calls.length).toBeGreaterThan(callsWhileReading);

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
        },
      ],
    });

    await act(async () => root.unmount());
  });
});
