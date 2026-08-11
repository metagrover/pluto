import { describe, it, expect } from 'vitest';
import { extractLearnedWordCandidate } from '../../src/utils/autoLearnObserver';

describe('extractLearnedWordCandidate', () => {
  it('extracts corrected jargon term when user fixes a word', () => {
    const original = 'we are deploying to kubernets today';
    const edited = 'we are deploying to Kubernetes today';
    const candidate = extractLearnedWordCandidate(original, edited);
    expect(candidate).toEqual({ original: 'kubernets', corrected: 'Kubernetes' });
  });

  it('returns null for common English word changes', () => {
    const original = 'we are going to the store';
    const edited = 'we are going to a store';
    const candidate = extractLearnedWordCandidate(original, edited);
    expect(candidate).toBeNull();
  });
});
