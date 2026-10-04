import fs from 'node:fs';
import https from 'node:https';
import { systemPreferences } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getRecordingReadinessStatus,
  prepareRecordingReadiness,
} from '../../electron/recordingReadiness';
import type { ParakeetFinalClient } from '../../electron/transcription/parakeetFinalClient';

vi.mock('node:fs');
vi.mock('node:https', () => ({
  default: {
    get: vi.fn(() => ({
      on: (event: string, handler: (error: Error) => void) => {
        if (event === 'error') handler(new Error('mock'));
      },
    })),
  },
}));
vi.mock('node:child_process', () => ({
  execFile: vi.fn((_cmd, _args, cb) => cb(null)),
}));
vi.mock('electron', () => ({
  systemPreferences: { getMediaAccessStatus: vi.fn() },
  app: { isPackaged: false, getPath: vi.fn(() => '/mock/userData') },
}));

const READY_CAPABILITY = {
  ready: true,
  engine: 'parakeet_coreml',
  liveEngine: 'parakeet_eou_320ms',
  modelVersion: 'test-model-v1',
} as const;

describe('recordingReadiness', () => {
  let mockParakeetClient: ParakeetFinalClient;
  const parakeetModelRoot = '/mock/parakeet/model/root';
  const audiocapPath = '/mock/audiocap';

  beforeEach(() => {
    vi.clearAllMocks();
    mockParakeetClient = {
      prepare: vi.fn().mockResolvedValue(READY_CAPABILITY),
      getPreparedCapability: vi.fn().mockReturnValue(READY_CAPABILITY),
    } as unknown as ParakeetFinalClient;
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.accessSync).mockImplementation(() => undefined);
    vi.mocked(fs.unlink).mockImplementation((_path, cb) => cb(null));
    vi.mocked(systemPreferences.getMediaAccessStatus).mockReturnValue(
      'granted',
    );
    Object.defineProperty(process, 'platform', {
      value: 'darwin',
      configurable: true,
    });
  });

  const status = () =>
    getRecordingReadinessStatus({
      parakeetFinalClient: mockParakeetClient,
      parakeetModelRoot,
      audiocapPath,
      systemAudioPermission: true,
    });

  it('reads prepared capability without starting model preparation', async () => {
    expect(await status()).toEqual({
      ready: true,
      blockers: [],
      details: {
        parakeetClient: true,
        parakeetModel: true,
        parakeetEouReady: true,
        audiocapExists: true,
        audiocapExecutable: true,
        micPermission: true,
        systemAudioPermission: true,
      },
    });
    await status();
    expect(mockParakeetClient.getPreparedCapability).toHaveBeenCalledTimes(2);
    expect(mockParakeetClient.prepare).not.toHaveBeenCalled();
  });

  it('fails closed when the client is missing', async () => {
    const result = await getRecordingReadinessStatus({
      parakeetFinalClient: null,
      parakeetModelRoot,
      audiocapPath,
      systemAudioPermission: true,
    });
    expect(result.blockers).toContain('parakeet_client_missing');
    expect(result.blockers).toContain('parakeet_eou_unavailable');
  });

  it('fails closed when prepare lacks the EOU capability', async () => {
    vi.mocked(mockParakeetClient.getPreparedCapability).mockReturnValue({
      ready: true,
      engine: 'parakeet_coreml',
      modelBundleVersion: 'legacy-final-only',
    });
    const result = await status();
    expect(result.ready).toBe(false);
    expect(result.blockers).toContain('parakeet_eou_unavailable');
    expect(result.details.parakeetEouReady).toBe(false);
  });

  it('uses verified prepare rather than directory non-emptiness', async () => {
    vi.mocked(mockParakeetClient.getPreparedCapability).mockReturnValue(null);
    const result = await status();
    expect(result.blockers).toContain('parakeet_model_missing');
    expect(result.blockers).toContain('parakeet_eou_unavailable');
    expect(fs.readdirSync).not.toHaveBeenCalled();
  });

  it('preserves AudioCap and permission blockers', async () => {
    vi.mocked(fs.existsSync).mockImplementation(
      (value) => value !== audiocapPath,
    );
    vi.mocked(systemPreferences.getMediaAccessStatus).mockImplementation(
      (kind) => (kind === 'microphone' ? 'denied' : 'granted'),
    );
    const result = await status();
    expect(result.blockers).toContain('audiocap_missing');
    expect(result.blockers).toContain('mic_permission_missing');
  });

  it('accepts verified audio-only access when screen recording is denied', async () => {
    vi.mocked(systemPreferences.getMediaAccessStatus).mockImplementation(
      (kind) => (kind === 'microphone' ? 'granted' : 'denied'),
    );
    expect((await status()).ready).toBe(true);
    expect(systemPreferences.getMediaAccessStatus).not.toHaveBeenCalledWith(
      'screen',
    );
  });

  it('does not infer tap access from screen recording permission', async () => {
    const result = await getRecordingReadinessStatus({
      parakeetFinalClient: mockParakeetClient,
      parakeetModelRoot,
      audiocapPath,
      systemAudioPermission: false,
    });
    expect(result.blockers).toContain('system_audio_permission_missing');
  });

  it('prepares the verified Parakeet bundle exactly once', async () => {
    vi.mocked(mockParakeetClient.getPreparedCapability).mockReturnValue(null);
    const result = await prepareRecordingReadiness({
      parakeetFinalClient: mockParakeetClient,
      parakeetModelRoot,
      audiocapPath,
      systemAudioPermission: true,
    });
    expect(result.ready).toBe(true);
    expect(mockParakeetClient.prepare).toHaveBeenCalledTimes(1);
    expect(https.get).not.toHaveBeenCalled();
  });

  it('forwards byte progress from the verified prepare path', async () => {
    const onProgress = vi.fn();
    vi.mocked(mockParakeetClient.prepare).mockImplementation(
      async (listener) => {
        listener?.({
          phase: 'downloading',
          downloadedBytes: 4,
          totalBytes: 10,
        });
        return READY_CAPABILITY;
      },
    );

    await prepareRecordingReadiness(
      {
        parakeetFinalClient: mockParakeetClient,
        parakeetModelRoot,
        audiocapPath,
        systemAudioPermission: true,
      },
      onProgress,
    );

    expect(onProgress).toHaveBeenCalledWith({
      phase: 'downloading',
      downloadedBytes: 4,
      totalBytes: 10,
    });
  });
});
