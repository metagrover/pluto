export type PrivateTranscriptionReviewSummary = {
  schemaVersion: 1;
  ratingCount: number;
  completedCount: number;
  candidateWins: number;
  referenceWins: number;
  ties: number;
  unclear: number;
  unanswered: number;
  candidatePreference: number;
  direction:
    | 'candidate_preferred'
    | 'reference_preferred'
    | 'tied'
    | 'inconclusive';
  promotionGate:
    | 'supports_candidate'
    | 'insufficient_cases'
    | 'incomplete_ratings'
    | 'too_many_unclear'
    | 'does_not_support_candidate';
};

type ReviewRating = {
  caseId: string;
  rating: '' | 'a' | 'b' | 'tie' | 'unclear';
};

type ReviewAssignment = {
  caseId: string;
  candidateLabel: 'a' | 'b';
};

export const PRIVATE_TRANSCRIPTION_REVIEW_MINIMUM_CASES = 20;

const exactKeys = (value: Record<string, unknown>, keys: string[]): boolean => {
  const expected = new Set(keys);
  return (
    keys.every((key) => key in value) &&
    Object.keys(value).every((key) => expected.has(key))
  );
};

const parseRatings = (value: unknown): ReviewRating[] => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('private_review_invalid_shape');
  }
  const envelope = value as Record<string, unknown>;
  if (
    !exactKeys(envelope, ['schemaVersion', 'reviewId', 'ratings']) ||
    envelope.schemaVersion !== 1 ||
    typeof envelope.reviewId !== 'string' ||
    !envelope.reviewId ||
    !Array.isArray(envelope.ratings)
  ) {
    throw new Error('private_review_invalid_shape');
  }
  const seen = new Set<string>();
  return envelope.ratings.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error('private_review_invalid_rating');
    }
    const rating = entry as Record<string, unknown>;
    if (
      !exactKeys(rating, ['caseId', 'rating']) ||
      typeof rating.caseId !== 'string' ||
      !/^review-[1-9]\d*$/.test(rating.caseId) ||
      seen.has(rating.caseId) ||
      !['', 'a', 'b', 'tie', 'unclear'].includes(String(rating.rating))
    ) {
      throw new Error('private_review_invalid_rating');
    }
    seen.add(rating.caseId);
    return rating as ReviewRating;
  });
};

const parseManifest = (
  value: unknown,
): { reviewId: string; assignments: Map<string, ReviewAssignment> } => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('private_review_manifest_invalid');
  }
  const envelope = value as Record<string, unknown>;
  if (
    !exactKeys(envelope, ['schemaVersion', 'reviewId', 'cases']) ||
    envelope.schemaVersion !== 1 ||
    typeof envelope.reviewId !== 'string' ||
    !envelope.reviewId ||
    !Array.isArray(envelope.cases)
  ) {
    throw new Error('private_review_manifest_invalid');
  }
  const assignments = new Map<string, ReviewAssignment>();
  for (const entry of envelope.cases) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error('private_review_manifest_invalid');
    }
    const assignment = entry as Record<string, unknown>;
    if (
      !exactKeys(assignment, ['caseId', 'candidateLabel']) ||
      typeof assignment.caseId !== 'string' ||
      !/^review-[1-9]\d*$/.test(assignment.caseId) ||
      assignments.has(assignment.caseId) ||
      !['a', 'b'].includes(String(assignment.candidateLabel))
    ) {
      throw new Error('private_review_manifest_invalid');
    }
    assignments.set(assignment.caseId, assignment as ReviewAssignment);
  }
  return { reviewId: envelope.reviewId, assignments };
};

export const evaluatePrivateTranscriptionReview = (
  value: unknown,
  manifestValue: unknown,
  options: {
    minimumCases?: number;
    minimumCandidatePreference?: number;
    maximumUnclearRate?: number;
  } = {},
): PrivateTranscriptionReviewSummary => {
  const ratings = parseRatings(value);
  const ratingsEnvelope = value as { reviewId: string };
  const manifest = parseManifest(manifestValue);
  if (
    ratingsEnvelope.reviewId !== manifest.reviewId ||
    ratings.length !== manifest.assignments.size ||
    ratings.some((rating) => !manifest.assignments.has(rating.caseId))
  ) {
    throw new Error('private_review_case_set_mismatch');
  }
  const minimumCases =
    options.minimumCases ?? PRIVATE_TRANSCRIPTION_REVIEW_MINIMUM_CASES;
  const minimumCandidatePreference = options.minimumCandidatePreference ?? 0.6;
  const maximumUnclearRate = options.maximumUnclearRate ?? 0.2;
  let candidateWins = 0;
  let referenceWins = 0;
  let ties = 0;
  let unclear = 0;
  let unanswered = 0;
  for (const rating of ratings) {
    if (!rating.rating) unanswered += 1;
    else if (rating.rating === 'unclear') unclear += 1;
    else if (rating.rating === 'tie') ties += 1;
    else if (
      rating.rating === manifest.assignments.get(rating.caseId)?.candidateLabel
    )
      candidateWins += 1;
    else referenceWins += 1;
  }
  const completedCount = ratings.length - unanswered;
  const evaluableCount = candidateWins + referenceWins + ties;
  const candidatePreference =
    evaluableCount > 0 ? (candidateWins + ties * 0.5) / evaluableCount : 0;
  const direction =
    evaluableCount === 0
      ? 'inconclusive'
      : candidateWins > referenceWins
        ? 'candidate_preferred'
        : referenceWins > candidateWins
          ? 'reference_preferred'
          : 'tied';
  const unclearRate = ratings.length > 0 ? unclear / ratings.length : 1;
  const promotionGate =
    unanswered > 0
      ? 'incomplete_ratings'
      : evaluableCount < minimumCases
        ? 'insufficient_cases'
        : unclearRate > maximumUnclearRate
          ? 'too_many_unclear'
          : candidatePreference >= minimumCandidatePreference &&
              candidateWins > referenceWins
            ? 'supports_candidate'
            : 'does_not_support_candidate';
  return {
    schemaVersion: 1,
    ratingCount: ratings.length,
    completedCount,
    candidateWins,
    referenceWins,
    ties,
    unclear,
    unanswered,
    candidatePreference: Number(candidatePreference.toFixed(4)),
    direction,
    promotionGate,
  };
};
