import { describe, expect, it } from 'vitest';
import { extractLearnedWordCandidate } from '../../src/utils/autoLearnObserver';

describe('extractLearnedWordCandidate', () => {
  it('extracts corrected jargon term when user fixes a word', () => {
    const original = 'we are deploying to kubernets today';
    const edited = 'we are deploying to Kubernetes today';
    const candidate = extractLearnedWordCandidate(original, edited);
    expect(candidate).toEqual({
      original: 'kubernets',
      corrected: 'Kubernetes',
    });
  });

  it('handles diffs with extra added context words', () => {
    const original = 'we discussed graphql backend architecture in the standup';
    const edited =
      'we discussed GraphQL backend architecture in the team standup today';
    const candidate = extractLearnedWordCandidate(original, edited);
    expect(candidate).toEqual({
      original: 'graphql',
      corrected: 'GraphQL',
    });
  });

  it('returns null for common English word changes', () => {
    const original = 'we are going to the store';
    const edited = 'we are going to a store';
    const candidate = extractLearnedWordCandidate(original, edited);
    expect(candidate).toBeNull();
  });
});
