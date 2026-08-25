import { describe, expect, it } from 'vitest';

import { resolveCaptureAction } from '../../src/services/captureLifecycle';

describe('capture lifecycle', () => {
  it('offers a new meeting only when capture is idle', () => {
    expect(resolveCaptureAction({ state: 'idle' })).toEqual({
      label: 'New meeting',
      enabled: true,
      command: 'start',
    });
    expect(resolveCaptureAction({ state: 'starting' })).toEqual({
      label: 'Starting meeting',
      enabled: false,
      command: 'wait',
    });
    expect(resolveCaptureAction({ state: 'sealing' })).toEqual({
      label: 'Finishing meeting',
      enabled: false,
      command: 'wait',
    });
  });

  it('returns to the active recording only while capture is recording', () => {
    expect(resolveCaptureAction({ state: 'recording' })).toEqual({
      label: 'Return to recording',
      enabled: true,
      command: 'return',
    });
  });
});
