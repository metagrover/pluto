// @vitest-environment happy-dom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({
  getEntity: vi.fn(),
  getEntityMeetings: vi.fn(),
}));
vi.mock('../../src/api/knowledgeGraph', () => api);
import { ProjectDossier } from '../../src/components/features/projects/ProjectDossier';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;
const project = {
  id: 'p1',
  name: 'Archive',
  metadata: JSON.stringify({
    context: 'Team archive context',
    projectQualification: {
      version: 1,
      state: 'qualified',
      source: 'extraction',
      reason: 'Grounded scope',
      assessedAt: '2026-08-28T12:00:00Z',
      outcome: 'Searchable archive',
      outcomeEvidenceQuote: 'Deliver a searchable archive.',
      sourceMeetingId: 'm1',
      workItems: [
        {
          description: 'Index records',
          evidenceQuote: 'Index the historical records.',
        },
      ],
    },
  }),
};
beforeEach(() => {
  vi.clearAllMocks();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  api.getEntity.mockResolvedValue(project);
  api.getEntityMeetings.mockResolvedValue([
    {
      id: 'm1',
      title: 'Archive planning',
      started_at: '2026-08-27T12:00:00Z',
      context: 'Archive kickoff',
    },
  ]);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
const render = async (id = 'p1', onOpenMeeting = vi.fn()) => {
  await act(async () =>
    root.render(
      <ProjectDossier
        projectId={id}
        onBack={() => {}}
        onOpenMeeting={onOpenMeeting}
      />,
    ),
  );
};
const click = async (text: string) => {
  await act(async () => {
    Array.from(host.querySelectorAll('button'))
      .find((button) => button.textContent?.includes(text))
      ?.click();
  });
};
it('renders real context, scope and navigable source meetings without status invention', async () => {
  const open = vi.fn();
  await render('p1', open);
  expect(host.textContent).toContain('Team archive context');
  expect(host.textContent).toContain('Searchable archive');
  expect(host.textContent).toContain('Index records');
  expect(host.textContent).toContain('Deliver a searchable archive.');
  expect(host.textContent).not.toMatch(
    /Loading overview|Loading status|Complete/,
  );
  await click('Archive planning');
  expect(open).toHaveBeenCalledWith('m1');
});
it('shows an error and successfully retries', async () => {
  api.getEntity.mockRejectedValueOnce(new Error('offline'));
  await render();
  expect(host.textContent).toContain('couldn’t load');
  await click('Retry');
  expect(host.textContent).toContain('Searchable archive');
});
it('retains last good data when refresh fails', async () => {
  await render();
  api.getEntity.mockRejectedValueOnce(new Error('offline'));
  await click('Refresh');
  expect(host.textContent).toContain('Searchable archive');
  expect(host.textContent).toContain('couldn’t refresh');
});
it('never displays old project content for a different id', async () => {
  await render();
  let resolve: (value: unknown) => void = () => {};
  api.getEntity.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await render('p2');
  expect(host.textContent).not.toContain('Searchable archive');
  expect(host.querySelector('[aria-busy="true"]')).not.toBeNull();
  await act(async () =>
    resolve({ id: 'p2', name: 'Second project', metadata: null }),
  );
  expect(host.textContent).toContain('Second project');
});
it('states missing scope and source evidence accurately', async () => {
  api.getEntity.mockResolvedValue({ id: 'p1', name: 'Archive', metadata: '{' });
  api.getEntityMeetings.mockResolvedValue([]);
  await render();
  expect(host.textContent).toContain('Not enough evidence');
  expect(host.textContent).toContain('No source meetings');
});

it('ignores an earlier request that resolves after project navigation', async () => {
  let finishOld: (value: unknown) => void = () => {};
  api.getEntity.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishOld = resolve;
      }),
  );
  await render('old');
  api.getEntity.mockResolvedValueOnce({
    id: 'new',
    name: 'New project',
    metadata: null,
  });
  await render('new');
  expect(host.textContent).toContain('New project');
  await act(async () => finishOld(project));
  expect(host.textContent).toContain('New project');
  expect(host.textContent).not.toContain('Searchable archive');
});

it('respects user-confirmed projects with no optional outcome', async () => {
  api.getEntity.mockResolvedValue({
    ...project,
    metadata: JSON.stringify({
      projectQualification: {
        version: 1,
        state: 'qualified',
        source: 'user',
        reason: 'This is my ongoing initiative.',
        assessedAt: '2026-08-28T12:00:00Z',
      },
    }),
  });
  await render();
  expect(host.textContent).toContain('Confirmed project');
  expect(host.textContent).toContain('This is my ongoing initiative.');
  expect(host.textContent).not.toContain('Not enough evidence');
});

it('opens related work without inventing task status', async () => {
  const open = vi.fn();
  const related = {
    id: 'child',
    type: 'project' as const,
    name: 'Index setup',
    normalized_name: 'index setup',
    status: null,
    due_date: null,
    assigned_to: null,
    metadata: null,
    saliency_score: 0,
    domain_tag: '',
    created_at: '2026-08-28',
    updated_at: '2026-08-28',
    meeting_count: 1,
    last_mentioned_at: '2026-08-28',
    latest_context: 'Configure the archive index.',
  };
  await act(async () =>
    root.render(
      <ProjectDossier
        projectId="p1"
        onBack={() => {}}
        relatedWork={[related]}
        onOpenRelatedWork={open}
      />,
    ),
  );
  expect(host.textContent).toContain('Related work');
  expect(host.textContent).toContain('Configure the archive index.');
  expect(host.textContent).not.toContain('Complete');
  await click('Index setup');
  expect(open).toHaveBeenCalledWith('child');
});
