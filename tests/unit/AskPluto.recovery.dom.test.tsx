// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AskPluto } from '../../src/components/features/AskPluto';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});
const submit = async (query: string) => {
  const input = container.querySelector('input')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )?.set?.call(input, query);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => {
    container
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
};
it('typed retry after failure repeats the original request without failed answer evidence', async () => {
  const invoke = vi.fn(async (channel: string) =>
    channel === 'intelligence:query'
      ? { status: 'answered', answer: 'No evidence.', citations: [] }
      : channel === 'intelligence:workspace-chat:create-thread'
        ? { id: 'thread-1' }
        : [],
  );
  Object.defineProperty(window, 'ipcRenderer', {
    configurable: true,
    value: { invoke, on: vi.fn(() => () => {}) },
  });
  await act(async () => {
    root.render(
      <AskPluto
        visible
        onClose={vi.fn()}
        onOpenMeeting={vi.fn()}
        messages={[
          { id: 'u', role: 'user', content: "What's assigned to Morgan?" },
          {
            id: 'a',
            role: 'assistant',
            content: 'Timed out.',
            outcome: 'unavailable',
            retryQuery: "What's assigned to Morgan?",
          },
        ]}
      />,
    );
  });
  await submit('try again?');
  expect(invoke).toHaveBeenCalledWith(
    'intelligence:query',
    expect.objectContaining({
      query: "What's assigned to Morgan?",
      priorTurns: [],
    }),
  );
});
it('dispatches without waiting for persistence and ignores late output after Stop', async () => {
  let finishCreate!: (value: unknown) => void;
  let finishAnswer!: (value: unknown) => void;
  const create = new Promise((resolve) => {
    finishCreate = resolve;
  });
  const answer = new Promise((resolve) => {
    finishAnswer = resolve;
  });
  const invoke = vi.fn((channel: string) =>
    channel === 'intelligence:workspace-chat:create-thread'
      ? create
      : channel === 'intelligence:query'
        ? answer
        : Promise.resolve(
            channel === 'intelligence:query:cancel' ? { cancelled: false } : [],
          ),
  );
  Object.defineProperty(window, 'ipcRenderer', {
    configurable: true,
    value: { invoke, on: vi.fn(() => () => {}) },
  });
  await act(async () => {
    root.render(<AskPluto visible onClose={vi.fn()} onOpenMeeting={vi.fn()} />);
  });
  await submit('What decisions were made?');
  expect(
    invoke.mock.calls.filter(([channel]) => channel === 'intelligence:query'),
  ).toHaveLength(1);
  const stop = [...container.querySelectorAll('button')].find(
    (button) => button.textContent === 'Stop',
  );
  expect(stop).toBeDefined();
  await act(async () => {
    stop!.click();
  });
  expect(container.textContent).toContain('Stopped.');
  expect(
    container.querySelector('button[aria-label="Send message"]'),
  ).not.toBeNull();
  await act(async () => {
    finishCreate({ id: 'thread-1' });
    finishAnswer({
      status: 'answered',
      answer: 'LATE_RESPONSE_SENTINEL',
      citations: [],
    });
  });
  expect(
    invoke.mock.calls.filter(([channel]) => channel === 'intelligence:query'),
  ).toHaveLength(1);
  expect(container.textContent).not.toContain('LATE_RESPONSE_SENTINEL');
});
it('restores the composer even when cancellation IPC rejects', async () => {
  const invoke = vi.fn((channel: string) =>
    channel === 'intelligence:query'
      ? new Promise(() => {})
      : channel === 'intelligence:query:cancel'
        ? Promise.reject(new Error('Disconnected'))
        : Promise.resolve([]),
  );
  Object.defineProperty(window, 'ipcRenderer', {
    configurable: true,
    value: { invoke, on: vi.fn(() => () => {}) },
  });
  await act(async () => {
    root.render(<AskPluto visible onClose={vi.fn()} onOpenMeeting={vi.fn()} />);
  });
  await submit('What decisions were made?');
  await act(async () => {
    [...container.querySelectorAll('button')]
      .find((button) => button.textContent === 'Stop')!
      .click();
  });
  expect(container.textContent).toContain('Stopped.');
  expect(
    container.querySelector('button[aria-label="Send message"]'),
  ).not.toBeNull();
});
