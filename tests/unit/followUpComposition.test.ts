import { describe, expect, it } from 'vitest';
import {
  buildFollowUpComposition,
  createSavedFollowUpDrafts,
  getSaveCompletionState,
  mergeRefinedVariants,
  parseRefinedVariants,
  parseSavedFollowUpDrafts,
  resolveFollowUpDrafts,
} from '../../src/components/features/followUpComposition';

const input = {
  meetingTitle: 'Launch review',
  overview: ['The launch remains on track for Friday.'],
  actionItems: ['Ship the release notes (Owner: Maya | Status: Active)'],
  decisions: ['Use the staged rollout (Decided by: Maya | Why: lower risk)'],
  discussionPoints: [],
  openQuestions: ['Who owns weekend monitoring?'],
  topicSummaries: [],
};

describe('buildFollowUpComposition', () => {
  it('builds three coordinated variants from meaningful evidence', () => {
    const result = buildFollowUpComposition(input);

    expect(result.availability).toBe('ready');
    if (result.availability !== 'ready') return;
    expect(result.variants.email).toContain(
      'The launch remains on track for Friday.',
    );
    expect(result.variants.internal).toContain(
      'The launch remains on track for Friday.',
    );
    expect(result.variants.slack).toContain(
      'The launch remains on track for Friday.',
    );
    expect(Object.values(result.variants).join('\n')).not.toMatch(
      /Owner:|Status:|Decided by:|Why:|None recorded/,
    );
  });

  it('uses overview evidence even without actions or decisions', () => {
    const result = buildFollowUpComposition({
      ...input,
      actionItems: [],
      decisions: [],
      openQuestions: [],
    });

    expect(result.availability).toBe('ready');
  });

  it('returns an honest weak state for names and linked entities alone', () => {
    const result = buildFollowUpComposition({
      meetingTitle: 'Introductions',
      overview: [],
      actionItems: [],
      decisions: [],
      discussionPoints: [],
      openQuestions: [],
      topicSummaries: [],
      participants: ['Maya'],
      entityContext: ['Project: Atlas'],
    });

    expect(result).toMatchObject({
      availability: 'weak_evidence',
      reason: expect.stringContaining('enough meeting evidence'),
    });
  });

  it('limits evidence and omits unsupported sections', () => {
    const result = buildFollowUpComposition({
      ...input,
      overview: [],
      decisions: ['D1', 'D2', 'D3', 'D4'],
      actionItems: ['A1', 'A2', 'A3', 'A4', 'A5', 'A6'],
      openQuestions: ['Q1?', 'Q2?', 'Q3?', 'Q4?'],
    });

    expect(result.availability).toBe('ready');
    if (result.availability !== 'ready') return;
    expect(result.variants.internal).toContain('D3');
    expect(result.variants.internal).not.toContain('D4');
    expect(result.variants.internal).toContain('A5');
    expect(result.variants.internal).not.toContain('A6');
    expect(result.variants.internal).toContain('Q3?');
    expect(result.variants.internal).not.toContain('Q4?');
    expect(result.variants.email).not.toContain('Recap\n\nDecisions');
  });

  it('produces a stable content-free fingerprint', () => {
    const first = buildFollowUpComposition(input);
    const second = buildFollowUpComposition({ ...input });

    expect(first.evidenceFingerprint).toBe(second.evidenceFingerprint);
    expect(first.evidenceFingerprint).toMatch(/^fup-[0-9a-f]{8}$/);
    expect(first.evidenceFingerprint).not.toContain('launch');
  });

  it('keeps sendable accountability while stripping internal metadata labels', () => {
    const result = buildFollowUpComposition({
      ...input,
      actionItems: [
        'Publish release notes (Owner: Maya (Head of Product) | Due: Friday | Status: Active)',
      ],
    });

    expect(result.availability).toBe('ready');
    if (result.availability !== 'ready') return;
    expect(result.variants.internal).toContain(
      'Publish release notes — Maya (Head of Product) · due Friday',
    );
    expect(result.variants.internal).not.toMatch(/Owner:|Due:|Status:/);
  });

  it('changes the fingerprint when the rendered meeting title changes', () => {
    const first = buildFollowUpComposition(input);
    const second = buildFollowUpComposition({
      ...input,
      meetingTitle: 'Renamed launch review',
    });

    expect(first.evidenceFingerprint).not.toBe(second.evidenceFingerprint);
  });
});

