// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Entity } from '../../src/api/knowledgeGraph';
import {
  AT_RISK_THRESHOLD_MS,
  MAX_INBOX_PREVIEW,
  ProjectHealthCard,
  ProjectsExecutionTab,
  buildExecutionSummary,
  buildQuickAddActionEntity,
  getExecutionBriefHeading,
  getInboxSummary,
  getNextTaskStatusForToggle,
  getProjectCardSummary,
  isTaskOverdue,
  partitionProjectsForDisplay,
  safeParseMetadata,
  sortExecutionTasksForDisplay,
} from '../../src/components/KnowledgeGraph/ProjectsExecutionTab';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const getEntitiesByTypeMock = vi.hoisted(() => vi.fn());
const getEntityLinksMock = vi.hoisted(() => vi.fn());

vi.mock('../../src/api/knowledgeGraph', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../src/api/knowledgeGraph')>();
  return {
    ...actual,
    getEntitiesByType: getEntitiesByTypeMock,
    getEntityLinks: getEntityLinksMock,
  };
});

describe('buildQuickAddActionEntity', () => {
  it('creates an explicitly confirmed user commitment', () => {
    expect(buildQuickAddActionEntity('  Send the rollout note  ')).toEqual({
      type: 'action_item',
      name: 'Send the rollout note',
      status: 'active',
      dedupe_by_name: false,
      metadata: {
        full_description: 'Send the rollout note',
        commitment_state: 'confirmed',
        origin: 'user',
      },
    });
  });
});

const makeEntity = (overrides: Partial<Entity>): Entity => ({
  id: 'entity-1',
  type: 'project',
  name: 'Launch project',
  status: 'active',
  created_at: '2026-07-14T00:00:00.000Z',
  updated_at: '2026-07-14T00:00:00.000Z',
  due_date: null,
  last_seen_at: null,
  metadata: null,
  confidence: 1,
  ...overrides,
});

