// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PlutoActionCard } from '../../src/components/features/PlutoActionCard';
import type { PlutoActionBatch } from '../../src/types/plutoActions';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
let invoke: ReturnType<typeof vi.fn>;
const batch: PlutoActionBatch = {
  id: 'batch',
  state: 'pending',
  items: [
    {
      id: 'one',
      action: {
        kind: 'create_task',
        title: 'Send proposal',
        dueDate: '2026-11-14',
      },
      destination: 'Tasks',
      preview: 'Send proposal · Due 2026-11-14',
      revision: 'a',
    },
    {
      id: 'two',
      action: { kind: 'create_note', title: 'Plan', content: 'Decision' },
      destination: 'Plan',
      preview: 'Decision',
      revision: 'b',
    },
  ],
};
beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  invoke = vi.fn(async () => batch);
  Object.defineProperty(window, 'ipcRenderer', {
    configurable: true,
    value: { invoke, on: vi.fn(() => () => {}) },
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
const render = () =>
  act(async () => {
    root.render(<PlutoActionCard batchId="batch" />);
  });
const button = (text: string) =>
  [...container.querySelectorAll('button')].find(
    (b) => b.textContent === text,
  )!;
it('loads a durable preview without applying, selects actions, applies once and undoes', async () => {
  await render();
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(container.textContent).toContain('2026-11-14');
  await act(async () => {
    container.querySelectorAll<HTMLInputElement>('input')[1].click();
  });
  invoke.mockResolvedValue({
    ...batch,
    state: 'applied',
    results: [{ kind: 'task', id: 'task', title: 'Send proposal' }],
  });
  await act(async () => {
    button('Apply selected changes').click();
    button('Apply selected changes').click();
  });
  expect(invoke.mock.calls.filter(([c]) => c === 'PLUTO_ACTION_APPLY')).toEqual(
    [['PLUTO_ACTION_APPLY', { id: 'batch', selectedIds: ['one'] }]],
  );
  expect(container.textContent).toContain('Changes saved');
  expect(container.textContent).toContain('Open Send proposal');
  invoke.mockResolvedValue({ ...batch, state: 'undone' });
  await act(async () => button('Undo').click());
  expect(invoke).toHaveBeenLastCalledWith('PLUTO_ACTION_UNDO', 'batch');
  expect(container.textContent).toContain('Changes undone');
});
it('shows failures without claiming success and preserves retry', async () => {
  await render();
  invoke.mockRejectedValue(new Error('Storage failed'));
  await act(async () => button('Apply selected changes').click());
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    'Storage failed',
  );
  expect(container.textContent).not.toContain('Changes saved');
  expect(button('Apply selected changes').disabled).toBe(false);
});
it('shows refreshed previews before requiring another apply', async () => {
  await render();
  await act(async () => button('Apply selected changes').click());
  expect(container.textContent).toContain('Review the refreshed preview');
  expect(container.textContent).not.toContain('Changes saved');
});
it('hydrates completed state without repeating the mutation', async () => {
  invoke.mockResolvedValue({ ...batch, state: 'applied', results: [] });
  await render();
  expect(container.textContent).toContain('Changes saved');
  expect(invoke.mock.calls.every(([c]) => c === 'PLUTO_ACTION_GET')).toBe(true);
});
