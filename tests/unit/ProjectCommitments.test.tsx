// @vitest-environment happy-dom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({
  getEntitiesByType: vi.fn(),
  getEntityLinks: vi.fn(),
  updateEntityStatus: vi.fn(),
  upsertEntity: vi.fn(),
  linkEntities: vi.fn(),
}));
vi.mock('../../src/api/knowledgeGraph', () => api);
import { ProjectCommitments } from '../../src/components/features/projects/ProjectCommitments';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;
const tasks = [
  { id: 'a', name: 'Unassigned action', status: 'active', metadata: null },
  { id: 'b', name: 'Finished action', status: 'completed', metadata: null },
  { id: 'c', name: 'Linked action', status: 'active', metadata: null },
  { id: 'd', name: 'Suggested link action', status: 'active', metadata: null },
];
beforeEach(() => {
  vi.clearAllMocks();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  api.getEntitiesByType.mockImplementation(async (type) =>
    type === 'project' ? [{ id: 'p' }] : tasks,
  );
  api.getEntityLinks.mockImplementation(async (id) =>
    id === 'c'
      ? [
          {
            relationship: 'belongs_to',
            source_entity_id: 'c',
            target_entity_id: 'p',
            state: 'confirmed',
          },
        ]
      : id === 'd'
        ? [
            {
              relationship: 'belongs_to',
              source_entity_id: 'd',
              target_entity_id: 'p',
              state: 'suggested',
            },
          ]
        : [],
  );
  api.updateEntityStatus.mockResolvedValue(undefined);
  api.upsertEntity.mockResolvedValue({ id: 'new' });
  api.linkEntities.mockResolvedValue({});
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
const render = async (projectId?: string) => {
  await act(async () =>
    root.render(<ProjectCommitments projectId={projectId} />),
  );
};
const open = async () => {
  await act(async () => {
    const details = host.querySelector('details')!;
    details.open = true;
    details.dispatchEvent(new Event('toggle'));
  });
};
it('loads lazily and preserves unassigned completed tasks', async () => {
  await render();
  expect(api.getEntitiesByType).not.toHaveBeenCalled();
  await open();
  expect(host.textContent).toContain('Unassigned action');
  expect(host.textContent).toContain('Finished action');
  expect(host.textContent).toContain('Suggested link action');
  expect(host.textContent).not.toContain('Linked action');
  expect(host.querySelectorAll('details')).toHaveLength(2);
});
it('shows only confirmed task membership for the selected project', async () => {
  await render('p');
  await open();
  expect(host.textContent).toContain('Linked action');
  expect(host.textContent).not.toContain('Unassigned action');
  expect(host.textContent).not.toContain('Suggested link action');
});
it('toggles completion and reports mutation errors', async () => {
  await render();
  await open();
  await act(async () =>
    host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click(),
  );
  expect(api.updateEntityStatus).toHaveBeenCalledWith('a', 'completed');
  api.updateEntityStatus.mockRejectedValueOnce(new Error('offline'));
  await act(async () =>
    host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click(),
  );
  expect(host.querySelector('[role="alert"]')?.textContent).toContain(
    'couldn’t update',
  );
});
it('adds a confirmed user task and explicit project membership', async () => {
  await render('p');
  await open();
  await act(async () => {
    const input = host.querySelector<HTMLInputElement>('input[type="text"]')!;
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(input, 'New task');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () =>
    host
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
  expect(api.upsertEntity).toHaveBeenCalledWith(
    expect.objectContaining({
      name: 'New task',
      metadata: expect.objectContaining({
        origin: 'user',
        commitment_state: 'confirmed',
      }),
    }),
  );
  expect(api.linkEntities).toHaveBeenCalledWith(
    expect.objectContaining({
      source_entity_id: 'new',
      target_entity_id: 'p',
      relationship: 'belongs_to',
      state: 'confirmed',
      source: 'user',
    }),
  );
});
it('shows load failure with retry', async () => {
  api.getEntitiesByType.mockRejectedValueOnce(new Error('offline'));
  await render();
  await open();
  expect(host.textContent).toContain('couldn’t load');
  await act(async () =>
    Array.from(host.querySelectorAll('button'))
      .find((button) => button.textContent === 'Retry')!
      .click(),
  );
  expect(host.textContent).toContain('Unassigned action');
});

it('reports partial add failures without retaining a duplicate draft', async () => {
  api.linkEntities.mockRejectedValueOnce(new Error('offline'));
  await render('p');
  await open();
  await act(async () => {
    const input = host.querySelector<HTMLInputElement>('input[type="text"]')!;
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(input, 'Saved task');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () =>
    host
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
  expect(host.textContent).toContain('Task saved in Unassigned tasks');
  expect(
    host.querySelector<HTMLInputElement>('input[type="text"]')!.value,
  ).toBe('');
  expect(api.upsertEntity).toHaveBeenCalledTimes(1);
});

it('resets disclosure and hides prior tasks after project navigation', async () => {
  await render();
  await open();
  expect(host.textContent).toContain('Unassigned action');
  await render('p');
  expect(host.textContent).not.toContain('Unassigned action');
  expect(host.querySelector('details')!.open).toBe(false);
  await open();
  expect(host.textContent).toContain('Linked action');
});
