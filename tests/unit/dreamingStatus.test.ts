import { describe, expect, it } from 'vitest';
import { DREAMING_STATUS_LABEL } from '../../src/utils/dreamingStatus';

describe('dreaming status copy', () => {
  it.each([
    ['existing', 'Already prepared'],
    ['busy', 'Another preparation is running'],
    ['ineligible', 'Preparation is paused'],
    ['backoff', 'Will retry later'],
    ['exhausted', 'Needs review before retrying'],
    ['review_required', 'Review required'],
  ] as const)('describes %s truthfully', (status, label) => {
    expect(DREAMING_STATUS_LABEL[status]).toBe(label);
    expect(label).not.toBe('Preparation failed');
  });
});
