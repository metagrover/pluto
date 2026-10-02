import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('subscribes to native PCM and failures before starting capture and persists failure evidence', () => {
  const source = readFileSync('src/components/AudioManager.tsx', 'utf8');
  const start = source.indexOf('const nativeAudioStartPromise =');
  expect(start).toBeGreaterThan(-1);
  expect(source.indexOf("'NATIVE_AUDIO_CHUNK',")).toBeGreaterThan(-1);
  expect(source.indexOf("'NATIVE_AUDIO_FAILURE',")).toBeGreaterThan(-1);
  expect(
    source.indexOf("'NATIVE_AUDIO_CHUNK',\n          handler"),
  ).toBeLessThan(start);
  expect(source.indexOf("'NATIVE_AUDIO_FAILURE',")).toBeLessThan(start);
  expect(source).toContain("'AUDIO_CAPTURE_JOURNAL_SOURCE_FAILED'");
  expect(source).toContain('systemLiveness.received(decoded.samples)');
  expect(source).toMatch(
    /createPcmLivenessMonitor\(\s*markSystemCaptureUnresponsive/u,
  );
  expect(source).toContain('void systemRecovery.recover()');
  expect(source).toContain('if (systemRecovery.isRecovering()) return;');
  expect(source).toMatch(
    /onRecovering: \(\) => \{[\s\S]*?recordSystemCaptureGap\(\);/u,
  );
  expect(source).toContain('if (systemGapRecorded) return;');
  expect(source).toContain(
    'if (isRecordingRef.current) recordSystemCaptureGap();',
  );
  const failureMutation = source.slice(
    source.indexOf('const markSystemCaptureFailed ='),
    source.indexOf(
      'systemAudioChunkSeenRef.current = false;',
      source.indexOf('const markSystemCaptureFailed ='),
    ),
  );
  expect(failureMutation).toMatch(
    /catch \(error\) \{\s*captureActivitySessionRef\.current\?\.markDurabilityFailure\(\);\s*throw error;/u,
  );
  expect(failureMutation).not.toContain('markSystemCaptureUnresponsive');
});

it('overlaps native PCM startup with independent meeting setup without weakening the recording boundary', () => {
  const source = readFileSync('src/components/AudioManager.tsx', 'utf8');
  const journalStart = source.indexOf("'AUDIO_CAPTURE_JOURNAL_START'");
  const nativeLaunch = source.indexOf(
    'const nativeAudioStartPromise =',
    journalStart,
  );
  const vocabularyStart = source.indexOf(
    "'GET_TRANSCRIPTION_VOCABULARY'",
    journalStart,
  );
  const eouStart = source.indexOf('eouSession.start()', journalStart);
  const microphoneAcquisition = source.indexOf(
    'navigator.mediaDevices.getUserMedia',
    journalStart,
  );
  const nativeSettlement = source.indexOf(
    'await nativeAudioStartPromise',
    nativeLaunch,
  );
  const microphoneRecorderStart = source.indexOf(
    'micRecorder.start(CHUNK_SECONDS * 1000)',
    nativeSettlement,
  );
  const recordingState = source.indexOf(
    'setIsRecording(true)',
    nativeSettlement,
  );
  const abortStart = source.slice(
    source.indexOf('const abortUnstartedCapture = async'),
    source.indexOf('const startSession = async'),
  );

  expect(nativeLaunch).toBeGreaterThan(journalStart);
  expect(nativeLaunch).toBeLessThan(vocabularyStart);
  expect(nativeLaunch).toBeLessThan(eouStart);
  expect(nativeLaunch).toBeLessThan(microphoneAcquisition);
  expect(source.slice(eouStart, microphoneAcquisition)).not.toContain(
    'await eouSession.start()',
  );
  expect(nativeSettlement).toBeGreaterThan(microphoneAcquisition);
  expect(nativeSettlement).toBeLessThan(microphoneRecorderStart);
  expect(recordingState).toBeGreaterThan(microphoneRecorderStart);
  expect(abortStart).toContain('cancelSystemAudioHealthTimeoutRef.current?.()');
  expect(abortStart).toContain('nativeAudioUnsubscribeRef.current?.()');
  expect(abortStart).toContain("invoke('NATIVE_AUDIO_STOP')");
});
