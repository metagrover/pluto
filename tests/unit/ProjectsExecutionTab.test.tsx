import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { Entity } from '../../src/api/knowledgeGraph';
import {
  ProjectHealthCard,
  buildExecutionSummary,
  getNextTaskStatusForToggle,
  partitionProjectsForDisplay,
} from '../../src/components/KnowledgeGraph/ProjectsExecutionTab';

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

    expect(markup).toContain('bg-red-500/10 text-red-500');
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
});

describe('buildExecutionSummary', () => {
  it('accounts for inbox work alongside linked project counts', () => {
    expect(
      buildExecutionSummary({
        activeTaskCount: 3,
        activeProjectCount: 1,
        activeInboxTaskCount: 2,
      }).detail,
    ).toBe('3 open across 1 project and 2 inbox items');
  });

  it('avoids zero-project framing when active work only lives in the inbox', () => {
    expect(
      buildExecutionSummary({
        activeTaskCount: 2,
        activeProjectCount: 0,
        activeInboxTaskCount: 2,
      }).detail,
    ).toBe('2 open in the inbox');
  });
});

describe('getNextTaskStatusForToggle', () => {
  it('marks overdue execution tasks completed from the checkbox', () => {
    expect(getNextTaskStatusForToggle('overdue')).toBe('completed');
  });
});
