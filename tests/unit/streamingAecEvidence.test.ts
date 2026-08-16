import { describe, expect, it } from 'vitest';

import {
  AEC_FAILURES,
  type AecAlgorithmConfig,
  type TrustedAecAudioReceipt,
} from '../../src/services/streamingAec/contracts';
import {
  createAecAlgorithmConfigDigest,
  isAecAlgorithmConfigDigest,
  isAecAudioReceipt,
  isAecWorkerRequest,
  validateAecAudioReceipt,
} from '../../src/services/streamingAec/evidence';

const config: AecAlgorithmConfig = {
  backendRevision: 'backend-r1',
  algorithmVersion: 'aec-v1',
  algorithmParameters: { filterLength: 256, adaptationRate: 0.05 },
  sampleRateHz: 16000,
  channelCount: 1,
  resamplerVersion: 'resampler-v1',
};

const baseReceipt = (): TrustedAecAudioReceipt => ({
  schemaVersion: 1,
  captureGeneration: 'generation-1',
  captureSequence: 7,
  intervalStartSeconds: 35,
  intervalEndSeconds: 40,
  micChecksum: 'a'.repeat(64),
  algorithmVersion: config.algorithmVersion,
  backendRevision: config.backendRevision,
  algorithmConfigDigest: createAecAlgorithmConfigDigest(config),
  sampleRateHz: 16000,
  channelCount: 1,
  resamplerVersion: config.resamplerVersion,
  verdict: 'trusted',
  systemChecksum: 'b'.repeat(64),
  derivedChecksum: 'c'.repeat(64),
  derivedAudioRelativePath: 'aec/7.wav',
  referenceCoverage: 1,
  estimatedDelayMs: 40,
  driftPpm: 20,
  preCorrelation: 0.8,
  postCorrelation: 0.12,
  erleDb: 18,
  doubleTalk: false,
  clipped: false,
  weakReference: false,
  confidence: 0.95,
});

const untrustedReceipt = (failure: string) => {
  const {
    verdict: _verdict,
    systemChecksum: _systemChecksum,
    derivedChecksum: _derivedChecksum,
    derivedAudioRelativePath: _derivedAudioRelativePath,
    referenceCoverage: _referenceCoverage,
    estimatedDelayMs: _estimatedDelayMs,
    driftPpm: _driftPpm,
    preCorrelation: _preCorrelation,
    postCorrelation: _postCorrelation,
    erleDb: _erleDb,
    doubleTalk: _doubleTalk,
    clipped: _clipped,
    weakReference: _weakReference,
    confidence: _confidence,
    ...base
  } = baseReceipt();
  return { ...base, verdict: 'untrusted' as const, failure };
};

