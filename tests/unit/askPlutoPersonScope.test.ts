import { describe, expect, it } from 'vitest';
import { shouldUsePersonFocusedEvidence } from '../../electron/intelligence/askPlutoPersonScope';

describe('person evidence scope', () => {
  it.each([
    'What is Morgan working on?',
    'What does Morgan own?',
    'What does Morgan expect from me?',
    'What do you think will satisfy Morgan?',
    "What are Morgan's expectations?",
    'Who is Morgan?',
  ])('keeps actual personal evidence scoped: %s', (query) => {
    expect(shouldUsePersonFocusedEvidence(query, 'lookup')).toBe(true);
  });
  it.each([
    'What should I present to Morgan about Atlas onboarding?',
    'What should I send to Morgan before the design review?',
    'Help me prepare for the onboarding session with Morgan.',
  ])('preserves meeting facts outside recipient mentions: %s', (query) => {
    expect(shouldUsePersonFocusedEvidence(query, 'analysis', true)).toBe(false);
  });
  it('preserves general project notes for a recipient draft', () => {
    expect(
      shouldUsePersonFocusedEvidence(
        'Draft a message to Morgan.',
        'draft',
        true,
      ),
    ).toBe(false);
  });
  it('inherits an active person for an elliptical work followup', () => {
    expect(
      shouldUsePersonFocusedEvidence('Any blockers?', 'lookup', true),
    ).toBe(true);
    expect(shouldUsePersonFocusedEvidence('Any blockers?', 'lookup')).toBe(
      false,
    );
  });
});
