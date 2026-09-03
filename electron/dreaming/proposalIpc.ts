import type { DreamingProposalRecord } from './proposalStore';
import type { DreamingEntityType } from './types';

export interface DreamingProposalScope {
  entityId: string;
  entityType: DreamingEntityType;
}

export interface DreamingProposalDecision extends DreamingProposalScope {
  proposalId: string;
}

export const parseDreamingProposalScope = (
  input: unknown,
  getEntity: (id: string) => { type: string } | null | undefined,
): DreamingProposalScope => {
  if (!input || typeof input !== 'object') {
    throw new Error('dreaming_scope_invalid');
  }
  const { entityId, entityType } = input as Record<string, unknown>;
  if (
    typeof entityId !== 'string' ||
    !entityId.trim() ||
    (entityType !== 'project' && entityType !== 'person')
  ) {
    throw new Error('dreaming_scope_invalid');
  }
  const normalizedEntityId = entityId.trim();
  const entity = getEntity(normalizedEntityId);
  if (!entity || entity.type !== entityType) {
    throw new Error('dreaming_scope_invalid');
  }
  return { entityId: normalizedEntityId, entityType };
};

export const assertScopedPendingProposal = (
  input: unknown,
  getEntity: (id: string) => { type: string } | null | undefined,
  listPending: (
    entityId: string,
    entityType: DreamingEntityType,
  ) => DreamingProposalRecord[],
): DreamingProposalDecision => {
  const scope = parseDreamingProposalScope(input, getEntity);
  const proposalId = (input as Record<string, unknown>).proposalId;
  if (typeof proposalId !== 'string' || !proposalId.trim()) {
    throw new Error('dreaming_proposal_id_required');
  }
  const normalizedProposalId = proposalId.trim();
  if (
    !listPending(scope.entityId, scope.entityType).some(
      (proposal) => proposal.id === normalizedProposalId,
    )
  ) {
    throw new Error('dreaming_proposal_not_in_scope');
  }
  return { ...scope, proposalId: normalizedProposalId };
};
