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
  readCaptureJournalManifest: vi.fn(),
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
    vi.mocked(captureJournal.createCaptureJournal).mockResolvedValue({
      schemaVersion: 3,
    } as any);
    vi.mocked(captureJournal.readCaptureJournalManifest).mockRejectedValue(
      Object.assign(new Error('missing'), { code: 'ENOENT' }),
    );
    defaultOptions.captureSessionLease.acquire.mockReturnValue({
      status: 'acquired',
    });
    defaultOptions.captureSessionLease.release.mockReturnValue(true);
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
    expect(defaultOptions.captureSessionLease.acquire).toHaveBeenCalledWith(
      'test-meeting',
      1,
    );
    expect(captureJournal.createCaptureJournal).toHaveBeenCalled();
  });
  it('freezes the self snapshot before readiness awaits and commits after journal creation', async () => {
    let self = 'person-before';
    const snapshots: string[] = [];
    const events: string[] = [];
    vi.mocked(captureJournal.createCaptureJournal).mockImplementation(
      async () => {
        events.push('journal');
        return { schemaVersion: 3 } as any;
      },
    );
    await handleAudioCaptureJournalStart({
      ...defaultOptions,
      prepareCaptureIdentity: (meetingId) => {
        expect(meetingId).toBe('test-meeting');
        const frozen = self;
        events.push('freeze');
        return () => {
          events.push('commit');
          snapshots.push(frozen);
        };
      },
      checkReadiness: vi.fn().mockImplementation(async () => {
        self = 'person-after';
        events.push('readiness');
        return { ready: true, blockers: [], details: {} };
      }),
    });
    expect(snapshots).toEqual(['person-before']);
    expect(events).toEqual(['freeze', 'readiness', 'journal', 'commit']);
  });
  it('does not persist frozen identity when readiness rejects the start', async () => {
    const snapshots: string[] = [];
    await expect(
      handleAudioCaptureJournalStart({
        ...defaultOptions,
        prepareCaptureIdentity: () => () => {
          snapshots.push('committed');
        },
        checkReadiness: vi.fn().mockResolvedValue({
          ready: false,
          blockers: ['blocked'],
          details: {},
        }),
      }),
    ).rejects.toThrow('recording_not_ready');
    expect(snapshots).toEqual([]);
  });
  it('does not persist identity if journal creation fails', async () => {
    const snapshots: string[] = [];
    vi.mocked(captureJournal.createCaptureJournal).mockRejectedValue(
      new Error('disk failure'),
    );
    await expect(
      handleAudioCaptureJournalStart({
        ...defaultOptions,
        prepareCaptureIdentity: () => () => {
          snapshots.push('committed');
        },
      }),
    ).rejects.toThrow('disk failure');
    expect(snapshots).toEqual([]);
    expect(defaultOptions.captureSessionLease.release).toHaveBeenCalledWith(
      'test-meeting',
      1,
    );
  });
  it('does not relabel an on-disk journal resumed after a process restart', async () => {
    const snapshots: string[] = [];
    vi.mocked(captureJournal.readCaptureJournalManifest).mockResolvedValue({
      schemaVersion: 3,
    } as any);
    await handleAudioCaptureJournalStart({
      ...defaultOptions,
      prepareCaptureIdentity: () => () => {
        snapshots.push('new-profile');
      },
    });
    expect(snapshots).toEqual([]);
  });
  it('does not resnapshot an already-owned active capture', async () => {
    const snapshots: string[] = [];
    defaultOptions.captureSessionLease.acquire.mockReturnValue({
      status: 'already_owned',
    });
    await handleAudioCaptureJournalStart({
      ...defaultOptions,
      prepareCaptureIdentity: () => () => {
        snapshots.push('new-profile');
      },
    });
    expect(snapshots).toEqual([]);
    expect(captureJournal.readCaptureJournalManifest).not.toHaveBeenCalled();
  });
  it('keeps capture owner reuse free of identity writes', async () => {
    const snapshots: string[] = [];
    defaultOptions.captureSessionLease.acquire.mockImplementation(() => {
      throw new Error('capture_session_already_active');
    });
    defaultOptions.captureSessionLease.activeForOwner.mockReturnValue({
      ownerId: 1,
      meetingId: 'active-meeting',
    });
    expect(
      await handleAudioCaptureJournalStart({
        ...defaultOptions,
        prepareCaptureIdentity: () => () => {
          snapshots.push('new-profile');
        },
      }),
    ).toEqual({ meetingId: 'active-meeting', state: 'resumed' });
    expect(snapshots).toEqual([]);
  });
  it('fails the capture boundary if persisting its identity snapshot fails', async () => {
    await expect(
      handleAudioCaptureJournalStart({
        ...defaultOptions,
        prepareCaptureIdentity: () => () => {
          throw new Error('identity write failed');
        },
      }),
    ).rejects.toThrow('identity write failed');
    expect(defaultOptions.captureSessionLease.release).toHaveBeenCalledWith(
      'test-meeting',
      1,
    );
    expect(defaultOptions.startParakeetLiveRecording).not.toHaveBeenCalled();
  });
  it('does not mistake an unreadable journal for a new recording', async () => {
    const snapshots: string[] = [];
    vi.mocked(captureJournal.readCaptureJournalManifest).mockRejectedValue(
      Object.assign(new Error('permission denied'), { code: 'EACCES' }),
    );
    await expect(
      handleAudioCaptureJournalStart({
        ...defaultOptions,
        prepareCaptureIdentity: () => () => {
          snapshots.push('committed');
        },
      }),
    ).rejects.toThrow('permission denied');
    expect(snapshots).toEqual([]);
    expect(captureJournal.createCaptureJournal).not.toHaveBeenCalled();
  });
});
