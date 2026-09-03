import { describe, expect, it, vi } from 'vitest';
import {
  assertScopedPendingProposal,
  parseDreamingProposalScope,
} from '../../electron/dreaming/proposalIpc';

const getEntity = (id: string) =>
  id === 'project-1' ? { type: 'project' } : null;

describe('dreaming proposal IPC validation', () => {
  it.each([
    null,
    {},
    { entityId: '', entityType: 'project' },
    { entityId: 'project-1', entityType: 'topic' },
    { entityId: 'missing', entityType: 'project' },
    { entityId: 'project-1', entityType: 'person' },
  ])('fails closed for malformed entity scope %#', (input) => {
    expect(() => parseDreamingProposalScope(input, getEntity)).toThrow(
      'dreaming_scope_invalid',
    );
  });

  it('rejects a proposal id that is not pending inside the requested scope', () => {
    const listPending = vi.fn(() => [{ id: 'proposal-other' }] as never[]);
    expect(() =>
      assertScopedPendingProposal(
        {
          entityId: 'project-1',
          entityType: 'project',
          proposalId: 'proposal-cross-scope',
        },
        getEntity,
        listPending,
      ),
    ).toThrow('dreaming_proposal_not_in_scope');
    expect(listPending).toHaveBeenCalledWith('project-1', 'project');
  });
});
