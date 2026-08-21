import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as captureJournal from '../../electron/captureJournal';
import { handleAudioCaptureJournalStart } from '../../electron/captureJournalStart';
import { captureSessionLease } from '../../electron/captureSessionLease';

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => '' },
  systemPreferences: { getMediaAccessStatus: vi.fn() },
}));

vi.mock('../../electron/captureSessionLease', () => ({
  captureSessionLease: {
    acquire: vi.fn(),
    release: vi.fn(),
  },
}));

vi.mock('../../electron/captureJournal', () => ({
  createCaptureJournal: vi.fn(),
}));

describe('handleAudioCaptureJournalStart', () => {
  const defaultOptions = {
    meetingId: 'test-meeting',
    startedAtMs: 1000,
    expectedSources: ['mic'],
    sourceAvailability: {},
    sender: { id: 1 },
    captureSessionLease: {
      acquire: vi.fn().mockReturnValue({ status: 'acquired' }),
      release: vi.fn(),
      activeForOwner: vi.fn(),
      getActive: vi.fn(),
    } as any,
    readinessParams: {
      parakeetFinalClient: null,
      parakeetModelRoot: '',
      audiocapPath: '',
    },
    watchCaptureOwner: vi.fn(),
    knowledgeSynthesisPause: { acquire: vi.fn(), release: vi.fn() },
    getMeetingArtifactsRootDir: vi.fn().mockReturnValue('/test'),
    startParakeetLiveRecording: vi.fn().mockResolvedValue(undefined),
    checkReadiness: vi
      .fn()
      .mockResolvedValue({ ready: true, blockers: [], details: {} }),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws recording_not_ready and prevents lease acquisition if not ready', async () => {
    const checkReadiness = vi.fn().mockResolvedValue({
      ready: false,
      blockers: ['mic_permission_missing'],
      details: {},
    });

    await expect(
      handleAudioCaptureJournalStart({
        ...defaultOptions,
        checkReadiness,
      }),
    ).rejects.toThrow('recording_not_ready');

    expect(captureSessionLease.acquire).not.toHaveBeenCalled();
    expect(captureJournal.createCaptureJournal).not.toHaveBeenCalled();
  });

  it('proceeds with lease acquisition and journal creation when ready', async () => {
    vi.mocked(captureSessionLease.acquire).mockReturnValue({
      status: 'acquired',
    });
    vi.mocked(captureJournal.createCaptureJournal).mockResolvedValue({
      schemaVersion: 3,
    } as any);

    const manifest = await handleAudioCaptureJournalStart(defaultOptions);

    expect(manifest).toEqual({ schemaVersion: 3 });
    expect(defaultOptions.captureSessionLease.acquire).toHaveBeenCalledWith('test-meeting', 1);
    expect(captureJournal.createCaptureJournal).toHaveBeenCalled();
  });
});
