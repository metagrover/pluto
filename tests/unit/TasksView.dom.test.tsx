// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TasksView,
  filterTasks,
} from '../../src/components/features/TasksView';
import type { TasksSnapshot } from '../../src/types/tasks';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const initial = (): TasksSnapshot => ({
  tags: [
    { id: 'writing', name: 'Writing' },
    { id: 'work', name: 'Work' },
  ],
  projects: [{ id: 'launch', name: 'Launch' }],
  tasks: [
    {
      entity: {
        id: 'outline',
        name: 'Send outline',
        status: 'active',
        due_date: '2026-10-20',
        created_at: '2026-10-19',
        updated_at: '2026-10-19',
      } as TasksSnapshot['tasks'][0]['entity'],
      projectId: 'launch',
      tagIds: ['writing', 'work'],
      description: 'Include timeline',
      sourceMeetingId: 'meeting',
      sourceMeetingTitle: 'Fictional planning',
      needsReview: false,
      focused: true,
    },
  ],
});

describe('Tasks workspace', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let snapshot: TasksSnapshot;
  let invoke: ReturnType<typeof vi.fn>;
  const button = (label: string) =>
    [...container.querySelectorAll('button')].find(
      (item) =>
        item.textContent?.trim() === label ||
        item.getAttribute('aria-label') === label,
    )!;
  const fill = async (label: string, value: string) => {
    const input = container.querySelector(
      `[aria-label="${label}"]`,
    ) as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )?.set?.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };
  beforeEach(() => {
    snapshot = initial();
    invoke = vi.fn(
      async (channel: string, payload: Record<string, unknown>) => {
        if (channel === 'TASKS_LIST') return structuredClone(snapshot);
        if (channel === 'TASKS_SAVE') return 'created-task';
        if (channel === 'TASKS_DELETE') return 'd'.repeat(64);
        if (channel === 'TASKS_STATUS')
          snapshot.tasks[0].entity.status = payload.status as
            | 'active'
            | 'completed';
        return null;
      },
    );
    Object.defineProperty(window, 'ipcRenderer', {
      configurable: true,
      value: { invoke },
    });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });
  it('captures a title-only task and opens optional details without requiring organization', async () => {
    await act(async () => root.render(<TasksView onOpenMeeting={vi.fn()} />));
    expect(container.querySelector('textarea')).toBeNull();
    await fill('New task', 'Renew passport');
    await act(async () => button('Add').click());
    expect(invoke).toHaveBeenCalledWith('TASKS_SAVE', {
      title: 'Renew passport',
    });
    expect(
      (container.querySelector('[aria-label="New task"]') as HTMLInputElement)
        .value,
    ).toBe('');
  });
  it('keeps failed capture text available for retry', async () => {
    invoke.mockImplementation(async (channel: string) => {
      if (channel === 'TASKS_LIST') return snapshot;
      throw new Error('Disk unavailable. Try again.');
    });
    await act(async () => root.render(<TasksView onOpenMeeting={vi.fn()} />));
    await fill('New task', 'Keep this draft');
    await act(async () => button('Add').click());
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Disk unavailable',
    );
    expect(
      (container.querySelector('[aria-label="New task"]') as HTMLInputElement)
        .value,
    ).toBe('Keep this draft');
  });
  it('completes and reopens the same task through the shared lifecycle', async () => {
    await act(async () => root.render(<TasksView onOpenMeeting={vi.fn()} />));
    await act(async () => button('Complete Send outline').click());
    expect(invoke).toHaveBeenCalledWith('TASKS_STATUS', {
      id: 'outline',
      status: 'completed',
    });
    await act(async () =>
      [...container.querySelectorAll('button')]
        .find((item) => item.textContent?.startsWith('Completed'))!
        .click(),
    );
    expect(button('Reopen Send outline')).toBeDefined();
    await act(async () => button('Reopen Send outline').click());
    expect(invoke).toHaveBeenCalledWith('TASKS_STATUS', {
      id: 'outline',
      status: 'active',
    });
  });
  it('opens source context and never offers completion for an uncertain task', async () => {
    snapshot.tasks[0].needsReview = true;
    const open = vi.fn();
    await act(async () =>
      root.render(<TasksView initialTaskId="outline" onOpenMeeting={open} />),
    );
    expect(button('Complete Send outline')).toBeUndefined();
    await act(async () => button('Fictional planning').click());
    expect(open).toHaveBeenCalledWith('meeting');
    await act(async () => button('Take on task').click());
    expect(invoke).toHaveBeenCalledWith('TASKS_REVIEW', {
      id: 'outline',
      state: 'confirmed',
    });
  });
  it('refreshes cross-window changes while preserving an unsaved draft and its original revision', async () => {
    snapshot.tasks[0].revision = 'a'.repeat(64);
    let notify: (() => void) | undefined;
    Object.assign(window.ipcRenderer, {
      on: vi.fn((_channel: string, listener: () => void) => {
        notify = listener;
        return vi.fn();
      }),
    });
    await act(async () =>
      root.render(
        <TasksView initialTaskId="outline" onOpenMeeting={vi.fn()} />,
      ),
    );
    const input = container.querySelector('textarea')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )?.set?.call(input, 'My unsaved draft');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    snapshot.tasks[0].entity.name = 'Updated in another window';
    snapshot.tasks[0].revision = 'b'.repeat(64);
    await act(async () => notify?.());
    expect(container.textContent).toContain('Updated in another window');
    expect(input.value).toBe('My unsaved draft');
    await act(async () => button('Save changes').click());
    expect(invoke).toHaveBeenCalledWith(
      'TASKS_SAVE',
      expect.objectContaining({
        title: 'My unsaved draft',
        expectedRevision: 'a'.repeat(64),
      }),
    );
  });
  it('filters by all selected tags, optional project, date and searchable context', () => {
    const filter = {
      view: 'open' as const,
      search: 'timeline',
      project: 'launch',
      tags: ['writing', 'work'],
      due: 'today',
    };
    expect(filterTasks(snapshot, filter, '2026-10-20')).toHaveLength(1);
    expect(
      filterTasks(
        snapshot,
        { ...filter, tags: ['writing', 'absent'] },
        '2026-10-20',
      ),
    ).toHaveLength(0);
    expect(
      filterTasks(snapshot, { ...filter, project: 'none' }, '2026-10-20'),
    ).toHaveLength(0);
    expect(
      filterTasks(snapshot, { ...filter, due: 'overdue' }, '2026-10-20'),
    ).toHaveLength(0);
  });
  it('saves project changes through the shared searchable dropdown', async () => {
    await act(async () =>
      root.render(
        <TasksView initialTaskId="outline" onOpenMeeting={vi.fn()} />,
      ),
    );
    const project = container.querySelector(
      '[role="combobox"][aria-label="Task project"]',
    ) as HTMLInputElement;
    await act(async () => project.click());
    const noProject = document.querySelector(
      '[role="option"][data-value=""]',
    ) as HTMLButtonElement;
    await act(async () => noProject.click());
    await act(async () => button('Save changes').click());
    expect(invoke).toHaveBeenCalledWith(
      'TASKS_SAVE',
      expect.objectContaining({ projectId: null }),
    );
    expect(container.querySelector('select')).toBeNull();
  });
  it('preserves an existing timed deadline when saving unrelated details', async () => {
    snapshot.tasks[0].entity.due_date = '2026-10-20T15:30:00-07:00';
    await act(async () =>
      root.render(
        <TasksView initialTaskId="outline" onOpenMeeting={vi.fn()} />,
      ),
    );
    await act(async () => button('Save changes').click());
    expect(invoke).toHaveBeenCalledWith(
      'TASKS_SAVE',
      expect.objectContaining({ id: 'outline', dueDate: undefined }),
    );
  });
  it('renders calm empty state when there are no tasks', async () => {
    invoke.mockImplementation(async (channel: string) => {
      if (channel === 'TASKS_LIST')
        return { tasks: [], tags: [], projects: [] };
      return null;
    });
    await act(async () => root.render(<TasksView onOpenMeeting={vi.fn()} />));
    expect(container.textContent).toContain('Make room for what’s next');
    await act(async () => button('Write a task').click());
    expect(document.activeElement).toBe(
      container.querySelector('input[aria-label="New task"]'),
    );
  });
  it('provides visual feedback and toast notification when creating and saving a task', async () => {
    await act(async () =>
      root.render(
        <TasksView initialTaskId="outline" onOpenMeeting={vi.fn()} />,
      ),
    );
    await act(async () => button('Save changes').click());
    expect(container.textContent).toContain('Saved');
    expect(container.textContent).toContain('Changes saved');

    await fill('New task', 'Ship release notes');
    await act(async () => button('Add').click());

    const notification = container.querySelector('.task-toast');
    expect(notification?.textContent).toContain(
      'Task created: “Ship release notes”',
    );
  });
  it('keeps the submitted draft stable while saving instead of marking new edits saved', async () => {
    let releaseSave!: () => void;
    invoke.mockImplementation(async (channel: string) => {
      if (channel === 'TASKS_LIST') return structuredClone(snapshot);
      if (channel === 'TASKS_SAVE')
        await new Promise<void>((resolve) => {
          releaseSave = resolve;
        });
      return 'outline';
    });
    await act(async () =>
      root.render(
        <TasksView initialTaskId="outline" onOpenMeeting={vi.fn()} />,
      ),
    );
    act(() => button('Save changes').click());
    expect(
      [...container.querySelectorAll('textarea')].every(
        (input) => input.disabled,
      ),
    ).toBe(true);
    expect(
      (container.querySelector('[aria-label="New task"]') as HTMLInputElement)
        .disabled,
    ).toBe(true);
    expect(
      (container.querySelector('input[type="date"]') as HTMLInputElement)
        .disabled,
    ).toBe(true);
    await act(async () => releaseSave());
    expect(
      [...container.querySelectorAll('textarea')].every(
        (input) => !input.disabled,
      ),
    ).toBe(true);
    expect(container.textContent).toContain('Changes saved');
  });

  it('supports deleting a task with inline confirmation and undo restore', async () => {
    await act(async () =>
      root.render(
        <TasksView initialTaskId="outline" onOpenMeeting={vi.fn()} />,
      ),
    );
    await act(async () => button('Delete task').click());
    expect(container.textContent).toContain('Delete task?');

    await act(async () => button('Delete').click());
    expect(invoke).toHaveBeenCalledWith('TASKS_DELETE', {
      id: 'outline',
      expectedRevision: undefined,
    });

    const toast = container.querySelector('.task-toast');
    expect(toast?.textContent).toContain('Task deleted: “Send outline”');

    const undoButton = [...container.querySelectorAll('button')].find((btn) =>
      btn.textContent?.includes('Undo'),
    );
    expect(undoButton).toBeDefined();
    await act(async () => undoButton?.click());
    expect(invoke).toHaveBeenCalledWith('TASKS_RESTORE', {
      id: 'outline',
      deletionRevision: 'd'.repeat(64),
    });
  });
});
