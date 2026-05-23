import { describe, expect, it } from 'vitest';

import {
  deriveCitationTrustStatus,
  deriveKnowledgeTrustStatus,
  getTrustStatusMeta,
} from '../../src/utils/trustStatus';

describe('trustStatus', () => {
  it('derives grounded for direct fresh evidence', () => {
    expect(
      deriveKnowledgeTrustStatus({
        docStatus: 'up_to_date',
        evidenceQuality: {
          mode: 'direct',
          confidence: 0.93,
          cited_meeting_count: 2,
          source_count: 2,
          last_reinforced_at: '2026-05-10T00:00:00.000Z',
          freshness: 'fresh',
        },
      }),
    ).toBe('grounded');
  });

  it('derives inferred for fresh inferred evidence', () => {
    expect(
      deriveKnowledgeTrustStatus({
        docStatus: 'up_to_date',
        evidenceQuality: {
          mode: 'inferred',
          confidence: 0.72,
          cited_meeting_count: 3,
          source_count: 3,
          last_reinforced_at: '2026-05-10T00:00:00.000Z',
          freshness: 'fresh',
        },
      }),
    ).toBe('inferred');
  });

  it('derives weak evidence when citations are missing', () => {
    expect(
      deriveKnowledgeTrustStatus({
        docStatus: 'up_to_date',
        evidenceQuality: {
          mode: 'direct',
          confidence: 0.51,
          cited_meeting_count: 0,
          source_count: 1,
          last_reinforced_at: null,
          freshness: 'unknown',
        },
      }),
    ).toBe('weak_evidence');
  });

  it('derives stale when the doc or evidence is stale', () => {
    expect(
      deriveKnowledgeTrustStatus({
        docStatus: 'stale',
        evidenceQuality: {
          mode: 'direct',
          confidence: 0.9,
          cited_meeting_count: 2,
          source_count: 2,
          last_reinforced_at: '2026-05-01T00:00:00.000Z',
          freshness: 'fresh',
        },
      }),
    ).toBe('stale');

    expect(
      deriveKnowledgeTrustStatus({
        docStatus: 'up_to_date',
        evidenceQuality: {
          mode: 'direct',
          confidence: 0.9,
          cited_meeting_count: 2,
          source_count: 2,
          last_reinforced_at: '2026-05-01T00:00:00.000Z',
          freshness: 'stale',
        },
      }),
    ).toBe('stale');
  });

  it('derives synthesis failed from failed docs', () => {
    expect(
      deriveKnowledgeTrustStatus({
        docStatus: 'failed',
        evidenceQuality: {
          mode: 'direct',
          confidence: 0.9,
          cited_meeting_count: 2,
          source_count: 2,
          last_reinforced_at: '2026-05-01T00:00:00.000Z',
          freshness: 'fresh',
        },
      }),
    ).toBe('synthesis_failed');
  });

  it('derives grounded vs needs review for citation audits', () => {
    expect(deriveCitationTrustStatus({ evidenceValid: true })).toBe('grounded');
    expect(deriveCitationTrustStatus({ evidenceValid: false })).toBe(
      'needs_review',
    );
  });

  it('returns stable labels for the canonical vocabulary', () => {
    expect(getTrustStatusMeta('weak_evidence').label).toBe('Weak evidence');
    expect(getTrustStatusMeta('needs_review').label).toBe('Needs review');
    expect(getTrustStatusMeta('grounded').description).toBe(
      'Backed by direct evidence from cited source material.',
    );
    expect(getTrustStatusMeta('stale').description).toBe(
      'The evidence has aged and should be refreshed before relying on it.',
    );
  });
});
