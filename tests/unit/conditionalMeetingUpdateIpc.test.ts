import { describe, expect, it } from 'vitest';

import { runConditionalMeetingUpdateForIpc } from '../../electron/conditionalMeetingUpdateIpc';

describe('conditional meeting update IPC mapping', () => {
  it('returns the database outcome', () => {
    expect(runConditionalMeetingUpdateForIpc(() => 'updated')).toBe('updated');
  });

  it('maps thrown database failures to failed without exposing the error', () => {
    expect(
      runConditionalMeetingUpdateForIpc(() => {
        throw new Error('private database detail');
      }),
    ).toBe('failed');
  });
});
