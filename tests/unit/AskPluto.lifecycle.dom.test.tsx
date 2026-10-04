// @vitest-environment happy-dom

import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AskPluto,
  type AskPlutoMessage,
} from '../../src/components/features/AskPluto';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const originalScrollIntoView = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  'scrollIntoView',
);

describe('Ask Pluto request lifecycle', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let scrollIntoView: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    if (originalScrollIntoView) {
      Object.defineProperty(
        HTMLElement.prototype,
        'scrollIntoView',
        originalScrollIntoView,
      );
    } else {
      Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
        configurable: true,
        writable: true,
        value: undefined,
      });
    }
  });

  it('keeps the chat usable when suggested queries are unavailable', async () => {
    const invoke = vi.fn((channel: string) => {
      if (channel === 'intelligence:suggested-queries') {
        return Promise.resolve(null);
      }
      return Promise.resolve(null);
    });
    Object.defineProperty(window, 'ipcRenderer', {
      configurable: true,
      value: { invoke, on: vi.fn(() => () => undefined) },
    });

    await act(async () => {
      root.render(
        <AskPluto visible onClose={vi.fn()} onOpenMeeting={vi.fn()} />,
      );
    });

    expect(container.textContent).toContain("Hello, I'm Pluto.");
    expect(container.textContent).toContain(
      'Record a meeting to get personalized suggestions.',
    );
    expect(
      container.querySelector('input[aria-label="Ask Pluto"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('button[aria-label="Send message"]'),
    ).not.toBeNull();
    expect(
      container.querySelector(
        '[role="log"][aria-label="Conversation with Pluto"]',
      ),
    ).not.toBeNull();
  });

  it('preserves a controlled conversation when the chat view remounts', async () => {
    const invoke = vi.fn((channel: string) => {
      if (channel === 'intelligence:suggested-queries')
        return Promise.resolve([]);
      if (channel === 'intelligence:query') {
        return Promise.resolve({
          status: 'answered',
          answer: 'Jordan owns the holdings update.',
          citations: [],
        });
      }
      return Promise.resolve(null);
    });
    Object.defineProperty(window, 'ipcRenderer', {
      configurable: true,
      value: { invoke, on: vi.fn(() => () => undefined) },
    });

    const Harness = () => {
      const [open, setOpen] = useState(true);
      const [messages, setMessages] = useState<AskPlutoMessage[]>([]);
      return (
        <>
          <button type="button" onClick={() => setOpen((value) => !value)}>
            Toggle chat
          </button>
          {open ? (
            <AskPluto
              visible
              onClose={vi.fn()}
              onOpenMeeting={vi.fn()}
              messages={messages}
              setMessages={setMessages}
            />
          ) : null}
        </>
      );
    };

    await act(async () => root.render(<Harness />));
    const input = container.querySelector('input') as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )?.set?.call(input, "What's assigned to Jordan?");
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      container
        .querySelector('form')
        ?.dispatchEvent(
          new Event('submit', { bubbles: true, cancelable: true }),
        );
    });
    expect(container.textContent).toContain('Jordan owns the holdings update.');

    const toggle = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Toggle chat',
    ) as HTMLButtonElement;
    await act(async () => toggle.click());
    expect(container.textContent).not.toContain(
      'Jordan owns the holdings update.',
    );
    await act(async () => toggle.click());
    expect(container.textContent).toContain('Jordan owns the holdings update.');

    const newConversation = [...container.querySelectorAll('button')].find(
      (button) => button.textContent?.includes('New conversation'),
    ) as HTMLButtonElement;
    expect(newConversation.nextElementSibling?.getAttribute('aria-label')).toBe(
      'Conversation history',
    );
    await act(async () => newConversation.click());
    expect(invoke).toHaveBeenCalledWith('intelligence:query:new-conversation');
    expect(container.textContent).not.toContain(
      'Jordan owns the holdings update.',
    );
    expect(container.textContent).toContain("Hello, I'm Pluto.");
  });

  it('describes held-back draft statements without blaming the meeting sources', async () => {
    const invoke = vi.fn((channel: string) =>
      Promise.resolve(channel === 'intelligence:suggested-queries' ? [] : null),
    );
    Object.defineProperty(window, 'ipcRenderer', {
      configurable: true,
      value: { invoke, on: vi.fn(() => () => undefined) },
    });
    const Harness = () => {
      const [messages, setMessages] = useState<AskPlutoMessage[]>([
        {
          id: 'user',
          role: 'user',
          content: 'Summarize Punit’s contributions',
        },
        {
          id: 'assistant',
          role: 'assistant',
          content: 'Punit asked about the kitchen table.',
          outcome: 'partial',
          unsupportedClaimCount: 4,
          omissionRef: 'opaque-ref',
        },
      ]);
      return (
        <AskPluto
          visible
          onClose={vi.fn()}
          onOpenMeeting={vi.fn()}
          messages={messages}
          setMessages={setMessages}
        />
      );
    };

    await act(async () => root.render(<Harness />));
    expect(container.textContent).toContain(
      'Partial answer · 4 draft statements need a closer check',
    );
    expect(container.textContent).not.toContain('Left out 4 details');
    const conversation = container.querySelector('[role="log"]');
    expect(conversation?.classList.contains('overflow-y-auto')).toBe(false);
    expect(
      conversation?.querySelector('[aria-label="Pluto"]')?.className,
    ).not.toContain('min-h-[calc(100dvh-13rem)]');
    expect(conversation?.contains(container.querySelector('form'))).toBe(false);
  });

  it('shows request phases, exposes cancellation, and restores the composer', async () => {
    let rejectQuery!: (error: Error) => void;
    const queryPromise = new Promise<never>((_resolve, reject) => {
      rejectQuery = reject;
    });
    const listeners = new Map<string, (...args: unknown[]) => void>();
    const invoke = vi.fn((channel: string) => {
      if (channel === 'intelligence:suggested-queries')
        return Promise.resolve([]);
      if (channel === 'intelligence:query') return queryPromise;
      if (channel === 'intelligence:query:cancel') {
        rejectQuery(
          new DOMException('Ask Pluto request cancelled', 'AbortError'),
        );
        return Promise.resolve({ cancelled: true });
      }
      return Promise.resolve(null);
    });
    Object.defineProperty(window, 'ipcRenderer', {
      configurable: true,
      value: {
        invoke,
        on: vi.fn((channel: string, listener: (...args: unknown[]) => void) => {
          listeners.set(channel, listener);
          return () => listeners.delete(channel);
        }),
      },
    });

    await act(async () => {
      root.render(
        <AskPluto visible onClose={vi.fn()} onOpenMeeting={vi.fn()} />,
      );
    });
    expect(invoke).toHaveBeenCalledWith(
      'intelligence:query:session-active',
      true,
    );

    const deepMode = container.querySelector(
      'button[aria-label="Analyze deeply"]',
    ) as HTMLButtonElement;
    await act(async () => deepMode.click());
    expect(deepMode.getAttribute('aria-pressed')).toBe('true');

    const input = container.querySelector('input') as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )?.set?.call(input, 'Compare the current meeting with the last one');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      container
        .querySelector('form')
        ?.dispatchEvent(
          new Event('submit', { bubbles: true, cancelable: true }),
        );
    });

    const queryCall = invoke.mock.calls.find(
      ([channel]) => channel === 'intelligence:query',
    );
    expect(queryCall?.[1]).toMatchObject({
      query: 'Compare the current meeting with the last one',
      modeOverride: 'deep',
    });
    const requestId = queryCall?.[1].requestId as string;
    expect(requestId).toMatch(/^ask-pluto-/);
    expect(container.textContent).toContain('Preparing an answer');
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'start',
    });
    expect(
      (scrollIntoView.mock.instances[0] as HTMLElement).getAttribute(
        'aria-label',
      ),
    ).toBe('You');
    expect(
      container.querySelector('[aria-label="Pluto"]')?.className,
    ).toContain('min-h-[calc(100dvh-13rem)]');
    expect(
      container.querySelector('output[aria-live="polite"]'),
    ).not.toBeNull();
    expect(input.disabled).toBe(false);

    await act(async () => {
      listeners.get('intelligence:query:status')?.(
        {},
        { requestId, phase: 'waiting' },
      );
    });
    expect(container.textContent).toContain('Preparing an answer');
    expect(
      container.querySelector('[data-testid="ask-pluto-loading-lines"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="ask-pluto-loading-shell"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="ask-pluto-progress-dot"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="ask-pluto-progress-track"]'),
    ).toBeNull();
    await act(async () => {
      listeners.get('intelligence:query:status')?.(
        {},
        { requestId, phase: 'writing' },
      );
    });
    expect(container.textContent).toContain('Starting the answer');
    expect(
      container.querySelector('[data-testid="ask-pluto-loading-shell"]'),
    ).not.toBeNull();
    await act(async () => {
      listeners.get('intelligence:query:status')?.(
        {},
        { requestId, phase: 'generating' },
      );
    });
    expect(container.textContent).toContain('Starting the answer');
    await act(async () => {
      listeners.get('intelligence:query:delta')?.(
        {},
        { requestId, delta: 'The current meeting changed direction.' },
      );
    });
    expect(container.textContent).toContain(
      'The current meeting changed direction.',
    );
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('Writing');
    expect(
      container.querySelector('[data-testid="ask-pluto-stream-caret"]'),
    ).not.toBeNull();

    const cancel = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Stop',
    );
    await act(async () => cancel?.click());

    expect(invoke).toHaveBeenCalledWith('intelligence:query:cancel', requestId);
    expect(container.textContent).toContain('Stopped');
    expect(input.disabled).toBe(false);
  });

  it('keeps streamed and finalized answers in the same typography container', async () => {
    let resolveQuery!: (response: {
      status: 'answered';
      answer: string;
      citations: never[];
    }) => void;
    const queryPromise = new Promise<{
      status: 'answered';
      answer: string;
      citations: never[];
    }>((resolve) => {
      resolveQuery = resolve;
    });
    const listeners = new Map<string, (...args: unknown[]) => void>();
    const invoke = vi.fn((channel: string) => {
      if (channel === 'intelligence:suggested-queries')
        return Promise.resolve([]);
      if (channel === 'intelligence:query') return queryPromise;
      return Promise.resolve(null);
    });
    Object.defineProperty(window, 'ipcRenderer', {
      configurable: true,
      value: {
        invoke,
        on: vi.fn((channel: string, listener: (...args: unknown[]) => void) => {
          listeners.set(channel, listener);
          return () => listeners.delete(channel);
        }),
      },
    });

    await act(async () => {
      root.render(
        <AskPluto visible onClose={vi.fn()} onOpenMeeting={vi.fn()} />,
      );
    });
    const input = container.querySelector('input') as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )?.set?.call(input, 'What changed?');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      container
        .querySelector('form')
        ?.dispatchEvent(
          new Event('submit', { bubbles: true, cancelable: true }),
        );
    });
    const queryCall = invoke.mock.calls.find(
      ([channel]) => channel === 'intelligence:query',
    );
    const requestId = queryCall?.[1].requestId as string;
    const answer = '**Pipeline:** stable now.';

    await act(async () => {
      listeners.get('intelligence:query:delta')?.(
        {},
        { requestId, delta: answer },
      );
    });
    const streamingContent = container.querySelector(
      '[data-testid="ask-pluto-answer-content"]',
    );
    const streamingClassName = streamingContent?.className;
    expect(streamingContent).not.toBeNull();
    expect(
      container.querySelector('[data-testid="ask-pluto-loading-shell"]'),
    ).toBeNull();

    await act(async () => {
      resolveQuery({ status: 'answered', answer, citations: [] });
      await queryPromise;
    });
    const finalizedContent = container.querySelector(
      '[data-testid="ask-pluto-answer-content"]',
    );
    expect(finalizedContent).toBe(streamingContent);
    expect(finalizedContent?.className).toBe(streamingClassName);
    expect(
      container.querySelector('[data-testid="ask-pluto-stream-caret"]'),
    ).toBeNull();
  });

  it('shows answer-level evidence trust when a claim needs review', async () => {
    const invoke = vi.fn((channel: string) => {
      if (channel === 'intelligence:suggested-queries')
        return Promise.resolve([]);
      if (channel === 'intelligence:query') {
        return Promise.resolve({
          status: 'answered',
          answer: 'Alex owns pricing approval.',
          citations: [],
          trustStatus: 'needs_review',
          unsupportedClaimCount: 1,
        });
      }
      return Promise.resolve(null);
    });
    Object.defineProperty(window, 'ipcRenderer', {
      configurable: true,
      value: { invoke, on: vi.fn(() => () => undefined) },
    });

    await act(async () => {
      root.render(
        <AskPluto visible onClose={vi.fn()} onOpenMeeting={vi.fn()} />,
      );
    });
    const input = container.querySelector('input') as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )?.set?.call(input, 'Who owns pricing approval?');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      container
        .querySelector('form')
        ?.dispatchEvent(
          new Event('submit', { bubbles: true, cancelable: true }),
        );
    });

    expect(container.textContent).toContain('Needs review');
    expect(container.textContent).toContain('1 detail could not be verified');
  });

  it('settles a timed-out request and offers Retry', async () => {
    const invoke = vi.fn((channel: string) => {
      if (channel === 'intelligence:suggested-queries')
        return Promise.resolve([]);
      if (channel === 'intelligence:query') {
        return Promise.resolve({
          status: 'unavailable',
          answer:
            'Pluto stopped this answer because it took longer than expected.',
          citations: [],
          failureReason: 'timeout',
        });
      }
      return Promise.resolve(null);
    });
    Object.defineProperty(window, 'ipcRenderer', {
      configurable: true,
      value: { invoke, on: vi.fn(() => () => undefined) },
    });

    await act(async () => {
      root.render(
        <AskPluto visible onClose={vi.fn()} onOpenMeeting={vi.fn()} />,
      );
    });
    const input = container.querySelector('input') as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )?.set?.call(input, 'What changed?');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      container
        .querySelector('form')
        ?.dispatchEvent(
          new Event('submit', { bubbles: true, cancelable: true }),
        );
    });

    expect(container.textContent).toContain('Pluto stopped this answer');
    expect(
      [...container.querySelectorAll('button')].some(
        (button) => button.textContent === 'Retry',
      ),
    ).toBe(true);
    expect(
      container.querySelector('[data-testid="ask-pluto-loading-shell"]'),
    ).toBeNull();
  });

  it('presents citations as a collapsed source disclosure instead of meeting cards', async () => {
    const onOpenMeeting = vi.fn();
    const invoke = vi.fn((channel: string) => {
      if (channel === 'intelligence:suggested-queries')
        return Promise.resolve([]);
      if (channel === 'intelligence:query') {
        return Promise.resolve({
          status: 'answered',
          answer: 'The team validated the live transcript flow.',
          citations: [
            {
              claim: 'The team validated the live transcript flow.',
              meeting_id: 'meeting-1',
              meeting_title: 'Transcription review',
              evidence_span: 'The live transcript should update.',
              evidence_valid: true,
              trust_status: 'grounded',
            },
          ],
          trustStatus: 'grounded',
          retrievalTrace: {
            level: 'section',
            searchedMeetingCount: 113,
            meetings: [
              {
                meetingId: 'meeting-1',
                meetingTitle: 'Transcription review',
              },
            ],
            sections: [
              {
                meetingId: 'meeting-1',
                meetingTitle: 'Transcription review',
                sectionId: 'discussion:live-flow',
                heading: 'Live transcript flow',
                kind: 'discussion',
                sourceRevision: 'revision-1',
              },
              {
                meetingId: 'meeting-1',
                meetingTitle: 'Transcription review',
                sectionId: 'decision:validation',
                heading: 'Validation decision',
                kind: 'decision',
                sourceRevision: 'revision-1',
              },
            ],
            transcriptPassages: [],
            commitmentCount: 0,
            omittedResultCount: 0,
          },
        });
      }
      return Promise.resolve(null);
    });
    Object.defineProperty(window, 'ipcRenderer', {
      configurable: true,
      value: { invoke, on: vi.fn(() => () => undefined) },
    });

    await act(async () => {
      root.render(
        <AskPluto visible onClose={vi.fn()} onOpenMeeting={onOpenMeeting} />,
      );
    });
    const input = container.querySelector('input') as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )?.set?.call(input, 'What did we validate?');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      container
        .querySelector('form')
        ?.dispatchEvent(
          new Event('submit', { bubbles: true, cancelable: true }),
        );
    });

    const disclosure = container.querySelector('details');
    expect(disclosure?.open).toBe(false);
    expect(disclosure?.querySelector('summary')?.textContent).toContain(
      '1 source',
    );
    expect(container.textContent).not.toContain('Source Log');
    expect(container.textContent).not.toContain('Claim');
    expect(container.textContent).not.toContain('Grounded answer');
    expect(container.textContent).toContain('2 synthesized note sections');
    expect(container.textContent).not.toContain('113 meetings searched');

    const sourceButton = disclosure?.querySelector(
      'button[aria-label="Open Transcription review"]',
    ) as HTMLButtonElement;
    await act(async () => sourceButton.click());
    expect(onOpenMeeting).toHaveBeenCalledWith('meeting-1');
  });

  it('labels answers from an active recording as provisional', async () => {
    const invoke = vi.fn((channel: string) => {
      if (channel === 'intelligence:suggested-queries')
        return Promise.resolve([]);
      if (channel === 'intelligence:query') {
        return Promise.resolve({
          status: 'answered',
          answer: 'The launch is Friday.',
          citations: [],
          trustStatus: 'inferred',
          currentMeeting: {
            kind: 'active_recording',
            meetingId: 'live-1',
            evidenceState: 'provisional',
          },
        });
      }
      return Promise.resolve(null);
    });
    Object.defineProperty(window, 'ipcRenderer', {
      configurable: true,
      value: { invoke, on: vi.fn(() => () => undefined) },
    });
    await act(async () => {
      root.render(
        <AskPluto visible onClose={vi.fn()} onOpenMeeting={vi.fn()} />,
      );
    });
    const input = container.querySelector('input') as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )?.set?.call(input, 'What was just said in the current meeting?');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      container
        .querySelector('form')
        ?.dispatchEvent(
          new Event('submit', { bubbles: true, cancelable: true }),
        );
    });

    expect(container.textContent).toContain('Provisional live answer');
  });

  it('retries an unavailable answer without losing the original question', async () => {
    let attempts = 0;
    const invoke = vi.fn((channel: string) => {
      if (channel === 'intelligence:suggested-queries')
        return Promise.resolve([]);
      if (channel === 'intelligence:query') {
        attempts += 1;
        return Promise.resolve(
          attempts === 1
            ? {
                status: 'unavailable',
                answer: 'The model is temporarily unavailable.',
                citations: [],
                failureReason: 'provider_unavailable',
              }
            : {
                status: 'answered',
                answer: 'Mira owns the rollout.',
                citations: [],
              },
        );
      }
      return Promise.resolve(null);
    });
    Object.defineProperty(window, 'ipcRenderer', {
      configurable: true,
      value: { invoke, on: vi.fn(() => () => undefined) },
    });

    await act(async () => {
      root.render(
        <AskPluto visible onClose={vi.fn()} onOpenMeeting={vi.fn()} />,
      );
    });
    const input = container.querySelector('input') as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )?.set?.call(input, 'Who owns the rollout?');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      container
        .querySelector('form')
        ?.dispatchEvent(
          new Event('submit', { bubbles: true, cancelable: true }),
        );
    });

    const retry = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Retry',
    );
    expect(retry).toBeDefined();
    await act(async () => retry?.click());

    const queryCalls = invoke.mock.calls.filter(
      ([channel]) => channel === 'intelligence:query',
    );
    expect(queryCalls).toHaveLength(2);
    expect(queryCalls[1][1]).toMatchObject({
      query: 'Who owns the rollout?',
      priorTurns: [],
    });
    expect(container.textContent).toContain('Mira owns the rollout.');
  });

  it.each(['unavailable', 'exception'])(
    'retries with preceding valid scope and keeps failed turns out of later reasoning: %s',
    async (failure) => {
      const previous: AskPlutoMessage[] = [
        {
          id: 'previous-user',
          role: 'user',
          content: 'Summarize Project Atlas.',
        },
        {
          id: 'previous-assistant',
          role: 'assistant',
          content: 'The rollout awaits access review.',
          outcome: 'answered',
          conversationContext: {
            anchor: 'Summarize Project Atlas.',
            meetingIds: ['atlas-review'],
          },
        },
      ];
      let attempts = 0;
      const invoke = vi.fn((channel: string) => {
        if (channel === 'intelligence:suggested-queries')
          return Promise.resolve([]);
        if (channel === 'intelligence:query') {
          attempts++;
          if (attempts === 1)
            return failure === 'exception'
              ? Promise.reject(new Error('Provider temporarily unavailable'))
              : Promise.resolve({
                  status: 'unavailable',
                  answer: 'Provider temporarily unavailable',
                  citations: [],
                });
          return Promise.resolve({
            status: 'answered',
            answer: 'Review the access checklist first.',
            outcome: 'answered',
            citations: [],
          });
        }
        return Promise.resolve(null);
      });
      Object.defineProperty(window, 'ipcRenderer', {
        configurable: true,
        value: { invoke, on: vi.fn(() => () => undefined) },
      });
      const Harness = () => {
        const [messages, setMessages] = useState(previous);
        return (
          <AskPluto
            visible
            onClose={vi.fn()}
            onOpenMeeting={vi.fn()}
            messages={messages}
            setMessages={setMessages}
          />
        );
      };
      await act(async () => root.render(<Harness />));
      const input = container.querySelector(
        'input[aria-label="Ask Pluto"]',
      ) as HTMLInputElement;
      const submit = async (value: string) => {
        await act(async () => {
          Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            'value',
          )?.set?.call(input, value);
          input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await act(async () =>
          container
            .querySelector('form')
            ?.dispatchEvent(
              new Event('submit', { bubbles: true, cancelable: true }),
            ),
        );
      };
      await submit('What should I focus on?');
      const retry = [...container.querySelectorAll('button')].find(
        (button) => button.textContent === 'Retry',
      );
      expect(retry).toBeDefined();
      await act(async () => retry?.click());
      const queries = () =>
        invoke.mock.calls.filter(
          ([channel]) => channel === 'intelligence:query',
        );
      const first = queries()[0][1] as { priorTurns: unknown[] };
      const retried = queries()[1][1] as { priorTurns: unknown[] };
      expect(retried).toMatchObject({ query: 'What should I focus on?' });
      expect(retried.priorTurns).toEqual(first.priorTurns);
      expect(retried.priorTurns).toMatchObject([
        { role: 'user', content: 'Summarize Project Atlas.' },
        {
          role: 'assistant',
          content: 'The rollout awaits access review.',
          meetingIds: ['atlas-review'],
        },
      ]);
      expect(JSON.stringify(retried.priorTurns)).not.toContain(
        'Provider temporarily unavailable',
      );
      // The failure remains visible while only useful conversation is sent onward.
      expect(container.textContent).toContain(
        'Provider temporarily unavailable',
      );
      await submit('Tell me more');
      const followup = queries()[2][1] as {
        priorTurns: Array<{ role: string; content: string }>;
      };
      expect(followup.priorTurns).toHaveLength(4);
      expect(followup.priorTurns.map((turn) => turn.content)).toEqual([
        'Summarize Project Atlas.',
        'The rollout awaits access review.',
        'What should I focus on?',
        'Review the access checklist first.',
      ]);
    },
  );

  it('does not send later thread memory when retrying an older persisted failure', async () => {
    const persisted = [
      {
        id: 'valid-user',
        role: 'user',
        content: 'Summarize Project Atlas.',
        payload: {},
      },
      {
        id: 'valid-answer',
        role: 'assistant',
        content: 'The rollout awaits review.',
        payload: {
          outcome: 'answered',
          conversationContext: {
            anchor: 'Summarize Project Atlas.',
            meetingIds: ['atlas-review'],
          },
        },
      },
      {
        id: 'failed-user',
        role: 'user',
        content: 'What should I focus on?',
        payload: {},
      },
      {
        id: 'failed-answer',
        role: 'assistant',
        content: 'The provider is unavailable.',
        payload: {
          outcome: 'unavailable',
          retryQuery: 'What should I focus on?',
        },
      },
      {
        id: 'later-user',
        role: 'user',
        content: 'Discuss Project Birch.',
        payload: {},
      },
      {
        id: 'later-answer',
        role: 'assistant',
        content: 'Birch needs a staffing update.',
        payload: { outcome: 'answered' },
      },
    ];
    const invoke = vi.fn((channel: string) => {
      if (channel === 'intelligence:workspace-chat:list-threads')
        return Promise.resolve([
          {
            id: 'thread-1',
            title: 'Project review',
            archivedAt: null,
            memory: {
              currentGoal: 'Discuss Project Birch.',
              lastAnswerSummary: 'Birch needs a staffing update.',
              corrections: [],
              unresolvedQuestions: [],
            },
          },
        ]);
      if (channel === 'intelligence:workspace-chat:list-messages')
        return Promise.resolve(persisted);
      if (channel === 'intelligence:suggested-queries')
        return Promise.resolve([]);
      if (channel === 'intelligence:query')
        return Promise.resolve({
          status: 'answered',
          answer: 'Review the Atlas rollout.',
          citations: [],
          outcome: 'answered',
        });
      return Promise.resolve(null);
    });
    Object.defineProperty(window, 'ipcRenderer', {
      configurable: true,
      value: { invoke, on: vi.fn(() => () => undefined) },
    });
    await act(async () =>
      root.render(
        <AskPluto visible onClose={vi.fn()} onOpenMeeting={vi.fn()} />,
      ),
    );
    const retry = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Retry',
    );
    expect(retry).toBeDefined();
    await act(async () => retry?.click());
    const request = invoke.mock.calls.find(
      ([channel]) => channel === 'intelligence:query',
    )?.[1];
    expect(request).toMatchObject({
      query: 'What should I focus on?',
      priorTurns: [
        { role: 'user', content: 'Summarize Project Atlas.' },
        {
          role: 'assistant',
          content: 'The rollout awaits review.',
          meetingIds: ['atlas-review'],
        },
      ],
    });
    expect(request).not.toHaveProperty('conversationMemory');
    expect(JSON.stringify(request)).not.toMatch(
      /Birch|provider is unavailable/,
    );
  });

  it('keeps prior conversation text and structured scope after a no-evidence answer', async () => {
    let attempts = 0;
    const scope = {
      kind: 'temporal' as const,
      meetingIds: ['today-1'],
      temporalRange: {
        fromInclusive: '2026-08-25T07:00:00.000Z',
        toExclusive: '2026-08-26T07:00:00.000Z',
        label: 'today',
        timeZone: 'America/Los_Angeles',
      },
      resolvedAt: '2026-08-26T00:36:00.000Z',
      source: 'explicit' as const,
    };
    const retrievalSummary = {
      matchedMeetingCount: 1,
      includedMeetingCount: 1,
      preparedEvidenceCount: 0,
      transcriptOnlyCount: 1,
      omittedMeetingCount: 0,
    };
    const invoke = vi.fn((channel: string) => {
      if (channel === 'intelligence:suggested-queries')
        return Promise.resolve([]);
      if (channel === 'intelligence:query') {
        attempts += 1;
        return Promise.resolve(
          attempts === 1
            ? {
                status: 'answered',
                answer:
                  "I couldn't find information about that in your meetings.",
                citations: [],
                outcome: 'no_evidence',
                resolvedScope: scope,
                retrievalSummary,
                turnMode: 'lookup',
                retrievalPolicy: 'fresh',
              }
            : {
                status: 'answered',
                answer: 'The previous request lacked supported evidence.',
                citations: [],
                outcome: 'answered',
                resolvedScope: { ...scope, source: 'inherited' },
                retrievalSummary,
              },
        );
      }
      return Promise.resolve(null);
    });
    Object.defineProperty(window, 'ipcRenderer', {
      configurable: true,
      value: { invoke, on: vi.fn(() => () => undefined) },
    });
    await act(async () => {
      root.render(
        <AskPluto visible onClose={vi.fn()} onOpenMeeting={vi.fn()} />,
      );
    });
    const input = container.querySelector('input') as HTMLInputElement;
    const submit = async (value: string) => {
      await act(async () => {
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          'value',
        )?.set?.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await act(async () => {
        container
          .querySelector('form')
          ?.dispatchEvent(
            new Event('submit', { bubbles: true, cancelable: true }),
          );
      });
    };

    await submit("Summarize today's meetings");
    expect(container.textContent).toContain("I couldn't verify an answer");
    await submit('What went wrong here?');

    const queryCalls = invoke.mock.calls.filter(
      ([channel]) => channel === 'intelligence:query',
    );
    expect(queryCalls[1][1].priorTurns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'assistant',
          outcome: 'no_evidence',
          resolvedScope: scope,
          retrievalSummary,
          turnMode: 'lookup',
          retrievalPolicy: 'fresh',
        }),
      ]),
    );
  });

  it('shows Stop in composer when idle while processing, but switches to Send when typing and cancels previous query', async () => {
    let pendingResolve: ((value: unknown) => void) | null = null;
    const invoke = vi.fn((channel: string, payload?: { query?: string }) => {
      if (channel === 'intelligence:suggested-queries')
        return Promise.resolve([]);
      if (channel === 'intelligence:query:cancel')
        return Promise.resolve({ ok: true });
      if (channel === 'intelligence:query') {
        if (payload?.query === 'First long query') {
          return new Promise((resolve) => {
            pendingResolve = resolve;
          });
        }
        return Promise.resolve({
          status: 'answered',
          answer: 'Second query answer',
          citations: [],
        });
      }
      return Promise.resolve(null);
    });
    Object.defineProperty(window, 'ipcRenderer', {
      configurable: true,
      value: { invoke, on: vi.fn(() => () => undefined) },
    });
    await act(async () => {
      root.render(
        <AskPluto visible onClose={vi.fn()} onOpenMeeting={vi.fn()} />,
      );
    });

    const input = container.querySelector('input') as HTMLInputElement;
    const submit = async (value: string) => {
      await act(async () => {
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          'value',
        )?.set?.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await act(async () => {
        container
          .querySelector('form')
          ?.dispatchEvent(
            new Event('submit', { bubbles: true, cancelable: true }),
          );
      });
    };

    // 1. Submit first query
    await submit('First long query');

    // 2. Since input is empty and processing, the Stop button is in the composer
    const stopButton = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Stop',
    );
    expect(stopButton).not.toBeUndefined();
    expect(stopButton?.getAttribute('aria-label')).toBe('Stop');

    // 3. User types a new query while processing
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )?.set?.call(input, 'Second query');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    // Stop button is no longer present, Send button is active
    expect(
      [...container.querySelectorAll('button')].find(
        (b) => b.textContent === 'Stop',
      ),
    ).toBeUndefined();

    // 4. User submits the second query
    await act(async () => {
      container
        .querySelector('form')
        ?.dispatchEvent(
          new Event('submit', { bubbles: true, cancelable: true }),
        );
    });

    // Should have cancelled the first query
    expect(invoke).toHaveBeenCalledWith(
      'intelligence:query:cancel',
      expect.stringContaining('ask-pluto-'),
    );
    expect(container.textContent).toContain('Second query answer');
    if (pendingResolve) pendingResolve(null);
  });

  it('restores the latest durable workspace conversation', async () => {
    const invoke = vi.fn((channel: string) => {
      if (channel === 'intelligence:workspace-chat:list-threads') {
        return Promise.resolve([
          {
            id: 'thread-1',
            title: 'Release priorities',
            memory: { corrections: [], unresolvedQuestions: [] },
            createdAt: '2026-09-28T10:00:00.000Z',
            updatedAt: '2026-09-28T10:05:00.000Z',
            archivedAt: null,
          },
        ]);
      }
      if (channel === 'intelligence:workspace-chat:list-messages') {
        return Promise.resolve([
          {
            id: 'message-1',
            threadId: 'thread-1',
            role: 'user',
            content: 'What deserves attention?',
            payload: {},
            createdAt: '2026-09-28T10:00:00.000Z',
          },
          {
            id: 'message-2',
            threadId: 'thread-1',
            role: 'assistant',
            content: 'Start with the production handoff.',
            payload: { outcome: 'answered' },
            createdAt: '2026-09-28T10:05:00.000Z',
          },
        ]);
      }
      if (channel === 'intelligence:suggested-queries')
        return Promise.resolve([]);
      return Promise.resolve(null);
    });
    Object.defineProperty(window, 'ipcRenderer', {
      configurable: true,
      value: { invoke, on: vi.fn(() => () => undefined) },
    });

    await act(async () => {
      root.render(
        <AskPluto visible onClose={vi.fn()} onOpenMeeting={vi.fn()} />,
      );
    });

    expect(container.textContent).toContain('What deserves attention?');
    expect(container.textContent).toContain(
      'Start with the production handoff.',
    );
    expect(container.textContent).toContain('Release priorities');
    expect(
      container.querySelector('[aria-label="Pluto"]')?.className,
    ).not.toContain('min-h-[calc(100dvh-13rem)]');
  });

  it('opens a scrollable history drawer with every saved conversation', async () => {
    let threads = Array.from({ length: 10 }, (_, index) => ({
      id: `thread-${index}`,
      title: `Conversation ${index + 1}`,
      memory: { corrections: [], unresolvedQuestions: [] },
      createdAt: '2026-09-28T10:00:00.000Z',
      updatedAt: '2026-09-28T10:00:00.000Z',
      archivedAt: null,
    }));
    const invoke = vi.fn((channel: string, threadId?: string) => {
      if (channel === 'intelligence:workspace-chat:list-threads')
        return Promise.resolve(threads);
      if (channel === 'intelligence:workspace-chat:list-messages')
        return Promise.resolve([
          {
            id: 'message-1',
            threadId: 'thread-0',
            role: 'user',
            content: 'Old question',
            payload: {},
            createdAt: '2026-09-28T10:00:00.000Z',
          },
        ]);
      if (channel === 'intelligence:workspace-chat:archive-thread') {
        threads = threads.map((thread) =>
          thread.id === threadId
            ? { ...thread, archivedAt: '2026-09-28T11:00:00.000Z' }
            : thread,
        );
        return Promise.resolve(
          threads.find((thread) => thread.id === threadId),
        );
      }
      if (channel === 'intelligence:suggested-queries')
        return Promise.resolve([]);
      return Promise.resolve(null);
    });
    Object.defineProperty(window, 'ipcRenderer', {
      configurable: true,
      value: { invoke, on: vi.fn(() => () => undefined) },
    });

    await act(async () => {
      root.render(
        <AskPluto visible onClose={vi.fn()} onOpenMeeting={vi.fn()} />,
      );
    });
    expect(invoke).toHaveBeenCalledWith(
      'intelligence:workspace-chat:list-threads',
      { includeArchived: false },
    );

    const historyButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Conversation history"]',
    );
    expect(historyButton?.getAttribute('aria-expanded')).toBe('false');
    expect(document.querySelector('#ask-pluto-history')?.className).toContain(
      'translate-x-full',
    );
    expect(container.textContent).toContain('Old question');
    await act(async () => historyButton?.click());
    expect(historyButton?.getAttribute('aria-expanded')).toBe('true');
    const drawer = document.querySelector('#ask-pluto-history');
    expect(
      drawer?.querySelectorAll('button[aria-label^="Delete conversation"]'),
    ).toHaveLength(10);
    expect(drawer?.textContent).toContain('Conversation 10');
    expect(drawer?.querySelector('time')?.getAttribute('dateTime')).toBe(
      '2026-09-28T10:00:00.000Z',
    );
    expect(drawer?.className).toContain('translate-x-0');
    expect(drawer?.className).toContain('transition-transform');
    expect(drawer?.className).not.toContain('fade-in');
    expect(
      drawer?.querySelector('nav')?.classList.contains('overflow-y-auto'),
    ).toBe(true);
    scrollIntoView.mockClear();
    await act(async () => {
      [...(drawer?.querySelectorAll('nav button') ?? [])]
        .find((button) => button.textContent?.startsWith('Conversation 2'))
        ?.click();
    });
    expect(invoke).toHaveBeenCalledWith(
      'intelligence:workspace-chat:list-messages',
      'thread-1',
    );
    expect(scrollIntoView).toHaveBeenCalledOnce();
    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: 'instant',
      block: 'end',
    });
    expect(
      (scrollIntoView.mock.instances[0] as HTMLElement).getAttribute(
        'aria-hidden',
      ),
    ).toBe('true');
    await act(async () => historyButton?.click());
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Delete conversation Conversation 2"]',
        )
        ?.click();
    });
    expect(invoke).toHaveBeenCalledWith(
      'intelligence:workspace-chat:archive-thread',
      'thread-1',
    );
    expect(container.textContent).not.toContain('Old question');
    expect(drawer?.textContent).not.toContain('Recently deleted');
    expect(
      drawer?.querySelectorAll('button[aria-label^="Delete conversation"]'),
    ).toHaveLength(9);
    const closeButton = drawer?.querySelector<HTMLButtonElement>(
      'button[aria-label="Close conversation history"]',
    );
    expect(closeButton).not.toBeNull();
    await act(async () => closeButton?.click());
    expect(drawer?.className).toContain('translate-x-full');
    expect(drawer?.parentElement?.getAttribute('aria-hidden')).toBe('true');
    expect(drawer?.parentElement?.hasAttribute('inert')).toBe(true);
    expect(historyButton?.getAttribute('aria-expanded')).toBe('false');

    await act(async () => historyButton?.click());
    await act(async () => {
      drawer?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
    });
    expect(drawer?.className).toContain('translate-x-full');
    expect(drawer?.parentElement?.getAttribute('aria-hidden')).toBe('true');
    expect(drawer?.parentElement?.hasAttribute('inert')).toBe(true);
    expect(historyButton?.getAttribute('aria-expanded')).toBe('false');
  });

  it('requires confirmation before creating a commitment', async () => {
    const invoke = vi.fn((channel: string) => {
      if (channel === 'intelligence:suggested-queries')
        return Promise.resolve([]);
      if (channel === 'intelligence:query') {
        return Promise.resolve({
          status: 'answered',
          answer:
            'I can add “send the release note” as an open commitment. Confirm it below.',
          citations: [],
          turnMode: 'act',
          retrievalPolicy: 'none',
          actionProposal: {
            kind: 'create_commitment',
            text: 'send the release note',
            label: 'Add commitment',
          },
        });
      }
      if (channel === 'UPSERT_ENTITY') {
        return Promise.resolve({ id: 'commitment-1' });
      }
      return Promise.resolve(null);
    });
    Object.defineProperty(window, 'ipcRenderer', {
      configurable: true,
      value: { invoke, on: vi.fn(() => () => undefined) },
    });
    await act(async () => {
      root.render(
        <AskPluto visible onClose={vi.fn()} onOpenMeeting={vi.fn()} />,
      );
    });

    const input = container.querySelector('input') as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )?.set?.call(input, 'Create a commitment to send the release note');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      container
        .querySelector('form')
        ?.dispatchEvent(
          new Event('submit', { bubbles: true, cancelable: true }),
        );
    });

    expect(invoke).not.toHaveBeenCalledWith('UPSERT_ENTITY', expect.anything());
    const confirm = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Add commitment'),
    );
    expect(confirm).toBeDefined();
    await act(async () => confirm?.click());
    expect(invoke).toHaveBeenCalledWith(
      'UPSERT_ENTITY',
      expect.objectContaining({
        type: 'action_item',
        name: 'send the release note',
      }),
    );
    expect(container.textContent).toContain('Saved to your commitments');
  });
});
