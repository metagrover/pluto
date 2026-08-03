export type ReviewedCommitmentState = 'confirmed' | 'rejected';

export interface ActionCommitmentReviewPayload {
  id: string;
  commitmentState: ReviewedCommitmentState;
}

const isReviewedCommitmentState = (
  value: unknown,
): value is ReviewedCommitmentState =>
  value === 'confirmed' || value === 'rejected';

export const parseActionCommitmentReviewPayload = (
  payload: unknown,
): ActionCommitmentReviewPayload => {
  if (
    typeof payload !== 'object' ||
    payload === null ||
    Array.isArray(payload)
  ) {
    throw new Error('Invalid action commitment review payload');
  }

  const { id, commitmentState } = payload as Record<string, unknown>;
  if (
    typeof id !== 'string' ||
    id.trim().length === 0 ||
    !isReviewedCommitmentState(commitmentState)
  ) {
    throw new Error('Invalid action commitment review payload');
  }

  return { id, commitmentState };
};

export const handleActionCommitmentReview = <T>(
  payload: unknown,
  deps: {
    updateActionCommitmentState: (
      id: string,
      commitmentState: ReviewedCommitmentState,
    ) => T;
    queueKnowledgeRefresh: () => void;
  },
): T => {
  const { id, commitmentState } = parseActionCommitmentReviewPayload(payload);
  const updated = deps.updateActionCommitmentState(id, commitmentState);
  deps.queueKnowledgeRefresh();
  return updated;
};
