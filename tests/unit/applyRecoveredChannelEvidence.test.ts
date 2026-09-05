import { describe, expect, it } from 'vitest';

import { applyRecoveredChannelEvidence } from '../../src/services/finalTranscription/applyRecoveredChannelEvidence';

describe('applyRecoveredChannelEvidence', () => {
  const provenance = {
    runtimeVersion: 'test',
    modelRevision: 'a'.repeat(40),
    artifactDigest: 'b'.repeat(64),
  };

  it.each(['Local Speaker 1', 'Remote Speaker 1', 'Speaker'])(
    'does not promote an unresolved historical label %s to Me',
    (speaker) => {
      const result = applyRecoveredChannelEvidence({
        segments: [{ startTime: 0, endTime: 3, speaker, text: 'saved words' }],
        activityWindows: [{ startTime: 0, endTime: 3, speaker: 'Me' }],
        provenance,
      });
      expect(result.segments[0].speaker).toBe('Unknown');
      expect(result.accepted).toBe(false);
    },
  );

  it('does not count overlapping local windows twice to verify Me', () => {
    const result = applyRecoveredChannelEvidence({
      segments: [
        { startTime: 0, endTime: 10, speaker: 'Them', text: 'remote' },
        { startTime: 0, endTime: 10, speaker: 'Me', text: 'unresolved mic' },
      ],
      activityWindows: [
        { startTime: 1, endTime: 4, speaker: 'Me' },
        { startTime: 0, endTime: 3, speaker: 'Me' },
      ],
      provenance,
    });
    expect(result.segments[1].speaker).toBe('Unknown');
    expect(result.accepted).toBe(false);
  });

  it('does not count simultaneous remote segments twice against local speech', () => {
    const result = applyRecoveredChannelEvidence({
      segments: [
        { startTime: 0, endTime: 3, speaker: 'Them', text: 'remote one' },
        { startTime: 1, endTime: 4, speaker: 'Them', text: 'remote two' },
        { startTime: 0, endTime: 10, speaker: 'Me', text: 'local response' },
      ],
      activityWindows: [],
      provenance,
    });
    expect(result.segments[2].speaker).toBe('Me');
    expect(result.accepted).toBe(true);
  });

  it('handles unsorted disjoint evidence and clips coverage to each segment', () => {
    const result = applyRecoveredChannelEvidence({
      segments: [
        { startTime: 0, endTime: 10, speaker: 'Them', text: 'remote' },
        { startTime: 2, endTime: 8, speaker: 'Me', text: 'local overlap' },
      ],
      activityWindows: [
        { startTime: 6, endTime: 12, speaker: 'Me' },
        { startTime: 0, endTime: 3, speaker: 'Me' },
      ],
      provenance,
    });
    expect(result.segments[1].speaker).toBe('Me');
  });

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
