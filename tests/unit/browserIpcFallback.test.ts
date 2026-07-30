import { describe, expect, it } from 'vitest';

import { createBrowserIpcFallback } from '../../src/utils/browserIpcFallback';
import { buildCaptureActivityEvidence } from '../../src/utils/transcriptActivityEvidence';

describe('browser IPC capture journal fallback', () => {
  it('returns the exact latest activity evidence when sealing a started journal', async () => {
    const ipc = createBrowserIpcFallback();
    const activityEvidence = await buildCaptureActivityEvidence(
      [{ startTime: 1, endTime: 2, speaker: 'Me' }],
      {
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
      },
    );

    await ipc.invoke('AUDIO_CAPTURE_JOURNAL_START', {
      meetingId: 'preview-meeting',
      startedAtMs: 1_000,
    });
    await ipc.invoke('AUDIO_CAPTURE_JOURNAL_ACTIVITY_UPDATE', {
      meetingId: 'preview-meeting',
      activityEvidence,
    });
    const sealed = await ipc.invoke<{
      activityEvidence: typeof activityEvidence;
    }>('AUDIO_CAPTURE_JOURNAL_SEAL', {
      meetingId: 'preview-meeting',
      endedAtMs: 2_000,
    });

    expect(sealed.activityEvidence).toBe(activityEvidence);
    await expect(
      ipc.invoke('AUDIO_CAPTURE_JOURNAL_SEAL', {
        meetingId: 'preview-meeting',
        endedAtMs: 2_000,
      }),
    ).resolves.toBeNull();
  });
});
