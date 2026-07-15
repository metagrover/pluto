import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { Entity } from '../../src/api/knowledgeGraph';
import {
  ProjectHealthCard,
  buildExecutionSummary,
  getExecutionBriefHeading,
  getInboxSummary,
  getNextTaskStatusForToggle,
  getProjectCardSummary,
  partitionProjectsForDisplay,
  sortExecutionTasksForDisplay,
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
          due_date: '2026-07-20T00:00:00.000Z',
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
          due_date: '2026-07-21T00:00:00.000Z',
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
