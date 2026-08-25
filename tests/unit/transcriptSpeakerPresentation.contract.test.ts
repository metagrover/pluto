import { describe, expect, it } from 'vitest';

import {
  applyTranscriptSpeakerPresentation,
  buildAnalysisTranscriptFromJson,
  buildTranscriptSegmentsForPresentation,
} from '../../src/utils/transcript.ts';

const fallbackJson = (segments: unknown[]) =>
  JSON.stringify({
    speakerAttribution: {
      source: 'channel_fallback',
      confidence: 0,
      diarizationAttempted: false,
      mappingApplied: false,
      fallbackReason: 'diarization_disabled',
    },
    segments,
  });

describe('saved transcript speaker-presentation contract', () => {
  it.each([
    {
      name: 'keeps System-channel speech as Them',
      segments: [
        { speaker: 'Them', startTime: 0, endTime: 4, text: 'Remote speech.' },
      ],
      expected: ['Them'],
    },
    {
      name: 'keeps substantive non-overlapping mic speech as Me',
      segments: [
        { speaker: 'Them', startTime: 0, endTime: 2, text: 'Remote speech.' },
        {
          speaker: 'Me',
          startTime: 3,
          endTime: 5,
          text: 'Can I ask something?',
        },
      ],
      expected: ['Them', 'Me'],
    },
    {
      name: 'assigns materially overlapping mic speech to Them',
      segments: [
        { speaker: 'Them', startTime: 0, endTime: 4, text: 'Remote speech.' },
        {
          speaker: 'Me',
          startTime: 1,
          endTime: 3,
          text: 'Different degraded words here.',
        },
      ],
      expected: ['Them', 'Them'],
    },
    {
      name: 'keeps short isolated mic speech neutral',
      segments: [{ speaker: 'Me', startTime: 5, endTime: 6, text: 'I agree' }],
      expected: ['Speaker'],
    },
    {
      name: 'keeps missing or malformed timing neutral',
      segments: [
        { speaker: 'Me', text: 'Missing timing evidence here.' },
        {
          speaker: 'Me',
          startTime: -2,
          endTime: -1,
          text: 'Malformed timing evidence here.',
        },
      ],
      expected: ['Speaker', 'Speaker'],
    },
    {
      name: 'supports legacy start and end timing',
      segments: [
        { speaker: 'Them', start: 0, end: 2, text: 'Remote speech.' },
        {
          speaker: 'Me',
          start: 3,
          end: 5,
          text: 'Legacy local timing works.',
        },
      ],
      expected: ['Them', 'Me'],
    },
  ])('$name', ({ segments, expected }) => {
    const transcriptJson = fallbackJson(segments);
    expect(
      applyTranscriptSpeakerPresentation(transcriptJson, segments).map(
        (segment) => segment.speaker,
      ),
    ).toEqual(expected);
  });

  it('uses a 50 percent overlap boundary for System authority', () => {
    const segments = [
      { speaker: 'Them', startTime: 0, endTime: 1, text: 'Remote speech.' },
      {
        speaker: 'Me',
        startTime: 0,
        endTime: 2,
        text: 'Exactly half overlaps remotely.',
      },
      {
        speaker: 'Me',
        startTime: 0,
        endTime: 2.01,
        text: 'Just under half stays local.',
      },
    ];

    expect(
      applyTranscriptSpeakerPresentation(fallbackJson(segments), segments).map(
        (segment) => segment.speaker,
      ),
    ).toEqual(['Them', 'Them', 'Me']);
  });

  it('preserves a confident mapped Me label during overlap', () => {
    const segments = [
      { speaker: 'Them', startTime: 0, endTime: 4, text: 'Remote speech.' },
      { speaker: 'Me', startTime: 1, endTime: 3, text: 'Mapped local speech.' },
    ];
    const transcriptJson = JSON.stringify({
      speakerAttribution: { mappingApplied: true },
      segments,
    });

    expect(
      applyTranscriptSpeakerPresentation(transcriptJson, segments).map(
        (segment) => segment.speaker,
      ),
    ).toEqual(['Them', 'Me']);
  });

  it('suppresses matching loudspeaker echo but retains phonetic mismatch as Them', () => {
    const segments = [
      {
        speaker: 'Them',
        startTime: 10,
        endTime: 14,
        text: 'Switch the task to Orion then.',
      },
      {
        speaker: 'Me',
        startTime: 10.5,
        endTime: 13.5,
        text: 'switch the task to Orion then',
      },
      {
        speaker: 'Me',
        startTime: 12.5,
        endTime: 14.08,
        text: 'or Ryan then',
      },
    ];
    const transcriptJson = fallbackJson(segments);

    expect(
      buildTranscriptSegmentsForPresentation(transcriptJson, segments).map(
        (segment) => [segment.speaker, segment.text],
      ),
    ).toEqual([
      ['Them', 'Switch the task to Orion then.'],
      ['Them', 'Or Ryan then.'],
    ]);
  });

  it('suppresses repeated contractions echoed across adjacent System rows', () => {
    const segments = [
      {
        speaker: 'Them',
        startTime: 20,
        endTime: 22,
        text: "We don't need another",
      },
      {
        speaker: 'Them',
        startTime: 22,
        endTime: 24,
        text: "don't need another retry",
      },
      {
        speaker: 'Me',
        startTime: 20,
        endTime: 24,
        text: "we don't need another don't need another retry",
      },
    ];
    const transcriptJson = fallbackJson(segments);

    expect(
      buildTranscriptSegmentsForPresentation(transcriptJson, segments).map(
        (segment) => [segment.speaker, segment.text],
      ),
    ).toEqual([['Them', "We don't need another don't need another retry."]]);
  });

  it('does not suppress matching words outside the overlap window', () => {
    const segments = [
      {
        speaker: 'Them',
        startTime: 30,
        endTime: 32,
        text: 'Review the release plan tomorrow.',
      },
      {
        speaker: 'Me',
        startTime: 35,
        endTime: 37,
        text: 'Review the release plan tomorrow.',
      },
    ];
    const transcriptJson = fallbackJson(segments);

    expect(
      buildTranscriptSegmentsForPresentation(transcriptJson, segments).map(
        (segment) => segment.speaker,
      ),
    ).toEqual(['Them', 'Me']);
  });

  it('keeps saved display and analysis on one projection without mutating evidence', () => {
    const segments = [
      {
        speaker: 'Them',
        startTime: 0,
        endTime: 4,
        text: 'The rollout is ready.',
      },
      {
        speaker: 'Me',
        startTime: 0.5,
        endTime: 3.5,
        text: 'the rollout is ready',
      },
      {
        speaker: 'Me',
        startTime: 5,
        endTime: 7,
        text: 'Can we review tomorrow?',
      },
    ];
    const before = structuredClone(segments);
    const transcriptJson = fallbackJson(segments);
    const presented = buildTranscriptSegmentsForPresentation(
      transcriptJson,
      segments,
    );

    expect(buildAnalysisTranscriptFromJson(transcriptJson)).toBe(
      presented
        .map((segment) => `${String(segment.speaker)}: ${segment.text}`)
        .join('\n'),
    );
    expect(segments).toEqual(before);
    expect(JSON.parse(transcriptJson).segments).toEqual(before);
  });

  it('uses the preserved live candidate when final wording is materially degraded', () => {
    const recovered = [
      { speaker: 'Them', startTime: 10, endTime: 11, text: 'The rollout' },
      {
        speaker: 'Them',
        startTime: 11.05,
        endTime: 11.5,
        text: 'the rollout',
      },
      { speaker: 'Them', startTime: 11.55, endTime: 12, text: 'is is' },
      { speaker: 'Them', startTime: 12.05, endTime: 13, text: 'ready' },
    ];
    const liveSegments = [
      {
        speaker: 'Them',
        startTime: 10,
        endTime: 13,
        text: 'The rollout is ready.',
      },
    ];
    const transcriptJson = JSON.stringify({
      speakerAttribution: { mappingApplied: false },
      liveSegments,
      segments: recovered,
    });
    const before = JSON.parse(transcriptJson);

    const presented = buildTranscriptSegmentsForPresentation(
      transcriptJson,
      recovered,
    );

    expect(presented.map((segment) => segment.text)).toEqual([
      'The rollout is ready.',
    ]);
    expect(buildAnalysisTranscriptFromJson(transcriptJson)).toBe(
      'Them: The rollout is ready.',
    );
    expect(JSON.parse(transcriptJson)).toEqual(before);
  });

  it('assembles the same punctuated sentences for saved display and analysis', () => {
    const segments = [
      { speaker: 'Them', startTime: 0, endTime: 0.8, text: 'this is' },
      { speaker: 'Them', startTime: 0.9, endTime: 1.8, text: 'one thought' },
      { speaker: 'Me', startTime: 2, endTime: 3, text: 'can we proceed' },
    ];
    const transcriptJson = JSON.stringify({
      speakerAttribution: { mappingApplied: true },
      segments,
    });

    const presented = buildTranscriptSegmentsForPresentation(
      transcriptJson,
      segments,
    );

    expect(presented.map((segment) => [segment.speaker, segment.text])).toEqual(
      [
        ['Them', 'This is one thought.'],
        ['Me', 'Can we proceed?'],
      ],
    );
    expect(buildAnalysisTranscriptFromJson(transcriptJson)).toBe(
      'Them: This is one thought.\nMe: Can we proceed?',
    );
  });
});
