import { describe, expect, it } from 'vitest';

import {
  deriveAttributionEvidence,
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

describe('mapDiarizationFromAcousticEvidence', () => {
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
    expect(result.injectedLocalWindows).toEqual([
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
