import { describe, expect, it } from 'vitest';
import { applyRemoteSpeakerClusters } from '../../src/services/finalTranscription/applyRemoteSpeakerClusters';

const evidence = (cluster: string) => ({
  cluster,
  embedding: Array(256).fill(0.1),
  cleanChunkCount: 1,
  cleanSegmentCount: 1,
  cleanDurationSeconds: 1.1,
  minimumChunkSimilarity: 1,
  meanChunkSimilarity: 1,
});
const segments = [
  { speaker: 'Me', startTime: 0, endTime: 1, text: 'Local speech' },
  { speaker: 'Them', startTime: 2, endTime: 12, text: 'Main remote speech' },
  { speaker: 'Them', startTime: 13, endTime: 14.1, text: 'Brief response' },
];
const turns = [
  { cluster: 'S1', startTime: 2, endTime: 12 },
  { cluster: 'S2', startTime: 13, endTime: 14.1 },
];

describe('remote speaker acoustic evidence gate', () => {
  it('withholds an unsupported extra cluster without deleting text or assigning it to someone else', () => {
    const result = applyRemoteSpeakerClusters({
      segments,
      turns,
      clusterEvidence: [evidence('S1')],
    });
    expect(result.segments.map((s) => s.speaker)).toEqual([
      'Me',
      'Remote Speaker 1',
      'Unknown',
    ]);
    expect(result.segments.map((s) => s.text)).toEqual(
      segments.map((s) => s.text),
    );
    expect(result.metadata.unsupportedClusters).toEqual([
      {
        cluster: 'S2',
        label: 'Remote Speaker 2',
        intervals: [{ startTime: 13, endTime: 14.1 }],
      },
    ]);
    expect(result.metadata.clusterCount).toBe(1);
    expect(result.metadata.labeledSegmentCount).toBe(1);
    expect(segments[2].speaker).toBe('Them');
  });

  it('retains a genuine brief speaker with one clean chunk, below enrollment requirements', () => {
    const result = applyRemoteSpeakerClusters({
      segments,
      turns,
      clusterEvidence: [evidence('S1'), evidence('S2')],
    });
    expect(result.segments[2].speaker).toBe('Remote Speaker 2');
    expect(result.metadata.clusterCount).toBe(2);
    expect(result.metadata.unsupportedClusters).toBeUndefined();
  });

  it.each([undefined, []])(
    'does not infer rejection when native acoustic evidence is unavailable: %s',
    (clusterEvidence) => {
      const result = applyRemoteSpeakerClusters({
        segments,
        turns,
        clusterEvidence,
      });
      expect(result.segments[2].speaker).toBe('Remote Speaker 2');
    },
  );

  it('keeps overlapping supported voices unresolved', () => {
    const result = applyRemoteSpeakerClusters({
      segments,
      turns: [...turns, { cluster: 'S1', startTime: 13, endTime: 14.1 }],
      clusterEvidence: [evidence('S1'), evidence('S2')],
    });
    expect(result.segments[2].speaker).toBe('Them');
  });
});
