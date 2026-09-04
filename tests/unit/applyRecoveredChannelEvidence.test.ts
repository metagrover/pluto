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

  it('accepts separated local speakers without claiming either one is Me', () => {
    const result = applyRecoveredChannelEvidence({
      segments: [
        {
          startTime: 0,
          endTime: 4,
          speaker: 'Local Speaker 1',
          text: 'first local voice',
        },
        {
          startTime: 4,
          endTime: 8,
          speaker: 'Local Speaker 2',
          text: 'second local voice',
        },
        { startTime: 8, endTime: 10, speaker: 'Them', text: 'remote voice' },
      ],
      activityWindows: [],
      localDiarization: {
        applied: true,
        multipleSpeakers: true,
        confidence: 1,
        clusterCount: 2,
        labeledSegmentCount: 2,
      },
      provenance: {
        runtimeVersion: 'fluidaudio-test',
        modelRevision: 'a'.repeat(40),
        artifactDigest: 'b'.repeat(64),
      },
    });

    expect(result.accepted).toBe(true);
    expect(result.segments.map((segment) => segment.speaker)).toEqual([
      'Local Speaker 1',
      'Local Speaker 2',
      'Them',
    ]);
    expect(result.attribution).toMatchObject({
      source: 'recovered_channel_acoustic_v3',
      confidence: 1,
      mappingApplied: false,
      speakerSeparation: 'verified',
      selfIdentity: 'unresolved',
      localDiarization: {
        applied: true,
        clusterCount: 2,
      },
    });
  });
});
