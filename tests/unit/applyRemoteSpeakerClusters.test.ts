import { describe, expect, it } from 'vitest';

import { applyRemoteSpeakerClusters } from '../../src/services/finalTranscription/applyRemoteSpeakerClusters';

const words = (items: Array<[string, number, number]>) =>
  items.map(([word, start, end]) => ({ word, start, end }));

describe('applyRemoteSpeakerClusters', () => {
  it('numbers supported system clusters by first appearance and splits on word bounds', () => {
    const result = applyRemoteSpeakerClusters({
      segments: [
        {
          startTime: 0,
          endTime: 4,
          speaker: 'Them',
          text: 'hello there yes agreed',
          words: words([
            ['hello', 0, 0.8],
            ['there', 0.8, 1.8],
            ['yes', 2.1, 2.8],
            ['agreed', 2.8, 4],
          ]),
        },
      ],
      turns: [
        { startTime: 0, endTime: 1.9, cluster: 'z-cluster' },
        { startTime: 2, endTime: 4, cluster: 'a-cluster' },
      ],
    });

    expect(result.applied).toBe(true);
    expect(result.segments.map((segment) => segment.speaker)).toEqual([
      'Remote Speaker 1',
      'Remote Speaker 2',
    ]);
    expect(result.segments.map((segment) => segment.text)).toEqual([
      'hello there',
      'yes agreed',
    ]);
    expect(result.metadata).toMatchObject({
      attempted: true,
      input: 'system_audio',
      applied: true,
      confidence: 1,
      clusterCount: 2,
      labeledSegmentCount: 2,
    });
  });

  it('never relabels Me or Unknown segments, including simultaneous speech', () => {
    const input = [
      { startTime: 0, endTime: 2, speaker: 'Me', text: 'local' },
      { startTime: 2, endTime: 4, speaker: 'Unknown', text: 'overlap' },
      { startTime: 4, endTime: 6, speaker: 'Them', text: 'remote one' },
      { startTime: 6, endTime: 8, speaker: 'Them', text: 'remote two' },
    ];
    const result = applyRemoteSpeakerClusters({
      segments: input,
      turns: [
        { startTime: 0, endTime: 2, cluster: 'S3' },
        { startTime: 2, endTime: 4, cluster: 'S2' },
        { startTime: 4, endTime: 6, cluster: 'S1' },
        { startTime: 6, endTime: 8, cluster: 'S2' },
      ],
    });

    expect(result.segments[0].speaker).toBe('Me');
    expect(result.segments[1].speaker).toBe('Unknown');
    expect(result.segments.slice(2).map((segment) => segment.speaker)).toEqual([
      'Remote Speaker 1',
      'Remote Speaker 2',
    ]);
  });

  it('suppresses a sub-second phantom cluster instead of creating another speaker', () => {
    const result = applyRemoteSpeakerClusters({
      segments: [
        { startTime: 0, endTime: 2, speaker: 'Them', text: 'first speaker' },
        { startTime: 2, endTime: 2.5, speaker: 'Them', text: 'yeah' },
        { startTime: 2.5, endTime: 5, speaker: 'Them', text: 'second speaker' },
      ],
      turns: [
        { startTime: 0, endTime: 2, cluster: 'S1' },
        { startTime: 2, endTime: 2.5, cluster: 'phantom' },
        { startTime: 2.5, endTime: 5, cluster: 'S2' },
      ],
    });

    expect(result.applied).toBe(true);
    expect(result.metadata.clusterCount).toBe(2);
    expect(result.segments.map((segment) => segment.speaker)).toEqual([
      'Remote Speaker 1',
      'Them',
      'Remote Speaker 2',
    ]);
  });

  it('smooths a sub-second phantom between established turns from the same speaker', () => {
    const result = applyRemoteSpeakerClusters({
      segments: [
        { startTime: 0, endTime: 2, speaker: 'Them', text: 'opening' },
        { startTime: 2, endTime: 2.5, speaker: 'Them', text: 'yeah' },
        { startTime: 2.5, endTime: 4, speaker: 'Them', text: 'continuing' },
        { startTime: 4, endTime: 6, speaker: 'Them', text: 'reply' },
      ],
      turns: [
        { startTime: 0, endTime: 2, cluster: 'S1' },
        { startTime: 2, endTime: 2.5, cluster: 'phantom' },
        { startTime: 2.5, endTime: 4, cluster: 'S1' },
        { startTime: 4, endTime: 6, cluster: 'S2' },
      ],
    });

    expect(result.applied).toBe(true);
    expect(result.segments.map((segment) => segment.speaker)).toEqual([
      'Remote Speaker 1',
      'Remote Speaker 1',
      'Remote Speaker 1',
      'Remote Speaker 2',
    ]);
  });

  it('keeps a genuinely overlapping remote word anonymous', () => {
    const result = applyRemoteSpeakerClusters({
      segments: [
        {
          startTime: 0,
          endTime: 5,
          speaker: 'Them',
          text: 'one two overlap three four',
          words: words([
            ['one', 0, 1],
            ['two', 1, 2],
            ['overlap', 2, 3],
            ['three', 3, 4],
            ['four', 4, 5],
          ]),
        },
      ],
      turns: [
        { startTime: 0, endTime: 3, cluster: 'S1' },
        { startTime: 2, endTime: 5, cluster: 'S2' },
      ],
    });

    expect(result.applied).toBe(true);
    expect(result.metadata.confidence).toBe(0.8);
    expect(result.segments.map((segment) => segment.speaker)).toEqual([
      'Remote Speaker 1',
      'Them',
      'Remote Speaker 2',
    ]);
  });

  it('keeps an unequally overlapped remote word anonymous', () => {
    const result = applyRemoteSpeakerClusters({
      segments: [
        {
          startTime: 0,
          endTime: 5,
          speaker: 'Them',
          text: 'one two overlap three four',
          words: words([
            ['one', 0, 1],
            ['two', 1, 2],
            ['overlap', 2, 3],
            ['three', 3, 4],
            ['four', 4, 5],
          ]),
        },
      ],
      turns: [
        { startTime: 0, endTime: 3, cluster: 'S1' },
        { startTime: 2.4, endTime: 5, cluster: 'S2' },
      ],
    });

    expect(result.applied).toBe(true);
    expect(result.metadata.confidence).toBe(0.8);
    expect(result.segments.map((segment) => segment.speaker)).toEqual([
      'Remote Speaker 1',
      'Them',
      'Remote Speaker 2',
    ]);
  });

  it('preserves standalone punctuation while splitting word groups', () => {
    const result = applyRemoteSpeakerClusters({
      segments: [
        {
          startTime: 0,
          endTime: 4,
          speaker: 'Them',
          text: 'Hello, world. Yes!',
          words: words([
            ['Hello', 0, 0.8],
            [',', 0.8, 0.8],
            ['world', 0.9, 1.7],
            ['.', 1.7, 1.7],
            ['Yes', 2.1, 3.8],
            ['!', 3.8, 3.8],
          ]),
        },
      ],
      turns: [
        { startTime: 0, endTime: 1.9, cluster: 'S1' },
        { startTime: 2, endTime: 4, cluster: 'S2' },
      ],
    });

    expect(result.segments.map((segment) => segment.text)).toEqual([
      'Hello, world.',
      'Yes!',
    ]);
  });

  it('falls back to Them when supported coverage is below the trust threshold', () => {
    const result = applyRemoteSpeakerClusters({
      segments: [
        { startTime: 0, endTime: 4, speaker: 'Them', text: 'long first turn' },
        { startTime: 4, endTime: 8, speaker: 'Them', text: 'long second turn' },
      ],
      turns: [
        { startTime: 0, endTime: 1.1, cluster: 'S1' },
        { startTime: 4, endTime: 5.1, cluster: 'S2' },
      ],
    });

    expect(result.applied).toBe(false);
    expect(result.segments.map((segment) => segment.speaker)).toEqual([
      'Them',
      'Them',
    ]);
    expect(result.metadata).toMatchObject({
      attempted: true,
      applied: false,
      fallbackReason: 'low_coverage',
    });
  });

  it('falls back to Them for a single established remote speaker', () => {
    const result = applyRemoteSpeakerClusters({
      segments: [
        { startTime: 0, endTime: 3, speaker: 'Them', text: 'only speaker' },
      ],
      turns: [{ startTime: 0, endTime: 3, cluster: 'S1' }],
    });

    expect(result.applied).toBe(false);
    expect(result.metadata.fallbackReason).toBe('not_enough_speakers');
    expect(result.segments[0].speaker).toBe('Them');
  });
  const paddedSpeech = () => ({
    segments: [
      {
        startTime: 0,
        endTime: 6,
        speaker: 'Them',
        text: 'First ending',
        words: words([
          ['First', 0, 1.2],
          ['ending', 1.2, 6],
        ]),
      },
      {
        startTime: 6,
        endTime: 10,
        speaker: 'Them',
        text: 'Second ending',
        words: words([
          ['Second', 6, 7.2],
          ['ending', 7.2, 10],
        ]),
      },
    ],
    turns: [
      { startTime: 0, endTime: 1.8, cluster: 'S1' },
      { startTime: 6, endTime: 7.8, cluster: 'S2' },
    ],
    systemEnergyWindows: [
      { startTime: 0, endTime: 1.8, systemRms: 0.1 },
      { startTime: 1.8, endTime: 6, systemRms: 0 },
      { startTime: 6, endTime: 7.8, systemRms: 0.1 },
      { startTime: 7.8, endTime: 10, systemRms: 0 },
    ],
  });

  it('excludes independently confirmed silence from padded word duration without changing raw timings', () => {
    const input = paddedSpeech();
    const before = structuredClone(input);
    const result = applyRemoteSpeakerClusters(input);
    expect(result.applied).toBe(true);
    expect(result.metadata.confidence).toBe(1);
    expect(result.segments.map((s) => s.speaker)).toEqual([
      'Remote Speaker 1',
      'Remote Speaker 2',
    ]);
    expect(result.segments.flatMap((s) => s.words)).toEqual(
      input.segments.flatMap((s) => s.words),
    );
    expect(input).toEqual(before);
  });

  it('counts audible unclustered speech even when it is quiet', () => {
    const input = paddedSpeech();
    input.systemEnergyWindows[1].systemRms = 0.000001;
    input.systemEnergyWindows[3].systemRms = 0.000001;
    expect(applyRemoteSpeakerClusters(input).metadata.fallbackReason).toBe(
      'low_coverage',
    );
  });

  it.each(['missing', 'gap', 'invalid', 'overlap'] as const)(
    'does not infer silence from %s energy evidence',
    (kind) => {
      const input = paddedSpeech();
      if (kind === 'missing') input.systemEnergyWindows = [];
      if (kind === 'gap') input.systemEnergyWindows.splice(1, 1);
      if (kind === 'invalid')
        input.systemEnergyWindows[1].systemRms = Number.NaN;
      if (kind === 'overlap') input.systemEnergyWindows[1].startTime = 0;
      expect(applyRemoteSpeakerClusters(input).applied).toBe(false);
    },
  );

  it('keeps a word spanning two remote speakers anonymous after silence trimming', () => {
    const input = paddedSpeech();
    input.segments = [
      {
        startTime: 0,
        endTime: 10,
        speaker: 'Them',
        text: 'uncertain',
        words: words([['uncertain', 0, 10]]),
      },
    ];
    expect(applyRemoteSpeakerClusters(input).applied).toBe(false);
  });

  it('allows one frame of boundary disagreement only with independent non-silent support', () => {
    const input = paddedSpeech();
    input.segments[0].words = words([
      ['A', 0, 0.12],
      ['first', 0.12, 1.2],
      ['ending', 1.2, 6],
    ]);
    input.segments[0].text = 'A first ending';
    input.turns[0].startTime = 0.13;
    const result = applyRemoteSpeakerClusters(input);
    expect(result.applied).toBe(true);
    expect(result.segments[0].text).toBe('A first ending');
    expect(result.segments[0].speaker).toBe('Remote Speaker 1');
  });
  it('does not double count intersecting boundary padding from the same speaker', () => {
    const result = applyRemoteSpeakerClusters({
      segments: [
        { startTime: 0, endTime: 0.7, speaker: 'Them', text: 'uncertain' },
        { startTime: 1, endTime: 2, speaker: 'Them', text: 'first speaker' },
        { startTime: 3, endTime: 4, speaker: 'Them', text: 'second speaker' },
      ],
      turns: [
        { startTime: 0, endTime: 0.1, cluster: 'S1' },
        { startTime: 0.11, endTime: 0.2, cluster: 'S1' },
        { startTime: 1, endTime: 2, cluster: 'S1' },
        { startTime: 3, endTime: 4, cluster: 'S2' },
      ],
      systemEnergyWindows: [{ startTime: 0, endTime: 4, systemRms: 0.1 }],
    });
    // Expanded S1 turns cover only 0.3 of the 0.7 second item, not 0.49.
    expect(result.applied).toBe(false);
    expect(result.metadata.fallbackReason).toBe('low_coverage');
    expect(result.metadata.confidence).toBe(0.741);
  });

  it('does not assign a speaker to words contradicted by entirely silent measured audio', () => {
    const input = paddedSpeech();
    input.systemEnergyWindows.forEach((window) => {
      window.systemRms = 0;
    });
    input.turns[0].endTime = 6;
    input.turns[1].endTime = 10;
    expect(applyRemoteSpeakerClusters(input).applied).toBe(false);
  });

  it('single remote speaker meeting retains Them in transcript while producing Them candidate', () => {
    const dummyProvenance = {
      modelIdentifier: 'speaker-diarization-offline-v1',
      modelRevision: 'a'.repeat(40),
      artifactDigest: 'b'.repeat(64),
      runtimeVersion: 'fluidaudio-test',
      profileAlgorithmVersion: 'v1',
    };
    const embedding = new Array(256).fill(0.1);
    const result = applyRemoteSpeakerClusters({
      segments: [
        {
          startTime: 0,
          endTime: 4,
          speaker: 'Them',
          text: 'single remote speaker meeting',
          words: words([
            ['single', 0, 1],
            ['remote', 1, 2],
            ['speaker', 2, 3],
            ['meeting', 3, 4],
          ]),
        },
      ],
      turns: [{ startTime: 0, endTime: 4, cluster: 'S1' }],
      clusterEvidence: [
        {
          cluster: 'S1',
          embedding,
          cleanChunkCount: 3,
          cleanSegmentCount: 2,
          cleanDurationSeconds: 4.0,
          minimumChunkSimilarity: 0.85,
          meanChunkSimilarity: 0.9,
        },
      ],
      provenance: dummyProvenance,
    });

    expect(result.applied).toBe(false);
    expect(result.metadata.fallbackReason).toBe('not_enough_speakers');
    expect(result.segments[0].speaker).toBe('Them');
    expect(result.candidateEvidence).toHaveLength(1);
    expect(result.candidateEvidence?.[0].speaker).toBe('Them');
    expect(result.candidateEvidence?.[0].nativeCluster).toBe('S1');
    expect(result.candidateEvidence?.[0].isEligibleForEnrollment).toBe(true);
    expect(result.candidateEvidence?.[0].candidateDigest).toHaveLength(64);
  });

  it('multi-speaker meeting maps candidate evidence to Remote Speaker 1 and 2', () => {
    const dummyProvenance = {
      modelIdentifier: 'speaker-diarization-offline-v1',
      modelRevision: 'a'.repeat(40),
      artifactDigest: 'b'.repeat(64),
      runtimeVersion: 'fluidaudio-test',
      profileAlgorithmVersion: 'v1',
    };
    const embedding = new Array(256).fill(0.1);
    const result = applyRemoteSpeakerClusters({
      segments: [
        {
          startTime: 0,
          endTime: 4,
          speaker: 'Them',
          text: 'hello there yes agreed',
          words: words([
            ['hello', 0, 0.8],
            ['there', 0.8, 1.8],
            ['yes', 2.1, 2.8],
            ['agreed', 2.8, 4],
          ]),
        },
      ],
      turns: [
        { startTime: 0, endTime: 1.9, cluster: 'S1' },
        { startTime: 2, endTime: 4, cluster: 'S2' },
      ],
      clusterEvidence: [
        {
          cluster: 'S1',
          embedding,
          cleanChunkCount: 3,
          cleanSegmentCount: 2,
          cleanDurationSeconds: 3.5,
          minimumChunkSimilarity: 0.85,
          meanChunkSimilarity: 0.9,
        },
        {
          cluster: 'S2',
          embedding,
          cleanChunkCount: 2,
          cleanSegmentCount: 2,
          cleanDurationSeconds: 3.0,
          minimumChunkSimilarity: 0.75,
          meanChunkSimilarity: 0.8,
        },
      ],
      provenance: dummyProvenance,
    });

    expect(result.applied).toBe(true);
    expect(result.candidateEvidence).toHaveLength(2);
    expect(result.candidateEvidence?.map((c) => c.speaker)).toEqual([
      'Remote Speaker 1',
      'Remote Speaker 2',
    ]);
  });
});