describe('saved follow-up drafts', () => {
  it('keeps a newer dirty revision pending when an older save completes', () => {
    expect(getSaveCompletionState(1, 2, true)).toBe('saving');
    expect(getSaveCompletionState(2, 2, true)).toBe('saved');
    expect(getSaveCompletionState(2, 2, false)).toBe('error');
    expect(getSaveCompletionState(1, 2, false, 2)).toBe('saved');
  });

  it('migrates legacy drafts in memory', () => {
    const parsed = parseSavedFollowUpDrafts(
      JSON.stringify({
        client: 'Email edit',
        internal: 'Team edit',
        slack: 'Slack edit',
      }),
      'fup-12345678',
    );

    expect(parsed.state).toBe('legacy');
    expect(parsed.document).toMatchObject({
      schemaVersion: 2,
      selectedFormat: 'email',
      variants: {
        email: 'Email edit',
        internal: 'Team edit',
        slack: 'Slack edit',
      },
      editedFormats: ['email', 'internal', 'slack'],
    });
  });

  it('loads a valid version-two document', () => {
    const document = createSavedFollowUpDrafts(
      'email',
      'fup-12345678',
      { email: 'E', internal: 'I', slack: 'S' },
      ['email'],
    );

    expect(
      parseSavedFollowUpDrafts(JSON.stringify(document), 'ignored'),
    ).toEqual({
      state: 'valid',
      document,
    });
  });

  it('preserves every saved variant when edited evidence changes', () => {
    const composition = buildFollowUpComposition(input);
    if (composition.availability !== 'ready') throw new Error('expected ready');
    const saved = createSavedFollowUpDrafts(
      'slack',
      'fup-old00000',
      { email: 'Saved email', internal: 'Saved internal', slack: 'My edit' },
      ['slack'],
    );

    const resolved = resolveFollowUpDrafts(composition, saved);

    expect(resolved.contextChanged).toBe(true);
    expect(resolved.document.variants).toEqual(saved.variants);
  });

  it('refreshes deterministic variants when nothing was edited', () => {
    const composition = buildFollowUpComposition(input);
    if (composition.availability !== 'ready') throw new Error('expected ready');
    const saved = createSavedFollowUpDrafts(
      'internal',
      'fup-old00000',
      { email: 'Old', internal: 'Old', slack: 'Old' },
      [],
    );

    const resolved = resolveFollowUpDrafts(composition, saved);

    expect(resolved.contextChanged).toBe(false);
    expect(resolved.document.variants).toEqual(composition.variants);
  });

  it('replaces only unedited formats after refinement', () => {
    const saved = createSavedFollowUpDrafts(
      'email',
      'fup-12345678',
      { email: 'My email', internal: 'Old internal', slack: 'Old slack' },
      ['email'],
    );

    expect(
      mergeRefinedVariants(saved, {
        email: 'New email',
        internal: 'New internal',
        slack: 'New slack',
      }).variants,
    ).toEqual({
      email: 'My email',
      internal: 'New internal',
      slack: 'New slack',
    });
  });

  it('maps refinement by title and rejects incomplete or duplicate formats', () => {
    expect(
      parseRefinedVariants([
        { title: 'Slack Update', content: 'S' },
        { title: 'Client Recap Email', content: 'E' },
        { title: 'Internal Summary', content: 'I' },
      ]),
    ).toEqual({ email: 'E', internal: 'I', slack: 'S' });
    expect(
      parseRefinedVariants([
        { title: 'Slack Update', content: 'S1' },
        { title: 'Slack Update', content: 'S2' },
        { title: 'Internal Summary', content: 'I' },
      ]),
    ).toBeNull();
  });
});
