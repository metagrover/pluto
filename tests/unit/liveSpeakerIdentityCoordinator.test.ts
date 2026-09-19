import { describe, expect, it, vi } from 'vitest';
import { LiveSpeakerIdentityCoordinator } from '../../electron/liveSpeakerIdentityCoordinator';
import { DEFAULT_CALIBRATION_POLICY_V1 } from '../../src/services/speakerVoiceMatcher';

const vector = (index: number) =>
  Array.from({ length: 256 }, (_, current) => (current === index ? 1 : 0));

const evidence = (embedding = vector(0)) => ({
  turns: [{ startTime: 4, endTime: 8, cluster: 'speaker-a' }],
  energyWindows: [{ startTime: 4, endTime: 8, micRms: 0, systemRms: 0.2 }],
  provenance: {
    ...DEFAULT_CALIBRATION_POLICY_V1.compatibilityKey,
  },
  timings: { diarizationMs: 10, energyAnalysisMs: 1, totalMs: 11 },
  windowSeconds: 0.1,
  clusterEvidence: [
    {
      cluster: 'speaker-a',
      embedding,
      representativeEmbeddings: [embedding, embedding],
      cleanChunkCount: 3,
      cleanSegmentCount: 2,
      cleanDurationSeconds: 4,
      minimumChunkSimilarity: 0.9,
      meanChunkSimilarity: 0.95,
    },
  ],
});

describe('LiveSpeakerIdentityCoordinator', () => {
  const setup = () => {
    const persistConfirmation = vi.fn();
    const removeConfirmation = vi.fn();
    const coordinator = new LiveSpeakerIdentityCoordinator({
      getProfiles: () => [
        {
          canonicalPersonId: 'person-alex',
          personName: 'Alex',
          sampleCount: 2,
          cleanDurationSeconds: 12,
          isActive: true,
          embedding: vector(0),
          representativeEmbeddings: [vector(0), vector(0)],
          provenance: { ...DEFAULT_CALIBRATION_POLICY_V1.compatibilityKey },
        },
      ],
      getRejections: () => [],
      persistConfirmation,
      removeConfirmation,
    });
    coordinator.start('meeting-1', 1);
    return { coordinator, persistConfirmation, removeConfirmation };
  };

  it('requires two consecutive compatible revisions before naming a person', () => {
    const { coordinator } = setup();
    expect(coordinator.applyEvidence(evidence()).hints).toEqual([]);
    const second = coordinator.applyEvidence(evidence());
    expect(second.hints).toEqual([
      expect.objectContaining({
        displayLabel: 'Likely Alex',
        state: 'suggested',
        ranges: [{ startMs: 4_000, endMs: 8_000 }],
      }),
    ]);
    expect(JSON.stringify(second)).not.toContain('person-alex');
    expect(JSON.stringify(second)).not.toContain('embedding');
  });

  it('persists confirmation, supports rejection undo, and never oscillates to a weak candidate', () => {
    const { coordinator, persistConfirmation, removeConfirmation } = setup();
    coordinator.applyEvidence(evidence());
    const suggestion = coordinator.applyEvidence(evidence()).hints[0]!;

    const confirmed = coordinator.act(suggestion.suggestionId, 'confirm');
    expect(confirmed.hints[0]).toMatchObject({
      displayLabel: 'Alex',
      state: 'confirmed',
    });
    expect(persistConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({ personId: 'person-alex' }),
    );

    const restored = coordinator.act(suggestion.suggestionId, 'restore');
    expect(restored.hints[0]).toMatchObject({
      displayLabel: 'Likely Alex',
      state: 'suggested',
    });
    expect(removeConfirmation).toHaveBeenCalled();

    const rejected = coordinator.act(suggestion.suggestionId, 'reject');
    expect(rejected.hints[0].state).toBe('rejected');
    expect(coordinator.applyEvidence(evidence(vector(1))).hints[0].state).toBe(
      'rejected',
    );
  });
});
