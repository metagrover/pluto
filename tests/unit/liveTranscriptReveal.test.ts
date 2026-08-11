import { describe, expect, it } from 'vitest';

import {
  advanceTranscriptRevealText,
  getLiveTranscriptRevealDelay,
  getPendingTranscriptWordCount,
} from '../../src/utils/liveTranscriptReveal';

describe('live transcript word reveal', () => {
  it('reveals one word without accepting transcript history as input', () => {
    expect(advanceTranscriptRevealText('Shipping today works.', '')).toBe(
      'Shipping ',
    );
    expect(
      advanceTranscriptRevealText('Shipping today works.', 'Shipping '),
    ).toBe('Shipping today ');
  });

  it('reveals appended words without replaying the confirmed prefix', () => {
    expect(advanceTranscriptRevealText('Ship it today', 'Ship it')).toBe(
      'Ship it today',
    );
  });

  it('measures only the active segment backlog', () => {
    expect(
      getPendingTranscriptWordCount('Send it tomorrow morning', 'Send '),
    ).toBe(3);
  });

  it('accelerates a large backlog without dropping words', () => {
    expect(getLiveTranscriptRevealDelay(4)).toBeGreaterThan(
      getLiveTranscriptRevealDelay(24),
    );
    expect(getLiveTranscriptRevealDelay(0)).toBeNull();
  });
});
