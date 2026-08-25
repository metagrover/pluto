import { describe, expect, it } from 'vitest';

import {
  buildAnalysisTranscriptFromJson,
  parseTranscriptSegmentsForPresentation,
} from '../../src/utils/transcript';

describe('buildAnalysisTranscriptFromJson', () => {
  it('formats transcript arrays with speaker labels', () => {
    const transcriptJson = JSON.stringify([
      { speaker: 'Me', text: 'Shared the rollout status.' },
      { speaker: 'Them', text: 'Asked for timing confirmation.' },
    ]);

    expect(buildAnalysisTranscriptFromJson(transcriptJson)).toBe(
      'Me: Shared the rollout status.\nThem: Asked for timing confirmation.',
    );
  });

  it('supports transcript objects that store segments', () => {
    const transcriptJson = JSON.stringify({
      segments: [
        { speaker: 1, text: 'Need to close the open blocker.' },
        { text: 'Decision is to ship on Monday.' },
      ],
    });

    expect(buildAnalysisTranscriptFromJson(transcriptJson)).toBe(
      '1: Need to close the open blocker.\nDecision is to ship on Monday.',
    );
  });

  it('retains confident channel attribution and assigns overlapping mic rows to Them', () => {
    const transcriptJson = JSON.stringify({
      speakerAttribution: {
        source: 'channel_fallback',
        confidence: 0,
        diarizationAttempted: false,
        mappingApplied: false,
        fallbackReason: 'diarization_disabled',
      },
      segments: [
        {
          speaker: 'Them',
          startTime: 0,
          endTime: 5,
          text: 'A longer remote sentence from system audio.',
        },
        {
          speaker: 'Me',
          startTime: 1,
          endTime: 2,
          text: 'short echo',
        },
        {
          speaker: 'Me',
          startTime: 6,
          endTime: 9,
          text: 'Do these match the original format?',
        },
        {
          speaker: 'Me',
          startTime: 3,
          endTime: 5,
          text: 'This longer mic row still overlaps remote audio.',
        },
        {
          speaker: 'Me',
          text: 'Timing evidence is missing here.',
        },
        {
          speaker: 'Me',
          startTime: 10,
          endTime: 11,
          text: 'I agree',
        },
      ],
    });

    expect(
      parseTranscriptSegmentsForPresentation(transcriptJson).map(
        (segment) => segment.speaker,
      ),
    ).toEqual(['Them', 'Them', 'Me', 'Them', 'Speaker', 'Speaker']);
    expect(buildAnalysisTranscriptFromJson(transcriptJson)).toBe(
      'Them: A longer remote sentence from system audio.\nThem: short echo\nMe: Do these match the original format?\nThem: This longer mic row still overlaps remote audio.\nSpeaker: Timing evidence is missing here.\nSpeaker: I agree',
    );
  });

  it('neutralizes mic rows covered by several adjacent remote rows', () => {
    const transcriptJson = JSON.stringify({
      speakerAttribution: { mappingApplied: false },
      segments: [
        { speaker: 'Them', startTime: 0, endTime: 2, text: 'First part.' },
        { speaker: 'Them', startTime: 2, endTime: 4, text: 'Second part.' },
        { speaker: 'Them', startTime: 4, endTime: 6, text: 'Third part.' },
        {
          speaker: 'Me',
          startTime: 0,
          endTime: 6,
          text: 'This mic row echoes all three remote rows.',
        },
      ],
    });

    expect(
      parseTranscriptSegmentsForPresentation(transcriptJson).at(-1)?.speaker,
    ).toBe('Them');
  });

  it('uses legacy start and end timing as attribution evidence', () => {
    const transcriptJson = JSON.stringify({
      speakerAttribution: { mappingApplied: false },
      segments: [
        { speaker: 'Them', start: 0, end: 2, text: 'Remote channel row.' },
        {
          speaker: 'Me',
          start: 3,
          end: 5,
          text: 'My separate legacy-timed response.',
        },
      ],
    });

    expect(
      parseTranscriptSegmentsForPresentation(transcriptJson).map(
        (segment) => segment.speaker,
      ),
    ).toEqual(['Them', 'Me']);
  });

  it('does not treat negative timing as confident mic evidence', () => {
    const transcriptJson = JSON.stringify({
      speakerAttribution: { mappingApplied: false },
      segments: [
        {
          speaker: 'Me',
          startTime: -5,
          endTime: -1,
          text: 'Malformed timing cannot prove attribution.',
        },
      ],
    });

    expect(
      parseTranscriptSegmentsForPresentation(transcriptJson)[0]?.speaker,
    ).toBe('Speaker');
  });

  it('drops invalid rows and returns empty for malformed data', () => {
    const transcriptJson = JSON.stringify([
      { speaker: 'Me', text: '  ' },
      { speaker: null, text: 42 },
      { text: 'Valid fallback row.' },
    ]);

    expect(buildAnalysisTranscriptFromJson(transcriptJson)).toBe(
      'Valid fallback row.',
    );
    expect(buildAnalysisTranscriptFromJson('{invalid json')).toBe('');
    expect(buildAnalysisTranscriptFromJson()).toBe('');
  });

  it('builds analysis from a readable projection without rewriting evidence', () => {
    const sourceSegments = [
      {
        id: 'remote-turn',
        speaker: 'Them',
        startTime: 10,
        endTime: 14,
        text: 'Um the rollout is uh ready',
      },
      {
        id: 'letter-artifact',
        speaker: 'Me',
        startTime: 11,
        endTime: 11.1,
        text: 's',
      },
      {
        id: 'letter-artifact-with-filler',
        speaker: 'Me',
        startTime: 12,
        endTime: 12.1,
        text: 'm uh',
      },
      {
        id: 'duplicate',
        speaker: 'Them',
        startTime: 10,
        endTime: 14,
        text: 'Um the rollout is uh ready',
      },
      {
        id: 'acknowledgement',
        speaker: 'Me',
        startTime: 15,
        endTime: 15.4,
        text: 'Okay',
      },
    ];
    const transcriptJson = JSON.stringify({ segments: sourceSegments });

    expect(buildAnalysisTranscriptFromJson(transcriptJson)).toBe(
      'Them: the rollout is ready\nMe: Okay',
    );
    expect(sourceSegments.map((segment) => segment.text)).toEqual([
      'Um the rollout is uh ready',
      's',
      'm uh',
      'Um the rollout is uh ready',
      'Okay',
    ]);
  });
});