describe('streaming AEC evidence', () => {
  it('exposes a receipt validator for fail-closed evidence admission', async () => {
    const evidence = await import(
      '../../src/services/streamingAec/evidence'
    ).catch(() => null);

    expect(evidence?.isAecAudioReceipt).toBeTypeOf('function');
  });

  it('accepts trusted receipts and explicitly binds their configuration digest', () => {
    const receipt = baseReceipt();

    expect(isAecAudioReceipt(receipt)).toBe(true);
    expect(isAecAlgorithmConfigDigest(receipt, config)).toBe(true);
    expect(
      isAecAlgorithmConfigDigest(receipt, {
        ...config,
        algorithmParameters: {
          ...config.algorithmParameters,
          filterLength: 512,
        },
      }),
    ).toBe(false);
  });

  it('pins digest bytes and ignores algorithm-parameter insertion order', () => {
    const expectedDigest =
      'daf90c34c8ac9c76d405f2b22e7d54f8881bf3bd9166f7d4f093319c11d9dd88';
    expect(createAecAlgorithmConfigDigest(config)).toBe(expectedDigest);
    expect(
      createAecAlgorithmConfigDigest({
        ...config,
        algorithmParameters: { adaptationRate: 0.05, filterLength: 256 },
      }),
    ).toBe(expectedDigest);
    expect(() =>
      createAecAlgorithmConfigDigest({
        ...config,
        trustedAdmissionPolicy: {
          minimumReferenceCoverage: 0.97,
          minimumConfidence: 0.85,
        },
      } as never),
    ).toThrow('immutable trusted admission policy');
  });

  it.each([
    ['coverage exact', 0.95, 0.95, true, undefined],
    ['coverage inside', 0.9501, 0.95, true, undefined],
    ['coverage outside', 0.9499, 0.95, false, 'coverage_mismatch'],
    ['confidence exact', 0.95, 0.8, true, undefined],
    ['confidence inside', 0.95, 0.8001, true, undefined],
    ['confidence outside', 0.95, 0.7999, false, 'low_confidence'],
  ])(
    'enforces immutable trusted admission boundary: %s',
    (_label, coverage, confidence, accepted, failure) => {
      const result = validateAecAudioReceipt({
        ...baseReceipt(),
        referenceCoverage: coverage,
        confidence,
      });

      expect(result.valid).toBe(accepted);
      if (!accepted && !result.valid) expect(result.failure).toBe(failure);
    },
  );

  it.each([
    ['clipped', { clipped: true }],
    ['weak reference', { weakReference: true }],
    ['zero reference coverage', { referenceCoverage: 0 }],
    ['zero confidence', { confidence: 0 }],
  ])(
    'rejects trusted receipts with unsafe %s diagnostics',
    (_label, overrides) => {
      expect(isAecAudioReceipt({ ...baseReceipt(), ...overrides })).toBe(false);
    },
  );

  it('rejects a trusted receipt that carries a failure', () => {
    const invalid = { ...baseReceipt(), failure: 'timeout' };

    expect(isAecAudioReceipt(invalid)).toBe(false);
  });

  it('rejects an untrusted receipt without a finite failure code', () => {
    const invalid = untrustedReceipt('not-a-failure');

    expect(isAecAudioReceipt(invalid)).toBe(false);
  });

  it.each([
    [
      'captureGeneration',
      { captureGeneration: 'meeting transcript for Alice' },
    ],
    ['algorithmVersion', { algorithmVersion: 'v1 with transcript text' }],
    ['backendRevision', { backendRevision: 'backend for Alice meeting' }],
    ['resamplerVersion', { resamplerVersion: 'resampler with human identity' }],
    ['derived path', { derivedAudioRelativePath: 'aec/meeting-recording.wav' }],
  ])('rejects content-bearing persisted %s values', (_label, overrides) => {
    expect(isAecAudioReceipt({ ...baseReceipt(), ...overrides })).toBe(false);
  });

  it('freezes the exact finite failure allowlist at runtime', () => {
    expect(Object.isFrozen(AEC_FAILURES)).toBe(true);
    expect(AEC_FAILURES).toHaveLength(18);
    expect(() =>
      (AEC_FAILURES as unknown as string[]).push('arbitrary'),
    ).toThrow();
    expect(AEC_FAILURES).toHaveLength(18);
  });

  it('accepts every terminal failure code only on an untrusted receipt', () => {
    for (const failure of AEC_FAILURES) {
      const receipt = {
        ...untrustedReceipt(failure),
        failure,
        metrics: { confidence: 0.1 },
      };

      expect(isAecAudioReceipt(receipt), failure).toBe(true);
    }
    expect(AEC_FAILURES).toHaveLength(18);
  });

  it.each([
    'transcriptText',
    'text',
    'personId',
    'meetingId',
    'deviceId',
    'audio',
    'audioBase64',
    'exception',
    'errorMessage',
    'requestId',
  ])('rejects recursively disallowed evidence field %s', (field) => {
    const invalid = {
      ...untrustedReceipt('timeout'),
      metrics: { confidence: 0.9, nested: { inner: { [field]: 'forbidden' } } },
    };

    expect(isAecAudioReceipt(invalid)).toBe(false);
  });

  it.each([
    '/absolute/path.wav',
    'C:\\absolute\\path.wav',
    '\\\\server\\share.wav',
    'file:///tmp/audio.wav',
    'file:/tmp/audio.wav',
    'file:C:/absolute/path.wav',
    'file:C:\\absolute\\path.wav',
    'aec/../secret.wav',
  ])('rejects absolute or escaping derived paths: %s', (path) => {
    expect(
      isAecAudioReceipt({ ...baseReceipt(), derivedAudioRelativePath: path }),
    ).toBe(false);
  });

  it('binds derived artifact paths to their capture sequence for both verdicts', () => {
    expect(
      isAecAudioReceipt({
        ...baseReceipt(),
        derivedAudioRelativePath: 'aec/8.wav',
      }),
    ).toBe(false);
    expect(
      isAecAudioReceipt({
        ...untrustedReceipt('timeout'),
        derivedAudioRelativePath: 'aec/8.wav',
      }),
    ).toBe(false);
  });

  it('allows provenance generation, sequence, bounds, and checksums', () => {
    const receipt = baseReceipt();

    expect(receipt.captureGeneration).toBe('generation-1');
    expect(receipt.captureSequence).toBe(7);
    expect(receipt.intervalStartSeconds).toBe(35);
    expect(receipt.intervalEndSeconds).toBe(40);
    expect(receipt.micChecksum).toBe('a'.repeat(64));
    expect(receipt.systemChecksum).toBe('b'.repeat(64));
    expect(receipt.derivedChecksum).toBe('c'.repeat(64));
    expect(validateAecAudioReceipt(receipt).valid).toBe(true);
  });

  it.each(['short', 'A'.repeat(64), 'G'.repeat(64), 'transcript text'])(
    'rejects non-SHA-256 checksum and digest values: %s',
    (invalidValue) => {
      expect(
        isAecAudioReceipt({ ...baseReceipt(), micChecksum: invalidValue }),
      ).toBe(false);
      expect(
        isAecAudioReceipt({ ...baseReceipt(), systemChecksum: invalidValue }),
      ).toBe(false);
      expect(
        isAecAudioReceipt({ ...baseReceipt(), derivedChecksum: invalidValue }),
      ).toBe(false);
      expect(
        isAecAudioReceipt({
          ...baseReceipt(),
          algorithmConfigDigest: invalidValue,
        }),
      ).toBe(false);
    },
  );

  it('rejects forbidden fields nested inside an otherwise valid untrusted receipt', () => {
    const invalid = {
      ...untrustedReceipt('timeout'),
      metrics: {
        confidence: 0.9,
        nested: { inner: { transcriptText: 'forbidden' } },
      },
    };

    expect(isAecAudioReceipt(invalid)).toBe(false);
  });

  it('allows approved absolute worker paths while keeping them out of receipts', () => {
    const request = {
      schemaVersion: 1 as const,
      captureGeneration: 'generation-1',
      captureSequence: 7,
      intervalStartSeconds: 35,
      intervalEndSeconds: 40,
      micPath: '/private/capture/mic.wav',
      systemPath: '/private/capture/system.wav',
      outputPath: '/private/aec/derived.wav',
    };

    expect(isAecWorkerRequest(request)).toBe(true);
    expect(
      isAecAudioReceipt({
        ...baseReceipt(),
        derivedAudioRelativePath: request.outputPath,
      }),
    ).toBe(false);
  });

  it('rejects unsafe capture sequences in receipts and worker requests', () => {
    expect(
      isAecAudioReceipt({
        ...baseReceipt(),
        captureSequence: Number.MAX_SAFE_INTEGER + 1,
      }),
    ).toBe(false);
    expect(
      isAecWorkerRequest({
        schemaVersion: 1,
        captureGeneration: 'generation-1',
        captureSequence: Number.MAX_SAFE_INTEGER + 1,
        intervalStartSeconds: 35,
        intervalEndSeconds: 40,
        micPath: '/private/capture/mic.wav',
        systemPath: '/private/capture/system.wav',
        outputPath: '/private/aec/derived.wav',
      }),
    ).toBe(false);
  });
});
