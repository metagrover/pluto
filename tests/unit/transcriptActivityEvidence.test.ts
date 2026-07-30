import { describe, expect, it } from 'vitest';

import {
  buildCaptureActivityEvidence,
  buildStoredTranscriptActivityEvidence,
  parseCaptureActivityEvidence,
  parseStoredTranscriptActivityEvidence,
  verifyCaptureActivityEvidence,
} from '../../src/utils/transcriptActivityEvidence';

const producer = {
  clock: {
    kind: 'meeting_relative_seconds' as const,
    origin: 'recording_start' as const,
  },
  thresholds: {
    rms: 0.012,
    dominanceRatio: 1.25,
    minimumSwitchIntervalMs: 200,
  },
  algorithmVersion: 'speaker_activity_v1' as const,
};

describe('capture activity evidence v2', () => {
  it('canonicalizes reordered windows to one deterministic digest', async () => {
    const first = await buildCaptureActivityEvidence(
      [
        { startTime: 2.5, endTime: 4, speaker: 'Them' },
        { startTime: 0, endTime: 2.5, speaker: 'Me' },
      ],
      producer,
    );
    const second = await buildCaptureActivityEvidence(
      [...first.windows].reverse(),
      producer,
    );

    expect(first).toEqual(second);
    expect(first.digestSha256).toMatch(/^[a-f0-9]{64}$/);
    await expect(verifyCaptureActivityEvidence(first)).resolves.toEqual(first);
  });

  it.each([
    ['negative start', [{ startTime: -1, endTime: 1, speaker: 'Me' }]],
    ['non-finite end', [{ startTime: 0, endTime: Number.NaN, speaker: 'Me' }]],
    ['zero-length window', [{ startTime: 1, endTime: 1, speaker: 'Me' }]],
    [
      'overlapping same-speaker windows',
      [
        { startTime: 0, endTime: 2, speaker: 'Me' },
        { startTime: 1, endTime: 3, speaker: 'Me' },
      ],
    ],
  ])(
    'classifies %s as malformed without filtering it',
    async (_name, windows) => {
      const valid = await buildCaptureActivityEvidence([], producer);

      await expect(
        parseCaptureActivityEvidence({ ...valid, windows }),
      ).resolves.toEqual({ ok: false, reason: 'malformed' });
    },
  );

  it.each([
    ['schema version', { schemaVersion: 3 }],
    ['source', { source: 'capture_activity_v3' }],
    ['serialization version', { serializationVersion: 2 }],
  ])('classifies unknown %s as unsupported', async (_name, change) => {
    const valid = await buildCaptureActivityEvidence([], producer);

    await expect(
      parseCaptureActivityEvidence({ ...valid, ...change }),
    ).resolves.toEqual({ ok: false, reason: 'unsupported' });
  });

  it('classifies a changed digest as digest_mismatch', async () => {
    const valid = await buildCaptureActivityEvidence(
      [{ startTime: 0, endTime: 1, speaker: 'Me' }],
      producer,
    );
    const changed = { ...valid, digestSha256: '0'.repeat(64) };

    await expect(parseCaptureActivityEvidence(changed)).resolves.toEqual({
      ok: false,
      reason: 'digest_mismatch',
    });
    await expect(verifyCaptureActivityEvidence(changed)).rejects.toThrow(
      'digest_mismatch',
    );
  });

  it.each([
    [
      'envelope',
      (evidence: Record<string, unknown>) => {
        evidence.transcriptText = 'must not survive';
      },
    ],
    [
      'clock',
      (evidence: Record<string, unknown>) => {
        (evidence.clock as Record<string, unknown>).participant = 'private';
      },
    ],
    [
      'thresholds',
      (evidence: Record<string, unknown>) => {
        (evidence.thresholds as Record<string, unknown>).audioPath = '/private';
      },
    ],
    [
      'window',
      (evidence: Record<string, unknown>) => {
        const windows = evidence.windows as Array<Record<string, unknown>>;
        windows[0].participant = 'private';
      },
    ],
  ])('rejects unsigned extra fields in the %s', async (_name, mutate) => {
    const valid = await buildCaptureActivityEvidence(
      [{ startTime: 0, endTime: 1, speaker: 'Me' }],
      producer,
    );
    const changed = structuredClone(valid) as unknown as Record<
      string,
      unknown
    >;
    mutate(changed);

    await expect(parseCaptureActivityEvidence(changed)).resolves.toEqual({
      ok: false,
      reason: 'malformed',
    });
  });

  it('rejects invalid producer inputs and windows while building', async () => {
    await expect(
      buildCaptureActivityEvidence(
        [{ startTime: -1, endTime: 1, speaker: 'Me' }],
        producer,
      ),
    ).rejects.toThrow('malformed');
    await expect(
      buildCaptureActivityEvidence([], {
        ...producer,
        thresholds: { ...producer.thresholds, rms: Number.POSITIVE_INFINITY },
      }),
    ).rejects.toThrow('malformed');
  });
});

describe('buildStoredTranscriptActivityEvidence', () => {
  it('keeps only content-free finite speaker windows', () => {
    expect(
      buildStoredTranscriptActivityEvidence([
        { startTime: 0, endTime: 12, speaker: 'Me' },
        { startTime: 12, endTime: 20, speaker: 'Them' },
        { startTime: 20, endTime: 20, speaker: 'Me' },
        { startTime: 22, endTime: 18, speaker: 'Them' },
      ]),
    ).toEqual({
      schemaVersion: 1,
      source: 'capture_activity_v1',
      windows: [
        { startTime: 0, endTime: 12, speaker: 'Me' },
        { startTime: 12, endTime: 20, speaker: 'Them' },
      ],
    });
  });
});

describe('parseStoredTranscriptActivityEvidence', () => {
  it('round-trips versioned stored activity evidence and rejects invalid schemas', () => {
    const stored = {
      schemaVersion: 1,
      source: 'capture_activity_v1',
      windows: [{ startTime: 0, endTime: 12, speaker: 'Me' }],
    };

    expect(parseStoredTranscriptActivityEvidence(stored)).toEqual(stored);
    expect(
      parseStoredTranscriptActivityEvidence({
        schemaVersion: 2,
        source: 'capture_activity_v1',
        windows: [{ startTime: 0, endTime: 12, speaker: 'Me' }],
      }),
    ).toBeNull();
  });
});
