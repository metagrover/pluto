import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('subscribes to native PCM and failures before starting capture and persists failure evidence', () => {
  const source = readFileSync('src/components/AudioManager.tsx', 'utf8');
  const start = source.indexOf("invoke('NATIVE_AUDIO_START')");
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
  expect(source).toContain(
    "'NATIVE_AUDIO_FAILURE',\n          markSystemCaptureFailed",
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