describe('ProjectHealthCard', () => {
  it('treats explicitly overdue tasks as slipping project health', () => {
    const project = makeEntity({
      id: 'project-overdue',
      metadata: JSON.stringify({ context: 'Customer launch' }),
    });
    const overdueTask = makeEntity({
      id: 'task-overdue',
      type: 'action_item',
      name: 'Unblock legal review',
      status: 'overdue',
      due_date: '2026-07-20T00:00:00.000Z',
      metadata: JSON.stringify({
        full_description: 'Unblock legal review',
      }),
    });

    const markup = renderToStaticMarkup(
      <ProjectHealthCard
        project={project}
        tasks={[overdueTask]}
        onToggleTask={() => {}}
        onTaskAdded={() => {}}
      />,
    );

    expect(markup).toContain('🔴 Slipping');
    expect(markup).not.toContain('🟢 On Track');
  });

  it('surfaces overdue counts in slipping project summaries', () => {
    const project = makeEntity({
      id: 'project-overdue-summary',
      metadata: JSON.stringify({ context: 'Customer launch' }),
    });
    const overdueTask = makeEntity({
      id: 'task-overdue-summary',
      type: 'action_item',
      name: 'Unblock legal review',
      status: 'overdue',
      due_date: '2026-07-20T00:00:00.000Z',
      metadata: JSON.stringify({
        full_description: 'Unblock legal review',
      }),
    });

    const markup = renderToStaticMarkup(
      <ProjectHealthCard
        project={project}
        tasks={[overdueTask]}
        onToggleTask={() => {}}
        onTaskAdded={() => {}}
      />,
    );

    expect(markup).toContain('1 overdue');
    expect(markup).not.toContain('1 open');
  });

  it('surfaces due-soon counts in at-risk project summaries', () => {
    const project = makeEntity({
      id: 'project-at-risk-summary',
      metadata: JSON.stringify({ context: 'Customer launch' }),
    });
    const dueSoonTask = makeEntity({
      id: 'task-at-risk-summary',
      type: 'action_item',
      name: 'Confirm stakeholder review',
      due_date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      metadata: JSON.stringify({
        full_description: 'Confirm stakeholder review',
      }),
    });

    const markup = renderToStaticMarkup(
      <ProjectHealthCard
        project={project}
        tasks={[dueSoonTask]}
        onToggleTask={() => {}}
        onTaskAdded={() => {}}
      />,
    );

    expect(markup).toContain('1 due soon');
    expect(markup).not.toContain('1 open');
  });

  it('renders overdue styling for explicitly overdue task due badges', () => {
    const project = makeEntity({
      id: 'project-overdue-badge',
      metadata: JSON.stringify({ context: 'Customer launch' }),
    });
    const overdueTask = makeEntity({
      id: 'task-overdue-badge',
      type: 'action_item',
      name: 'Unblock legal review',
      status: 'overdue',
      due_date: '2026-07-20T00:00:00.000Z',
      metadata: JSON.stringify({
        full_description: 'Unblock legal review',
      }),
    });

    const markup = renderToStaticMarkup(
      <ProjectHealthCard
        project={project}
        tasks={[overdueTask]}
        onToggleTask={() => {}}
        onTaskAdded={() => {}}
      />,
    );

    expect(markup).toContain('bg-pro-urgent/10 text-pro-urgent');
    expect(markup).not.toContain('bg-pro-bg text-pro-text-muted');
  });

  it('collapses completed tasks behind disclosure by default', () => {
    const project = makeEntity({
      id: 'project-1',
      metadata: JSON.stringify({ context: 'Execution board' }),
    });
    const activeTask = makeEntity({
      id: 'task-active',
      type: 'action_item',
      name: 'Finalize rollout checklist',
      metadata: JSON.stringify({
        full_description: 'Finalize rollout checklist',
      }),
    });
    const completedTask = makeEntity({
      id: 'task-completed',
      type: 'action_item',
      name: 'Archive launch notes',
      status: 'completed',
      metadata: JSON.stringify({
        full_description: 'Archive launch notes',
      }),
    });

    const markup = renderToStaticMarkup(
      <ProjectHealthCard
        project={project}
        tasks={[activeTask, completedTask]}
        onToggleTask={() => {}}
        onTaskAdded={() => {}}
      />,
    );

    expect(markup).toContain('Finalize rollout checklist');
    expect(markup).toContain('Show 1 completed task');
    expect(markup).not.toContain('Archive launch notes');
  });

  it('does not render a completed-work disclosure when no tasks are completed', () => {
    const project = makeEntity({
      id: 'project-1',
      metadata: JSON.stringify({ context: 'Execution board' }),
    });
    const activeTask = makeEntity({
      id: 'task-active',
      type: 'action_item',
      name: 'Finalize rollout checklist',
      metadata: JSON.stringify({
        full_description: 'Finalize rollout checklist',
      }),
    });

    const markup = renderToStaticMarkup(
      <ProjectHealthCard
        project={project}
        tasks={[activeTask]}
        onToggleTask={() => {}}
        onTaskAdded={() => {}}
      />,
    );

    expect(markup).toContain('Finalize rollout checklist');
    expect(markup).not.toContain('completed task');
  });

  it('marks the selected project card with its exact entity id', () => {
    const project = makeEntity({
      id: 'project-selected',
      metadata: JSON.stringify({ context: 'Execution board' }),
    });
    const activeTask = makeEntity({
      id: 'task-selected',
      type: 'action_item',
      name: 'Finalize rollout checklist',
      metadata: JSON.stringify({
        full_description: 'Finalize rollout checklist',
      }),
    });

    const markup = renderToStaticMarkup(
      <ProjectHealthCard
        project={project}
        tasks={[activeTask]}
        selected
        onToggleTask={() => {}}
        onTaskAdded={() => {}}
      />,
    );

    expect(markup).toContain('data-project-id="project-selected"');
    expect(markup).toContain('data-selected="true"');
  });
});

