import { describe, expect, it } from 'vitest';
import {
  applyMeetingSpeakerDisplayNames,
  buildMeetingTranscriptTurns,
  getMeetingRemoteSpeakerStatus,
} from '../../src/components/features/meetingTranscriptPresentation';
import type { TranscriptSegment } from '../../src/types';

describe('meeting transcript presentation', () => {
  it('bounds long same-speaker reading turns without changing evidence rows', () => {
    const segments: TranscriptSegment[] = Array.from(
      { length: 14 },
      (_, index) => ({
        speaker: 'Them',
        startTime: index * 5,
        endTime: index * 5 + 4,
        text: `Sentence ${index} retains its canonical wording and punctuation.`,
      }),
    );

    const turns = buildMeetingTranscriptTurns(segments);

    expect(turns.length).toBeGreaterThan(1);
    expect(turns.flatMap((turn) => turn.segments)).toEqual(segments);
    expect(
      turns.every(
        (turn) =>
          turn.segments.map((segment) => segment.text).join(' ').length <= 420,
      ),
    ).toBe(true);
  });

  it('starts a new reading turn when the speaker changes', () => {
    const turns = buildMeetingTranscriptTurns([
      { speaker: 'Me', startTime: 0, endTime: 2, text: 'My point.' },
      { speaker: 'Them', startTime: 2, endTime: 4, text: 'Their answer.' },
    ]);

    expect(turns.map((turn) => turn.speaker)).toEqual(['Me', 'Them']);
  });

  it('projects confirmed names across matching turns without mutating evidence rows', () => {
    const segments: TranscriptSegment[] = [
      {
        speaker: 'Remote Speaker 1',
        startTime: 0,
        endTime: 2,
        text: 'First point.',
      },
      {
        speaker: 'Remote Speaker 2',
        startTime: 2,
        endTime: 4,
        text: 'Second point.',
      },
      {
        speaker: 'Remote Speaker 1',
        startTime: 4,
        endTime: 6,
        text: 'Third point.',
      },
    ];

    const projected = applyMeetingSpeakerDisplayNames(segments, {
      'Remote Speaker 1': 'Avery Chen',
    });

    expect(projected.map((segment) => segment.speaker)).toEqual([
      'Avery Chen',
      'Remote Speaker 2',
      'Avery Chen',
    ]);
    expect(segments.map((segment) => segment.speaker)).toEqual([
      'Remote Speaker 1',
      'Remote Speaker 2',
      'Remote Speaker 1',
    ]);
  });
});

describe('remote speaker completion status', () => {
  const meeting = (remoteDiarization: unknown, status = 'validated') => ({
    transcript_status: status,
    transcript_json: JSON.stringify({
      segments: [{ speaker: 'Them', text: 'A complete transcript.' }],
      speakerAttribution: { remoteDiarization },
    }),
  });
  const attempted = {
    attempted: true,
    input: 'system_audio',
    applied: false,
    clusterCount: 1,
    labeledSegmentCount: 0,
    confidence: 0,
  };

  it('keeps successful transcription separate from an unresolved voice group', () => {
    const result = getMeetingRemoteSpeakerStatus(
      meeting({
        ...attempted,
        fallbackReason: 'not_enough_speakers',
      }),
    );
    expect(result).toMatchObject({
      state: 'unresolved',
      title: 'Transcript ready · Remote speakers not separated',
    });
    expect(result?.detail).toContain('distinct voices could not be confirmed');
  });

  it('explains insufficient speech alignment without claiming missing capture', () => {
    const result = getMeetingRemoteSpeakerStatus(
      meeting({
        ...attempted,
        clusterCount: 2,
        fallbackReason: 'low_coverage',
      }),
    );
    expect(result?.state).toBe('unresolved');
    expect(result?.detail).toContain('matched confidently');
    expect(result?.detail).not.toContain('recording is incomplete');
  });

  it('describes absent remote speech without treating it as a transcription error', () => {
    expect(
      getMeetingRemoteSpeakerStatus(
        meeting({
          ...attempted,
          clusterCount: 0,
          fallbackReason: 'no_system_speech',
        }),
      ),
    ).toMatchObject({
      state: 'no_remote_speech',
      title: 'Transcript ready · No remote speech detected',
    });
  });

  it('reports applied labels while acknowledging uncertain remaining speech', () => {
    expect(
      getMeetingRemoteSpeakerStatus(
        meeting({
          ...attempted,
          applied: true,
          clusterCount: 2,
          labeledSegmentCount: 5,
        }),
      ),
    ).toMatchObject({
      state: 'separated',
      title: 'Transcript ready · Remote speaker labels applied',
    });
  });

  it.each(['validating', 'needs_attention', 'provisional'])(
    'does not announce readiness during %s',
    (status) => {
      expect(
        getMeetingRemoteSpeakerStatus(meeting(attempted, status)),
      ).toBeNull();
    },
  );

  it.each([
    undefined,
    {},
    { attempted: false },
    { ...attempted, input: 'mic_audio' },
  ])(
    'does not invent remote status for legacy or incompatible metadata',
    (metadata) => {
      expect(getMeetingRemoteSpeakerStatus(meeting(metadata))).toBeNull();
    },
  );

  it('ignores malformed or empty transcript records', () => {
    expect(
      getMeetingRemoteSpeakerStatus({
        transcript_status: 'validated',
        transcript_json: '{',
      }),
    ).toBeNull();
    expect(
      getMeetingRemoteSpeakerStatus({
        transcript_status: 'validated',
        transcript_json: JSON.stringify({
          segments: [],
          speakerAttribution: { remoteDiarization: attempted },
        }),
      }),
    ).toBeNull();
  });
});
