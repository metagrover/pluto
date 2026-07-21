import { describe, expect, it } from 'vitest';
import {
  composeFollowUp,
  createEvidenceFingerprint,
  mergeSavedFollowUp,
  parseSavedFollowUpDocument,
  serializeSavedFollowUpDocument,
} from '../../src/components/features/followUpDraftComposition';

const strongEvidence = {
  meetingTitle: 'Launch review',
  overview: ['The release remains on track for Friday.'],
  decisions: [
    'Ship Friday (Topic: Release | Decided by: Ana | Why: Customers are ready)',
  ],
  actionItems: [
    'Resolve deployment blocker (Owner: Lee | Status: blocked)',
    'Publish notes (Owner: Sam | Status: active)',
    'Confirm support rota (Due: Thursday)',
    'Archive old checklist',
  ],
  openQuestions: ['Release: Does support need a weekend rota?'],
  discussionPoints: [],
  topicSummaries: [],
};

describe('composeFollowUp', () => {
  it('builds coordinated variants from prioritized evidence without internal labels', () => {
    const result = composeFollowUp(strongEvidence);

    expect(result.state).toBe('ready');
    expect(result.variants.email).toContain('Ship Friday');
    expect(result.variants.internal).toContain('Resolve deployment blocker');
    expect(result.variants.slack).toContain('Does support need a weekend rota?');
    expect(result.variants.email).not.toMatch(
      /Linked Context|Topic:|Status:|Decided by:|Why:/,
    );
    expect(result.variants.email).not.toContain('Archive old checklist');
    expect(result.variants.email).not.toContain('None');
  });

  it('uses useful context even when there are no actions or decisions', () => {
    const result = composeFollowUp({
      meetingTitle: 'Research sync',
      overview: ['The team aligned on the current customer signal.'],
      actionItems: [],
      decisions: [],
      openQuestions: [],
      discussionPoints: [],
      topicSummaries: [],
    });

    expect(result.state).toBe('ready');
    expect(result.variants.email).toContain('current customer signal');
    expect(result.variants.email).not.toContain('Decisions');
    expect(result.variants.email).not.toContain('Next steps');
  });

  it('returns an honest weak-evidence state instead of filler', () => {
    const result = composeFollowUp({
      meetingTitle: 'Untitled meeting',
      overview: [],
      actionItems: [],
      decisions: [],
      openQuestions: [],
      discussionPoints: [],
      topicSummaries: [],
    });

    expect(result.state).toBe('weak');
    expect(result.reason).toContain('enough supported meeting context');
    expect(result.variants.email).toBe('');
  });
});

describe('saved follow-up documents', () => {
  it('creates a stable evidence fingerprint', () => {
    expect(createEvidenceFingerprint(strongEvidence)).toBe(
      createEvidenceFingerprint({ ...strongEvidence }),
    );
    expect(
      createEvidenceFingerprint({
        ...strongEvidence,
        overview: ['A different read'],
      }),
    ).not.toBe(createEvidenceFingerprint(strongEvidence));
  });

  it('migrates legacy drafts and preserves them as edits', () => {
    const parsed = parseSavedFollowUpDocument(
      JSON.stringify({
        client: 'My email edit',
        internal: 'My internal edit',
        slack: 'My Slack edit',
      }),
    );

    expect(parsed.kind).toBe('legacy');
    expect(parsed.document?.variants.email).toBe('My email edit');
    expect(parsed.document?.edited.email).toBe(true);
  });

  it('preserves edited variants and refreshes unedited variants when evidence changes', () => {
    const original = composeFollowUp(strongEvidence);
    const saved = {
      version: 2 as const,
      fingerprint: original.fingerprint,
      variants: {
        ...original.variants,
        email: 'My carefully edited email',
      },
      edited: { email: true, internal: false, slack: false },
      activeFormat: 'email' as const,
    };
    const changed = composeFollowUp({
      ...strongEvidence,
      overview: ['The launch moved to Monday.'],
    });

    const merged = mergeSavedFollowUp(saved, changed);

    expect(merged.contextChanged).toBe(true);
    expect(merged.document.variants.email).toBe('My carefully edited email');
    expect(merged.document.variants.internal).toContain('moved to Monday');
    expect(
      parseSavedFollowUpDocument(serializeSavedFollowUpDocument(merged.document))
        .kind,
    ).toBe('v2');
  });

  it('reports malformed saved JSON without treating it as an empty document', () => {
    expect(parseSavedFollowUpDocument('{bad json').kind).toBe('malformed');
  });
});
