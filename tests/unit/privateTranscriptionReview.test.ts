import { describe, expect, it } from 'vitest';

import { evaluatePrivateTranscriptionReview } from '../../src/services/privateTranscriptionReview';

const review = (
  ratings: Array<{
    caseId: string;
    rating: '' | 'a' | 'b' | 'tie' | 'unclear';
  }>,
) => ({ schemaVersion: 1, reviewId: 'review-run-1', ratings });

const manifest = (caseCount: number) => ({
  schemaVersion: 1,
  reviewId: 'review-run-1',
  cases: Array.from({ length: caseCount }, (_, index) => ({
    caseId: `review-${index + 1}`,
    candidateLabel: (index % 2 === 0 ? 'b' : 'a') as 'a' | 'b',
  })),
});

describe('evaluatePrivateTranscriptionReview', () => {
  it('scores balanced blind labels in candidate-relative terms', () => {
    expect(
      evaluatePrivateTranscriptionReview(
        review([
          { caseId: 'review-1', rating: 'b' },
          { caseId: 'review-2', rating: 'a' },
          { caseId: 'review-3', rating: 'a' },
          { caseId: 'review-4', rating: 'tie' },
        ]),
        manifest(4),
        { minimumCases: 4 },
      ),
    ).toEqual({
      schemaVersion: 1,
      ratingCount: 4,
      completedCount: 4,
      candidateWins: 2,
      referenceWins: 1,
      ties: 1,
      unclear: 0,
      unanswered: 0,
      candidatePreference: 0.625,
      direction: 'candidate_preferred',
      promotionGate: 'supports_candidate',
    });
  });

  it('keeps an incomplete six-case review below the promotion gate', () => {
    expect(
      evaluatePrivateTranscriptionReview(
        review([
          { caseId: 'review-1', rating: 'b' },
          { caseId: 'review-2', rating: '' },
        ]),
        manifest(2),
      ).promotionGate,
    ).toBe('incomplete_ratings');
    expect(
      evaluatePrivateTranscriptionReview(
        review(
          Array.from({ length: 6 }, (_, index) => ({
            caseId: `review-${index + 1}`,
            rating: (index % 2 === 0 ? 'b' : 'a') as 'a' | 'b',
          })),
        ),
        manifest(6),
      ).promotionGate,
    ).toBe('insufficient_cases');
  });

  it('rejects duplicate cases and content-bearing extra fields', () => {
    expect(() =>
      evaluatePrivateTranscriptionReview(
        review([
          { caseId: 'review-1', rating: 'a' },
          { caseId: 'review-1', rating: 'b' },
        ]),
        manifest(2),
      ),
    ).toThrow('private_review_invalid_rating');
    expect(() =>
      evaluatePrivateTranscriptionReview(
        {
          schemaVersion: 1,
          reviewId: 'review-run-1',
          ratings: [
            {
              caseId: 'review-1',
              rating: 'a',
              transcript: 'private content',
            },
          ],
        },
        manifest(1),
      ),
    ).toThrow('private_review_invalid_rating');
  });

  it('rejects ratings that do not match the trusted assignment manifest', () => {
    expect(() =>
      evaluatePrivateTranscriptionReview(
        review([{ caseId: 'review-99', rating: 'a' }]),
        manifest(1),
      ),
    ).toThrow('private_review_case_set_mismatch');
    expect(() =>
      evaluatePrivateTranscriptionReview(
        {
          schemaVersion: 1,
          reviewId: 'review-run-1',
          ratings: [{ caseId: 'review-1', rating: 'a', candidateLabel: 'a' }],
        },
        manifest(1),
      ),
    ).toThrow('private_review_invalid_rating');
  });

  it('blocks promotion when ratings are too unclear', () => {
    expect(
      evaluatePrivateTranscriptionReview(
        review(
          Array.from({ length: 20 }, (_, index) => ({
            caseId: `review-${index + 1}`,
            rating: (index < 5 ? 'unclear' : 'tie') as 'unclear' | 'tie',
          })),
        ),
        manifest(20),
        { minimumCases: 15 },
      ).promotionGate,
    ).toBe('too_many_unclear');
  });

  it('blocks promotion when the reference is preferred', () => {
    expect(
      evaluatePrivateTranscriptionReview(
        review(
          Array.from({ length: 20 }, (_, index) => {
            const candidateLabel = index % 2 === 0 ? 'b' : 'a';
            return {
              caseId: `review-${index + 1}`,
              rating: candidateLabel === 'a' ? ('b' as const) : ('a' as const),
            };
          }),
        ),
        manifest(20),
      ).promotionGate,
    ).toBe('does_not_support_candidate');
  });
});
