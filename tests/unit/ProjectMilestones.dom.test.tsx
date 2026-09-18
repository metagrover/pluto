// @vitest-environment happy-dom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  deleteProjectMilestone: vi.fn(),
  recordEntityCorrection: vi.fn(),
  restoreProjectMilestone: vi.fn(),
  saveProjectMilestone: vi.fn(),
}));

vi.mock('../../src/api/knowledgeGraph', () => api);

import { ProjectMilestones } from '../../src/components/features/projects/ProjectMilestones';
import type { ProjectMilestone } from '../../src/utils/projectBriefing';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.clearAllMocks();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  api.saveProjectMilestone.mockImplementation(async (_pid, input) => ({
    id: input.id || 'milestone-1',
    title: input.title,
    status: input.status,
    targetDate: input.targetDate,
    note: input.note,
    createdAt: '2026-09-18T00:00:00.000Z',
    updatedAt: '2026-09-18T00:00:00.000Z',
  }));
  api.deleteProjectMilestone.mockResolvedValue(undefined);
  api.recordEntityCorrection.mockResolvedValue(undefined);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

const renderComponent = async (props: {
  projectId: string;
  milestones: ProjectMilestone[];
  onChange?: (milestones: ProjectMilestone[]) => void;
}) => {
  await act(async () => {
    root.render(
      <ProjectMilestones
        projectId={props.projectId}
        milestones={props.milestones}
        onChange={props.onChange ?? vi.fn()}
      />,
    );
  });
};

it('renders the elevated empty state when no milestones exist', async () => {
  await renderComponent({ projectId: 'p1', milestones: [] });
  expect(host.textContent).toContain('No dates or milestones yet');
  expect(host.textContent).toContain('Add first milestone');
});

it('opens the elevated milestone composer when Add milestone is clicked', async () => {
  await renderComponent({ projectId: 'p1', milestones: [] });

  const addBtn = host.querySelector('button') as HTMLButtonElement;
  await act(async () => {
    addBtn.click();
  });

  expect(host.textContent).toContain('New milestone');
  expect(host.textContent).toContain('Milestone title');
  expect(host.textContent).toContain('Planned');
  expect(host.textContent).toContain('In progress');
  expect(host.textContent).toContain('Complete');
  expect(host.textContent).toContain('Create milestone');
  expect(host.textContent).toContain('Cancel');
});

it('supports switching status pills in the composer', async () => {
  await renderComponent({ projectId: 'p1', milestones: [] });

  const addBtn = host.querySelector('button') as HTMLButtonElement;
  await act(async () => {
    addBtn.click();
  });

  const inProgressBtn = Array.from(
    host.querySelectorAll('button[role="radio"]'),
  ).find((btn) =>
    btn.textContent?.includes('In progress'),
  ) as HTMLButtonElement;

  expect(inProgressBtn).toBeDefined();
  await act(async () => {
    inProgressBtn.click();
  });

  expect(inProgressBtn.getAttribute('aria-checked')).toBe('true');
});

const enterText = (input: HTMLInputElement, value: string) => {
  Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  )?.set?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

it('allows entering a title and submitting the new milestone', async () => {
  const onChange = vi.fn();
  await renderComponent({ projectId: 'p1', milestones: [], onChange });

  const addBtn = host.querySelector('button') as HTMLButtonElement;
  await act(async () => {
    addBtn.click();
  });

  const titleInput = host.querySelector(
    '#project-milestone-title',
  ) as HTMLInputElement;
  await act(async () => {
    enterText(titleInput, 'SOC 2 Audit Signoff');
  });

  const submitBtn = Array.from(host.querySelectorAll('button')).find((btn) =>
    btn.textContent?.includes('Create milestone'),
  ) as HTMLButtonElement;

  await act(async () => {
    submitBtn.click();
  });

  expect(api.saveProjectMilestone).toHaveBeenCalledWith('p1', {
    id: undefined,
    title: 'SOC 2 Audit Signoff',
    status: 'planned',
    targetDate: null,
    note: null,
  });
  expect(onChange).toHaveBeenCalled();
});

