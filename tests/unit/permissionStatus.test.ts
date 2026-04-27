import { describe, expect, test } from 'vitest';
import {
  isGrantedStatus,
  resolveMicrophoneStatus,
  resolveSystemAudioStatus,
} from '../../src/utils/permissions';

describe('permission status helpers', () => {
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
