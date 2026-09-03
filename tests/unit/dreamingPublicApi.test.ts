import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  acceptDreamingProposal,
  getPendingDreamingProposals,
  rejectDreamingProposal,
} from '../../src/api/knowledgeGraph';

describe('manual dreaming public API', () => {
  const invoke = vi.fn(async (channel: string) => {
    if (channel === 'GET_PENDING_DREAMING_PROPOSALS')
      return [{ id: 'proposal-1' }];
    if (channel === 'ACCEPT_DREAMING_PROPOSAL') {
      return { status: 'accepted', proposalId: 'proposal-1' };
    }
    if (channel === 'REJECT_DREAMING_PROPOSAL') {
      return { status: 'rejected', proposalId: 'proposal-2' };
    }
    return undefined;
  });

  beforeEach(() => {
    invoke.mockClear();
    Object.assign(globalThis, {
      window: { ipcRenderer: { invoke } },
    });
  });

  it('uses explicit entity scope for proposal reads and decisions', async () => {
    const scope = { entityId: 'project-1', entityType: 'project' as const };
    const pending = await getPendingDreamingProposals(scope);
    const accepted = await acceptDreamingProposal({
      ...scope,
      proposalId: 'proposal-1',
    });
    const rejected = await rejectDreamingProposal({
      ...scope,
      proposalId: 'proposal-2',
    });

    expect(invoke).toHaveBeenNthCalledWith(
      1,
      'GET_PENDING_DREAMING_PROPOSALS',
      scope,
    );
    expect(invoke).toHaveBeenNthCalledWith(2, 'ACCEPT_DREAMING_PROPOSAL', {
      ...scope,
      proposalId: 'proposal-1',
    });
    expect(invoke).toHaveBeenNthCalledWith(3, 'REJECT_DREAMING_PROPOSAL', {
      ...scope,
      proposalId: 'proposal-2',
    });
    expect(pending).toEqual([{ id: 'proposal-1' }]);
    expect(accepted).toEqual({
      status: 'accepted',
      proposalId: 'proposal-1',
    });
    expect(rejected).toEqual({
      status: 'rejected',
      proposalId: 'proposal-2',
    });
  });
});
