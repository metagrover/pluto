// @vitest-environment happy-dom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ProjectBrief } from '../../src/utils/projectBriefing';

const api = vi.hoisted(() => ({
  getProjectBrief: vi.fn(),
  updateProjectDisplayTitle: vi.fn(),
  saveProjectMilestone: vi.fn(),
  deleteProjectMilestone: vi.fn(),
  restoreProjectMilestone: vi.fn(),
  mergeProject: vi.fn(),
  addProjectAlias: vi.fn().mockResolvedValue(undefined),
  restoreProjectMerge: vi.fn(),
  setProjectPortfolioDisposition: vi.fn(),
  getEntitiesByType: vi.fn(),
  getEntityLinks: vi.fn(),
  updateEntityStatus: vi.fn(),
  upsertEntity: vi.fn(),
  linkEntities: vi.fn(),
  getEntityAliasSuggestions: vi.fn().mockResolvedValue([]),
  updateEntityAliasSuggestionStatus: vi
    .fn()
    .mockResolvedValue({ success: true }),
  triggerDreamingNow: vi.fn().mockResolvedValue({
    status: 'no_change',
    entityId: 'p1',
    proposals: [],
  }),
  recordEntityCorrection: vi.fn().mockResolvedValue({}),
  getPendingDreamingProposals: vi.fn().mockResolvedValue([]),
  acceptDreamingProposal: vi.fn(),
  rejectDreamingProposal: vi.fn(),
}));
vi.mock('../../src/api/knowledgeGraph', () => api);
import { ProjectDossier } from '../../src/components/features/projects/ProjectDossier';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;

