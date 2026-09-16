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
  detachTopicFromProject: vi.fn().mockResolvedValue({}),
  fileTopicUnderProject: vi.fn().mockResolvedValue({}),
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
      participants: [
        {
          entity_id: 'person-alex',
          name: 'Alex Rivera',
          role: 'Engineering lead',
        },
        {
          entity_id: 'person-sam',
          name: 'Sam',
          role: 'Project manager',
        },
        {
          entity_id: 'person-lauren',
          name: 'Lauren Kessler',
          role: 'Exec sponsor from Frames Direct',
        },
      ],
      context: 'Migration and rollout',
    },
  ],
  tasks: [
    {
      id: 't1',
      name: 'Complete migration review',
      status: 'active',
      due_date: '2026-09-05T10:00:00Z',
      assigned_to: 'person-alex',
      updated_at: '2026-08-28T12:00:00Z',
      metadata: null,
    },
  ],
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

it('leads with the project brief, people, timeline, health, and meeting rhythm', async () => {
  await render();
  expect(host.textContent).toContain('Archive modernization');
  expect(host.textContent).toContain('Project brief');
  expect(host.textContent).toContain('Make historical records searchable');
  expect(host.textContent).toContain('7 meetings');
  expect(host.textContent).toContain('Current focus');
  expect(host.textContent).toContain('Validate access rules before launch');
  expect(host.textContent).toContain(
    'Alex Rivera is responsible for Complete migration review',
  );
  expect(host.textContent).toContain('Coming up');
  expect(host.textContent).toContain('Project health');
  expect(host.textContent).toContain('Needs attention');
  expect(host.textContent).toContain(
    '1 milestone or commitment is due in the next two weeks.',
  );
  expect(
    host.textContent?.match(
      /1 milestone or commitment is due in the next two weeks\./g,
    ),
  ).toHaveLength(1);
  expect(host.textContent).toContain('People involved');
  expect(host.textContent).toContain('Alex Rivera');
  expect(host.textContent).toContain('Sam');
  const alexCard = host.querySelector('[data-person-card="Alex Rivera"]');
  const samCard = host.querySelector('[data-person-card="Sam"]');
  const laurenCard = host.querySelector('[data-person-card="Lauren Kessler"]');
  expect(alexCard?.parentElement?.classList.contains('h-24')).toBe(true);
  expect(samCard?.parentElement?.classList.contains('h-24')).toBe(true);
  expect(alexCard?.textContent).toContain('AR');
  expect(alexCard?.textContent).toContain('Engineering lead');
  expect(alexCard?.textContent).toContain('Engineering');
  expect(samCard?.textContent).toContain('Project manager');
  expect(samCard?.textContent).toContain('Project management');
  expect(laurenCard?.textContent).toContain('Executive sponsor');
  expect(host.textContent).toContain('Usually 4 people');
  expect(host.textContent).toContain('Regular meetings');
  expect(host.textContent).toContain('Weekly pattern');
  expect(host.textContent).toContain('4 meetings');
  expect(host.textContent).toContain('Timeline and milestones');
  expect(host.textContent).toContain('Open questions and actions');
  expect(host.textContent).toContain('Complete migration review');
  expect(host.textContent).toContain('From meeting notes');
  expect(host.textContent).toContain('Meeting history');
  expect(host.textContent!.indexOf('Timeline and milestones')).toBeLessThan(
    host.textContent!.indexOf('Open questions and actions'),
  );
  expect(host.textContent).not.toContain('More details');
  expect(host.textContent).not.toContain('Since last time');
  expect(host.textContent).not.toContain('Project details');
  expect(host.textContent).not.toContain('Momentum');
});

it('opens the matching person profile from a person card', async () => {
  const onOpenPerson = vi.fn();
  await render({ onOpenPerson });

  await act(async () => {
    host
      .querySelector<HTMLButtonElement>('[data-person-card="Alex Rivera"]')
      ?.click();
  });

  expect(onOpenPerson).toHaveBeenCalledWith('person-alex');
});

