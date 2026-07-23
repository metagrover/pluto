import { describe, expect, it, vi } from 'vitest';

import { createCaptureActivitySession } from '../../src/utils/captureActivitySession';
import { sealCaptureJournalBeforeFinalization } from '../../src/utils/recordingFinalization';
import type { CaptureActivityProducer } from '../../src/utils/transcriptActivityEvidence';

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

  it('latches a stop at the active window start without persisting empty evidence', async () => {
    const persistSnapshot = vi.fn(async () => {});
    const session = createCaptureActivitySession({ producer, persistSnapshot });

    session.transitionSpeaker('Me', 5);
    await session.closeAt(5);

    expect(session.windows()).toEqual([]);
    expect(persistSnapshot).not.toHaveBeenCalled();
    expect(session.hasDurabilityFailure()).toBe(true);
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
});
