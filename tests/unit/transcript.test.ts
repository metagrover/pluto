import { describe, expect, it } from 'vitest';

import {
  buildAnalysisTranscriptFromJson,
  parseTranscriptSegmentsForPresentation,
} from '../../src/utils/transcript';

describe('buildAnalysisTranscriptFromJson', () => {
  it.each(['validated', 'validating', 'needs_attention'])(
    'keeps finalized recovered text and speakers authoritative during %s',
    (lifecycleStatus) => {
      const transcript = {
        pipelineMode: 'parakeet_final_v1',
        canonicalSource: 'recovered_channels',
        lifecycleStatus,
        speakerAttribution: { source: 'recovered_channel_acoustic_v2' },
        segments: [
          { speaker: 'Me', startTime: 0, endTime: 2, text: 'My update.' },
          {
            speaker: 'Speaker 1',
            startTime: 3,
            endTime: 5,
            text: 'Participant response.',
          },
          {
            speaker: 'Unknown',
            startTime: 6,
            endTime: 8,
            text: 'Uncertain voice.',
          },
        ],
        liveSegments: [
          {
            speaker: 'Local Speaker 2',
            startTime: 0,
            endTime: 2,
            text: 'My update.',
          },
          {
            speaker: 'Me',
            startTime: 3,
            endTime: 5,
            text: 'Participant response.',
          },
          {
            speaker: 'Local Speaker 3',
            startTime: 6,
            endTime: 8,
            text: 'Uncertain voice.',
          },
          {
            speaker: 'Me',
            startTime: 9,
            endTime: 10,
            text: 'Rejected old evidence.',
          },
        ],
      };
      const raw = JSON.stringify(transcript);
      expect(buildAnalysisTranscriptFromJson(raw)).toBe(
        'Me: My update.\nSpeaker 1: Participant response.\nUnknown: Uncertain voice.',
      );
      expect(JSON.stringify(transcript)).toBe(raw);
    },
  );

  it('does not resurrect live speech after an empty final result', () => {
    expect(
      buildAnalysisTranscriptFromJson(
        JSON.stringify({
          pipelineMode: 'parakeet_final_v1',
          canonicalSource: 'recovered_channels',
          lifecycleStatus: 'validated',
          segments: [],
          liveSegments: [
            {
              speaker: 'Local Speaker 1',
              startTime: 0,
              endTime: 2,
              text: 'Rejected speech.',
            },
          ],
        }),
      ),
    ).toBe('');
  });

  it('formats transcript arrays with speaker labels', () => {
    const transcriptJson = JSON.stringify([
      { speaker: 'Me', text: 'Shared the rollout status.' },
      { speaker: 'Them', text: 'Asked for timing confirmation.' },
    ]);

    expect(buildAnalysisTranscriptFromJson(transcriptJson)).toBe(
      'Me: Shared the rollout status.\nThem: Asked for timing confirmation.',
    );
  });

  it('uses only resolved speaker display names in the analysis transcript', () => {
    const transcriptJson = JSON.stringify([
      { speaker: 'Me', text: 'Shared the rollout status.' },
      { speaker: 'Speaker 1', text: 'Asked for timing confirmation.' },
      { speaker: 'Speaker 2', text: 'Raised an unresolved risk.' },
    ]);

    expect(
      buildAnalysisTranscriptFromJson(transcriptJson, {
        speakerDisplayNames: {
          Me: 'Punit Grover',
          'Speaker 1': 'Alice',
        },
      }),
    ).toBe(
      'Punit Grover: Shared the rollout status.\nAlice: Asked for timing confirmation.\nSpeaker 2: Raised an unresolved risk.',
    );
  });

  it('keeps a resolved self name when channel fallback would anonymize Me', () => {
    const transcriptJson = JSON.stringify({
      speakerAttribution: {
        source: 'channel_fallback',
        confidence: 0,
        diarizationAttempted: false,
        mappingApplied: false,
        fallbackReason: 'missing_diarization_audio',
      },
      segments: [
        { speaker: 'Me', text: 'Preparing my daily update.' },
        { speaker: 'Speaker 1', text: 'An unidentified participant replied.' },
      ],
    });

    expect(
      buildAnalysisTranscriptFromJson(transcriptJson, {
        speakerDisplayNames: { Me: 'Punit Grover' },
      }),
    ).toBe(
      'Punit Grover: Preparing my daily update.\nSpeaker: An unidentified participant replied.',
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
      'Speaker: Need to close the open blocker.\nSpeaker: Decision is to ship on Monday.',
    );
  });

  it('retains source labels and neutralizes unverified overlapping mic rows', () => {
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
    ).toEqual(['Them', 'Speaker', 'Me', 'Speaker', 'Speaker', 'Speaker']);
    expect(buildAnalysisTranscriptFromJson(transcriptJson)).toBe(
      'Them: A longer remote sentence from system audio.\nSpeaker: Short echo.\nMe: Do these match the original format?\nSpeaker: This longer mic row still overlaps remote audio.\nSpeaker: Timing evidence is missing here.\nSpeaker: I agree.',
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
    ).toBe('Speaker');
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
      'Speaker: Valid fallback row.',
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
      'Them: The rollout is ready.\nMe: Okay.',
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