const brief = (overrides: Partial<ProjectBrief> = {}): ProjectBrief => ({
  project: {
    id: 'p1',
    displayTitle: 'Archive modernization',
    detectedTitle:
      'Build the searchable historical archive modernization initiative',
    status: 'active',
    metadata: JSON.stringify({
      projectQualification: {
        version: 1,
        state: 'qualified',
        source: 'review',
        reason: 'Grounded scope',
        assessedAt: '2026-08-28T12:00:00Z',
        outcome: 'Make historical records searchable',
      },
    }),
  },
  theme: {
    version: 1,
    sourceMeetingIds: ['m1', 'm2'],
    candidateProjectIds: ['candidate-1'],
    outcome: 'Make historical records searchable',
    currentFocus: 'Validate access rules before launch',
    recentChanges: [
      {
        sourceMeetingId: 'm1',
        summary: 'The first collection is now indexed.',
        evidenceQuote: 'The first collection is now indexed.',
      },
    ],
    openThreads: [
      {
        sourceMeetingId: 'm1',
        kind: 'action',
        text: 'Validate access rules before launch',
        evidenceQuote: 'Validate access rules before launch.',
      },
    ],
    synthesizedAt: '2026-08-28T12:00:00Z',
  },
  meetingStats: {
    meetingCount: 7,
    activeWeeks: 8,
    participantCoverage: 5,
    typicalParticipantCount: 4,
    frequentParticipants: ['Alex', 'Sam'],
    recurringSeries: [
      {
        key: 'archive weekly review',
        title: 'Archive weekly review',
        meetingCount: 4,
        cadence: 'Weekly pattern',
        typicalParticipantCount: 4,
        lastMetAt: '2026-08-27T12:00:00Z',
        meetingIds: ['m1', 'm2', 'm3', 'm4'],
      },
    ],
  },
  momentum: {
    recentMeetingCount: 2,
    openCommitmentCount: 3,
    completedCommitmentCount: 4,
    recentlyCompletedCount: 1,
    lastActivityAt: '2026-08-28T12:00:00Z',
    headline: 'Recent activity and completed work',
  },
  health: {
    state: 'watch',
    headline: 'Watch',
    summary: 'One confirmed milestone is due within two weeks.',
    updatedAt: '2026-08-28T12:00:00Z',
    freshness: 'fresh',
    evidenceTaskIds: ['t1'],
  },
  milestones: [
    {
      id: 't1',
      title: 'Complete migration review',
      status: 'upcoming',
      timing: 'Sep 5',
      evidenceQuote: 'Complete the migration review by September 5.',
      source: 'commitment',
      targetDate: '2026-09-05T10:00:00Z',
      note: null,
    },
  ],
  meetings: [
    {
      id: 'm1',
      title: 'Archive weekly review',
      started_at: '2026-08-27T12:00:00Z',
      created_at: null,
      participants: [],
      context: 'Migration and rollout',
    },
  ],
  tasks: [],
  mergedProjects: [],
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  api.getProjectBrief.mockResolvedValue(brief());
  api.updateProjectDisplayTitle.mockResolvedValue({});
  api.saveProjectMilestone.mockResolvedValue({
    id: 'user-1',
    title: 'Private beta',
    status: 'planned',
    targetDate: '2026-09-10',
    note: null,
    createdAt: '2026-08-29T12:00:00Z',
    updatedAt: '2026-08-29T12:00:00Z',
  });
  api.deleteProjectMilestone.mockResolvedValue({
    id: 'user-1',
    title: 'Private beta',
    status: 'planned',
    targetDate: '2026-09-10',
    note: null,
    createdAt: '2026-08-29T12:00:00Z',
    updatedAt: '2026-08-29T12:00:00Z',
  });
  api.restoreProjectMilestone.mockResolvedValue({
    id: 'user-1',
    title: 'Private beta',
    status: 'planned',
    targetDate: '2026-09-10',
    note: null,
    createdAt: '2026-08-29T12:00:00Z',
    updatedAt: '2026-08-29T12:00:00Z',
  });
  api.mergeProject.mockResolvedValue(undefined);
  api.restoreProjectMerge.mockResolvedValue(undefined);
  api.setProjectPortfolioDisposition.mockResolvedValue({});
  api.getEntitiesByType.mockResolvedValue([]);
  api.getEntityLinks.mockResolvedValue([]);
  api.triggerDreamingNow.mockResolvedValue({
    status: 'no_change',
    entityId: 'p1',
    proposals: [],
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

const render = async (props: Record<string, unknown> = {}) => {
  await act(async () =>
    root.render(<ProjectDossier projectId="p1" onBack={() => {}} {...props} />),
  );
};

const click = async (text: string) => {
  await act(async () => {
    Array.from(host.querySelectorAll('button'))
      .find((button) => button.textContent?.includes(text))
      ?.click();
  });
};

const setValue = async (
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string,
) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(element),
      'value',
    )?.set?.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
};

it('leads with current focus, recent changes, and open threads', async () => {
  await render();
  expect(host.textContent).toContain('Archive modernization');
  expect(host.textContent).toContain('Make historical records searchable');
  expect(host.textContent).toContain('7 conversations');
  expect(host.textContent).toContain('Current focus');
  expect(host.textContent).toContain('Validate access rules before launch');
  expect(host.textContent).toContain('Since last time');
  expect(host.textContent).toContain('The first collection is now indexed.');
  expect(host.textContent).toContain('Open threads');
  expect(host.textContent).toContain('Complete migration review');
  expect(host.textContent).toContain('From meeting evidence');
  expect(host.textContent).toContain('Conversation history');
  expect(host.textContent!.indexOf('Conversation history')).toBeLessThan(
    host.textContent!.indexOf('Milestones'),
  );
  expect(host.textContent).not.toContain('Momentum');
});

it('does not repeat the project outcome when it matches the current focus', async () => {
  const duplicateFocusBrief = brief();
  duplicateFocusBrief.theme!.currentFocus =
    'Make historical records searchable.';
  api.getProjectBrief.mockResolvedValueOnce(duplicateFocusBrief);

  await render();

  expect(host.textContent).toContain('Current focus');
  expect(
    host.textContent?.match(/Make historical records searchable/g),
  ).toHaveLength(1);
});

it('adds a user milestone from an inline form', async () => {
  await render();
  await click('Add milestone');
  const title = host.querySelector<HTMLInputElement>(
    '#project-milestone-title',
  )!;
  await setValue(title, 'Private beta');
  await click('Create milestone');

  expect(api.saveProjectMilestone).toHaveBeenCalledWith('p1', {
    title: 'Private beta',
    status: 'planned',
    targetDate: null,
    note: null,
  });
  expect(host.textContent).toContain('User-created');
  expect(host.textContent).toContain('Milestone saved');
});

it('keeps an unsaved milestone draft when saving fails', async () => {
  api.saveProjectMilestone.mockRejectedValueOnce(new Error('offline'));
  await render();
  await click('Add milestone');
  const title = host.querySelector<HTMLInputElement>(
    '#project-milestone-title',
  )!;
  await setValue(title, 'Partner onboarding');
  await click('Create milestone');

  expect(title.value).toBe('Partner onboarding');
  expect(host.textContent).toContain(
    'We couldn’t save this milestone. Your draft is still here.',
  );
});

it('completes, deletes and restores a user-created milestone', async () => {
  const userMilestone = {
    id: 'user-1',
    title: 'Private beta',
    status: 'planned' as const,
    timing: 'Sep 10',
    evidenceQuote: null,
    source: 'user' as const,
    targetDate: '2026-09-10',
    note: null,
  };
  api.getProjectBrief.mockResolvedValue(
    brief({ milestones: [...brief().milestones, userMilestone] }),
  );
  await render();

  await act(async () =>
    host
      .querySelector<HTMLButtonElement>(
        '[aria-label="Mark Private beta complete"]',
      )
      ?.click(),
  );
  expect(api.saveProjectMilestone).toHaveBeenCalledWith(
    'p1',
    expect.objectContaining({ id: 'user-1', status: 'completed' }),
  );

  await act(async () =>
    host
      .querySelector<HTMLButtonElement>('[aria-label="Delete Private beta"]')
      ?.click(),
  );
  expect(api.deleteProjectMilestone).toHaveBeenCalledWith('p1', 'user-1');
  await click('Undo');
  expect(api.restoreProjectMilestone).toHaveBeenCalledWith(
    'p1',
    expect.objectContaining({ id: 'user-1' }),
  );
});

it('persists generated milestone removal through the backend without a broad text correction', async () => {
  const generatedMilestone = {
    id: 'dream-ms-1',
    title: 'Evidence milestone',
    status: 'upcoming' as const,
    timing: null,
    evidenceQuote: 'Evidence milestone is next.',
    source: 'dreaming' as const,
    targetDate: null,
    note: null,
  };
  api.getProjectBrief.mockResolvedValue(
    brief({ milestones: [generatedMilestone] }),
  );
  api.deleteProjectMilestone.mockResolvedValue({
    id: generatedMilestone.id,
    title: generatedMilestone.title,
    status: 'planned',
    targetDate: null,
    note: null,
    createdAt: '2026-08-29T12:00:00Z',
    updatedAt: '2026-08-29T12:00:00Z',
    source: 'dreaming',
  });
  await render();

  await act(async () =>
    host
      .querySelector<HTMLButtonElement>(
        '[aria-label="Remove Evidence milestone"]',
      )
      ?.click(),
  );

  expect(api.deleteProjectMilestone).toHaveBeenCalledWith('p1', 'dream-ms-1');
  expect(api.recordEntityCorrection).not.toHaveBeenCalled();
});

it('edits a user-created milestone inline', async () => {
  const userMilestone = {
    id: 'user-1',
    title: 'Private beta',
    status: 'upcoming' as const,
    timing: 'Sep 10',
    evidenceQuote: null,
    source: 'user' as const,
    userStatus: 'in_progress' as const,
    targetDate: '2026-09-10',
    note: 'Invite design partners',
  };
  api.getProjectBrief.mockResolvedValue(
    brief({ milestones: [...brief().milestones, userMilestone] }),
  );
  await render();

  await act(async () =>
    host
      .querySelector<HTMLButtonElement>('[aria-label="Edit Private beta"]')
      ?.click(),
  );
  const title = host.querySelector<HTMLInputElement>(
    '#project-milestone-title',
  )!;
  expect(title.value).toBe('Private beta');
  await setValue(title, 'Private beta ready');
  await click('Save milestone');

  expect(api.saveProjectMilestone).toHaveBeenCalledWith(
    'p1',
    expect.objectContaining({
      id: 'user-1',
      title: 'Private beta ready',
      status: 'in_progress',
      targetDate: '2026-09-10',
      note: 'Invite design partners',
    }),
  );
});

it('opens a source meeting from the evidence history', async () => {
  const open = vi.fn();
  await render({ onOpenMeeting: open });
  await click('Archive weekly review');
  expect(open).toHaveBeenCalledWith('m1');
});

it('edits the display title without replacing detected identity', async () => {
  await render();
  await act(async () =>
    host
      .querySelector<HTMLButtonElement>('[aria-label="Edit project title"]')
      ?.click(),
  );
  const input = host.querySelector<HTMLInputElement>('#project-display-title')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )?.set?.call(input, 'Archive launch');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await click('Save title');
  expect(api.updateProjectDisplayTitle).toHaveBeenCalledWith(
    'p1',
    'Archive launch',
  );
  expect(host.textContent).toContain('Archive launch');
  expect(host.textContent).toContain('Title saved');
});

it('previews, performs and undoes a reversible merge', async () => {
  const candidate = {
    id: 'p2',
    name: 'Archive indexing',
    meeting_count: 3,
    metadata: null,
  };
  api.getProjectBrief
    .mockResolvedValueOnce(brief())
    .mockResolvedValue(
      brief({ meetingStats: { ...brief().meetingStats, meetingCount: 3 } }),
    );
  await render({ mergeCandidates: [candidate] });
  await click('Merge another project');
  const select = host.querySelector<HTMLSelectElement>(
    '#merge-project-source',
  )!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLSelectElement.prototype,
      'value',
    )?.set?.call(select, 'p2');
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(host.textContent).toContain('Meeting references10');
  await click('Merge Archive indexing');
  expect(api.mergeProject).toHaveBeenCalledWith('p2', 'p1');
  expect(host.textContent).toContain('was merged into this project');
  await click('Undo');
  expect(api.restoreProjectMerge).toHaveBeenCalledWith('p2');
});

