import { describe, expect, it } from 'vitest';

import { applyRecoveredChannelEvidence } from '../../src/services/finalTranscription/applyRecoveredChannelEvidence';

describe('applyRecoveredChannelEvidence', () => {
  it('trusts System as remote and requires mic-exclusive support for Me', () => {
    const result = applyRecoveredChannelEvidence({
      segments: [
        { startTime: 0, endTime: 4, speaker: 'Them', text: 'remote' },
        { startTime: 4, endTime: 8, speaker: 'Me', text: 'local' },
        { startTime: 8, endTime: 9, speaker: 'Me', text: 'unsupported' },
      ],
      activityWindows: [
        { startTime: 0, endTime: 4, speaker: 'Them' },
        { startTime: 4, endTime: 8, speaker: 'Me' },
      ],
      provenance: {
        runtimeVersion: 'fluidaudio-test',
        modelRevision: 'a'.repeat(40),
        artifactDigest: 'b'.repeat(64),
      },
    });

    expect(result.accepted).toBe(true);
    expect(result.segments.map((segment) => segment.speaker)).toEqual([
      'Them',
      'Me',
      'Unknown',
    ]);
    expect(result.segments[1]).toMatchObject({ nearEndEvidence: true });
    expect(result.attribution).toMatchObject({
      source: 'recovered_channel_acoustic_v2',
      confidence: 8 / 9,
      mappingApplied: true,
    });
  });

  it('rejects a candidate with too much unsupported mic speech', () => {
    const result = applyRecoveredChannelEvidence({
      segments: [
        { startTime: 0, endTime: 2, speaker: 'Them', text: 'remote' },
        { startTime: 2, endTime: 8, speaker: 'Me', text: 'unsupported' },
      ],
      activityWindows: [{ startTime: 0, endTime: 2, speaker: 'Them' }],
      provenance: {
        runtimeVersion: 'fluidaudio-test',
        modelRevision: 'a'.repeat(40),
        artifactDigest: 'b'.repeat(64),
      },
    });

    expect(result.accepted).toBe(false);
    expect(result.reasons).toEqual(['low_attribution_confidence']);
    expect(result.attribution.mappingApplied).toBe(false);
  });
});
