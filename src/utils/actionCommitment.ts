export type CommitmentState = 'possible' | 'confirmed' | 'rejected';

export type ActionOrigin = 'extraction' | 'user';

export interface ActionCommitmentMetadata extends Record<string, unknown> {
  commitment_state: CommitmentState;
  origin: ActionOrigin;
  source_meeting_id?: string;
  reviewed_at?: string;
  full_description?: string;
  assignee_name?: string;
}

export const parseActionMetadata = (
  value: string | null,
): Record<string, unknown> => {
  if (!value) return {};

  try {
    const parsed: unknown = JSON.parse(value);
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return {};
    }
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
};

export const getCommitmentState = (value: string | null): CommitmentState => {
  const state = parseActionMetadata(value).commitment_state;
  return state === 'confirmed' || state === 'rejected' ? state : 'possible';
};

export const mergeCommitmentReview = (
  value: string | null,
  commitmentState: 'confirmed' | 'rejected',
  reviewedAt: string,
): Record<string, unknown> => ({
  ...parseActionMetadata(value),
  commitment_state: commitmentState,
  reviewed_at: reviewedAt,
});
