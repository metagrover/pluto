import { describe, expect, it } from 'vitest';

import {
  advanceLiveTranscriptReveal,
  createLiveTranscriptRevealState,
  getLiveTranscriptRevealDelay,
  getRevealedTranscriptText,
  reconcileLiveTranscriptReveal,
} from '../../src/utils/liveTranscriptReveal';

const segment = (id: string, text: string) => ({ id, text });

describe('live transcript word reveal', () => {
  it('keeps mounted transcript text stable and reveals a new segment one word at a time', () => {
    const mounted = createLiveTranscriptRevealState([
      segment('existing', 'Already visible.'),
    ]);
    const reconciled = reconcileLiveTranscriptReveal(mounted, [
      segment('existing', 'Already visible.'),
      segment('new', 'Shipping today works.'),
    ]);

    expect(getRevealedTranscriptText(reconciled, 'existing')).toBe(
      'Already visible.',
    );
    expect(getRevealedTranscriptText(reconciled, 'new')).toBe('');

    const firstWord = advanceLiveTranscriptReveal(reconciled);
    expect(getRevealedTranscriptText(firstWord, 'new')).toBe('Shipping ');
    expect(getRevealedTranscriptText(firstWord, 'existing')).toBe(
      'Already visible.',
    );

    const secondWord = advanceLiveTranscriptReveal(firstWord);
    expect(getRevealedTranscriptText(secondWord, 'new')).toBe(
      'Shipping today ',
    );
  });

  it('reveals appended words without replaying the confirmed prefix', () => {
    const mounted = createLiveTranscriptRevealState([
      segment('turn', 'Ship it'),
    ]);
    const reconciled = reconcileLiveTranscriptReveal(mounted, [
      segment('turn', 'Ship it today'),
    ]);

    expect(getRevealedTranscriptText(reconciled, 'turn')).toBe('Ship it');
    expect(
      getRevealedTranscriptText(
        advanceLiveTranscriptReveal(reconciled),
        'turn',
      ),
    ).toBe('Ship it today');
  });

  it('shows source corrections and reduced-motion updates immediately', () => {
    const mounted = createLiveTranscriptRevealState([
      segment('turn', 'Send it'),
    ]);

    const corrected = reconcileLiveTranscriptReveal(mounted, [
      segment('turn', 'Ship it'),
    ]);
    expect(getRevealedTranscriptText(corrected, 'turn')).toBe('Ship it');

    const reducedMotion = reconcileLiveTranscriptReveal(
      mounted,
      [segment('turn', 'Send it tomorrow morning')],
      { revealImmediately: true },
    );
    expect(getRevealedTranscriptText(reducedMotion, 'turn')).toBe(
      'Send it tomorrow morning',
    );
  });

  it('accelerates a large backlog without dropping words', () => {
    expect(getLiveTranscriptRevealDelay(4)).toBeGreaterThan(
      getLiveTranscriptRevealDelay(24),
    );
    expect(getLiveTranscriptRevealDelay(0)).toBeNull();
  });
});
