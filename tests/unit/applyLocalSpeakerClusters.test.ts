import { describe, expect, it } from 'vitest';

import { applyLocalSpeakerClusters } from '../../src/services/finalTranscription/applyLocalSpeakerClusters';

describe('applyLocalSpeakerClusters', () => {
  it('projects multiple microphone clusters to deterministic anonymous labels', () => {
    const result = applyLocalSpeakerClusters({
      segments: [
        { startTime: 0, endTime: 2, speaker: 'Me', text: 'first voice' },
        { startTime: 2, endTime: 4, speaker: 'Me', text: 'second voice' },
        { startTime: 5, endTime: 7, speaker: 'Them', text: 'system voice' },
      ],
      turns: [
        { startTime: 2, endTime: 4, cluster: 'speaker-z' },
        { startTime: 0, endTime: 2, cluster: 'speaker-a' },
      ],
    });

    expect(result).toMatchObject({
      applied: true,
      multipleSpeakers: true,
      confidence: 1,
      clusterCount: 2,
      labeledSegmentCount: 2,
    });
    expect(result.segments.map((segment) => segment.speaker)).toEqual([
      'Local Speaker 1',
      'Local Speaker 2',
      'Them',
    ]);
  });

  it('splits timed microphone words at cluster boundaries', () => {
    const result = applyLocalSpeakerClusters({
      segments: [
        {
          startTime: 0,
          endTime: 4,
          speaker: 'Me',
          text: 'one voice two voice',
          words: [
            { word: 'one', start: 0, end: 1 },
            { word: 'voice', start: 1, end: 2 },
            { word: 'two', start: 2, end: 3 },
            { word: 'voice', start: 3, end: 4 },
          ],
        },
      ],
      turns: [
        { startTime: 0, endTime: 2, cluster: 'a' },
        { startTime: 2, endTime: 4, cluster: 'b' },
      ],
    });

    expect(result.segments).toEqual([
      expect.objectContaining({
        speaker: 'Local Speaker 1',
        text: 'one voice',
        startTime: 0,
        endTime: 2,
      }),
      expect.objectContaining({
        speaker: 'Local Speaker 2',
        text: 'two voice',
        startTime: 2,
        endTime: 4,
      }),
    ]);
  });

  it('bridges a diarization gap only when the containing segment has one supported cluster', () => {
    const result = applyLocalSpeakerClusters({
      segments: [
        {
          startTime: 0,
          endTime: 3,
          speaker: 'Me',
          text: 'before brief gap after',
          words: [
            { word: 'before', start: 0, end: 1 },
            { word: 'brief gap', start: 1, end: 2 },
            { word: 'after', start: 2, end: 3 },
          ],
        },
        { startTime: 3, endTime: 4, speaker: 'Me', text: 'other voice' },
      ],
      turns: [
        { startTime: 0, endTime: 1, cluster: 'a' },
        { startTime: 2, endTime: 3, cluster: 'a' },
        { startTime: 3, endTime: 4, cluster: 'b' },
      ],
    });

    expect(result.applied).toBe(true);
    expect(result.segments[0]).toMatchObject({
      speaker: 'Local Speaker 1',
      text: 'before brief gap after',
    });
  });

  it('keeps a diarization gap unknown between different supported clusters', () => {
    const result = applyLocalSpeakerClusters({
      segments: [
        {
          startTime: 0,
          endTime: 3,
          speaker: 'Me',
          text: 'first gap second',
          words: [
            { word: 'first', start: 0, end: 1 },
            { word: 'gap', start: 1, end: 1.1 },
            { word: 'second', start: 1.1, end: 3 },
          ],
        },
        { startTime: 3, endTime: 4, speaker: 'Me', text: 'first again' },
      ],
      turns: [
        { startTime: 0, endTime: 1, cluster: 'a' },
        { startTime: 1.1, endTime: 3, cluster: 'b' },
        { startTime: 3, endTime: 4, cluster: 'a' },
      ],
    });

    expect(result.applied).toBe(true);
    expect(result.segments.map((segment) => segment.speaker)).toEqual([
      'Local Speaker 1',
      'Unknown',
      'Local Speaker 2',
      'Local Speaker 1',
    ]);
  });

  it('fails closed when multiple clusters do not cover enough microphone speech', () => {
    const result = applyLocalSpeakerClusters({
      segments: [
        { startTime: 0, endTime: 10, speaker: 'Me', text: 'long speech' },
      ],
      turns: [
        { startTime: 0, endTime: 1, cluster: 'a' },
        { startTime: 1, endTime: 2, cluster: 'b' },
      ],
    });

    expect(result).toMatchObject({
      applied: false,
      multipleSpeakers: true,
      confidence: 0,
      clusterCount: 2,
    });
    expect(result.segments[0]?.speaker).toBe('Unknown');
  });

  it('leaves the compatible single-microphone-speaker path unchanged', () => {
    const segment = {
      startTime: 0,
      endTime: 3,
      speaker: 'Me',
      text: 'only voice',
    };
    const result = applyLocalSpeakerClusters({
      segments: [segment],
      turns: [{ startTime: 0, endTime: 3, cluster: 'a' }],
    });

    expect(result.multipleSpeakers).toBe(false);
    expect(result.applied).toBe(false);
    expect(result.segments).toEqual([segment]);
  });
});
