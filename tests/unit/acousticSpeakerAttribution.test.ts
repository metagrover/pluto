import { describe, expect, it } from 'vitest';

import {
  deriveAttributionEvidence,
  injectLocalEvidenceWindows,
  mapDiarizationFromAcousticEvidence,
} from '../../src/utils/acousticSpeakerAttribution';

describe('deriveAttributionEvidence', () => {
  it('classifies mic-exclusive, system-correlated, and weak windows', () => {
    expect(
      deriveAttributionEvidence([
        { startTime: 0, endTime: 0.6, micRms: 0.04, systemRms: 0.001 },
        { startTime: 0.6, endTime: 1.2, micRms: 0.03, systemRms: 0.02 },
        { startTime: 1.2, endTime: 1.8, micRms: 0.002, systemRms: 0.001 },
      ]).map((window) => window.evidence),
    ).toEqual(['mic_exclusive', 'system_correlated', 'inconclusive']);
  });
});

describe('injectLocalEvidenceWindows', () => {
  it('does not relabel a remote turn from a small overlapping evidence window', () => {
    const result = injectLocalEvidenceWindows(
      [
        {
          startTime: 4,
          endTime: 5.4,
          speaker: 'Them',
          text: 'remote answer',
        },
      ],
      [{ startTime: 4.5, endTime: 4.8, overlapsRemote: true }],
    );

    expect(result[0].speaker).toBe('Them');
  });

  it('does not relabel remote speech inside a bridged mic-evidence gap', () => {
    const result = injectLocalEvidenceWindows(
      [
        {
          startTime: 4.1,
          endTime: 4.4,
          speaker: 'Them',
          text: 'remote interjection',
        },
      ],
      [
        {
          startTime: 4,
          endTime: 4.6,
          overlapsRemote: true,
          activeIntervals: [
            { startTime: 4, endTime: 4.1 },
            { startTime: 4.4, endTime: 4.6 },
          ],
        },
      ],
    );

    expect(result[0].speaker).toBe('Them');
  });

  it('does not carve an inferred Me turn out of a long remote segment', () => {
    const result = injectLocalEvidenceWindows(
      [
        {
          startTime: 0,
          endTime: 8,
          speaker: 'Them',
          text: 'one two three four five six seven eight',
        },
      ],
      [{ startTime: 4, endTime: 4.541, overlapsRemote: true }],
    );

    expect(result).toEqual([
      {
        startTime: 0,
        endTime: 8,
        speaker: 'Them',
        text: 'one two three four five six seven eight',
      },
    ]);
  });

  it('relabels an entire bounded two-word canonical turn', () => {
    const result = injectLocalEvidenceWindows(
      [
        { startTime: 0, endTime: 4, speaker: 'Them', text: 'remote words' },
        { startTime: 4, endTime: 4.541, speaker: 'Them', text: 'short reply' },
        { startTime: 4.541, endTime: 8, speaker: 'Them', text: 'more remote' },
      ],
      [{ startTime: 4.1, endTime: 4.4, overlapsRemote: true }],
    );

    expect(result[1]).toMatchObject({
      startTime: 4,
      endTime: 4.541,
      speaker: 'Me',
      text: 'short reply',
    });
  });
});