it('retains the last reliable briefing when refresh fails', async () => {
  await render();
  api.getProjectBrief.mockRejectedValueOnce(new Error('offline'));
  await act(async () =>
    root.render(<ProjectDossier projectId="p2" onBack={() => {}} />),
  );
  expect(host.textContent).not.toContain('Archive modernization');
  expect(host.textContent).toContain('couldn’t load');
});

it('teaches honest empty states when evidence is sparse', async () => {
  api.getProjectBrief.mockResolvedValue(
    brief({
      meetingStats: {
        meetingCount: 1,
        activeWeeks: 1,
        participantCoverage: 0,
        typicalParticipantCount: null,
        frequentParticipants: [],
        recurringSeries: [],
      },
      health: {
        state: 'not_enough_evidence',
        headline: 'Not enough evidence',
        summary: 'Pluto has not found enough evidence.',
        updatedAt: null,
        freshness: 'unknown',
        evidenceTaskIds: [],
      },
      milestones: [],
      theme: null,
    }),
  );
  await render();
  expect(host.textContent).toContain(
    'One conversation supports this suggestion',
  );
  expect(host.textContent).toContain('Review suggestion');
  expect(host.textContent).not.toContain('Momentum');
  expect(host.textContent).not.toContain('Not enough evidence');
});