it('supports saving with Cmd+Enter keyboard shortcut', async () => {
  const onChange = vi.fn();
  await renderComponent({ projectId: 'p1', milestones: [], onChange });

  const addBtn = host.querySelector('button') as HTMLButtonElement;
  await act(async () => {
    addBtn.click();
  });

  const titleInput = host.querySelector(
    '#project-milestone-title',
  ) as HTMLInputElement;
  await act(async () => {
    enterText(titleInput, 'Keyboard Milestone');
  });

  const formContainer =
    host.querySelector('div[onkeydown]') || host.querySelector('form');
  await act(async () => {
    formContainer?.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        metaKey: true,
        bubbles: true,
      }),
    );
  });

  expect(api.saveProjectMilestone).toHaveBeenCalledWith('p1', {
    id: undefined,
    title: 'Keyboard Milestone',
    status: 'planned',
    targetDate: null,
    note: null,
  });
  expect(onChange).toHaveBeenCalled();
});

it('closes the composer when Cancel is clicked', async () => {
  await renderComponent({ projectId: 'p1', milestones: [] });

  const addBtn = host.querySelector('button') as HTMLButtonElement;
  await act(async () => {
    addBtn.click();
  });

  expect(host.textContent).toContain('New milestone');

  const cancelBtn = Array.from(host.querySelectorAll('button')).find(
    (btn) => btn.textContent === 'Cancel',
  ) as HTMLButtonElement;

  await act(async () => {
    cancelBtn.click();
  });

  expect(host.textContent).not.toContain('New milestone');
});

it('closes the composer on Escape key', async () => {
  await renderComponent({ projectId: 'p1', milestones: [] });

  const addBtn = host.querySelector('button') as HTMLButtonElement;
  await act(async () => {
    addBtn.click();
  });

  expect(host.textContent).toContain('New milestone');

  const formContainer =
    host.querySelector('div[onkeydown]') || host.querySelector('form');
  await act(async () => {
    formContainer?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
  });

  expect(host.textContent).not.toContain('New milestone');
});

it('supports selecting quick date presets', async () => {
  await renderComponent({ projectId: 'p1', milestones: [] });

  const addBtn = host.querySelector('button') as HTMLButtonElement;
  await act(async () => {
    addBtn.click();
  });

  const presetBtn = Array.from(host.querySelectorAll('button')).find((btn) =>
    btn.textContent?.includes('This Friday'),
  ) as HTMLButtonElement;

  expect(presetBtn).toBeDefined();
  await act(async () => {
    presetBtn.click();
  });

  const dateInput = host.querySelector(
    '#project-milestone-date',
  ) as HTMLInputElement;
  expect(dateInput.value).not.toBe('');
});

it('opens composer in edit mode for existing milestones and updates', async () => {
  const onChange = vi.fn();
  const existing: ProjectMilestone = {
    id: 'm-existing',
    title: 'Alpha Launch',
    status: 'planned',
    source: 'user',
    timing: 'Oct 1',
    evidenceQuote: null,
    userStatus: 'planned',
    targetDate: '2026-10-01',
    note: 'Launch to private beta users',
  };

  await renderComponent({
    projectId: 'p1',
    milestones: [existing],
    onChange,
  });

  expect(host.textContent).toContain('Alpha Launch');

  const editBtn = host.querySelector(
    'button[aria-label="Edit Alpha Launch"]',
  ) as HTMLButtonElement;
  expect(editBtn).toBeDefined();

  await act(async () => {
    editBtn.click();
  });

  expect(host.textContent).toContain('Edit milestone');
  expect(host.textContent).toContain('Save milestone');

  const titleInput = host.querySelector(
    '#project-milestone-title',
  ) as HTMLInputElement;
  expect(titleInput.value).toBe('Alpha Launch');

  await act(async () => {
    enterText(titleInput, 'Alpha Launch v2');
  });

  const saveBtn = Array.from(host.querySelectorAll('button')).find((btn) =>
    btn.textContent?.includes('Save milestone'),
  ) as HTMLButtonElement;

  await act(async () => {
    saveBtn.click();
  });

  expect(api.saveProjectMilestone).toHaveBeenCalledWith('p1', {
    id: 'm-existing',
    title: 'Alpha Launch v2',
    status: 'planned',
    targetDate: '2026-10-01',
    note: 'Launch to private beta users',
  });
  expect(onChange).toHaveBeenCalled();
});
