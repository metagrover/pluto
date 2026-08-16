import { describe, expect, it, vi } from 'vitest';

import { prepareFinalTranscriptionBeforeRecovery } from '../../electron/transcription/finalTranscriptionStartup';

describe('final transcription startup boundary', () => {
  it('attempts Parakeet preparation before transcript recovery', async () => {
    const events: string[] = [];
    const prepare = vi.fn(async () => events.push('prepare'));
    const recover = vi.fn(async () => events.push('recover'));

    const outcome = await prepareFinalTranscriptionBeforeRecovery({
      prepare,
      recover,
    });

    expect(events).toEqual(['prepare', 'recover']);
    expect(outcome.prepared).toBe(true);
  });

  it('still runs recovery after a content-free preparation failure', async () => {
    const events: string[] = [];
    const outcome = await prepareFinalTranscriptionBeforeRecovery({
      prepare: async () => {
        events.push('prepare');
        throw new Error('/private/model path');
      },
      recover: async () => events.push('recover'),
    });

    expect(events).toEqual(['prepare', 'recover']);
    expect(outcome).toEqual({
      prepared: false,
      reason: 'parakeet_prepare_failed',
    });
    expect(JSON.stringify(outcome)).not.toContain('/private');
  });
});
