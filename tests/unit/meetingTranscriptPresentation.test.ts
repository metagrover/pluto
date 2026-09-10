import { describe, expect, it } from 'vitest';
import {
  applyMeetingSpeakerDisplayNames,
  buildMeetingTranscriptTurns,
  extractSpeakerDisplayNames,
  formatMeetingTranscriptForClipboard,
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

  it('formats the displayed turns as readable clipboard text', () => {
    const turns = buildMeetingTranscriptTurns([
      { speaker: 'Avery (You)', startTime: 0, endTime: 2, text: ' Hello. ' },
      { speaker: 'Speaker 1', startTime: 65, endTime: 68, text: ' Hi there. ' },
    ]);

    expect(formatMeetingTranscriptForClipboard(turns)).toBe(
      'Avery (You) (0:00)\nHello.\n\nSpeaker 1 (1:05)\nHi there.',
    );
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
      'Speaker 2',
      'Avery Chen',
    ]);
    expect(segments.map((segment) => segment.speaker)).toEqual([
      'Remote Speaker 1',
      'Remote Speaker 2',
      'Remote Speaker 1',
    ]);
  });

  it('projects Me as [Name] (You) when a display name is provided', () => {
    const segments: TranscriptSegment[] = [
      { speaker: 'Me', startTime: 0, endTime: 2, text: 'Hello everyone.' },
    ];
    const projected = applyMeetingSpeakerDisplayNames(segments, {
      Me: 'Aditya Grover',
    });
    expect(projected[0].speaker).toBe('Aditya Grover (You)');
  });

  it('does not duplicate (You) if already present', () => {
    const segments: TranscriptSegment[] = [
      { speaker: 'Me', startTime: 0, endTime: 2, text: 'Hello everyone.' },
    ];
    const projected = applyMeetingSpeakerDisplayNames(segments, {
      Me: 'Aditya Grover (You)',
    });
    expect(projected[0].speaker).toBe('Aditya Grover (You)');
  });

  it('resolves Me from identity.profile.preferredName when no explicit Me binding exists', () => {
    const names = extractSpeakerDisplayNames({
      people: [{ id: 'person-1', name: 'Deepak Grover' }],
      bindings: [
        {
          speaker: 'Remote Speaker 1',
          personId: 'person-1',
        },
      ],
      profile: { preferredName: 'Deepak' },
      selfPersonId: 'person-1',
    });
    expect(names.Me).toBe('Deepak');
  });

  it('resolves Me from identity.selfPersonId person name when no explicit Me binding or profile exists', () => {
    const names = extractSpeakerDisplayNames({
      people: [{ id: 'self-id', name: 'Deepak Grover' }],
      bindings: [],
      selfPersonId: 'self-id',
    });
    expect(names.Me).toBe('Deepak Grover');
  });

  it('respects explicit Me binding over profile.preferredName fallback', () => {
    const names = extractSpeakerDisplayNames({
      people: [{ id: 'self-id', name: 'Deepak Grover' }],
      bindings: [{ speaker: 'Me', personId: 'self-id' }],
      profile: { preferredName: 'D' },
      selfPersonId: 'self-id',
    });
    expect(names.Me).toBe('Deepak Grover');
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

  describe('extractSpeakerDisplayNames', () => {
    it('returns empty object when identity is null, undefined, or malformed', () => {
      expect(extractSpeakerDisplayNames(null)).toEqual({});
      expect(extractSpeakerDisplayNames(undefined)).toEqual({});
      expect(extractSpeakerDisplayNames({} as any)).toEqual({});
      expect(
        extractSpeakerDisplayNames({ people: [], bindings: undefined as any }),
      ).toEqual({});
    });

    it('maps bound speakers to their trimmed person names', () => {
      const identity = {
        people: [
          { id: 'person-1', name: ' Alice Smith ' },
          { id: 'person-2', name: 'Bob Jones' },
        ],
        bindings: [
          { speaker: 'Remote Speaker 1', personId: 'person-1' },
          { speaker: 'Remote Speaker 2', personId: 'person-2' },
        ],
      };

      expect(extractSpeakerDisplayNames(identity)).toEqual({
        'Remote Speaker 1': 'Alice Smith',
        'Remote Speaker 2': 'Bob Jones',
      });
    });

    it('ignores bindings with missing personId, unbound persons, or whitespace-only names', () => {
      const identity = {
        people: [
          { id: 'person-1', name: 'Alice' },
          { id: 'person-empty', name: '   ' },
        ],
        bindings: [
          { speaker: 'Remote Speaker 1', personId: 'person-1' },
          { speaker: 'Remote Speaker 2', personId: null },
          { speaker: 'Remote Speaker 3', personId: 'person-unknown' },
          { speaker: 'Remote Speaker 4', personId: 'person-empty' },
          { speaker: 'Remote Speaker 5' },
        ],
      };

      expect(extractSpeakerDisplayNames(identity)).toEqual({
        'Remote Speaker 1': 'Alice',
      });
    });
  });
});
