import { describe, expect, it, vi } from 'vitest';

import { createLiveMeetingContextCoordinator } from '../../electron/intelligence/liveMeetingContextCoordinator';
import type { LiveMeetingContextCheckpointV1 } from '../../src/types/meetingContext';

const checkpoint = (): LiveMeetingContextCheckpointV1 => ({
  schemaVersion: 1,
  meetingId: 'meeting-1',
  updatedThrough: { segmentId: 'old', timestampMs: 1_000 },
  segments: [
    {
      id: 'old',
      speaker: 'Avery',
      text: 'The earlier pricing discussion.',
      timestampMs: 1_000,
      confirmed: true,
    },
  ],
  generatedAt: '2026-09-10T10:00:00.000Z',
});

describe('live meeting context coordinator', () => {
  it('hydrates once and checkpoints new confirmed evidence', () => {
    let now = 100_000;
    const loadCheckpoint = vi.fn(() => checkpoint());
    const saveCheckpoint = vi.fn();
    const coordinator = createLiveMeetingContextCoordinator({
      loadCheckpoint,
      saveCheckpoint,
      deleteCheckpoint: vi.fn(),
      now: () => now,
      checkpointIntervalMs: 5_000,
      checkpointSegmentInterval: 10,
    });

    coordinator.ingest('meeting-1', [
      {
        id: 'new',
        speaker: 'Riley',
        text: 'We decided to launch Friday.',
        timestampMs: 2_000,
        confirmed: true,
      },
    ]);
    expect(loadCheckpoint).toHaveBeenCalledOnce();
    expect(saveCheckpoint).not.toHaveBeenCalled();

    now += 5_000;
    coordinator.ingest('meeting-1', [
      {
        id: 'newer',
        speaker: 'Riley',
        text: 'The rollout owner is Avery.',
        timestampMs: 3_000,
        confirmed: true,
      },
    ]);
    expect(saveCheckpoint).toHaveBeenCalledOnce();
    expect(saveCheckpoint.mock.calls[0][0].segments).toHaveLength(3);

    coordinator.select('meeting-1', 'What did we decide?');
    expect(loadCheckpoint).toHaveBeenCalledOnce();
  });

  it('forwards the user intent separately from retrieval hints after hydration', () => {
    const coordinator = createLiveMeetingContextCoordinator({
      loadCheckpoint: checkpoint,
      saveCheckpoint: vi.fn(),
      deleteCheckpoint: vi.fn(),
    });
    const selected = coordinator.select(
      'meeting-1',
      'What did Avery say about pricing? A follow-up was promised.',
      2,
      'What did Avery say about pricing?',
    );
    expect(selected.intent).toBe('speaker_recall');
    expect(selected.segments.map(({ id }) => id)).toContain('old');
  });

  it('contains persistence failures and keeps the hot index usable', () => {
    const onError = vi.fn();
    const coordinator = createLiveMeetingContextCoordinator({
      loadCheckpoint: () => {
        throw new Error('corrupt cache');
      },
      saveCheckpoint: () => {
        throw new Error('disk full');
      },
      deleteCheckpoint: () => {
        throw new Error('locked');
      },
      now: () => 100_000,
      checkpointIntervalMs: 5_000,
      onError,
    });

    expect(() =>
      coordinator.ingest('meeting-1', [
        {
          id: 'new',
          speaker: 'Avery',
          text: 'Pricing needs another pass.',
          timestampMs: 2_000,
          confirmed: true,
        },
      ]),
    ).not.toThrow();
    expect(coordinator.inspect('meeting-1').segmentCount).toBe(1);
    coordinator.flush('meeting-1');
    expect(() => coordinator.clear('meeting-1')).not.toThrow();
    expect(onError.mock.calls.map(([operation]) => operation)).toEqual([
      'load',
      'save',
      'delete',
    ]);
  });
});
