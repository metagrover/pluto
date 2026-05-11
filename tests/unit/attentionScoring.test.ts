import { describe, expect, it } from 'vitest';

import { scoreAttentionItem } from '../../electron/intelligence/attentionScoring';

describe('attention scoring', () => {
  it('keeps repeated blockers above routine follow-ups', () => {
    const blocker = scoreAttentionItem({
      kind: 'blocker',
      status: 'active',
      confidence: 0.88,
      evidence_mode: 'direct',
      freshness: 'fresh',
      cited_meeting_count: 3,
      source_count: 3,
      related_stream_count: 1,
    });
    const followUp = scoreAttentionItem({
      kind: 'follow_up',
      status: 'active',
      confidence: 0.61,
      evidence_mode: 'direct',
      freshness: 'aging',
      cited_meeting_count: 1,
      source_count: 1,
      related_stream_count: 1,
      is_explicit_commitment: true,
    });

    expect(blocker.score).toBeGreaterThan(followUp.score);
    expect(blocker.severity).toBe('critical');
    expect(followUp.severity).not.toBe('critical');
    expect(blocker.score_breakdown.repetition).toBeGreaterThan(
      followUp.score_breakdown.repetition,
    );
  });

  it('lets urgent well-supported commitments outrank routine blockers', () => {
    const overdueCommitment = scoreAttentionItem({
      kind: 'follow_up',
      status: 'active',
      confidence: 0.92,
      evidence_mode: 'direct',
      freshness: 'fresh',
      due_at: '2026-05-09T12:00:00.000Z',
      now: '2026-05-11T12:00:00.000Z',
      cited_meeting_count: 2,
      source_count: 2,
      related_stream_count: 1,
      is_explicit_commitment: true,
    });
    const routineBlocker = scoreAttentionItem({
      kind: 'blocker',
      status: 'active',
      confidence: 0.68,
      evidence_mode: 'inferred',
      freshness: 'aging',
      cited_meeting_count: 1,
      source_count: 1,
      related_stream_count: 0,
    });

    expect(overdueCommitment.score).toBeGreaterThan(routineBlocker.score);
    expect(overdueCommitment.score_breakdown.urgency).toBeGreaterThan(0);
  });

  it('demotes stale weak one-off claims instead of promoting them', () => {
    const weakClaim = scoreAttentionItem({
      kind: 'open_question',
      status: 'active',
      confidence: 0.34,
      evidence_mode: 'inferred',
      freshness: 'stale',
      cited_meeting_count: 1,
      source_count: 1,
      related_stream_count: 0,
    });

    expect(weakClaim.score).toBeLessThan(0.25);
    expect(weakClaim.severity).toBe('steady');
    expect(weakClaim.score_breakdown.stale_penalty).toBeGreaterThan(0);
    expect(weakClaim.score_breakdown.weak_evidence_penalty).toBeGreaterThan(0);
    expect(weakClaim.score).toBe(weakClaim.score_breakdown.total);
  });

  it('applies predictable feedback boosts and suppressions', () => {
    const active = scoreAttentionItem({
      kind: 'risk',
      status: 'active',
      confidence: 0.8,
      evidence_mode: 'direct',
      freshness: 'fresh',
      cited_meeting_count: 2,
      source_count: 2,
      related_stream_count: 1,
    });
    const pinned = scoreAttentionItem({
      kind: 'risk',
      status: 'pinned',
      confidence: 0.8,
      evidence_mode: 'direct',
      freshness: 'fresh',
      cited_meeting_count: 2,
      source_count: 2,
      related_stream_count: 1,
    });
    const dismissed = scoreAttentionItem({
      kind: 'risk',
      status: 'dismissed',
      confidence: 0.8,
      evidence_mode: 'direct',
      freshness: 'fresh',
      cited_meeting_count: 2,
      source_count: 2,
      related_stream_count: 1,
    });

    expect(pinned.score).toBeGreaterThan(active.score);
    expect(pinned.score_breakdown.feedback).toBeGreaterThan(0);
    expect(dismissed.score).toBeLessThan(active.score);
    expect(dismissed.score_breakdown.feedback).toBeLessThan(0);
    expect(dismissed.severity).toBe('steady');
  });
});
