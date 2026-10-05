import { describe, expect, test, vi } from 'vitest';
import {
  isGrantedStatus,
  refreshRecordingPermissions,
  resolveMicrophoneStatus,
  resolveSystemAudioStatus,
  shouldRunBootPermissionProbe,
} from '../../src/utils/permissions';

describe('permission status helpers', () => {
  test('refreshes changed permissions without relaunching the app', async () => {
    const invoke = vi.fn(async (channel: string) =>
      channel === 'CHECK_MICROPHONE_PERMISSION' ? 'granted' : true,
    );
    const probeMicrophone = vi.fn(async () => true);
    expect(
      await refreshRecordingPermissions({ invoke, probeMicrophone }),
    ).toEqual({ mic: 'granted', systemAudio: 'granted' });
    expect(invoke.mock.calls.map(([channel]) => channel)).toEqual([
      'CHECK_MICROPHONE_PERMISSION',
      'SYSTEM_AUDIO_PROBE',
    ]);
    expect(probeMicrophone).not.toHaveBeenCalled();
  });
  test('keeps a denial visible and allows an explicit retry to recover', async () => {
    const invoke = vi.fn(async (channel: string) =>
      channel === 'CHECK_MICROPHONE_PERMISSION' ? 'denied' : true,
    );
    const probeMicrophone = vi.fn(async () => false);
    expect(
      (await refreshRecordingPermissions({ invoke, probeMicrophone })).mic,
    ).toBe('denied');
    probeMicrophone.mockResolvedValueOnce(true);
    expect(
      (await refreshRecordingPermissions({ invoke, probeMicrophone })).mic,
    ).toBe('granted');
  });
  test('defers the legacy boot probe until onboarding is complete', () => {
    expect(shouldRunBootPermissionProbe(null)).toBe(false);
    expect(shouldRunBootPermissionProbe(true)).toBe(false);
    expect(shouldRunBootPermissionProbe(false)).toBe(true);
  });

  test('treats authorized and granted as granted statuses', () => {
    expect(isGrantedStatus('authorized')).toBe(true);
    expect(isGrantedStatus('granted')).toBe(true);
    expect(isGrantedStatus('denied')).toBe(false);
  });

  test('prefers a successful microphone probe over a stale native status', () => {
    expect(resolveMicrophoneStatus('denied', true)).toBe('granted');
    expect(resolveMicrophoneStatus('restricted', true)).toBe('granted');
  });

  test('preserves the native status when the microphone probe fails', () => {
    expect(resolveMicrophoneStatus('denied', false)).toBe('denied');
    expect(resolveMicrophoneStatus('not-determined', false)).toBe(
      'not-determined',
    );
  });

  test('does not treat a silent boot system-audio probe miss as a hard failure', () => {
    expect(resolveSystemAudioStatus(false, true)).toBe('unknown');
    expect(resolveSystemAudioStatus(true, true)).toBe('granted');
  });

  test('treats an active recording system-audio probe miss as needs-audio', () => {
    expect(resolveSystemAudioStatus(false, false)).toBe('needs-audio');
  });
});
