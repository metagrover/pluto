// @vitest-environment happy-dom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ProjectBrief } from '../../src/utils/projectBriefing';

const api = vi.hoisted(() => ({
  getProjectBrief: vi.fn(),
  updateProjectDisplayTitle: vi.fn(),
  mergeProject: vi.fn(),
  restoreProjectMerge: vi.fn(),
  getEntitiesByType: vi.fn(),
  getEntityLinks: vi.fn(),
  updateEntityStatus: vi.fn(),
  upsertEntity: vi.fn(),
  linkEntities: vi.fn(),
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
  api.mergeProject.mockResolvedValue(undefined);
  api.restoreProjectMerge.mockResolvedValue(undefined);
  api.getEntitiesByType.mockResolvedValue([]);
  api.getEntityLinks.mockResolvedValue([]);
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

it('leads with grounded activity, health, milestones and meeting rhythm', async () => {
  await render();
  expect(host.textContent).toContain('Archive modernization');
  expect(host.textContent).toContain('Make historical records searchable');
  expect(host.textContent).toContain('7 meetings');
  expect(host.textContent).toContain('Typically 4 participants');
  expect(host.textContent).toContain('Attendance is available for 5 of 7');
  expect(host.textContent).toContain('Watch');
  expect(host.textContent).toContain('Complete migration review');
  expect(host.textContent).toContain('Weekly pattern');
  expect(host.textContent).toContain('Archive weekly review');
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
    }),
  );
  await render();
  expect(host.textContent).toContain('No explicit milestones yet');
  expect(host.textContent).toContain('No recurring meeting pattern');
  expect(host.textContent).toContain('Not enough evidence');
});
