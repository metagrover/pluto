import { describe, expect, it } from 'vitest';
import {
  clearAskPlutoOmissions,
  describeUnverifiedAskPlutoOmissions,
  getAskPlutoOmissionReview,
  rememberAskPlutoOmissions,
  selectAdditionalSupportedClaims,
  selectAskPlutoOmissionContext,
  uniqueAskPlutoEvidenceMeetings,
} from '../../electron/intelligence/askPlutoOmissionReview';
import type { RetrievalResult } from '../../electron/intelligence/intelligenceTypes';

const scope = {
  kind: 'meeting_ids' as const,
  meetingIds: ['meeting-1'],
  resolvedAt: '2026-09-25T00:00:00.000Z',
  source: 'explicit' as const,
};

describe('Ask Pluto omission review', () => {
  it('keeps draft claims behind a session-scoped opaque reference', () => {
    const ref = rememberAskPlutoOmissions(
      {
        ownerId: 10,
        originalQuery: 'Summarize Punit Grover’s contributions',
        visibleAnswer: 'Punit asked about the kitchen table.',
        claims: ['Punit suggested a larger workspace.'],
        scope,
        searchMeetingIds: ['meeting-1'],
      },
      1000,
    );

    expect(ref).toMatch(/^[\da-f-]{36}$/i);
    expect(ref).not.toContain('workspace');
    expect(getAskPlutoOmissionReview(ref, 11, 1000)).toBeUndefined();
    expect(getAskPlutoOmissionReview(ref, 10, 1000)).toMatchObject({
      claims: ['Punit suggested a larger workspace.'],
      searchMeetingIds: ['meeting-1'],
    });
    clearAskPlutoOmissions(10);
    expect(getAskPlutoOmissionReview(ref, 10, 1000)).toBeUndefined();
  });

  it('expires a review so stale claims cannot be replayed', () => {
    const ref = rememberAskPlutoOmissions(
      {
        ownerId: 20,
        originalQuery: 'What changed?',
        visibleAnswer: 'The date moved.',
        claims: ['The owner changed.'],
        scope,
      },
      1000,
    );

    expect(
      getAskPlutoOmissionReview(ref, 20, 1000 + 2 * 60 * 60_000 + 1),
    ).toBeUndefined();
  });

  it('returns only newly supported claims and keeps their citations', () => {
    const earlierAnswer = 'Punit asked about the kitchen table.';
    const result = selectAdditionalSupportedClaims(
      [
        { claim: 'Punit asked about the kitchen table.', meeting_id: 'm1' },
        { claim: 'Punit requested a larger workspace.', meeting_id: 'm1' },
        { claim: 'Punit requested a larger workspace.', meeting_id: 'm2' },
      ],
      earlierAnswer,
    );

    expect(result.claims).toEqual(['Punit requested a larger workspace.']);
    expect(result.citations.map((citation) => citation.meeting_id)).toEqual([
      'm1',
      'm2',
    ]);
  });

  it('retains different evidence passages from the same meeting across search leads', () => {
    const result = (evidence: string): RetrievalResult => ({
      meeting_id: 'meeting-1',
      mid: null,
      evidence_text: evidence,
      score: 1,
      score_breakdown: {
        fts_rank: 1,
        graph_proximity: 0,
        recency_decay: 1,
        mention_weight: 0,
      },
    });
    const selected = selectAskPlutoOmissionContext(
      [
        [result('[Section: Setup]: Asked about the kitchen table.')],
        [result('[Section: Model]: Asked why Parakeet was unavailable.')],
      ],
      [result('[Section: Setup]: Asked about the kitchen table.')],
    );

    expect(selected.map((item) => item.evidence_text)).toEqual([
      '[Section: Setup]: Asked about the kitchen table.',
      '[Section: Model]: Asked why Parakeet was unavailable.',
    ]);
    expect(uniqueAskPlutoEvidenceMeetings(selected)).toHaveLength(1);
  });

  it('explains an empty follow-up using the actual omitted-detail count', () => {
    expect(describeUnverifiedAskPlutoOmissions(4)).toBe(
      "I rechecked the 4 details left out of my earlier draft, but couldn't verify any as additional facts in this search.",
    );
  });
});
