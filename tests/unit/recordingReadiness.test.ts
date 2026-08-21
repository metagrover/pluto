import fs from 'node:fs';
import { systemPreferences } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mlxPreview } from '../../electron/transcription/mlxPreviewClient';
import { getRecordingReadinessStatus, prepareRecordingReadiness } from '../../electron/recordingReadiness';
import type { ParakeetFinalClient } from '../../electron/transcription/parakeetFinalClient';

vi.mock('node:fs');
vi.mock('electron', () => ({
  systemPreferences: {
    getMediaAccessStatus: vi.fn(),
  },
}));
vi.mock('../../electron/transcription/mlxPreviewClient', () => ({
  mlxPreview: {
    health: vi.fn(),
    prepareDiarizationModels: vi.fn(),
  },
}));

describe('recordingReadiness', () => {
  let mockParakeetClient: any;
  const parakeetModelRoot = '/mock/parakeet/model/root';
  const audiocapPath = '/mock/audiocap';

  beforeEach(() => {
    vi.clearAllMocks();
    mockParakeetClient = { prepare: vi.fn().mockResolvedValue(true) } as unknown as ParakeetFinalClient;

    // Default to fully ready state
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockReturnValue(['model.bin'] as any);
    vi.mocked(fs.accessSync).mockImplementation(() => {});
    vi.mocked(systemPreferences.getMediaAccessStatus).mockReturnValue('granted');
    vi.mocked(mlxPreview.health).mockResolvedValue({ engine: 'mlx_whisper', mlx_available: true } as any);

    // Mock platform/arch to avoid issues
    Object.defineProperty(process, 'arch', { value: 'arm64', configurable: true });
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
  });

  describe('getRecordingReadinessStatus', () => {
    it('returns ready when all checks pass', async () => {
      const status = await getRecordingReadinessStatus({
        parakeetFinalClient: mockParakeetClient,
        parakeetModelRoot,
        audiocapPath,
      });

      expect(status.ready).toBe(true);
      expect(status.blockers).toHaveLength(0);
      expect(status.details).toEqual({
        parakeetClient: true,
        parakeetModel: true,
        mlxAvailable: true,
        audiocapExists: true,
        audiocapExecutable: true,
        micPermission: true,
        systemAudioPermission: true,
      });
    });

    it('returns parakeet_client_missing blocker when client is null', async () => {
      const status = await getRecordingReadinessStatus({
        parakeetFinalClient: null,
        parakeetModelRoot,
        audiocapPath,
      });

      expect(status.ready).toBe(false);
      expect(status.blockers).toContain('parakeet_client_missing');
      expect(status.details.parakeetClient).toBe(false);
    });

    it('returns parakeet_model_missing blocker when model directory is empty', async () => {
      vi.mocked(fs.readdirSync).mockReturnValue([] as any);

      const status = await getRecordingReadinessStatus({
        parakeetFinalClient: mockParakeetClient,
        parakeetModelRoot,
        audiocapPath,
      });

      expect(status.ready).toBe(false);
      expect(status.blockers).toContain('parakeet_model_missing');
      expect(status.details.parakeetModel).toBe(false);
    });

    it('returns mlx_unavailable blocker when on arm64 and mlx is missing', async () => {
      vi.mocked(mlxPreview.health).mockResolvedValue({ engine: 'unavailable', mlx_available: false } as any);

      const status = await getRecordingReadinessStatus({
        parakeetFinalClient: mockParakeetClient,
        parakeetModelRoot,
        audiocapPath,
      });

      expect(status.ready).toBe(false);
      expect(status.blockers).toContain('mlx_unavailable');
      expect(status.details.mlxAvailable).toBe(false);
    });

    it('ignores mlx availability on non-arm64 architecture', async () => {
      Object.defineProperty(process, 'arch', { value: 'x64', configurable: true });
      vi.mocked(mlxPreview.health).mockResolvedValue({ engine: 'unavailable', mlx_available: false } as any);

      const status = await getRecordingReadinessStatus({
        parakeetFinalClient: mockParakeetClient,
        parakeetModelRoot,
        audiocapPath,
      });

      expect(status.ready).toBe(true);
      expect(status.blockers).not.toContain('mlx_unavailable');
      expect(status.details.mlxAvailable).toBe(true);
    });

    it('returns audiocap_missing blocker when audiocap does not exist', async () => {
      vi.mocked(fs.existsSync).mockImplementation((path) => path !== audiocapPath);

      const status = await getRecordingReadinessStatus({
        parakeetFinalClient: mockParakeetClient,
        parakeetModelRoot,
        audiocapPath,
      });

      expect(status.ready).toBe(false);
      expect(status.blockers).toContain('audiocap_missing');
      expect(status.details.audiocapExists).toBe(false);
    });

    it('returns audiocap_not_executable blocker when audiocap is not executable', async () => {
      vi.mocked(fs.accessSync).mockImplementation((path) => {
        if (path === audiocapPath) throw new Error('EACCES');
      });

      const status = await getRecordingReadinessStatus({
        parakeetFinalClient: mockParakeetClient,
        parakeetModelRoot,
        audiocapPath,
      });

      expect(status.ready).toBe(false);
      expect(status.blockers).toContain('audiocap_not_executable');
      expect(status.details.audiocapExecutable).toBe(false);
    });

    it('returns mic_permission_missing blocker when microphone is not granted', async () => {
      vi.mocked(systemPreferences.getMediaAccessStatus).mockImplementation((mediaType) => {
        if (mediaType === 'microphone') return 'denied';
        return 'granted';
      });

      const status = await getRecordingReadinessStatus({
        parakeetFinalClient: mockParakeetClient,
        parakeetModelRoot,
        audiocapPath,
      });

      expect(status.ready).toBe(false);
      expect(status.blockers).toContain('mic_permission_missing');
      expect(status.details.micPermission).toBe(false);
    });

    it('returns system_audio_permission_missing blocker when screen is not granted on darwin', async () => {
      vi.mocked(systemPreferences.getMediaAccessStatus).mockImplementation((mediaType) => {
        if (mediaType === 'screen') return 'denied';
        return 'granted';
      });

      const status = await getRecordingReadinessStatus({
        parakeetFinalClient: mockParakeetClient,
        parakeetModelRoot,
        audiocapPath,
      });

      expect(status.ready).toBe(false);
      expect(status.blockers).toContain('system_audio_permission_missing');
      expect(status.details.systemAudioPermission).toBe(false);
    });

    it('ignores system audio permission on non-darwin platform', async () => {
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
      vi.mocked(systemPreferences.getMediaAccessStatus).mockImplementation(() => 'denied');

      const status = await getRecordingReadinessStatus({
        parakeetFinalClient: mockParakeetClient,
        parakeetModelRoot,
        audiocapPath,
      });

      expect(status.blockers).not.toContain('system_audio_permission_missing');
      expect(status.details.systemAudioPermission).toBe(true);
    });
  });

  describe('prepareRecordingReadiness', () => {
    it('calls prepare on parakeet and mlx, and returns new status', async () => {
      const status = await prepareRecordingReadiness({
        parakeetFinalClient: mockParakeetClient,
        parakeetModelRoot,
        audiocapPath,
      });

      expect(mockParakeetClient.prepare).toHaveBeenCalled();
      expect(mlxPreview.prepareDiarizationModels).toHaveBeenCalled();
      expect(status.ready).toBe(true);
    });

    it('tolerates prepare failures and still returns status', async () => {
      mockParakeetClient.prepare.mockRejectedValue(new Error('Network error'));
      vi.mocked(mlxPreview.prepareDiarizationModels).mockRejectedValue(new Error('Disk error'));

      const status = await prepareRecordingReadiness({
        parakeetFinalClient: mockParakeetClient,
        parakeetModelRoot,
        audiocapPath,
      });

      expect(status.ready).toBe(true); // Status is evaluated again, based on disk state which is mocked to true
    });
  });
});
