// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AskPluto } from '../../src/components/features/AskPluto';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('Ask Pluto request lifecycle', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
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
    expect(container.textContent).toContain('Finding relevant meetings');
    expect(input.disabled).toBe(false);

    await act(async () => {
      listeners.get('intelligence:query:status')?.(
        {},
        { requestId, phase: 'generating' },
      );
    });
    expect(container.textContent).toContain('Analyzing evidence');
    await act(async () => {
      listeners.get('intelligence:query:delta')?.(
        {},
        { requestId, delta: 'The current meeting changed direction.' },
      );
    });
    expect(container.textContent).toContain(
      'The current meeting changed direction.',
    );

    const cancel = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Stop',
    );
    await act(async () => cancel?.click());

    expect(invoke).toHaveBeenCalledWith('intelligence:query:cancel', requestId);
    expect(container.textContent).toContain('Stopped');
    expect(input.disabled).toBe(false);
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
    expect(container.textContent).toContain('1 unsupported claim');
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
    expect(queryCalls[1][1]).toMatchObject({ query: 'Who owns the rollout?' });
    expect(container.textContent).toContain('Mira owns the rollout.');
  });
});