describe('mapDiarizationFromAcousticEvidence', () => {
  it('coalesces production-sized energy windows before short-local injection', () => {
    const evidenceWindows = deriveAttributionEvidence([
      { startTime: 0, endTime: 4, micRms: 0.03, systemRms: 0.03 },
      { startTime: 4, endTime: 4.1, micRms: 0.06, systemRms: 0.001 },
      { startTime: 4.1, endTime: 4.2, micRms: 0.06, systemRms: 0.001 },
      { startTime: 4.2, endTime: 4.3, micRms: 0.06, systemRms: 0.001 },
      { startTime: 4.3, endTime: 4.4, micRms: 0.06, systemRms: 0.001 },
      { startTime: 4.4, endTime: 4.541, micRms: 0.06, systemRms: 0.001 },
      { startTime: 4.541, endTime: 8, micRms: 0.03, systemRms: 0.03 },
    ]);

    const result = mapDiarizationFromAcousticEvidence({
      turns: [{ startTime: 0, endTime: 8, cluster: 'remote' }],
      evidenceWindows,
    });

    expect(result.injectedLocalWindows).toMatchObject([
      { startTime: 4, endTime: 4.541, overlapsRemote: true },
    ]);
    expect(result.missedMeEvidenceSeconds).toBe(0);
  });

  it('bridges brief correlated gaps inside one short near-end turn', () => {
    const result = mapDiarizationFromAcousticEvidence({
      turns: [{ startTime: 0, endTime: 8, cluster: 'remote' }],
      evidenceWindows: deriveAttributionEvidence([
        { startTime: 0, endTime: 4, micRms: 0.03, systemRms: 0.03 },
        { startTime: 4, endTime: 4.1, micRms: 0.06, systemRms: 0.001 },
        { startTime: 4.1, endTime: 4.4, micRms: 0.03, systemRms: 0.03 },
        { startTime: 4.4, endTime: 4.6, micRms: 0.06, systemRms: 0.001 },
        { startTime: 4.6, endTime: 8, micRms: 0.03, systemRms: 0.03 },
      ]),
    });

    expect(result.injectedLocalWindows).toMatchObject([
      { startTime: 4, endTime: 4.6, overlapsRemote: true },
    ]);
  });

  it('does not turn loudspeaker pass-through into Me', () => {
    const result = mapDiarizationFromAcousticEvidence({
      turns: [{ startTime: 0, endTime: 8, cluster: 'speaker_0' }],
      evidenceWindows: deriveAttributionEvidence([
        { startTime: 0, endTime: 8, micRms: 0.04, systemRms: 0.035 },
      ]),
    });

    expect(result.mapping).toEqual({ speaker_0: 'Them' });
    expect(result.injectedLocalWindows).toEqual([]);
    expect(result.falseMeEvidenceSeconds).toBe(0);
  });

  it('maps at most one cluster to Me from sustained exclusive evidence', () => {
    const result = mapDiarizationFromAcousticEvidence({
      turns: [
        { startTime: 0, endTime: 3, cluster: 'speaker_0' },
        { startTime: 3, endTime: 7, cluster: 'speaker_1' },
      ],
      evidenceWindows: deriveAttributionEvidence([
        { startTime: 0, endTime: 3, micRms: 0.05, systemRms: 0.001 },
        { startTime: 3, endTime: 7, micRms: 0.025, systemRms: 0.03 },
      ]),
    });

    expect(result.mapping).toEqual({ speaker_0: 'Me', speaker_1: 'Them' });
    expect(
      Object.values(result.mapping).filter((label) => label === 'Me'),
    ).toHaveLength(1);
  });

  it('recovers a 0.541-second mic-exclusive interruption without erasing the remote turn', () => {
    const result = mapDiarizationFromAcousticEvidence({
      turns: [{ startTime: 0, endTime: 8, cluster: 'speaker_0' }],
      evidenceWindows: deriveAttributionEvidence([
        { startTime: 0, endTime: 4, micRms: 0.03, systemRms: 0.03 },
        { startTime: 4, endTime: 4.541, micRms: 0.06, systemRms: 0.001 },
        { startTime: 4.541, endTime: 8, micRms: 0.03, systemRms: 0.03 },
      ]),
    });

    expect(result.mapping).toEqual({ speaker_0: 'Them' });
    expect(result.injectedLocalWindows).toMatchObject([
      { startTime: 4, endTime: 4.541, overlapsRemote: true },
    ]);
    expect(result.missedMeEvidenceSeconds).toBe(0);
    expect(result.falseMeEvidenceSeconds).toBe(0);
  });

  it('keeps inconclusive clusters unknown when acoustic evidence is missing', () => {
    const result = mapDiarizationFromAcousticEvidence({
      turns: [{ startTime: 0, endTime: 2, cluster: 'speaker_0' }],
      evidenceWindows: [],
    });

    expect(result.mapping).toEqual({ speaker_0: 'Unknown' });
    expect(result.fallbackReason).toBe('missing_acoustic_evidence');
  });
});
