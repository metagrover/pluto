import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { createCaptureJournalMutationCoordinator } from '../../src/utils/captureJournalMutationCoordinator';

describe('capture journal mutation coordinator', () => {
  it('keeps revision reads and writes atomic across independent producers', async () => {
    const coordinator = createCaptureJournalMutationCoordinator();
    const events: string[] = [];
    let revision = 0;
    let releaseAudioRead: (() => void) | undefined;
    const audioReadBlocked = new Promise<void>((resolve) => {
      releaseAudioRead = resolve;
    });

    const audio = coordinator.run(async () => {
      const expectedRevision = revision;
      events.push('audio-read');
      await audioReadBlocked;
      if (expectedRevision !== revision) throw new Error('revision conflict');
      revision += 1;
      events.push('audio-write');
    });
    const checkpoint = coordinator.run(async () => {
      const expectedRevision = revision;
      events.push('checkpoint-read');
      if (expectedRevision !== revision) throw new Error('revision conflict');
      revision += 1;
      events.push('checkpoint-write');
    });

    await Promise.resolve();
    expect(events).toEqual(['audio-read']);

    releaseAudioRead?.();
    await Promise.all([audio, checkpoint]);

    expect(events).toEqual([
      'audio-read',
      'audio-write',
      'checkpoint-read',
      'checkpoint-write',
    ]);
    expect(revision).toBe(2);
  });

  it('continues ordering later mutations after a rejected write', async () => {
    const coordinator = createCaptureJournalMutationCoordinator();
    const events: string[] = [];

    const failed = coordinator.run(async () => {
      events.push('failed-write');
      throw new Error('revision conflict');
    });
    const later = coordinator.run(async () => {
      events.push('later-write');
      return 'persisted';
    });

    await expect(failed).rejects.toThrow('revision conflict');
    await expect(later).resolves.toBe('persisted');
    expect(events).toEqual(['failed-write', 'later-write']);
  });

  it('drains every accepted mutation before the stop boundary continues', async () => {
    const coordinator = createCaptureJournalMutationCoordinator();
    const events: string[] = [];
    let releaseFinalAudio: (() => void) | undefined;
    const finalAudioBlocked = new Promise<void>((resolve) => {
      releaseFinalAudio = resolve;
    });

    coordinator.run(async () => {
      events.push('final-audio-start');
      await finalAudioBlocked;
      events.push('final-audio-end');
    });
    const drained = coordinator.drain().then(() => events.push('drained'));

    await Promise.resolve();
    expect(events).toEqual(['final-audio-start']);

    releaseFinalAudio?.();
    await drained;
    expect(events).toEqual(['final-audio-start', 'final-audio-end', 'drained']);
  });

  it('resolves dependent receipt state after the prior audio mutation', async () => {
    const coordinator = createCaptureJournalMutationCoordinator();
    let receipt: string | null = null;
    let releaseAudio: (() => void) | undefined;
    const audioBlocked = new Promise<void>((resolve) => {
      releaseAudio = resolve;
    });

    const audio = coordinator.run(async () => {
      await audioBlocked;
      receipt = 'durable-audio-receipt';
    });
    const checkpoint = coordinator.run(async () => receipt);

    await Promise.resolve();
    expect(receipt).toBeNull();

    releaseAudio?.();
    await audio;
    await expect(checkpoint).resolves.toBe('durable-audio-receipt');
  });

  it('serializes raw audio mutations without recording-time transcript checkpoints', () => {
    const audioManager = readFileSync(
      'src/components/AudioManager.tsx',
      'utf8',
    );
    const audioBoundary = audioManager.slice(
      audioManager.indexOf('const appendCaptureJournalBlob ='),
      audioManager.indexOf('const abortUnstartedCapture ='),
    );

    expect(audioBoundary.indexOf('.run(async () =>')).toBeLessThan(
      audioBoundary.indexOf("'AUDIO_CAPTURE_JOURNAL_RAW_APPEND'"),
    );
    expect(audioManager).not.toContain('persistTranscriptCheckpoint');
  });
});
