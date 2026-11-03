import { describe, expect, it } from 'vitest';

import { fits } from '../../electron/intelligence/suggestionText';

describe('suggested question text', () => {
  it('keeps names whole and skips ones too long to read', () => {
    expect(fits('  IPO Launchpad Kickoff ', 60)).toBe('IPO Launchpad Kickoff');
    expect(
      fits(
        'Vrinda / Deepak - IPO Project Revival and Strategy Planning Session',
        60,
      ),
    ).toBeNull();
    expect(fits(undefined, 60)).toBeNull();
  });
});