it('keeps a large people roster compact until the user expands it', async () => {
  const manyPeopleBrief = brief();
  manyPeopleBrief.meetings[0].participants = Array.from(
    { length: 8 },
    (_, index) => ({
      entity_id: `person-${index + 1}`,
      name: `Person ${index + 1}`,
      role: index === 0 ? 'Engineering lead' : undefined,
    }),
  );
  api.getProjectBrief.mockResolvedValueOnce(manyPeopleBrief);

  await render();

  expect(host.querySelectorAll('[data-person-card]')).toHaveLength(6);
  expect(host.textContent).toContain('Show 2 more');

  await click('Show 2 more');

  expect(host.querySelectorAll('[data-person-card]')).toHaveLength(8);
  expect(host.textContent).toContain('Show fewer people');
});

it('uses known roles in the summary when no ownership is established', async () => {
  api.getProjectBrief.mockResolvedValueOnce(brief({ tasks: [] }));

  await render();

  expect(host.textContent).toContain(
    'Alex Rivera (Engineering lead), Lauren Kessler (Exec sponsor from Frames Direct), and Sam (Project manager) are involved in this project.',
  );
});

it('does not repeat the project outcome when it matches the current focus', async () => {
  const duplicateFocusBrief = brief();
  duplicateFocusBrief.theme!.currentFocus =
    'Make historical records searchable.';
  api.getProjectBrief.mockResolvedValueOnce(duplicateFocusBrief);

  await render();

  expect(host.textContent).not.toContain('Current focus');
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
  expect(host.textContent).toContain('Added by you');
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
  const select = host.querySelector<HTMLElement>('#merge-project-source')!;
  await act(async () => select.click());
  await act(async () =>
    document.body
      .querySelector<HTMLButtonElement>('[role="option"][data-value="p2"]')
      ?.click(),
  );
  expect(host.textContent).toContain('Meetings10');
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
      momentum: {
        recentMeetingCount: 0,
        openCommitmentCount: 0,
        completedCommitmentCount: 0,
        recentlyCompletedCount: 0,
        lastActivityAt: '2026-08-28T12:00:00Z',
        headline: 'Not enough evidence for a trend',
      },
      milestones: [],
      tasks: [],
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
      theme: null,
    }),
  );
  await render();
  expect(host.textContent).toContain('Pluto found this in one meeting');
  expect(host.textContent).toContain('Review suggestion');
  expect(host.textContent).toContain('Status not clear yet');
  expect(host.textContent).toContain('No people yet');
  expect(host.textContent).toContain('No regular schedule');
  expect(host.textContent).toContain('No dates or milestones yet');
  expect(host.querySelector('#project-people')).toBeNull();
  expect(host.querySelector('#project-meeting-rhythm')).toBeNull();
  expect(host.textContent).not.toContain('Momentum');
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

  expect(host.textContent).toContain('Suggested by Pluto');
  const source = Array.from(host.querySelectorAll('summary')).find((item) =>
    item.textContent?.includes('See meeting note'),
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

it('allows toggling primary focus star from header toolbar', async () => {
  api.getProjectBrief.mockResolvedValue(brief());
  await render();

  const starBtn = host.querySelector<HTMLButtonElement>(
    '[aria-label="Star project"]',
  );
  expect(starBtn).not.toBeNull();
  expect(starBtn?.textContent).toContain('Star');

  await act(async () => {
    starBtn?.click();
  });

  expect(api.upsertEntity).toHaveBeenCalledWith(
    expect.objectContaining({
      id: 'p1',
      metadata: expect.objectContaining({
        projectStarred: true,
      }),
    }),
  );
});

it('renders Topics & Discussion Streams and allows detaching a topic', async () => {
  api.getProjectBrief.mockResolvedValue(brief());
  const onPortfolioChanged = vi.fn();
  const relatedWork = [
    {
      id: 'topic-1',
      type: 'project' as const,
      name: 'Search indexing pipeline',
      display_title: 'Search indexing pipeline',
      status: 'active' as const,
      meeting_count: 2,
      last_mentioned_at: '2026-08-20T10:00:00Z',
      latest_context: 'Discussion about index compression',
      created_at: '2026-08-01T00:00:00Z',
      updated_at: '2026-08-20T10:00:00Z',
      due_date: null,
      last_seen_at: null,
      metadata: JSON.stringify({
        projectQualification: {
          version: 1,
          state: 'subordinate',
          parentProjectId: 'p1',
        },
      }),
      confidence: 1,
    },
  ];

  await render({
    relatedWork,
    onPortfolioChanged,
  });

  expect(host.textContent).toContain('Topics & Discussion Streams');
  expect(host.textContent).toContain('Search indexing pipeline');
  expect(host.textContent).toContain('Discussion about index compression');
  expect(host.textContent).toContain('2 conversations');

  const detachBtn = host.querySelector<HTMLButtonElement>(
    '[aria-label="Detach Search indexing pipeline from this initiative"]',
  );
  expect(detachBtn).not.toBeNull();

  await act(async () => {
    detachBtn?.click();
  });

  expect(api.detachTopicFromProject).toHaveBeenCalledWith('topic-1');
  expect(onPortfolioChanged).toHaveBeenCalled();
});

it('renders executive at a glance panel with detected meeting rhythm and no manual select dropdown', async () => {
  api.getProjectBrief.mockResolvedValue(brief());
  await render();

  const atAGlanceSection = host.querySelector('[aria-labelledby="project-at-a-glance"]');
  expect(atAGlanceSection).not.toBeNull();
  expect(atAGlanceSection?.textContent).toContain('At a glance');
  expect(atAGlanceSection?.textContent).toContain('Meeting rhythm');
  expect(atAGlanceSection?.textContent).toContain('Weekly rhythm');
  expect(atAGlanceSection?.textContent).toContain('Rhythm slipping');
  expect(atAGlanceSection?.textContent).toContain(
    'Detected from recurring “Archive weekly review” (4 meetings)',
  );
  expect(atAGlanceSection?.textContent).toContain('7 meetings over 8 weeks');
  expect(atAGlanceSection?.textContent).toContain('3 open · 4 completed');
  expect(atAGlanceSection?.textContent).toContain('Complete migration review');

  // Verify there is NO <select> asking the user for cadence
  expect(host.querySelector('select[aria-label="Set project cadence"]')).toBeNull();
  expect(host.querySelector('select')).toBeNull();
});

it('automatically detects rhythm from meeting intervals when no recurring series exists', async () => {
  api.getProjectBrief.mockResolvedValue(
    brief({
      meetingStats: {
        meetingCount: 3,
        activeWeeks: 3,
        participantCoverage: 3,
        typicalParticipantCount: 2,
        frequentParticipants: ['Alex'],
        recurringSeries: [],
      },
      meetings: [
        {
          id: 'm1',
          title: 'Planning session',
          started_at: '2026-08-01T10:00:00Z',
          created_at: null,
          participants: [],
          context: 'Kickoff',
        },
        {
          id: 'm2',
          title: 'Design review',
          started_at: '2026-08-08T10:00:00Z',
          created_at: null,
          participants: [],
          context: 'Design',
        },
        {
          id: 'm3',
          title: 'Tech sync',
          started_at: '2026-08-15T10:00:00Z',
          created_at: null,
          participants: [],
          context: 'Tech',
        },
      ],
    }),
  );

  await render();
  const atAGlanceSection = host.querySelector('[aria-labelledby="project-at-a-glance"]');
  expect(atAGlanceSection?.textContent).toContain('Weekly rhythm');
  expect(atAGlanceSection?.textContent).toContain(
    'Detected from meeting intervals (averages ~7d between sessions)',
  );
});

