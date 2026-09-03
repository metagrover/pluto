// @vitest-environment happy-dom

import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  getPeopleBriefingSummaries: vi.fn(),
  getPersonBriefing: vi.fn(),
  updatePersonName: vi.fn(),
  mergePerson: vi.fn(),
  restorePersonMerge: vi.fn(),
  resolvePersonCommitmentOwner: vi.fn(),
  getEntityAliasSuggestions: vi.fn(),
  triggerDreamingNow: vi.fn(),
  getPendingDreamingProposals: vi.fn(),
  acceptDreamingProposal: vi.fn(),
  rejectDreamingProposal: vi.fn(),
}));

vi.mock('../../src/api/knowledgeGraph', () => api);

import { PeopleTab } from '../../src/components/KnowledgeGraph/PeopleTab';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const entity = (id: string, name: string) => ({
  id,
  type: 'person' as const,
  name,
  normalized_name: name.toLowerCase(),
  status: 'active' as const,
  due_date: null,
  assigned_to: null,
  metadata: null,
  saliency_score: 1,
  domain_tag: 'work',
  created_at: '2026-08-01T12:00:00.000Z',
  updated_at: '2026-08-20T12:00:00.000Z',
});

const summary = (id: string, name: string, possibleDuplicateCount = 0) => ({
  id,
  name,
  role: 'Known from conversations',
  meetingCount: id === 'person-1' ? 4 : 2,
  mentionCount: id === 'person-1' ? 8 : 3,
  latestMeetingId: 'meeting-1',
  latestMeetingTitle: 'Product review',
  latestMeetingAt: '2026-08-20T12:00:00.000Z',
  context: null,
  openCommitmentCount: 0,
  candidateCommitmentCount: 0,
  briefHeadline: null,
  briefStatus: null,
  briefUpdatedAt: null,
  possibleDuplicateCount,
});

const detail = (id: string, name: string) => ({
  person: entity(id, name),
  meetings: [],
  commitments: { open: [], delivered: [], candidates: [] },
  isSelf: false,
  knowledgeDoc: null,
  workingMemorySnapshot: null,
  mergedPeople: [],
});

describe('People identity controls', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    api.getPeopleBriefingSummaries.mockResolvedValue([
      summary('person-1', 'Avery Chen', 1),
      summary('person-2', 'Avery C.', 0),
    ]);
    api.getPersonBriefing.mockImplementation((id: string) =>
      Promise.resolve(
        id === 'person-2'
          ? detail('person-2', 'Avery C.')
          : detail('person-1', 'Avery Chen'),
      ),
    );
    api.updatePersonName.mockResolvedValue(entity('person-1', 'Avery Smith'));
    api.mergePerson.mockResolvedValue(undefined);
    api.restorePersonMerge.mockResolvedValue(undefined);
    api.resolvePersonCommitmentOwner.mockResolvedValue({});
    api.getEntityAliasSuggestions.mockResolvedValue([]);
    api.triggerDreamingNow.mockResolvedValue({
      status: 'cancelled',
      entityId: 'person-1',
    });
    api.getPendingDreamingProposals.mockResolvedValue([]);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  const render = async () => {
    await act(async () => {
      root.render(
        <PeopleTab selectedPersonId="person-1" onSelectPerson={() => {}} />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  const click = async (label: string) => {
    await act(async () => {
      const control = Array.from(
        host.querySelectorAll<HTMLElement>('button, summary'),
      ).find(
        (button) =>
          button.textContent?.includes(label) ||
          button.getAttribute('aria-label')?.includes(label),
      );
      control?.click();
      await Promise.resolve();
    });
  };

  const setValue = async (
    element: HTMLInputElement | HTMLSelectElement,
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

  it('renames a person inline and keeps the saved name visible', async () => {
    api.updatePersonName.mockImplementation(async () => {
      api.getPersonBriefing.mockResolvedValue(
        detail('person-1', 'Avery Smith'),
      );
      return entity('person-1', 'Avery Smith');
    });
    await render();
    await click('Edit person name');
    const input = host.querySelector<HTMLInputElement>('#person-name')!;
    expect(input.value).toBe('Avery Chen');
    await setValue(input, 'Avery Smith');
    await click('Save name');

    expect(api.updatePersonName).toHaveBeenCalledWith(
      'person-1',
      'Avery Smith',
    );
    expect(host.textContent).toContain('Avery Smith');
    expect(host.textContent).toContain('Name saved');
  });

  it('previews, performs, and undoes a reversible person merge', async () => {
    await render();
    await click('Review possible duplicate');
    const select = host.querySelector<HTMLSelectElement>(
      '#merge-person-source',
    )!;
    await setValue(select, 'person-2');

    expect(host.textContent).toContain('Avery C.');
    expect(host.textContent).toContain('2 meetings');
    expect(host.textContent).toContain('Avery Chen will remain');

    await click('Merge Avery C.');
    expect(api.mergePerson).toHaveBeenCalledWith('person-2', 'person-1');
    expect(host.textContent).toContain('Avery C. was merged into Avery Chen');

    await click('Undo merge');
    expect(api.restorePersonMerge).toHaveBeenCalledWith('person-2');
  });

  it('exposes a persistent restore action for previously merged people', async () => {
    api.getPersonBriefing.mockResolvedValue({
      ...detail('person-1', 'Avery Chen'),
      mergedPeople: [
        {
          id: 'person-2',
          name: 'Avery C.',
          mergedAt: '2026-08-30T12:00:00.000Z',
        },
      ],
    });
    await render();
    await click('Manage merged names');
    await click('Restore Avery C.');

    expect(api.restorePersonMerge).toHaveBeenCalledWith('person-2');
  });

  it('requires an explicit owner decision for a name-matched open loop', async () => {
    api.getPersonBriefing.mockResolvedValue({
      ...detail('person-1', 'Avery Chen'),
      commitments: {
        open: [],
        delivered: [],
        candidates: [
          {
            id: 'action-1',
            text: 'Share the launch notes',
            status: 'active',
            dueDate: null,
            evidence: 'Avery can share the notes.',
            sourceMeetingId: 'meeting-1',
            sourceMeetingTitle: 'Product review',
            updatedAt: '2026-08-20T12:00:00.000Z',
            suggestedOwnerName: 'Avery Chen',
          },
        ],
      },
    });
    await render();
    expect(host.textContent).toContain('Needs confirmation');

    await click('Confirm owner');

    expect(api.resolvePersonCommitmentOwner).toHaveBeenCalledWith(
      'action-1',
      'person-1',
    );
  });

  it('shows cancelled preparation without claiming success', async () => {
    await render();
    await click('More actions');
    await click('Prepare updates');
    expect(host.textContent).toContain('Preparation cancelled');
  });

  it('announces prepared updates outside the closed menu with a review action', async () => {
    api.triggerDreamingNow.mockResolvedValueOnce({
      status: 'proposed',
      entityId: 'person-1',
      proposals: [],
    });
    await render();
    await click('More actions');
    await click('Prepare updates');

    const status = host.querySelector('[aria-live="polite"]');
    expect(status?.textContent).toContain('Updates are ready');
    expect(host.textContent).toContain('Review prepared updates');
  });
});