describe('partitionProjectsForDisplay', () => {
  it('tucks completed-only projects out of the main execution list', () => {
    const activeProject = makeEntity({
      id: 'project-active',
      metadata: JSON.stringify({ context: 'Current sprint' }),
    });
    const completedProject = makeEntity({
      id: 'project-complete',
      metadata: JSON.stringify({ context: 'Shipped work' }),
    });
    const groupedTasks = {
      'project-active': [
        makeEntity({
          id: 'task-active',
          type: 'action_item',
          name: 'Land rollout cleanup',
        }),
      ],
      'project-complete': [
        makeEntity({
          id: 'task-complete',
          type: 'action_item',
          name: 'Archive notes',
          status: 'completed',
        }),
      ],
    };

    const result = partitionProjectsForDisplay(
      [activeProject, completedProject],
      groupedTasks,
    );

    expect(result.activeProjects.map((project) => project.id)).toEqual([
      'project-active',
    ]);
    expect(result.completedProjects.map((project) => project.id)).toEqual([
      'project-complete',
    ]);
  });

  it('prioritizes slipping projects ahead of routine work while keeping stable order within a health bucket', () => {
    const onTrackFirst = makeEntity({
      id: 'project-on-track-first',
      name: 'Routine first',
    });
    const slippingProject = makeEntity({
      id: 'project-slipping',
      name: 'Slipping launch',
    });
    const onTrackSecond = makeEntity({
      id: 'project-on-track-second',
      name: 'Routine second',
    });
    const groupedTasks = {
      'project-on-track-first': [
        makeEntity({
          id: 'task-on-track-first',
          type: 'action_item',
          name: 'Prepare notes',
          due_date: '2099-07-20T00:00:00.000Z',
        }),
      ],
      'project-slipping': [
        makeEntity({
          id: 'task-slipping',
          type: 'action_item',
          name: 'Unblock review',
          status: 'overdue',
        }),
      ],
      'project-on-track-second': [
        makeEntity({
          id: 'task-on-track-second',
          type: 'action_item',
          name: 'Share agenda',
          due_date: '2099-07-21T00:00:00.000Z',
        }),
      ],
    };

    const result = partitionProjectsForDisplay(
      [onTrackFirst, slippingProject, onTrackSecond],
      groupedTasks,
    );

    expect(result.activeProjects.map((project) => project.id)).toEqual([
      'project-slipping',
      'project-on-track-first',
      'project-on-track-second',
    ]);
  });
});

describe('buildExecutionSummary', () => {
  it('accounts for inbox work alongside linked project counts', () => {
    expect(
      buildExecutionSummary({
        activeTaskCount: 3,
        activeProjectCount: 1,
        activeInboxTaskCount: 2,
        overdueTaskCount: 0,
      }).detail,
    ).toBe('3 open across 1 project and 2 inbox items');
  });

  it('avoids zero-project framing when active work only lives in the inbox', () => {
    expect(
      buildExecutionSummary({
        activeTaskCount: 2,
        activeProjectCount: 0,
        activeInboxTaskCount: 2,
        overdueTaskCount: 0,
      }).detail,
    ).toBe('2 open in the inbox');
  });

  it('foregrounds overdue counts when slipping work spans projects and inbox tasks', () => {
    expect(
      buildExecutionSummary({
        activeTaskCount: 5,
        activeProjectCount: 2,
        activeInboxTaskCount: 1,
        overdueTaskCount: 2,
      }),
    ).toEqual({
      heading: 'Slipping commitments',
      detail: '2 overdue across 2 projects and 1 inbox item',
    });
  });

  it('foregrounds overdue counts for inbox-only slipping work', () => {
    expect(
      buildExecutionSummary({
        activeTaskCount: 3,
        activeProjectCount: 0,
        activeInboxTaskCount: 3,
        overdueTaskCount: 1,
      }),
    ).toEqual({
      heading: 'Slipping commitments',
      detail: '1 overdue in the inbox',
    });
  });
});

describe('getExecutionBriefHeading', () => {
  it('surfaces slipping work when overdue commitments are present', () => {
    expect(getExecutionBriefHeading({ activeCount: 3, overdueCount: 1 })).toBe(
      'Slipping commitments',
    );
  });

  it('keeps routine active work on the default heading when nothing is overdue', () => {
    expect(getExecutionBriefHeading({ activeCount: 3, overdueCount: 0 })).toBe(
      'Work in motion',
    );
  });

  it('keeps the empty-state heading when no active commitments remain', () => {
    expect(getExecutionBriefHeading({ activeCount: 0, overdueCount: 0 })).toBe(
      'No active commitments',
    );
  });
});

describe('getProjectCardSummary', () => {
  it('surfaces overdue counts for slipping projects', () => {
    expect(
      getProjectCardSummary({
        activeCount: 3,
        overdueCount: 1,
        atRiskCount: 0,
        completedCount: 0,
      }),
    ).toBe('1 overdue');
  });

  it('surfaces due-soon counts for at-risk projects', () => {
    expect(
      getProjectCardSummary({
        activeCount: 2,
        overdueCount: 0,
        atRiskCount: 1,
        completedCount: 0,
      }),
    ).toBe('1 due soon');
  });

  it('keeps routine active project summaries unchanged when nothing is overdue', () => {
    expect(
      getProjectCardSummary({
        activeCount: 2,
        overdueCount: 0,
        atRiskCount: 0,
        completedCount: 0,
      }),
    ).toBe('2 open');
  });

  it('keeps completed-only project summaries unchanged', () => {
    expect(
      getProjectCardSummary({
        activeCount: 0,
        overdueCount: 0,
        atRiskCount: 0,
        completedCount: 2,
      }),
    ).toBe('2 finished');
  });
});

