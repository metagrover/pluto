import { describe, expect, it } from 'vitest';
import {
  runCalibrationBenchmark,
  validateReportPrivacy,
} from '../../scripts/benchmark_voice_calibration';
import { DEFAULT_CALIBRATION_POLICY_V1 } from '../../src/services/speakerVoiceMatcher';

describe('speakerVoiceCalibrationBenchmark & privacy guard', () => {
  it('runs calibration benchmark and observes zero false suggestions under calibrated policy', () => {
    const report = runCalibrationBenchmark(DEFAULT_CALIBRATION_POLICY_V1);

    expect(report.schemaVersion).toBe(1);
    expect(report.metrics.zeroFalseSuggestionsObserved).toBe(true);
    expect(report.metrics.falsePositives).toBe(0);
    expect(report.metrics.falseSuggestionRate).toBe(0);
    expect(report.metrics.truePositives).toBeGreaterThan(0);
    expect(report.selectedPolicyPassed).toBe(true);
  });

  it('validates report privacy passes for clean aggregate reports', () => {
    const report = runCalibrationBenchmark(DEFAULT_CALIBRATION_POLICY_V1);
    expect(() => validateReportPrivacy(report)).not.toThrow();
  });

  it('rejects benchmark reports leaking embeddings, digests, audio, or excerpts', () => {
    expect(() =>
      validateReportPrivacy({
        schemaVersion: 1,
        embedding: [0.1, 0.2, 0.3],
      }),
    ).toThrow('privacy_violation_forbidden_key: "embedding"');

    expect(() =>
      validateReportPrivacy({
        schemaVersion: 1,
        candidateDigest: 'abc1234',
      }),
    ).toThrow('privacy_violation_forbidden_key: "candidateDigest"');

    expect(() =>
      validateReportPrivacy({
        schemaVersion: 1,
        meetingId: 'meeting-secret',
      }),
    ).toThrow('privacy_violation_forbidden_key: "meetingId"');

    expect(() =>
      validateReportPrivacy({
        schemaVersion: 1,
        excerpt: 'Confidential conversation discussion',
      }),
    ).toThrow('privacy_violation_forbidden_key: "excerpt"');
  });

  it('rejects benchmark reports leaking local filesystem paths or identities', () => {
    expect(() =>
      validateReportPrivacy({
        schemaVersion: 1,
        leak: '/Users/metagrover/Desktop/audio.wav',
      }),
    ).toThrow('privacy_violation_path_leakage');

    expect(() =>
      validateReportPrivacy({
        schemaVersion: 1,
        person: 'Alex Synthetic',
      }),
    ).toThrow('privacy_violation_identity_leakage');
  });
});
