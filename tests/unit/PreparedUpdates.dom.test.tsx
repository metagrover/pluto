// @vitest-environment happy-dom

import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  getPendingDreamingProposals: vi.fn(),
  acceptDreamingProposal: vi.fn(),
  rejectDreamingProposal: vi.fn(),
}));

vi.mock('../../src/api/knowledgeGraph', () => api);

import { PreparedUpdates } from '../../src/components/features/dreaming/PreparedUpdates';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const proposal = {
  id: 'proposal-1',
  runId: 'run-1',
  entityId: 'project-1',
  entityType: 'project' as const,
  kind: 'project_milestone' as const,
  payload: { name: 'Launch the archive', status: 'planned' as const },
  evidence: [
    { meetingId: 'meeting-1', excerpt: 'We launch the archive next week.' },
  ],
  fingerprint: 'fingerprint-1',
  status: 'pending' as const,
  decidedAt: null,
  createdAt: '2026-09-01T12:00:00Z',
  updatedAt: '2026-09-01T12:00:00Z',
};

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.clearAllMocks();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  api.getPendingDreamingProposals.mockResolvedValue([proposal]);
  api.acceptDreamingProposal.mockResolvedValue({
    status: 'accepted',
    proposalId: proposal.id,
  });
  api.rejectDreamingProposal.mockResolvedValue({
    status: 'rejected',
    proposalId: proposal.id,
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

const render = async (onCanonicalChange = vi.fn()) => {
  await act(async () => {
    root.render(
      <PreparedUpdates
        entityId="project-1"
        entityType="project"
        evidenceMeetings={[
          {
            id: 'meeting-1',
            title: 'Archive weekly',
            date: '2026-09-01T12:00:00Z',
          },
        ]}
        onCanonicalChange={onCanonicalChange}
      />,
    );
    await Promise.resolve();
  });
  return onCanonicalChange;
};

const click = async (label: string) => {
  await act(async () => {
    Array.from(host.querySelectorAll<HTMLElement>('button, summary'))
      .find((node) => node.textContent?.includes(label))
      ?.click();
    await Promise.resolve();
  });
};

it('loads an entity-scoped proposal and keeps exact evidence collapsed', async () => {
  await render();

  expect(api.getPendingDreamingProposals).toHaveBeenCalledWith({
    entityId: 'project-1',
    entityType: 'project',
  });
  expect(host.textContent).toContain('Prepared updates');
  expect(host.textContent).toContain('Milestone');
  expect(host.textContent).toContain('Launch the archive');
  expect(host.querySelector('details')?.open).toBe(false);

  await click('Show source');
  expect(host.querySelector('details')?.open).toBe(true);
  expect(host.textContent).toContain('Archive weekly');
  expect(host.textContent).toContain('Sep 1, 2026');
  expect(host.textContent).toContain('We launch the archive next week.');
});

it('accepts one row, refreshes canonical data, and announces the result politely', async () => {
  const onCanonicalChange = await render();
  await click('Accept');

  expect(api.acceptDreamingProposal).toHaveBeenCalledWith({
    entityId: 'project-1',
    entityType: 'project',
    proposalId: 'proposal-1',
  });
  expect(onCanonicalChange).toHaveBeenCalledOnce();
  expect(host.querySelector('[aria-live="polite"]')?.textContent).toContain(
    'Update accepted',
  );
  expect(host.querySelector('[role="alert"]')).toBeNull();
});

it('rejects one row and refreshes the canonical read and proposal list', async () => {
  const onCanonicalChange = await render();
  await click('Reject');

  expect(api.rejectDreamingProposal).toHaveBeenCalledWith({
    entityId: 'project-1',
    entityType: 'project',
    proposalId: 'proposal-1',
  });
  expect(onCanonicalChange).toHaveBeenCalledOnce();
  expect(host.textContent).toContain('Update rejected');
});

it.each([
  ['stale', 'This prepared update is out of date. Prepare updates again.'],
  ['review_required', 'This update needs a manual identity review.'],
  ['not_pending', 'This update has already been reviewed.'],
])('shows a truthful %s decision result', async (status, message) => {
  api.acceptDreamingProposal.mockResolvedValueOnce({
    status,
    proposalId: proposal.id,
  });
  await render();
  await click('Accept');
  expect(host.textContent).toContain(message);
});

it('keeps actions available after a decision error and uses semantic controls', async () => {
  api.acceptDreamingProposal.mockRejectedValueOnce(new Error('offline'));
  await render();
  await click('Accept');

  expect(host.textContent).toContain('couldn’t save this choice');
  expect(host.querySelector('details')).not.toBeNull();
  expect(
    Array.from(host.querySelectorAll('button')).every(
      (button) => button.getAttribute('type') === 'button',
    ),
  ).toBe(true);
  expect(host.querySelector('button')?.className).toContain('focus-visible');
});