describe('getInboxSummary', () => {
  it('surfaces overdue counts for slipping inbox work', () => {
    expect(getInboxSummary({ activeCount: 3, overdueCount: 1 })).toBe(
      '1 overdue to triage',
    );
  });

  it('keeps routine inbox summaries unchanged when nothing is overdue', () => {
    expect(getInboxSummary({ activeCount: 2, overdueCount: 0 })).toBe(
      '2 to triage',
    );
  });

  it('keeps the empty inbox summary unchanged', () => {
    expect(getInboxSummary({ activeCount: 0, overdueCount: 0 })).toBe(
      '0 to triage',
    );
  });
});

describe('getNextTaskStatusForToggle', () => {
  it('marks overdue execution tasks completed from the checkbox', () => {
    expect(getNextTaskStatusForToggle('overdue')).toBe('completed');
  });
});

describe('sortExecutionTasksForDisplay', () => {
  it('keeps newer items first within the same lifecycle bucket', () => {
    const result = sortExecutionTasksForDisplay([
      makeEntity({
        id: 'active-older',
        type: 'action_item',
        status: 'active',
        created_at: '2026-07-12T00:00:00.000Z',
      }),
      makeEntity({
        id: 'active-newer',
        type: 'action_item',
        status: 'active',
        created_at: '2026-07-14T00:00:00.000Z',
      }),
      makeEntity({
        id: 'overdue-older',
        type: 'action_item',
        status: 'overdue',
        created_at: '2026-07-11T00:00:00.000Z',
      }),
      makeEntity({
        id: 'overdue-newer',
        type: 'action_item',
        status: 'overdue',
        created_at: '2026-07-13T00:00:00.000Z',
      }),
    ]);

    expect(result.map((item) => item.id)).toEqual([
      'overdue-newer',
      'overdue-older',
      'active-newer',
      'active-older',
    ]);
  });
});

describe('safeParseMetadata', () => {
  it('parses valid JSON string', () => {
    expect(safeParseMetadata('{"key": "value"}')).toEqual({ key: 'value' });
  });

  it('handles already parsed objects', () => {
    expect(safeParseMetadata({ key: 'value' })).toEqual({ key: 'value' });
  });

  it('safely falls back to empty object for invalid JSON without throwing', () => {
    expect(safeParseMetadata('invalid json {')).toEqual({});
    expect(safeParseMetadata('{ incomplete')).toEqual({});
    expect(safeParseMetadata(null)).toEqual({});
    expect(safeParseMetadata(undefined)).toEqual({});
    expect(safeParseMetadata('')).toEqual({});
    expect(safeParseMetadata('   ')).toEqual({});
    expect(safeParseMetadata(123)).toEqual({});
  });
});

describe('isTaskOverdue', () => {
  const now = new Date('2026-07-15T12:00:00.000Z').getTime();

  it('returns true when task status is explicitly overdue', () => {
    const task = makeEntity({
      status: 'overdue',
      due_date: '2026-07-20T00:00:00.000Z',
    });
    expect(isTaskOverdue(task, now)).toBe(true);
  });

  it('returns true when task due date is in the past and task is active', () => {
    const task = makeEntity({
      status: 'active',
      due_date: '2026-07-10T00:00:00.000Z',
    });
    expect(isTaskOverdue(task, now)).toBe(true);
  });

  it('returns false when task due date is in the future', () => {
    const task = makeEntity({
      status: 'active',
      due_date: '2026-07-20T00:00:00.000Z',
    });
    expect(isTaskOverdue(task, now)).toBe(false);
  });

  it('returns false when task has no due date and status is not overdue', () => {
    const task = makeEntity({
      status: 'active',
      due_date: null,
    });
    expect(isTaskOverdue(task, now)).toBe(false);
  });

  it('returns false when task is completed even if due date is in the past', () => {
    const task = makeEntity({
      status: 'completed',
      due_date: '2026-07-10T00:00:00.000Z',
    });
    expect(isTaskOverdue(task, now)).toBe(false);
  });
});

describe('Constants', () => {
  it('exports expected AT_RISK_THRESHOLD_MS and MAX_INBOX_PREVIEW', () => {
    expect(AT_RISK_THRESHOLD_MS).toBe(2 * 24 * 60 * 60 * 1000);
    expect(MAX_INBOX_PREVIEW).toBe(6);
  });
});

