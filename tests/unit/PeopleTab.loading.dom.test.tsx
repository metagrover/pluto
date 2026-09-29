// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  getPeopleBriefingSummaries: vi.fn(),
  getPersonBriefing: vi.fn(),
  getEntityAliasSuggestions: vi.fn(),
  getPendingDreamingProposals: vi.fn(),
  acceptDreamingProposal: vi.fn(),
  rejectDreamingProposal: vi.fn(),
}));

vi.mock('../../src/api/knowledgeGraph', () => api);

import { PeopleTab } from '../../src/components/KnowledgeGraph/PeopleTab';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const summary = {
  id: 'person-1',
  name: 'Avery Chen',
  role: 'Design lead',
  meetingCount: 4,
  mentionCount: 9,
  latestMeetingId: 'meeting-1',
  latestMeetingTitle: 'Product review',
  latestMeetingAt: '2026-07-12T12:00:00.000Z',
  context: 'Reviewed launch evidence.',
  openCommitmentCount: 2,
  candidateCommitmentCount: 0,
  briefHeadline: null,
  briefStatus: null,
  briefUpdatedAt: null,
  possibleDuplicateCount: 0,
};

describe('PeopleTab loading', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    api.getPeopleBriefingSummaries.mockReset();
    api.getPersonBriefing.mockReset();
    api.getEntityAliasSuggestions.mockReset();
    api.getEntityAliasSuggestions.mockResolvedValue([]);
    api.getPendingDreamingProposals.mockResolvedValue([]);
    api.getPeopleBriefingSummaries.mockResolvedValue([summary]);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('renders summaries without fetching every full dossier', async () => {
    await act(async () => {
      root.render(<PeopleTab />);
      await Promise.resolve();
    });

    expect(api.getPeopleBriefingSummaries).toHaveBeenCalledOnce();
    expect(api.getPersonBriefing).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Avery Chen');
    expect(container.textContent).toContain('Latest link: Product review');
  });

  it('fetches one full dossier only after that person is selected', async () => {
    api.getPersonBriefing.mockResolvedValue({
      person: {
        id: 'person-1',
        type: 'person',
        name: 'Avery Chen',
        normalized_name: 'avery chen',
        status: 'active',
        due_date: null,
        assigned_to: null,
        metadata: null,
        saliency_score: 0,
        domain_tag: 'general',
        created_at: '2026-07-01T00:00:00.000Z',
        updated_at: '2026-07-12T00:00:00.000Z',
      },
      meetings: [],
      commitments: { open: [], delivered: [], candidates: [] },
      isSelf: false,
      knowledgeDoc: null,
      workingMemorySnapshot: null,
    });

    await act(async () => {
      root.render(<PeopleTab selectedPersonId="person-1" />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(api.getPeopleBriefingSummaries).toHaveBeenCalledOnce();
    expect(api.getPersonBriefing).toHaveBeenCalledOnce();
    expect(api.getPersonBriefing).toHaveBeenCalledWith('person-1');
  });
});
