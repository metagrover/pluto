import { describe, expect, it } from 'vitest';

import { deriveSetupReadiness } from '../../src/services/setupReadiness';

describe('setup readiness', () => {
  it('is ready only when transcription and both capture permissions are ready', () => {
    expect(
      deriveSetupReadiness({
        transcription: 'ready',
        microphone: 'granted',
        systemAudio: 'granted',
      }),
    ).toEqual({ status: 'ready', canComplete: true, action: 'finish' });
  });

  it('reports model preparation without requiring an analysis provider', () => {
    expect(
      deriveSetupReadiness({
        transcription: 'preparing',
        microphone: 'granted',
        systemAudio: 'granted',
      }),
    ).toEqual({ status: 'preparing', canComplete: false, action: 'wait' });
  });

  it('makes failed model preparation retryable', () => {
    expect(
      deriveSetupReadiness({
        transcription: 'error',
        microphone: 'granted',
        systemAudio: 'granted',
      }),
    ).toEqual({ status: 'blocked', canComplete: false, action: 'retry-model' });
  });

  it('directs the user to missing permissions after the model is ready', () => {
    expect(
      deriveSetupReadiness({
        transcription: 'ready',
        microphone: 'blocked',
        systemAudio: 'granted',
      }),
    ).toEqual({
      status: 'blocked',
      canComplete: false,
      action: 'open-permissions',
    });
  });
});