it('lets the user confirm a one-conversation suggestion', async () => {
  api.getProjectBrief.mockResolvedValue(
    brief({
      theme: null,
      meetingStats: {
        meetingCount: 1,
        activeWeeks: 1,
        participantCoverage: 0,
        typicalParticipantCount: null,
        frequentParticipants: [],
        recurringSeries: [],
      },
    }),
  );
  await render();
  await click('Keep as project');
  expect(api.setProjectPortfolioDisposition).toHaveBeenCalledWith(
    'p1',
    'confirmed',
  );
});

it('dismisses a one-conversation suggestion and returns to the portfolio', async () => {
  const back = vi.fn();
  api.getProjectBrief.mockResolvedValue(
    brief({
      theme: null,
      meetingStats: {
        meetingCount: 1,
        activeWeeks: 1,
        participantCoverage: 0,
        typicalParticipantCount: null,
        frequentParticipants: [],
        recurringSeries: [],
      },
    }),
  );
  await render({ onBack: back });
  await click('Dismiss suggestion');
  expect(api.setProjectPortfolioDisposition).toHaveBeenCalledWith(
    'p1',
    'dismissed',
  );
  expect(back).toHaveBeenCalledOnce();
});

it('does not render the legacy alias suggestion banner', async () => {
  api.getProjectBrief.mockResolvedValue(brief());
  api.getEntityAliasSuggestions.mockResolvedValue([
    {
      id: 'sug-1',
      entity_id: 'p1',
      suggested_name: 'Archive Modernization V2',
      source_meeting_ids_json: '["m1"]',
      status: 'pending',
      created_at: '2026-08-28T12:00:00Z',
      updated_at: '2026-08-28T12:00:00Z',
    },
  ]);

  await render();
  expect(host.textContent).not.toContain('Archive Modernization V2');
  expect(host.textContent).not.toContain('Suggested Alias');
});

