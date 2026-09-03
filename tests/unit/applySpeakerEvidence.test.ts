import { describe, expect, it } from 'vitest';

import { applySpeakerEvidence } from '../../src/services/finalTranscription/applySpeakerEvidence';

const provenance = {
  modelIdentifier: 'speaker-diarization-offline-v1',
  modelRevision: 'a'.repeat(40),
  artifactDigest: 'b'.repeat(64),
  runtimeVersion: 'fluidaudio-test',
};

describe('applySpeakerEvidence', () => {
  it('replaces channel labels with acoustically mapped anonymous clusters', () => {
    const result = applySpeakerEvidence({
      segments: [
        { startTime: 0, endTime: 2, speaker: 'Them', text: 'local words' },
        { startTime: 2, endTime: 4, speaker: 'Me', text: 'remote words' },
      ],
      evidence: {
        turns: [
          { startTime: 0, endTime: 2, cluster: 'S1' },
          { startTime: 2, endTime: 4, cluster: 'S2' },
        ],
        energyWindows: [
          { startTime: 0, endTime: 2, micRms: 0.03, systemRms: 0.001 },
          { startTime: 2, endTime: 4, micRms: 0.001, systemRms: 0.02 },
        ],
        provenance,
        timings: { diarizationMs: 10, energyAnalysisMs: 2, totalMs: 12 },
        windowSeconds: 0.1,
      },
    });

    expect(result.accepted).toBe(true);
    expect(result.segments.map((segment) => segment.speaker)).toEqual([
      'Me',
      'Them',
    ]);
    expect(result.attribution).toMatchObject({
      source: 'offline_diarization_acoustic_v1',
      diarizationAttempted: true,
      mappingApplied: true,
      confidence: 1,
      falseMeEvidenceSeconds: 0,
      missedMeEvidenceSeconds: 0,
    });
  });

  it('labels unsupported cluster coverage Unknown instead of retaining channel identity', () => {
    const result = applySpeakerEvidence({
      segments: [
        { startTime: 0, endTime: 2, speaker: 'Me', text: 'local' },
        { startTime: 2, endTime: 4, speaker: 'Them', text: 'remote' },
        { startTime: 4, endTime: 5, speaker: 'Me', text: 'unsupported' },
      ],
      evidence: {
        turns: [
          { startTime: 0, endTime: 2, cluster: 'S1' },
          { startTime: 2, endTime: 4, cluster: 'S2' },
          { startTime: 4, endTime: 5, cluster: 'S3' },
        ],
        energyWindows: [
          { startTime: 0, endTime: 2, micRms: 0.03, systemRms: 0 },
          { startTime: 2, endTime: 4, micRms: 0, systemRms: 0.02 },
        ],
        provenance,
        timings: { diarizationMs: 10, energyAnalysisMs: 2, totalMs: 12 },
        windowSeconds: 0.1,
      },
    });

    expect(result.accepted).toBe(true);
    expect(result.segments.at(-1)?.speaker).toBe('Unknown');
  });

  it('rejects any acoustically contradicted Me mapping', () => {
    const result = applySpeakerEvidence({
      segments: [{ startTime: 0, endTime: 2, speaker: 'Me', text: 'words' }],
      evidence: {
        turns: [{ startTime: 0, endTime: 2, cluster: 'S1' }],
        energyWindows: [
          { startTime: 0, endTime: 1.5, micRms: 0.03, systemRms: 0 },
          { startTime: 1.5, endTime: 2, micRms: 0, systemRms: 0.02 },
        ],
        provenance,
        timings: { diarizationMs: 10, energyAnalysisMs: 2, totalMs: 12 },
        windowSeconds: 0.1,
      },
    });

    expect(result.accepted).toBe(false);
    expect(result.reasons).toContain('false_me_evidence');
    expect(result.attribution.mappingApplied).toBe(false);
  });

  it('restores a short mic-exclusive interruption omitted by diarization', () => {
    const result = applySpeakerEvidence({
      segments: [
        { startTime: 0, endTime: 2, speaker: 'Me', text: 'local' },
        { startTime: 2, endTime: 4, speaker: 'Them', text: 'remote' },
        { startTime: 4, endTime: 4.5, speaker: 'Them', text: 'interruption' },
      ],
      evidence: {
        turns: [
          { startTime: 0, endTime: 2, cluster: 'S1' },
          { startTime: 2, endTime: 4, cluster: 'S2' },
        ],
        energyWindows: [
          { startTime: 0, endTime: 2, micRms: 0.03, systemRms: 0 },
          { startTime: 2, endTime: 4, micRms: 0, systemRms: 0.02 },
          { startTime: 4, endTime: 4.5, micRms: 0.03, systemRms: 0 },
        ],
        provenance,
        timings: { diarizationMs: 10, energyAnalysisMs: 2, totalMs: 12 },
        windowSeconds: 0.1,
      },
    });

    expect(result.accepted).toBe(true);
    expect(result.segments.at(-1)?.speaker).toBe('Me');
    expect(result.attribution.injectedLocalWindows).toBe(1);
  });
});
