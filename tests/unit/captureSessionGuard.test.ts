import { describe, expect, it } from 'vitest';
import {
  attachCaptureUnloadGuard,
  isCaptureSessionAlreadyActiveError,
  shouldPreventCaptureUnload,
} from '../../src/utils/captureSessionGuard';

describe('capture session renderer guard', () => {
  it('recognizes Electron-wrapped active-capture conflicts', () => {
    expect(
      isCaptureSessionAlreadyActiveError(
        new Error(
          'Error invoking remote method AUDIO_CAPTURE_JOURNAL_START: capture_session_already_active',
        ),
      ),
    ).toBe(true);
    expect(
      isCaptureSessionAlreadyActiveError('capture_session_already_active'),
    ).toBe(true);
  });

  it('does not hard-reject unrelated journal failures', () => {
    expect(
      isCaptureSessionAlreadyActiveError(new Error('disk unavailable')),
    ).toBe(false);
    expect(isCaptureSessionAlreadyActiveError(null)).toBe(false);
  });

  it('prevents unload while recording or finalization is active', () => {
    expect(shouldPreventCaptureUnload({ state: 'recording' })).toBe(true);
    expect(shouldPreventCaptureUnload({ state: 'sealing' })).toBe(true);
    expect(shouldPreventCaptureUnload({ state: 'starting' })).toBe(true);
    expect(shouldPreventCaptureUnload({ state: 'idle' })).toBe(false);
  });

  it('installs an unload guard that follows current capture state', () => {
    let state = 'idle' as const | 'recording' | 'sealing';
    const target = new EventTarget();
    const detach = attachCaptureUnloadGuard(target, {
      snapshot: () => ({ state }),
    });

    expect(
      target.dispatchEvent(new Event('beforeunload', { cancelable: true })),
    ).toBe(true);

    state = 'recording';
    expect(
      target.dispatchEvent(new Event('beforeunload', { cancelable: true })),
    ).toBe(false);

    state = 'sealing';
    expect(
      target.dispatchEvent(new Event('beforeunload', { cancelable: true })),
    ).toBe(false);

    detach();
    expect(
      target.dispatchEvent(new Event('beforeunload', { cancelable: true })),
    ).toBe(true);
  });
});
