import { describe, expect, it } from 'vitest';

import { applyRecoveredChannelEvidence } from '../../src/services/finalTranscription/applyRecoveredChannelEvidence';

describe('applyRecoveredChannelEvidence', () => {
  it('trusts System as remote and preserves mic-only speech as Me', () => {
    const result = applyRecoveredChannelEvidence({
      segments: [
        { startTime: 0, endTime: 4, speaker: 'Them', text: 'remote' },
        { startTime: 4, endTime: 8, speaker: 'Me', text: 'local' },
        { startTime: 8, endTime: 9, speaker: 'Me', text: 'mic only' },
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
      'Me',
    ]);
    expect(result.segments[1]).toMatchObject({ nearEndEvidence: true });
    expect(result.attribution).toMatchObject({
      source: 'recovered_channel_acoustic_v2',
      confidence: 1,
      mappingApplied: true,
    });
  });

  it('rejects a candidate with too much unsupported simultaneous mic speech', () => {
    const result = applyRecoveredChannelEvidence({
      segments: [
        { startTime: 0, endTime: 8, speaker: 'Them', text: 'remote' },
        { startTime: 2, endTime: 8, speaker: 'Me', text: 'unsupported' },
      ],
      activityWindows: [{ startTime: 0, endTime: 8, speaker: 'Them' }],
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

  it('does not treat a small System boundary overlap as concurrent speech', () => {
    const result = applyRecoveredChannelEvidence({
      segments: [
        { startTime: 0, endTime: 4.1, speaker: 'Them', text: 'remote' },
        { startTime: 4, endTime: 6, speaker: 'Me', text: 'local response' },
      ],
      activityWindows: [{ startTime: 0, endTime: 4.1, speaker: 'Them' }],
      provenance: {
        runtimeVersion: 'fluidaudio-test',
        modelRevision: 'a'.repeat(40),
        artifactDigest: 'b'.repeat(64),
      },
    });

    expect(result.segments[1]).toMatchObject({
      speaker: 'Me',
      nearEndEvidence: true,
    });
  });
});
