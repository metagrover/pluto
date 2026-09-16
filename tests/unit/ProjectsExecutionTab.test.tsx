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
const getProjectPortfolioMock = vi.hoisted(() => vi.fn());
const discoverProjectInitiativeMock = vi.hoisted(() => vi.fn());
const reviewProjectScopeMock = vi.hoisted(() => vi.fn());
const getEntityMock = vi.hoisted(() => vi.fn());
const getEntityMeetingsMock = vi.hoisted(() => vi.fn());
const getProjectBriefMock = vi.hoisted(() => vi.fn());
const upsertEntityMock = vi.hoisted(() => vi.fn());
const mergeProjectMock = vi.hoisted(() => vi.fn());
const restoreProjectMergeMock = vi.hoisted(() => vi.fn());
const fileTopicUnderProjectMock = vi.hoisted(() => vi.fn());
const detachTopicFromProjectMock = vi.hoisted(() => vi.fn());
const promoteTopicToInitiativeMock = vi.hoisted(() => vi.fn());
const demoteInitiativeToTopicMock = vi.hoisted(() => vi.fn());

vi.mock('../../src/api/knowledgeGraph', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../src/api/knowledgeGraph')>();
  return {
    ...actual,
    getEntitiesByType: getEntitiesByTypeMock,
    getEntityLinks: getEntityLinksMock,
    getProjectPortfolio: getProjectPortfolioMock,
    discoverProjectInitiative: discoverProjectInitiativeMock,
    reviewProjectScope: reviewProjectScopeMock,
    getEntity: getEntityMock,
    getEntityMeetings: getEntityMeetingsMock,
    getProjectBrief: getProjectBriefMock,
    upsertEntity: upsertEntityMock,
    mergeProject: mergeProjectMock,
    restoreProjectMerge: restoreProjectMergeMock,
    fileTopicUnderProject: fileTopicUnderProjectMock,
    detachTopicFromProject: detachTopicFromProjectMock,
    promoteTopicToInitiative: promoteTopicToInitiativeMock,
    demoteInitiativeToTopic: demoteInitiativeToTopicMock,
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
    getProjectPortfolioMock.mockReset();
    discoverProjectInitiativeMock.mockReset();
    reviewProjectScopeMock.mockReset();
    upsertEntityMock.mockReset();
    mergeProjectMock.mockReset();
    restoreProjectMergeMock.mockReset();
    fileTopicUnderProjectMock.mockReset();
    detachTopicFromProjectMock.mockReset();
    promoteTopicToInitiativeMock.mockReset();
    demoteInitiativeToTopicMock.mockReset();
    upsertEntityMock.mockImplementation(async (entity) => entity);
    mergeProjectMock.mockResolvedValue(undefined);
    restoreProjectMergeMock.mockResolvedValue(undefined);
    fileTopicUnderProjectMock.mockResolvedValue(qualified());
    detachTopicFromProjectMock.mockResolvedValue(qualified());
    promoteTopicToInitiativeMock.mockResolvedValue(qualified());
    demoteInitiativeToTopicMock.mockResolvedValue(qualified());
    getProjectPortfolioMock.mockResolvedValue([qualified()]);
    discoverProjectInitiativeMock.mockResolvedValue({
      discovered: 0,
      remaining: 0,
      failed: 0,
      deferred: false,
    });
    reviewProjectScopeMock.mockResolvedValue({
      reviewed: 0,
      remaining: 0,
      deferred: false,
    });
    getEntityMock.mockResolvedValue(qualified());
    getEntityMeetingsMock.mockResolvedValue([]);
    getProjectBriefMock.mockResolvedValue({
      project: {
        id: 'project-1',
        displayTitle: 'Project Orion',
        detectedTitle: 'Project Orion',
        metadata: qualified().metadata,
        status: 'active',
      },
      meetingStats: {
        meetingCount: 2,
        activeWeeks: 1,
        participantCoverage: 0,
        typicalParticipantCount: null,
        frequentParticipants: [],
        recurringSeries: [],
      },
      health: {
        state: 'not_enough_evidence',
        headline: 'Not enough evidence',
        summary: 'No reliable status yet.',
        updatedAt: null,
        freshness: 'unknown',
        evidenceTaskIds: [],
      },
      milestones: [],
      momentum: {
        recentMeetingCount: 0,
        openCommitmentCount: 0,
        completedCommitmentCount: 0,
        recentlyCompletedCommitmentCount: 0,
        lastActivityAt: null,
        headline: 'No recent project activity recorded',
      },
      meetings: [],
      tasks: [],
      mergedProjects: [],
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const qualified = () => ({
    ...makeEntity({
      id: 'project-1',
      name: 'Project Orion',
      metadata: JSON.stringify({
        projectQualification: {
          version: 1,
          state: 'qualified',
          source: 'user',
          reason: 'Confirmed initiative',
          assessedAt: '2026-08-28',
          outcome: 'Replace legacy billing',
        },
      }),
    }),
    meeting_count: 2,
    last_mentioned_at: '2026-08-28T12:00:00Z',
    latest_context: 'Migration and rollout',
  });

  it('shows qualified initiatives without fabricated health or zero metrics', async () => {
    await act(async () => root.render(<ProjectsExecutionTab />));
    expect(container.textContent).toContain('Project Orion');
    expect(container.textContent).toContain('Replace legacy billing');
    expect(container.textContent).not.toContain('Complete');
    expect(container.textContent).not.toContain('Tasks');
    expect(container.textContent).not.toContain('People');
    expect(reviewProjectScopeMock).not.toHaveBeenCalled();
  });

  it('lists durable themes without inventing health-based groups', async () => {
    getProjectPortfolioMock.mockResolvedValue([
      {
        ...qualified(),
        id: 'needs-attention',
        name: 'Migration readiness',
        health_state: 'watch',
        health_headline: 'Watch',
        health_summary: 'A confirmed milestone is due soon.',
      },
      {
        ...qualified(),
        id: 'in-motion',
        name: 'Archive launch',
        health_state: 'appears_on_track',
        health_headline: 'Appears on track',
        health_summary: 'A confirmed milestone was completed recently.',
      },
      {
        ...qualified(),
        id: 'awaiting-signal',
        name: 'Sandbox readiness',
        health_state: 'not_enough_evidence',
        health_headline: 'Not enough evidence',
        health_summary: 'No reliable progress signal yet.',
      },
    ]);

    await act(async () => root.render(<ProjectsExecutionTab />));

    const current = container.querySelector(
      '[data-testid="current-projects"]',
    )?.textContent;
    expect(current).toContain('Migration readiness');
    expect(current).toContain('Archive launch');
    expect(current).toContain('Sandbox readiness');
    expect(container.textContent).not.toContain('Awaiting signal');
    expect(container.textContent).not.toContain('In motion');
  });

  it('keeps unqualified records in a secondary disclosure', async () => {
    getProjectPortfolioMock.mockResolvedValue([
      qualified(),
      {
        ...qualified(),
        id: 'routine',
        name: 'Routine configuration',
        metadata: JSON.stringify({
          projectQualification: {
            version: 1,
            state: 'subordinate',
            source: 'review',
            reason: 'A single configuration task',
            assessedAt: '2026-08-28',
          },
        }),
      },
    ]);
    await act(async () => root.render(<ProjectsExecutionTab />));
    expect(
      container.querySelector('details [data-project-id="routine"]'),
    ).not.toBeNull();
    expect(container.querySelector('details')?.open).toBe(false);
    expect(
      container.querySelector(
        '[data-testid="current-projects"] [data-project-id="routine"]',
      ),
    ).toBeNull();
  });

  it('does not auto-review legacy fragments one at a time', async () => {
    getProjectPortfolioMock
      .mockResolvedValueOnce([{ ...qualified(), metadata: null }])
      .mockResolvedValue([qualified()]);
    await act(async () => root.render(<ProjectsExecutionTab />));
    expect(reviewProjectScopeMock).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Discussed work');
  });

  it('publishes synthesized themes in one portfolio-level pass', async () => {
    vi.useFakeTimers();
    try {
      getProjectPortfolioMock
        .mockResolvedValueOnce([])
        .mockResolvedValue([qualified()]);
      discoverProjectInitiativeMock.mockResolvedValueOnce({
        discovered: 1,
        discoveredProjectId: 'project-1',
        remaining: 0,
        failed: 0,
        deferred: false,
      });
      await act(async () => root.render(<ProjectsExecutionTab />));
      expect(container.textContent).toContain('Project Orion');
      expect(reviewProjectScopeMock).not.toHaveBeenCalled();
      await act(async () => vi.advanceTimersByTimeAsync(500));
      expect(discoverProjectInitiativeMock).toHaveBeenCalledOnce();
      expect(reviewProjectScopeMock).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('retains loaded records when theme synthesis fails and offers retry', async () => {
    discoverProjectInitiativeMock.mockRejectedValue(new Error('offline'));
    await act(async () => root.render(<ProjectsExecutionTab />));
    expect(container.textContent).toContain('Project Orion');
    expect(container.textContent).toContain('Retry synthesis');
    expect(container.textContent).not.toContain('No projects');
  });

  it('retries a failed portfolio synthesis only after an explicit action', async () => {
    discoverProjectInitiativeMock.mockResolvedValueOnce({
      discovered: 0,
      remaining: 1,
      failed: 1,
      deferred: false,
    });
    await act(async () => root.render(<ProjectsExecutionTab />));
    expect(discoverProjectInitiativeMock).toHaveBeenCalledOnce();
    const retry = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Retry synthesis',
    );
    discoverProjectInitiativeMock.mockResolvedValueOnce({
      discovered: 0,
      remaining: 0,
      failed: 0,
      deferred: false,
    });
    await act(async () => retry?.click());
    expect(discoverProjectInitiativeMock).toHaveBeenCalledTimes(2);
    expect(discoverProjectInitiativeMock).toHaveBeenLastCalledWith({
      retryFailed: true,
    });
  });

  it('waits and retries when synthesis is deferred by foreground work', async () => {
    vi.useFakeTimers();
    try {
      discoverProjectInitiativeMock
        .mockResolvedValueOnce({
          discovered: 0,
          remaining: 1,
          failed: 0,
          deferred: true,
        })
        .mockResolvedValueOnce({
          discovered: 0,
          remaining: 0,
          failed: 0,
          deferred: false,
        });
      await act(async () => root.render(<ProjectsExecutionTab />));
      expect(container.textContent).toContain('resume when Pluto is free');
      await act(async () => vi.advanceTimersByTimeAsync(5000));
      expect(discoverProjectInitiativeMock).toHaveBeenCalledTimes(2);
      expect(reviewProjectScopeMock).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('describes a synthesis failure without hiding saved context', async () => {
    discoverProjectInitiativeMock.mockRejectedValue(new Error('offline'));
    await act(async () => root.render(<ProjectsExecutionTab />));
    expect(container.textContent).toContain('couldn’t refresh themes');
    expect(container.textContent).toContain('Project Orion');
  });

  it('separates one-meeting auto-discoveries into suggested themes', async () => {
    const suggestion = {
      ...qualified(),
      meeting_count: 1,
      metadata: JSON.stringify({
        projectQualification: {
          version: 1,
          state: 'qualified',
          source: 'review',
          reason: 'Generated from one meeting.',
          assessedAt: '2026-08-28',
          outcome: 'Replace legacy billing',
        },
        projectInitiativeDiscovery: { version: 12, sourceMeetingId: 'm1' },
      }),
    };
    getProjectPortfolioMock.mockResolvedValue([suggestion]);
    await act(async () => root.render(<ProjectsExecutionTab />));
    expect(container.textContent).toContain('Suggested themes');
    expect(container.textContent).toContain(
      'One conversation, review before adding',
    );
    expect(
      container.querySelector(
        '[data-testid="current-projects"] [data-project-id="project-1"]',
      ),
    ).toBeNull();
  });

  it('does not start theme synthesis while a dossier is selected', async () => {
    await act(async () =>
      root.render(<ProjectsExecutionTab selectedProjectId="project-1" />),
    );
    expect(getProjectBriefMock).toHaveBeenCalledWith('project-1');
    expect(discoverProjectInitiativeMock).not.toHaveBeenCalled();
  });

  it('shows synthesized current focus and recent change on the overview', async () => {
    getProjectPortfolioMock.mockResolvedValue([
      {
        ...qualified(),
        current_focus: 'Validate access rules before launch',
        recent_change: 'The first collection is now indexed.',
        open_thread_count: 2,
      },
    ]);
    await act(async () => root.render(<ProjectsExecutionTab />));
    expect(container.textContent).toContain(
      'Validate access rules before launch',
    );
    expect(container.textContent).toContain('Since last time');
    expect(container.textContent).toContain(
      'The first collection is now indexed.',
    );
    expect(container.textContent).toContain('2 open threads');
  });

  it('opens real dossier and returns to the overview', async () => {
    await act(async () => root.render(<ProjectsExecutionTab />));
    await act(async () =>
      (
        container.querySelector(
          '[data-project-id="project-1"]',
        ) as HTMLButtonElement
      ).click(),
    );
    expect(container.textContent).toContain('Meeting history');
    const back = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Back'),
    );
    await act(async () => back?.click());
    expect(
      container.querySelector('[data-testid="current-projects"]'),
    ).not.toBeNull();
  });

  it('syncs dossier navigation with a selected project prop', async () => {
    await act(async () => root.render(<ProjectsExecutionTab />));
    await act(async () =>
      root.render(<ProjectsExecutionTab selectedProjectId="project-1" />),
    );
    expect(getProjectBriefMock).toHaveBeenCalledWith('project-1');
  });

  it('partitions projects into Primary Focus and Other initiatives when starring is active', async () => {
    const starredProject = {
      ...qualified(),
      id: 'project-star',
      name: 'Alpha Engine',
      metadata: JSON.stringify({
        projectQualification: {
          version: 1,
          state: 'qualified',
          source: 'user',
          reason: 'Confirmed initiative',
          assessedAt: '2026-08-28',
          outcome: 'Ship Alpha',
        },
        projectStarred: true,
      }),
    };
    const sideProject = {
      ...qualified(),
      id: 'project-side',
      name: 'Beta Exploration',
      metadata: JSON.stringify({
        projectQualification: {
          version: 1,
          state: 'qualified',
          source: 'user',
          reason: 'Confirmed initiative',
          assessedAt: '2026-08-28',
          outcome: 'Explore Beta',
        },
        projectStarred: false,
      }),
    };

    getProjectPortfolioMock.mockResolvedValue([starredProject, sideProject]);
    await act(async () => root.render(<ProjectsExecutionTab />));

    expect(container.textContent).toContain('Primary focus');
    expect(container.textContent).toContain('Other initiatives');
    expect(container.textContent).toContain('Alpha Engine');
    expect(container.textContent).toContain('Beta Exploration');
    expect(container.textContent).toContain('Primary');
  });

  it('allows starring a project directly from the overview list', async () => {
    getProjectPortfolioMock.mockResolvedValue([qualified()]);
    await act(async () => root.render(<ProjectsExecutionTab />));

    const starButton = container.querySelector<HTMLButtonElement>(
      '[aria-label="Star Project Orion"]',
    );
    expect(starButton).not.toBeNull();

    await act(async () => {
      starButton?.click();
    });

    expect(upsertEntityMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'project-1',
        metadata: expect.objectContaining({
          projectStarred: true,
        }),
      }),
    );
  });

  it('opens quick merge modal, merges a project, and supports undo toast', async () => {
    const projectA = qualified();
    const projectB = {
      ...qualified(),
      id: 'project-2',
      name: 'Project Vega',
    };
    getProjectPortfolioMock.mockResolvedValue([projectA, projectB]);
    await act(async () => root.render(<ProjectsExecutionTab />));

    // Click quick merge on project-1
    const mergeBtn = container.querySelector<HTMLButtonElement>(
      '[aria-label="Merge Project Orion with another project"]',
    );
    expect(mergeBtn).not.toBeNull();
    await act(async () => {
      mergeBtn?.click();
    });

    // Verify modal is open
    const modal = document.body.querySelector('[role="dialog"]');
    expect(modal).not.toBeNull();
    expect(modal?.textContent).toContain('Quick Merge Project');
    expect(modal?.textContent).toContain('Merge this into another');

    // Select Project Vega as target
    const candidateBtn = Array.from(
      modal?.querySelectorAll('button') ?? [],
    ).find((b) => b.textContent?.includes('Project Vega'));
    expect(candidateBtn).not.toBeNull();
    await act(async () => {
      candidateBtn?.click();
    });

    // Click "Confirm Merge"
    const confirmBtn = Array.from(
      modal?.querySelectorAll('button') ?? [],
    ).find((b) => b.textContent?.includes('Confirm Merge'));
    expect(confirmBtn).not.toBeNull();

    await act(async () => {
      confirmBtn?.click();
    });

    expect(mergeProjectMock).toHaveBeenCalledWith('project-1', 'project-2');

    // Verify undo toast appears
    expect(document.body.textContent).toContain(
      'Merged Project Orion into Project Vega',
    );
    const undoBtn = Array.from(document.body.querySelectorAll('button')).find(
      (b) => b.textContent === 'Undo',
    );
    expect(undoBtn).not.toBeNull();

    // Undo the merge
    await act(async () => {
      undoBtn?.click();
    });
    expect(restoreProjectMergeMock).toHaveBeenCalledWith('project-1');
  });

  it('supports drag-and-drop merge to trigger confirmation modal', async () => {
    const projectA = qualified();
    const projectB = {
      ...qualified(),
      id: 'project-2',
      name: 'Project Vega',
    };
    getProjectPortfolioMock.mockResolvedValue([projectA, projectB]);
    await act(async () => root.render(<ProjectsExecutionTab />));

    const rowA = container.querySelector('[data-project-id="project-1"]');
    const rowB = container.querySelector('[data-project-id="project-2"]');
    expect(rowA).not.toBeNull();
    expect(rowB).not.toBeNull();

    const dragStartEvent = new Event('dragstart', { bubbles: true });
    Object.assign(dragStartEvent, {
      dataTransfer: {
        setData: vi.fn(),
        effectAllowed: '',
      },
    });
    await act(async () => {
      rowA?.dispatchEvent(dragStartEvent);
    });

    const dropEvent = new Event('drop', { bubbles: true });
    Object.assign(dropEvent, {
      preventDefault: vi.fn(),
    });
    await act(async () => {
      rowB?.dispatchEvent(dropEvent);
    });

    // Modal should now be open
    expect(document.body.textContent).toContain('Confirm Project Merge');

    const confirmBtn = Array.from(
      document.body.querySelectorAll('button'),
    ).find((b) => b.textContent?.includes('Merge into Project Vega'));
    expect(confirmBtn).not.toBeNull();

    await act(async () => {
      confirmBtn?.click();
    });

    expect(mergeProjectMock).toHaveBeenCalledWith('project-1', 'project-2');
  });

  it('renders unfiled discussion streams in the Discussed Topics Radar', async () => {
    const initiative = qualified();
    const radarTopic = {
      ...qualified(),
      id: 'topic-1',
      name: 'Authentication Discussion',
      meeting_count: 1,
      last_mentioned_at: '2026-08-20T10:00:00Z',
      latest_context: 'Single call discussion about OAuth2 providers',
      metadata: JSON.stringify({
        projectQualification: {
          version: 1,
          state: 'unassessed',
        },
      }),
    };
    getProjectPortfolioMock.mockResolvedValue([initiative, radarTopic]);
    await act(async () => root.render(<ProjectsExecutionTab />));

    const radar = container.querySelector('[data-testid="topic-radar"]');
    expect(radar).not.toBeNull();
    expect(radar?.textContent).toContain('Discussed work & topics');
    expect(radar?.textContent).toContain('Authentication Discussion');
    expect(radar?.textContent).toContain(
      'Single call discussion about OAuth2 providers',
    );
    expect(radar?.textContent).toContain('1 call');
  });

  it('files a topic under an initiative via File under menu with undo support', async () => {
    const initiative = qualified();
    const radarTopic = {
      ...qualified(),
      id: 'topic-1',
      name: 'OAuth Discussion',
      meeting_count: 1,
      metadata: JSON.stringify({
        projectQualification: {
          version: 1,
          state: 'unassessed',
        },
      }),
    };
    getProjectPortfolioMock.mockResolvedValue([initiative, radarTopic]);
    await act(async () => root.render(<ProjectsExecutionTab />));

    // Click "File under…" button on the topic
    const fileUnderBtn = container.querySelector<HTMLButtonElement>(
      '[aria-label="File OAuth Discussion under an initiative"]',
    );
    expect(fileUnderBtn).not.toBeNull();
    await act(async () => {
      fileUnderBtn?.click();
    });

    // Dropdown should be open showing Project Orion
    const initOption = Array.from(
      container.querySelectorAll('[role="menu"] button'),
    ).find((b) => b.textContent?.includes('Project Orion'));
    expect(initOption).not.toBeNull();

    // Select Project Orion
    await act(async () => {
      (initOption as HTMLButtonElement).click();
    });

    expect(fileTopicUnderProjectMock).toHaveBeenCalledWith(
      'topic-1',
      'project-1',
    );

    // Verify undo toast appears
    expect(document.body.textContent).toContain(
      'Filed "OAuth Discussion" under Project Orion',
    );
    const undoBtn = Array.from(document.body.querySelectorAll('button')).find(
      (b) => b.textContent === 'Undo',
    );
    expect(undoBtn).not.toBeNull();

    // Undo filing
    await act(async () => {
      undoBtn?.click();
    });
    expect(detachTopicFromProjectMock).toHaveBeenCalledWith('topic-1');
  });

  it('files a topic under an initiative via drag-and-drop directly without merge modal', async () => {
    const initiative = qualified();
    const radarTopic = {
      ...qualified(),
      id: 'topic-1',
      name: 'OAuth Discussion',
      meeting_count: 1,
      metadata: JSON.stringify({
        projectQualification: {
          version: 1,
          state: 'unassessed',
        },
      }),
    };
    getProjectPortfolioMock.mockResolvedValue([initiative, radarTopic]);
    await act(async () => root.render(<ProjectsExecutionTab />));

    const topicRow = container.querySelector('[data-project-id="topic-1"]');
    const initRow = container.querySelector('[data-project-id="project-1"]');
    expect(topicRow).not.toBeNull();
    expect(initRow).not.toBeNull();

    const dragStartEvent = new Event('dragstart', { bubbles: true });
    Object.assign(dragStartEvent, {
      dataTransfer: {
        setData: vi.fn(),
        effectAllowed: '',
      },
    });
    await act(async () => {
      topicRow?.dispatchEvent(dragStartEvent);
    });

    const dropEvent = new Event('drop', { bubbles: true });
    Object.assign(dropEvent, {
      preventDefault: vi.fn(),
    });
    await act(async () => {
      initRow?.dispatchEvent(dropEvent);
    });

    // Should NOT open Confirm Project Merge modal, directly calls fileTopicUnderProject
    expect(container.textContent).not.toContain('Confirm Project Merge');
    expect(fileTopicUnderProjectMock).toHaveBeenCalledWith(
      'topic-1',
      'project-1',
    );
  });

  it('renders constituent topic chips on initiative card and allows detaching', async () => {
    const initiative = qualified();
    const filedTopic = {
      ...qualified(),
      id: 'topic-filed',
      name: 'Token Storage Strategy',
      meeting_count: 1,
      metadata: JSON.stringify({
        projectQualification: {
          version: 1,
          state: 'subordinate',
          source: 'user',
          reason: 'Filed under parent initiative by user.',
          assessedAt: '2026-08-28T12:00:00.000Z',
          parentProjectId: 'project-1',
        },
      }),
    };
    getProjectPortfolioMock.mockResolvedValue([initiative, filedTopic]);
    await act(async () => root.render(<ProjectsExecutionTab />));

    const initCard = container.querySelector('[data-project-id="project-1"]');
    expect(initCard?.textContent).toContain('Topics:');
    expect(initCard?.textContent).toContain('Token Storage Strategy');

    const detachBtn = initCard?.querySelector<HTMLButtonElement>(
      '[aria-label="Detach Token Storage Strategy"]',
    );
    expect(detachBtn).not.toBeNull();

    await act(async () => {
      detachBtn?.click();
    });

    expect(detachTopicFromProjectMock).toHaveBeenCalledWith('topic-filed');
  });

  it('promotes a topic to an initiative via Make project button with undo support', async () => {
    const initiative = qualified();
    const radarTopic = {
      ...qualified(),
      id: 'topic-1',
      name: 'Pluto Architecture',
      meeting_count: 4,
      metadata: JSON.stringify({
        projectQualification: {
          version: 1,
          state: 'unassessed',
        },
      }),
    };
    getProjectPortfolioMock.mockResolvedValue([initiative, radarTopic]);
    await act(async () => root.render(<ProjectsExecutionTab />));

    // Check for Suggested initiative badge since meeting_count >= 2
    const topicRow = container.querySelector('[data-project-id="topic-1"]');
    expect(topicRow?.textContent).toContain('Suggested initiative');
    expect(topicRow?.textContent).toContain('4 calls');

    // Click "Make project" button
    const makeProjectBtn = container.querySelector<HTMLButtonElement>(
      '[aria-label="Make Pluto Architecture a project"]',
    );
    expect(makeProjectBtn).not.toBeNull();
    await act(async () => {
      makeProjectBtn?.click();
    });

    expect(promoteTopicToInitiativeMock).toHaveBeenCalledWith('topic-1');

    // Verify undo toast appears
    expect(document.body.textContent).toContain(
      'Promoted "Pluto Architecture" to a project',
    );
    const undoBtn = Array.from(document.body.querySelectorAll('button')).find(
      (b) => b.textContent === 'Undo',
    );
    expect(undoBtn).not.toBeNull();

    // Click Undo
    await act(async () => {
      undoBtn?.click();
    });
    expect(demoteInitiativeToTopicMock).toHaveBeenCalledWith('topic-1');
  });

  it('promotes a topic to an initiative via Promote to project in File under menu', async () => {
    const initiative = qualified();
    const radarTopic = {
      ...qualified(),
      id: 'topic-1',
      name: 'ARP',
      meeting_count: 1,
      metadata: JSON.stringify({
        projectQualification: {
          version: 1,
          state: 'unassessed',
        },
      }),
    };
    getProjectPortfolioMock.mockResolvedValue([initiative, radarTopic]);
    await act(async () => root.render(<ProjectsExecutionTab />));

    // Open File under menu
    const fileUnderBtn = container.querySelector<HTMLButtonElement>(
      '[aria-label="File ARP under an initiative"]',
    );
    expect(fileUnderBtn).not.toBeNull();
    await act(async () => {
      fileUnderBtn?.click();
    });

    // Click "Promote to project" option
    const promoteOption = Array.from(
      container.querySelectorAll('[role="menu"] button'),
    ).find((b) => b.textContent?.includes('Promote to project'));
    expect(promoteOption).not.toBeNull();

    await act(async () => {
      (promoteOption as HTMLButtonElement).click();
    });

    expect(promoteTopicToInitiativeMock).toHaveBeenCalledWith('topic-1');
  });

  it('renders Reference badge instead of 0 calls for topics with 0 meetings', async () => {
    const initiative = qualified();
    const zeroCallTopic = {
      ...qualified(),
      id: 'topic-zero',
      name: 'Open Source Community',
      meeting_count: 0,
      metadata: JSON.stringify({
        projectQualification: {
          version: 1,
          state: 'unassessed',
        },
      }),
    };
    getProjectPortfolioMock.mockResolvedValue([initiative, zeroCallTopic]);
    await act(async () => root.render(<ProjectsExecutionTab />));

    const topicRow = container.querySelector('[data-project-id="topic-zero"]');
    expect(topicRow?.textContent).toContain('Reference');
    expect(topicRow?.textContent).not.toContain('0 calls');
  });

  it('renders Dormant initiatives section with dormancy badge for projects untouched >30 days', async () => {
    const activeProject = {
      ...qualified(),
      id: 'active-proj',
      name: 'Active Project',
      last_mentioned_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(), // 3d ago
    };
    const dormantProject = {
      ...qualified(),
      id: 'dormant-proj',
      name: 'Old Untouched Project',
      last_mentioned_at: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString(), // 45d ago
    };

    getProjectPortfolioMock.mockResolvedValue([activeProject, dormantProject]);
    await act(async () => root.render(<ProjectsExecutionTab />));

    // Active project in current-projects
    const activeRow = container.querySelector(
      '[data-testid="current-projects"] [data-project-id="active-proj"]',
    );
    expect(activeRow).not.toBeNull();

    // Dormant project in dormant-projects section
    const dormantSection = container.querySelector(
      '[data-testid="dormant-projects"]',
    );
    expect(dormantSection).not.toBeNull();
    expect(dormantSection?.textContent).toContain('Dormant initiatives');
    expect(dormantSection?.textContent).toContain('1 dormant');
    expect(dormantSection?.textContent).toContain('Old Untouched');
    expect(dormantSection?.textContent).toContain('Inactive for');
  });
});
