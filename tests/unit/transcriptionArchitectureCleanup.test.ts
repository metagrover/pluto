import { existsSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');

describe('transcription architecture cleanup', () => {
  it('keeps Parakeet EOU live and Parakeet final as explicit contracts', () => {
    const renderer = read('src/components/AudioManager.tsx');
    const app = read('src/App.tsx');
    const finalWorker = read(
      'src/services/finalTranscription/runPersistedMeetingFinalTranscription.ts',
    );
    const main = read('electron/main.ts');
    const retry = read('src/services/retryMeetingTranscriptValidation.ts');

    expect(`${renderer}\n${main}\n${retry}`).not.toContain(
      ['WHISPER', 'TRANSCRIBE'].join('_'),
    );
    expect(renderer).toContain('createDurableEouSession');
    expect(renderer).not.toContain('TRANSCRIPTION_TRANSCRIBE_PREVIEW');
    expect(renderer).not.toContain('TRANSCRIPTION_TRANSCRIBE_FINAL');
    expect(app).toContain('runPersistedMeetingFinalTranscription');
    expect(finalWorker).toContain('TRANSCRIPTION_TRANSCRIBE_FINAL');
    expect(finalWorker).toContain('processValidatedMeetingDownstream');
    expect(renderer).not.toContain('fullSession');
    expect(renderer).not.toContain('whole-session');
    expect(main).toMatch(/'models',\s*'transcription',\s*'parakeet'/);
  });

  it('does not expose obsolete backend, device, model, or quality choices', () => {
    const settings = read('src/utils/transcriptionSettings.ts');
    const surface = read('src/components/features/SettingsTab.tsx');

    expect(settings).not.toContain(['whisperx', 'current'].join('_'));
    expect(settings).not.toContain(['whisperx', 'tuned'].join('_'));
    expect(settings).not.toMatch(/'cpu'|'cuda'|'mps'/);
    expect(surface).not.toMatch(
      /settings-transcription-preset|settings-whisper-model/,
    );
  });

  it('has no executable MLX transcription workflow', () => {
    expect(existsSync('electron/whisperx.ts')).toBe(false);
    expect(existsSync('python/whisperx_server.py')).toBe(false);
    expect(existsSync('electron/transcription/mlxPreviewClient.ts')).toBe(
      false,
    );
    expect(existsSync('python/mlx_transcription_server.py')).toBe(false);
    expect(existsSync('python/mlx_transcription_server.spec')).toBe(false);
    expect(existsSync('python/requirements-mlx.txt')).toBe(false);
    expect(existsSync('electron/transcription.ts')).toBe(false);

    const executableSurfaces = [
      'package.json',
      'electron/main.ts',
      'electron/recordingReadiness.ts',
      'src/App.tsx',
      'src/components/AudioManager.tsx',
      'src/utils/transcriptionSettings.ts',
      'src/services/transcription/contracts.ts',
      'python/speaker_attribution_benchmark_adapter.py',
      'src/services/finalTranscription/runPersistedMeetingFinalTranscription.ts',
      'scripts/setup_python.sh',
      'scripts/verify_packaged_runtime.mjs',
      'python/requirements.txt',
    ]
      .map(read)
      .join('\n');
    expect(executableSurfaces).not.toMatch(
      /mlx[_-]?(?:preview|whisper|transcription)|requirements-mlx/iu,
    );
  });
});
