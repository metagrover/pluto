import { expect, it } from 'vitest';
import { shouldOfferIncrementalMeetingNotes } from '../../src/services/incrementalMeetingNotesOffer';

it.each([
  [{ sourceCharacterCount: 11_999, lastOfferedCharacterCount: 0 }, false],
  [{ sourceCharacterCount: 12_000, lastOfferedCharacterCount: 0 }, true],
  [{ sourceCharacterCount: 17_999, lastOfferedCharacterCount: 12_000 }, false],
  [{ sourceCharacterCount: 18_000, lastOfferedCharacterCount: 12_000 }, true],
])(
  'bounds incremental offers by stable source growth: %j',
  (input, expected) => {
    expect(shouldOfferIncrementalMeetingNotes(input)).toBe(expected);
  },
);
