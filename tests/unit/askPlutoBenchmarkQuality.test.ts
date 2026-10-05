import { expect, it } from 'vitest';
import { answerPassesQuality } from '../../scripts/run_ask_pluto_benchmark';
it('accepts factual answers without obsolete inline citation syntax', () => {
  expect(
    answerPassesQuality('fast', 'Sam owns launch signoff. Launch is Friday.'),
  ).toBe(true);
  expect(
    answerPassesQuality(
      'deep',
      'Launch moved from Tuesday to Friday. Sam previously owned signoff; Alex now owns it. Payment integration testing remains blocked.',
    ),
  ).toBe(true);
});
it('rejects empty evidence and contradictory ownership/status even with all keywords present', () => {
  expect(
    answerPassesQuality(
      'fast',
      "I couldn't verify whether Sam owns signoff on Friday.",
    ),
  ).toBe(false);
  expect(
    answerPassesQuality(
      'deep',
      'Tuesday changed to Friday. Alex reviewed it, but Sam still owns signoff. Payment testing is complete; the block is gone.',
    ),
  ).toBe(false);
});
