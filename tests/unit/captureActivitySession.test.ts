import { describe, expect, it, vi } from 'vitest';

import { createCaptureActivitySession } from '../../src/utils/captureActivitySession';
import { sealCaptureJournalBeforeFinalization } from '../../src/utils/recordingFinalization';
import type { CaptureActivityProducer } from '../../src/utils/transcriptActivityEvidence';
import { buildCaptureActivityEvidence } from '../../src/utils/transcriptActivityEvidence';

const producer: CaptureActivityProducer = {
  clock: {
    kind: 'meeting_relative_seconds',
    origin: 'recording_start',
  },
  thresholds: {
    rms: 0.01,
    dominanceRatio: 1.5,
    minimumSwitchIntervalMs: 250,
  },
  algorithmVersion: 'speaker_activity_v1',
};

describe('capture activity session', () => {
  it('orders audio and activity writes through one durability queue', async () => {
    const events: string[] = [];
    const snapshotWindowCounts: number[] = [];
    const session = createCaptureActivitySession({
      producer,
      persistSnapshot: async (snapshot) => {
        events.push('snapshot');
        snapshotWindowCounts.push(snapshot.windows.length);
      },
    });

    session.enqueue(async () => {
      events.push('audio-1');
    });
    session.transitionSpeaker('Me', 1);
    session.transitionSpeaker('Them', 2);
    session.enqueue(async () => {
      events.push('audio-2');
    });
    session.closeAt(3);
    await session.drain();
    events.push('seal');

    expect(events).toEqual([
      'audio-1',
      'snapshot',
      'audio-2',
      'snapshot',
      'seal',
    ]);
    expect(snapshotWindowCounts).toEqual([1, 2]);
  });

  it('coalesces transition snapshots until the next audio checkpoint and final close', async () => {
    const persistSnapshot = vi.fn(async () => {});
    const session = createCaptureActivitySession({ producer, persistSnapshot });

    for (let index = 0; index < 100; index++) {
      session.transitionSpeaker(index % 2 === 0 ? 'Me' : 'Them', index + 1);
    }
    session.enqueue(async () => {});
    await session.closeAt(101);

    expect(persistSnapshot).toHaveBeenCalledTimes(2);
    expect(persistSnapshot.mock.calls[0]?.[0].windows).toHaveLength(99);
    expect(persistSnapshot.mock.calls[1]?.[0].windows).toHaveLength(100);
  });

  it('keeps an audio append failure latched after later work succeeds', async () => {
    const events: string[] = [];
    const session = createCaptureActivitySession({
      producer,
      persistSnapshot: async () => {
        events.push('snapshot');
      },
    });

    session.enqueue(async () => {
      throw new Error('/private/audio.wav: transcript words');
    });
    session.transitionSpeaker('Me', 1);
    session.closeAt(2);
    await session.drain();

    expect(events).toEqual(['snapshot']);
    expect(session.hasDurabilityFailure()).toBe(true);
  });

  it('keeps a journal start failure latched after later writes succeed', async () => {
    const events: string[] = [];
    const session = createCaptureActivitySession({
      producer,
      persistSnapshot: async () => {
        events.push('snapshot');
      },
    });
    session.markDurabilityFailure();
    session.enqueue(async () => {
      events.push('audio');
    });
    session.transitionSpeaker('Me', 1);
    await session.closeAt(2);
    const seal = vi.fn(async () => ({}));

    const outcome = await sealCaptureJournalBeforeFinalization({
      drainAppends: session.drain,
      hasWriteFailure: session.hasDurabilityFailure,
      seal,
    });

    expect(events).toEqual(['audio', 'snapshot']);
    expect(seal).not.toHaveBeenCalled();
    expect(outcome).toEqual({
      status: 'recovery_required',
      reason: 'capture_journal_write_failed',
    });
  });

  it('latches a rejected activity snapshot', async () => {
    const session = createCaptureActivitySession({
      producer,
      persistSnapshot: async () => {
        throw new Error('private snapshot data');
      },
    });

    session.transitionSpeaker('Them', 5);
    session.closeAt(8.25);
    await session.drain();

    expect(session.hasDurabilityFailure()).toBe(true);
  });

  it('closes the active window at the frozen stop time and persists it', async () => {
    const persistSnapshot = vi.fn(async () => {});
    const session = createCaptureActivitySession({
      producer,
      persistSnapshot,
    });

    session.transitionSpeaker('Them', 5);
    session.closeAt(8.25);
    await session.drain();

    expect(session.windows()).toEqual([
      { startTime: 5, endTime: 8.25, speaker: 'Them' },
    ]);
    expect(persistSnapshot).toHaveBeenLastCalledWith(
      expect.objectContaining({
        windows: [{ startTime: 5, endTime: 8.25, speaker: 'Them' }],
      }),
    );
    expect(session.hasDurabilityFailure()).toBe(false);
  });

  it('closes activity at a null transition without extending it to stop', async () => {
    const persistSnapshot = vi.fn(async () => {});
    const session = createCaptureActivitySession({ producer, persistSnapshot });

    session.transitionSpeaker('Me', 1);
    session.transitionSpeaker(null, 2);
    await session.closeAt(10);

    expect(session.windows()).toEqual([
      { startTime: 1, endTime: 2, speaker: 'Me' },
    ]);
    expect(persistSnapshot).toHaveBeenLastCalledWith(
      expect.objectContaining({
        windows: [{ startTime: 1, endTime: 2, speaker: 'Me' }],
      }),
    );
    expect(session.hasDurabilityFailure()).toBe(false);
  });

  it('rejects a non-monotonic transition without replacing the active window', async () => {
    const persistSnapshot = vi.fn(async () => {});
    const session = createCaptureActivitySession({ producer, persistSnapshot });

    session.transitionSpeaker('Me', 5);
    session.transitionSpeaker('Them', 4);
    await session.closeAt(8);

    expect(session.windows()).toEqual([
      { startTime: 5, endTime: 8, speaker: 'Me' },
    ]);
    expect(persistSnapshot).toHaveBeenLastCalledWith(
      expect.objectContaining({
        windows: [{ startTime: 5, endTime: 8, speaker: 'Me' }],
      }),
    );
    expect(session.hasDurabilityFailure()).toBe(true);
  });

  it('rejects an equal-time speaker switch without discarding the active window', async () => {
    const persistSnapshot = vi.fn(async () => {});
    const session = createCaptureActivitySession({ producer, persistSnapshot });

    session.transitionSpeaker('Me', 5);
    session.transitionSpeaker('Them', 5);
    await session.closeAt(8);

    expect(session.windows()).toEqual([
      { startTime: 5, endTime: 8, speaker: 'Me' },
    ]);
    expect(persistSnapshot).toHaveBeenLastCalledWith(
      expect.objectContaining({
        windows: [{ startTime: 5, endTime: 8, speaker: 'Me' }],
      }),
    );
    expect(session.hasDurabilityFailure()).toBe(true);
  });

  it('closes admission atomically and drains every accepted pre-close task', async () => {
    const events: string[] = [];
    let releaseAudio: (() => void) | undefined;
    const audioBlocked = new Promise<void>((resolve) => {
      releaseAudio = resolve;
    });
    const session = createCaptureActivitySession({
      producer,
      persistSnapshot: async () => {
        events.push('snapshot');
      },
    });

    session.enqueue(async () => {
      events.push('audio-start');
      await audioBlocked;
      events.push('audio-end');
    });
    session.transitionSpeaker('Them', 1);
    const closed = session.closeAt(2);
    session.enqueue(async () => {
      events.push('late-audio');
    });
    session.transitionSpeaker('Me', 3);
    releaseAudio?.();
    await closed;

    expect(events).toEqual(['audio-start', 'audio-end', 'snapshot']);
    expect(session.windows()).toEqual([
      { startTime: 1, endTime: 2, speaker: 'Them' },
    ]);
    expect(session.hasDurabilityFailure()).toBe(true);
  });

  it('freezes producer metadata before caller mutation', async () => {
    const mutableProducer: CaptureActivityProducer = {
      ...producer,
      thresholds: { ...producer.thresholds },
    };
    const persistSnapshot = vi.fn(async () => {});
    const session = createCaptureActivitySession({
      producer: mutableProducer,
      persistSnapshot,
    });

    mutableProducer.thresholds.rms = 999;
    session.transitionSpeaker('Me', 1);
    await session.closeAt(2);

    expect(persistSnapshot).toHaveBeenLastCalledWith(
      expect.objectContaining({
        thresholds: expect.objectContaining({ rms: 0.01 }),
      }),
    );
  });

  it('persists canonical empty evidence when recording closes without activity', async () => {
    const persistSnapshot = vi.fn(async () => {});
    const session = createCaptureActivitySession({ producer, persistSnapshot });

    await session.closeAt(8.25);

    expect(persistSnapshot).toHaveBeenCalledTimes(1);
    expect(persistSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        schemaVersion: 2,
        source: 'capture_activity_v2',
        windows: [],
      }),
    );
    expect(session.hasDurabilityFailure()).toBe(false);
  });

  it('closes a stop at the active window start without latching durability failure', async () => {
    const persistSnapshot = vi.fn(async () => {});
    const session = createCaptureActivitySession({ producer, persistSnapshot });

    session.transitionSpeaker('Me', 5);
    await session.closeAt(5);

    expect(session.windows()).toEqual([]);
    expect(persistSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        schemaVersion: 2,
        source: 'capture_activity_v2',
        windows: [],
      }),
    );
    expect(session.hasDurabilityFailure()).toBe(false);
  });

  it('blocks sealing when the connected session rejected an audio append', async () => {
    const session = createCaptureActivitySession({
      producer,
      persistSnapshot: async () => {},
    });
    session.enqueue(async () => {
      throw new Error('/private/audio.wav: transcript words');
    });
    await session.closeAt(8);
    const seal = vi.fn(async () => ({}));

    const outcome = await sealCaptureJournalBeforeFinalization({
      drainAppends: session.drain,
      hasWriteFailure: session.hasDurabilityFailure,
      seal,
    });

    expect(seal).not.toHaveBeenCalled();
    expect(outcome).toEqual({
      status: 'recovery_required',
      reason: 'capture_journal_write_failed',
    });
  });

  it('blocks sealing when the connected session rejected a snapshot', async () => {
    const session = createCaptureActivitySession({
      producer,
      persistSnapshot: async () => {
        throw new Error('private snapshot data');
      },
    });
    const seal = vi.fn(async () => ({}));
    await session.closeAt(8);

    const outcome = await sealCaptureJournalBeforeFinalization({
      drainAppends: session.drain,
      hasWriteFailure: session.hasDurabilityFailure,
      seal,
    });

    expect(seal).not.toHaveBeenCalled();
    expect(outcome).toEqual({
      status: 'recovery_required',
      reason: 'capture_journal_write_failed',
    });
  });

  it('hands the exact sealed evidence to validation and persistence after mutable windows change', async () => {
    const mutableWindows = [
      { startTime: 1, endTime: 2, speaker: 'Me' as const },
    ];
    const sealedActivityEvidence = await buildCaptureActivityEvidence(
      mutableWindows,
      producer,
    );
    const validate = vi.fn(async () => {});
    const persistIntegrity = vi.fn(async () => {});
    const persistProcessingError = vi.fn(async () => {});

    const outcome = await sealCaptureJournalBeforeFinalization({
      drainAppends: async () => {},
      hasWriteFailure: () => false,
      seal: async () => ({ activityEvidence: sealedActivityEvidence }),
    });
    expect(outcome.status).toBe('sealed');
    if (outcome.status !== 'sealed') return;
    const finalActivityEvidence = outcome.activityEvidence;

    mutableWindows.push({ startTime: 3, endTime: 4, speaker: 'Them' });
    await validate(finalActivityEvidence.windows);
    await persistIntegrity({
      activityEvidenceSource: 'capture_activity_v2',
      activityEvidence: finalActivityEvidence,
    });
    await persistProcessingError({
      activityEvidenceSource: 'capture_activity_v2',
      activityEvidence: finalActivityEvidence,
    });

    expect(validate).toHaveBeenCalledWith(finalActivityEvidence.windows);
    expect(validate.mock.calls[0]?.[0]).toBe(finalActivityEvidence.windows);
    expect(persistIntegrity).toHaveBeenCalledWith({
      activityEvidenceSource: 'capture_activity_v2',
      activityEvidence: finalActivityEvidence,
    });
    expect(persistIntegrity.mock.calls[0]?.[0].activityEvidence).toBe(
      finalActivityEvidence,
    );
    expect(persistProcessingError.mock.calls[0]?.[0]).toEqual({
      activityEvidenceSource: 'capture_activity_v2',
      activityEvidence: finalActivityEvidence,
    });
    expect(persistProcessingError.mock.calls[0]?.[0].activityEvidence).toBe(
      finalActivityEvidence,
    );
    expect(finalActivityEvidence.digestSha256).toBe(
      sealedActivityEvidence.digestSha256,
    );
    expect(finalActivityEvidence.windows).toEqual([
      { startTime: 1, endTime: 2, speaker: 'Me' },
    ]);
  });
});