it('prepares updates for the open project and reports no change accurately', async () => {
  api.getProjectBrief.mockResolvedValue(brief());
  await render();
  await click('Prepare updates');
  expect(api.triggerDreamingNow).toHaveBeenCalledWith({
    entityId: 'p1',
  });
  expect(host.textContent).toContain('Current — no updates needed');
});

it('shows a failed dreaming run as a failure', async () => {
  api.triggerDreamingNow.mockResolvedValue({
    status: 'failed',
    entityId: 'p1',
    errorCode: 'generation_failed',
  });
  await render();
  await click('Prepare updates');
  expect(host.textContent).toContain('Preparation failed');
});

it('ignores a late preparation result after the open project changes', async () => {
  let resolvePreparation!: (value: {
    status: 'proposed';
    entityId: string;
    proposals: [];
  }) => void;
  api.triggerDreamingNow.mockReturnValueOnce(
    new Promise((resolve) => {
      resolvePreparation = resolve;
    }),
  );
  await render();
  await act(async () => {
    Array.from(host.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Prepare updates'))
      ?.click();
    await Promise.resolve();
  });
  api.getProjectBrief.mockResolvedValueOnce(
    brief({
      project: { ...brief().project, id: 'p2', displayTitle: 'Second project' },
    }),
  );
  await act(async () => {
    root.render(<ProjectDossier projectId="p2" onBack={() => {}} />);
    await Promise.resolve();
  });
  await act(async () => {
    resolvePreparation({ status: 'proposed', entityId: 'p1', proposals: [] });
    await Promise.resolve();
  });

  expect(host.textContent).toContain('Second project');
  expect(host.textContent).not.toContain('Updates are ready');
});

it('shows generated milestone provenance and keeps its durable remove action', async () => {
  const openMeeting = vi.fn();
  api.getProjectBrief.mockResolvedValue(
    brief({
      milestones: [
        {
          id: 'dream-milestone-1',
          title: 'Launch the archive',
          status: 'planned',
          timing: null,
          evidenceQuote: 'We launch the archive next week.',
          source: 'dreaming',
          targetDate: null,
          note: null,
          sourceMeetingIds: ['m1'],
          sourceExcerpts: ['We launch the archive next week.'],
        },
      ],
    }),
  );
  await render({ onOpenMeeting: openMeeting });

  expect(host.textContent).toContain('Pluto-prepared');
  const source = Array.from(host.querySelectorAll('summary')).find((item) =>
    item.textContent?.includes('Show source'),
  );
  await act(async () => source?.click());
  expect(host.textContent).toContain('Archive weekly review');
  expect(host.textContent).toContain('We launch the archive next week.');
  const sourceMeeting = Array.from(
    source?.parentElement?.querySelectorAll('button') ?? [],
  ).find((button) => button.textContent?.includes('Archive weekly review'));
  await act(async () => sourceMeeting?.click());
  expect(openMeeting).toHaveBeenCalledWith('m1');

  await act(async () => {
    host
      .querySelector<HTMLButtonElement>(
        '[aria-label="Remove Launch the archive"]',
      )
      ?.click();
  });
  expect(api.deleteProjectMilestone).toHaveBeenCalledWith(
    'p1',
    'dream-milestone-1',
  );
});
