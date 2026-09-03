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

const secondProposal = {
  ...proposal,
  id: 'proposal-2',
  kind: 'project_summary' as const,
  payload: { summary: 'Complete access review' },
  fingerprint: 'fingerprint-2',
};

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
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

it('bounds the number of proposal rows rendered at once', async () => {
  api.getPendingDreamingProposals.mockResolvedValue(
    Array.from({ length: 24 }, (_, index) => ({
      ...proposal,
      id: `proposal-${index}`,
      fingerprint: `fingerprint-${index}`,
    })),
  );
  await render();
  expect(host.querySelectorAll('ol > li')).toHaveLength(20);
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

it('keeps Reject and identity review available when an alias needs review', async () => {
  const aliasProposal = {
    ...proposal,
    kind: 'person_alias' as const,
    entityId: 'person-1',
    entityType: 'person' as const,
    payload: { alias: 'A. Chen' },
  };
  const onReviewIdentity = vi.fn();
  api.getPendingDreamingProposals.mockResolvedValue([aliasProposal]);
  api.acceptDreamingProposal.mockResolvedValueOnce({
    status: 'review_required',
    proposalId: aliasProposal.id,
  });
  await act(async () => {
    root.render(
      <PreparedUpdates
        entityId="person-1"
        entityType="person"
        onReviewIdentity={onReviewIdentity}
      />,
    );
    await Promise.resolve();
  });

  expect(host.textContent).toContain('Alternate person name');
  expect(host.textContent).toContain('displayed name stays unchanged');
  await click('Accept');
  const accept = Array.from(host.querySelectorAll('button')).find(
    (button) => button.textContent === 'Accept',
  )!;
  const reject = Array.from(host.querySelectorAll('button')).find(
    (button) => button.textContent === 'Reject',
  )!;
  expect(accept.disabled).toBe(true);
  expect(reject.disabled).toBe(false);

  await click('Review identity');
  expect(onReviewIdentity).toHaveBeenCalledOnce();
  await click('Reject');
  expect(api.rejectDreamingProposal).toHaveBeenCalledWith({
    entityId: 'person-1',
    entityType: 'person',
    proposalId: aliasProposal.id,
  });
});

it('opens source meetings through the dossier callback', async () => {
  const onOpenMeeting = vi.fn();
  await act(async () => {
    root.render(
      <PreparedUpdates
        entityId="project-1"
        entityType="project"
        evidenceMeetings={[{ id: 'meeting-1', title: 'Archive weekly' }]}
        onOpenMeeting={onOpenMeeting}
      />,
    );
    await Promise.resolve();
  });
  await click('Show source');
  await click('Archive weekly');
  expect(onOpenMeeting).toHaveBeenCalledWith('meeting-1');
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

it('keeps a confirmed decision absent and reports refresh failures separately', async () => {
  let backendProposals = [proposal];
  let failNextProposalRead = false;
  api.getPendingDreamingProposals.mockImplementation(async () => {
    if (failNextProposalRead) {
      failNextProposalRead = false;
      throw new Error('offline');
    }
    return backendProposals;
  });
  api.acceptDreamingProposal.mockImplementationOnce(async () => {
    backendProposals = [];
    failNextProposalRead = true;
    return { status: 'accepted', proposalId: proposal.id };
  });
  const onCanonicalChange = vi.fn().mockRejectedValue(new Error('offline'));
  await render(onCanonicalChange);

  await click('Accept');

  expect(host.textContent).toContain('Update accepted');
  expect(host.textContent).not.toContain('couldn’t save this choice');
  expect(host.textContent).not.toContain('Launch the archive');
  expect(host.textContent).toContain('couldn’t refresh the dossier');

  await act(async () => {
    root.unmount();
  });
  root = createRoot(host);
  await act(async () => {
    root.render(
      <PreparedUpdates
        entityId="project-1"
        entityType="project"
        onCanonicalChange={onCanonicalChange}
      />,
    );
    await Promise.resolve();
  });
  expect(host.textContent).not.toContain('Launch the archive');
  expect(api.getPendingDreamingProposals).toHaveBeenLastCalledWith({
    entityId: 'project-1',
    entityType: 'project',
  });
});

it('disables every proposal action while one decision is in flight', async () => {
  const pendingDecision = deferred<{
    status: 'accepted';
    proposalId: string;
  }>();
  api.getPendingDreamingProposals.mockResolvedValue([proposal, secondProposal]);
  api.acceptDreamingProposal.mockReturnValueOnce(pendingDecision.promise);
  await render();

  await act(async () => {
    Array.from(host.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Accept'))
      ?.click();
    await Promise.resolve();
  });

  const proposalActions = Array.from(host.querySelectorAll('button')).filter(
    (button) =>
      button.textContent === 'Accept' || button.textContent === 'Reject',
  );
  expect(proposalActions).toHaveLength(3);
  expect(proposalActions.every((button) => button.disabled)).toBe(true);
  expect(api.rejectDreamingProposal).not.toHaveBeenCalled();

  await act(async () => {
    pendingDecision.resolve({ status: 'accepted', proposalId: proposal.id });
    await pendingDecision.promise;
    await Promise.resolve();
  });

  expect(
    Array.from(host.querySelectorAll('button')).some(
      (button) => button.textContent === 'Reject' && !button.disabled,
    ),
  ).toBe(true);
  expect(document.activeElement?.textContent).toBe('Accept');
});

it('ignores a slow pending response from the previously open entity', async () => {
  const oldEntity = deferred<(typeof proposal)[]>();
  api.getPendingDreamingProposals.mockReturnValueOnce(oldEntity.promise);
  await act(async () => {
    root.render(<PreparedUpdates entityId="project-1" entityType="project" />);
    await Promise.resolve();
  });

  api.getPendingDreamingProposals.mockResolvedValueOnce([
    { ...secondProposal, entityId: 'project-2' },
  ]);
  await act(async () => {
    root.render(<PreparedUpdates entityId="project-2" entityType="project" />);
    await Promise.resolve();
  });
  expect(host.textContent).toContain('Complete access review');

  await act(async () => {
    oldEntity.resolve([proposal]);
    await oldEntity.promise;
  });
  expect(host.textContent).toContain('Complete access review');
  expect(host.textContent).not.toContain('Launch the archive');
});

it('supports keyboard focus order and semantic disclosure and decision activation', async () => {
  const pressNativeKey = async (target: HTMLElement, key: 'Enter' | ' ') => {
    await act(async () => {
      target.focus();
      const keydown = new KeyboardEvent('keydown', {
        key,
        bubbles: true,
        cancelable: true,
      });
      const shouldRunDefault = target.dispatchEvent(keydown);
      if (
        shouldRunDefault &&
        ((target instanceof HTMLButtonElement &&
          (key === 'Enter' || key === ' ')) ||
          (target instanceof HTMLElement &&
            target.tagName === 'SUMMARY' &&
            key === 'Enter'))
      ) {
        target.dispatchEvent(
          new MouseEvent('click', { bubbles: true, cancelable: true }),
        );
      }
      target.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }));
      await Promise.resolve();
    });
  };

  await render();
  const summary = host.querySelector('summary')!;
  const accept = Array.from(host.querySelectorAll('button')).find(
    (button) => button.textContent === 'Accept',
  )!;
  const reject = Array.from(host.querySelectorAll('button')).find(
    (button) => button.textContent === 'Reject',
  )!;

  await pressNativeKey(summary, 'Enter');
  expect(document.activeElement).toBe(summary);
  expect(host.querySelector('details')?.open).toBe(true);

  accept.focus();
  expect(document.activeElement).toBe(accept);
  expect(
    summary.compareDocumentPosition(accept) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(
    accept.compareDocumentPosition(reject) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  await pressNativeKey(accept, 'Enter');
  expect(api.acceptDreamingProposal).toHaveBeenCalledOnce();

  api.getPendingDreamingProposals.mockResolvedValueOnce([secondProposal]);
  await act(async () => {
    root.render(
      <PreparedUpdates
        entityId="project-1"
        entityType="project"
        reloadToken={1}
      />,
    );
    await Promise.resolve();
  });
  const nextReject = Array.from(host.querySelectorAll('button')).find(
    (button) => button.textContent === 'Reject',
  )!;
  await pressNativeKey(nextReject, ' ');
  expect(api.rejectDreamingProposal).toHaveBeenCalledOnce();
  expect(reject.tagName).toBe('BUTTON');
});