describe('ProjectHealthCard metadata resilience', () => {
  it('renders gracefully when project and tasks have malformed metadata JSON', () => {
    const project = makeEntity({
      id: 'project-malformed',
      name: 'Resilient Project',
      metadata: 'invalid-json-{broken',
    });
    const task = makeEntity({
      id: 'task-malformed',
      name: 'Resilient Task',
      status: 'active',
      metadata: '{{{not-json',
    });

    const markup = renderToStaticMarkup(
      <ProjectHealthCard
        project={project}
        tasks={[task]}
        onToggleTask={() => {}}
        onTaskAdded={() => {}}
      />,
    );

    expect(markup).toContain('Resilient Project');
    expect(markup).toContain('Resilient Task');
  });
});

describe('ProjectsExecutionTab borderless portfolio and dossier routing', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    vi.clearAllMocks();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('renders the borderless portfolio list when no project is selected', async () => {
    const project = makeEntity({
      id: 'project-1',
      type: 'project',
      name: 'Project Orion',
      metadata: JSON.stringify({ people_count: 3 }),
    });
    const task = makeEntity({
      id: 'task-1',
      type: 'action_item',
      name: 'Finalize architecture spec',
      status: 'active',
    });

    getEntitiesByTypeMock.mockImplementation(async (type: string) => {
      if (type === 'project') return [project];
      if (type === 'action_item') return [task];
      return [];
    });

    getEntityLinksMock.mockImplementation(async () => [
      {
        id: 'link-1',
        source_entity_id: 'task-1',
        target_entity_id: 'project-1',
        relationship: 'belongs_to',
      },
    ]);

    await act(async () => {
      root.render(<ProjectsExecutionTab selectedProjectId={null} />);
    });

    // Verify borderless portfolio row rendered with project title, tasks and people count
    expect(container.textContent).toContain('Project Orion');
    expect(container.textContent).toContain('Tasks');
    expect(container.textContent).toContain('People');
    expect(container.textContent).toContain('1 Tasks');
    expect(container.textContent).toContain('3 People');

    // Should not render dossier content initially
    expect(container.textContent).not.toContain('Quick Overview');
    expect(container.textContent).not.toContain("Pluto's Insights");

    // Clicking the project row navigates to ProjectDossier
    const projectRow = container.querySelector('[data-project-id="project-1"]');
    expect(projectRow).not.toBeNull();

    await act(async () => {
      projectRow?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    // Now ProjectDossier should be rendered
    expect(container.textContent).toContain('Quick Overview');
    expect(container.textContent).toContain('Status Update');
    expect(container.textContent).toContain("Pluto's Insights");

    // Clicking back returns to the portfolio list
    const backButton = Array.from(container.querySelectorAll('button')).find(
      (btn) => btn.textContent?.includes('Back'),
    );
    expect(backButton).toBeDefined();

    await act(async () => {
      backButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    // Returned to portfolio list
    expect(container.textContent).toContain('Project Orion');
    expect(container.textContent).toContain('Tasks');
    expect(container.textContent).not.toContain('Quick Overview');
  });

  it('renders ProjectDossier directly when selectedProjectId is provided', async () => {
    const project = makeEntity({
      id: 'project-2',
      type: 'project',
      name: 'Project Nebula',
    });

    getEntitiesByTypeMock.mockImplementation(async (type: string) => {
      if (type === 'project') return [project];
      if (type === 'action_item') return [];
      return [];
    });

    getEntityLinksMock.mockImplementation(async () => []);

    await act(async () => {
      root.render(<ProjectsExecutionTab selectedProjectId="project-2" />);
    });

    expect(container.textContent).toContain('Quick Overview');
    expect(container.textContent).toContain('Status Update');
    expect(container.textContent).toContain("Pluto's Insights");
  });

  it('syncs activeProjectId when selectedProjectId prop changes', async () => {
    const project = makeEntity({
      id: 'project-3',
      type: 'project',
      name: 'Project Sol',
    });

    getEntitiesByTypeMock.mockImplementation(async (type: string) => {
      if (type === 'project') return [project];
      if (type === 'action_item') return [];
      return [];
    });

    getEntityLinksMock.mockImplementation(async () => []);

    await act(async () => {
      root.render(<ProjectsExecutionTab selectedProjectId={null} />);
    });

    expect(container.textContent).not.toContain('Quick Overview');

    await act(async () => {
      root.render(<ProjectsExecutionTab selectedProjectId="project-3" />);
    });

    expect(container.textContent).toContain('Quick Overview');
    expect(container.textContent).toContain("Pluto's Insights");
  });
});
