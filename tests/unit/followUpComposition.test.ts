import { describe, expect, it } from 'vitest';
import {
  composeFollowUp,
  createSavedFollowUpDrafts,
  mergeRefinedVariants,
  parseSavedFollowUpDrafts,
} from '../../src/components/features/followUpComposition';

const evidence = {
  meetingTitle: 'Launch review',
  overview: ['The release remains on track for Friday.'],
  decisions: [
    'Ship Friday (Topic: Release | Decided by: Ana | Why: Customers are ready)',
  ],
  actionItems: [
    'Resolve deployment blocker (Owner: Lee | Status: blocked)',
    'Publish notes (Owner: Sam | Status: active)',
  ],
  openQuestions: ['Release: Does support need a weekend rota?'],
  discussionPoints: [],
  topicSummaries: [],
};

describe('composeFollowUp', () => {
  it('builds coordinated variants without Pluto metadata labels or empty sections', () => {
    const result = composeFollowUp(evidence);

    expect(result.availability).toBe('ready');
    expect(result.variants.email).toContain('Ship Friday');
    expect(result.variants.internal).toContain('Resolve deployment blocker');
    expect(result.variants.slack).toContain(
      'Does support need a weekend rota?',
    );
    expect(Object.values(result.variants).join('\n')).not.toMatch(
      /Linked Context:|Topic:|Status:|Decided by:|Why:|None recorded/,
    );
  });

  it('uses overview evidence without requiring actions or decisions', () => {
    const result = composeFollowUp({
      ...evidence,
      overview: ['The team aligned on the customer signal.'],
      decisions: [],
      actionItems: [],
      openQuestions: [],
    });

    expect(result.availability).toBe('ready');
    expect(result.variants.email).toContain('customer signal');
    expect(result.variants.email).not.toContain('Decisions');
    expect(result.variants.email).not.toContain('Next steps');
  });

  it('returns honest weak evidence when only non-sendable context exists', () => {
    const result = composeFollowUp({
      meetingTitle: 'Untitled meeting',
      overview: [],
      decisions: [],
      actionItems: [],
      openQuestions: [],
      discussionPoints: [],
      topicSummaries: [],
      participants: ['Avery'],
      entityContext: ['Project: Apollo'],
    });

    expect(result.availability).toBe('weak_evidence');
    expect(result.reason).toBe(
      'Pluto does not yet have enough meeting evidence to draft a useful follow-up.',
    );
    expect(result.variants.email).toBe('');
  });

  it('produces a stable content-free evidence fingerprint', () => {
    const first = composeFollowUp(evidence).evidenceFingerprint;
    const second = composeFollowUp({ ...evidence }).evidenceFingerprint;
    const changed = composeFollowUp({
      ...evidence,
      overview: ['The release moved to Monday.'],
    }).evidenceFingerprint;

    expect(first).toBe(second);
    expect(changed).not.toBe(first);
    expect(first).not.toContain('Launch');
  });
});

describe('saved follow-up document', () => {
  it('migrates legacy variants as edited content', () => {
    const composition = composeFollowUp(evidence);
    const parsed = parseSavedFollowUpDrafts(
      JSON.stringify({
        client: 'My email edit',
        internal: 'My internal edit',
        slack: 'My Slack edit',
      }),
      composition,
    );

    expect(parsed).toMatchObject({
      schemaVersion: 2,
      variants: { email: 'My email edit' },
      editedFormats: ['email', 'internal', 'slack'],
    });
  });

  it('preserves every saved variant when edited evidence becomes stale', () => {
    const original = composeFollowUp(evidence);
    const saved = {
      ...createSavedFollowUpDrafts(original),
      variants: { ...original.variants, email: 'My edited email' },
      editedFormats: ['email' as const],
    };
    const changed = composeFollowUp({
      ...evidence,
      overview: ['The release moved to Monday.'],
    });
    const parsed = parseSavedFollowUpDrafts(JSON.stringify(saved), changed);

    expect(parsed?.variants.email).toBe('My edited email');
    expect(parsed?.variants.internal).toBe(saved.variants.internal);
    expect(parsed?.evidenceFingerprint).toBe(original.evidenceFingerprint);
  });

  it('replaces only unedited variants after refinement', () => {
    const saved = {
      ...createSavedFollowUpDrafts(composeFollowUp(evidence)),
      variants: {
        email: 'Edited email',
        internal: 'Old internal',
        slack: 'Old Slack',
      },
      editedFormats: ['email' as const],
    };
    const merged = mergeRefinedVariants(saved, {
      email: 'Refined email',
      internal: 'Refined internal',
      slack: 'Refined Slack',
    });

    expect(merged.variants).toEqual({
      email: 'Edited email',
      internal: 'Refined internal',
      slack: 'Refined Slack',
    });
  });
});
