const MINIMUM_INCREMENTAL_SOURCE_CHARACTERS = 12_000;
const INCREMENTAL_SOURCE_STEP_CHARACTERS = 6_000;

export const shouldOfferIncrementalMeetingNotes = (input: {
  sourceCharacterCount: number;
  lastOfferedCharacterCount: number;
}): boolean =>
  input.sourceCharacterCount >= MINIMUM_INCREMENTAL_SOURCE_CHARACTERS &&
  input.sourceCharacterCount - input.lastOfferedCharacterCount >=
    INCREMENTAL_SOURCE_STEP_CHARACTERS;
