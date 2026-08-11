import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('known-person transcription vocabulary production boundary', () => {
  const audioManager = readFileSync('src/components/AudioManager.tsx', 'utf8');
  const main = readFileSync('electron/main.ts', 'utf8');
  const transcription = readFileSync('electron/transcription.ts', 'utf8');
  const whisper = readFileSync('electron/whisperx.ts', 'utf8');
  const server = readFileSync('python/whisperx_server.py', 'utf8');

  it('resolves and caches one vocabulary selection at the recording boundary', () => {
    expect(main).toContain("'GET_TRANSCRIPTION_VOCABULARY'");
    expect(audioManager).toContain("'GET_TRANSCRIPTION_VOCABULARY'");
    expect(audioManager).toContain('transcriptionVocabularyRef.current');
    expect(audioManager).toContain('initialPrompt:');
  });

  it('threads the local prompt through Electron into MLX', () => {
    expect(transcription).toContain('initialPrompt: options.initialPrompt');
    expect(whisper).toContain('initial_prompt: options.initialPrompt');
    expect(server).toContain('initial_prompt: Optional[str]');
    expect(server).toContain(
      'mlx_kwargs["initial_prompt"] = request.initial_prompt',
    );
  });

  it('persists only content-free vocabulary provenance', () => {
    expect(transcription).toContain('vocabularyHintPolicyVersion');
    expect(transcription).toContain('vocabularyHintCount');
    expect(transcription).not.toContain(
      'initialPrompt: options.initialPrompt,\n      },',
    );
    expect(audioManager).toContain("'[Pluto] Transcription vocabulary ready'");
    expect(audioManager).not.toContain('console.log(initialPrompt');
  });
});
