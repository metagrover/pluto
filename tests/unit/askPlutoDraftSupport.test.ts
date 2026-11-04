import { describe, expect, it } from 'vitest';

import {
  cleanDraftText,
  draftClaimsCoveredByPriorAnswer,
} from '../../electron/intelligence/askPlutoDraftSupport';

const prior =
  'The team must ensure the ability to limit the digital pilot experience to specific entitled users rather than the wider population. This task was rejected.';

describe('draft support from the previous answer', () => {
  it('accepts a draft that restates the validated previous answer', () => {
    expect(
      draftClaimsCoveredByPriorAnswer(
        [
          'Hi Riley, regarding the pilot migration, the task "The team must ensure the ability to limit the digital pilot experience to specific entitled users rather than the wider population" was rejected [Source 1].',
        ],
        prior,
      ),
    ).toBe(true);
  });

  it('still requires grounding for facts the previous answer did not contain', () => {
    expect(
      draftClaimsCoveredByPriorAnswer(
        [
          'Hi Riley, the pilot launches on Friday and finance approved the budget increase.',
        ],
        prior,
      ),
    ).toBe(false);
    expect(
      draftClaimsCoveredByPriorAnswer(
        [
          'The task was rejected.',
          'Finance approved the budget increase for the vendor contract.',
        ],
        prior,
      ),
    ).toBe(false);
  });

  it('needs a previous answer and at least one factual sentence', () => {
    expect(
      draftClaimsCoveredByPriorAnswer(['The task was rejected.'], ''),
    ).toBe(false);
    expect(
      draftClaimsCoveredByPriorAnswer(['Hi Riley,', 'Thanks!'], prior),
    ).toBe(false);
  });

  it('removes source markers from the delivered draft', () => {
    expect(cleanDraftText('Hi Riley, the task was rejected [Source 1].')).toBe(
      'Hi Riley, the task was rejected.',
    );
  });
});
