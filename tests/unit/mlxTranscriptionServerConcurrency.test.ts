import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('python/mlx_transcription_server.py', 'utf8');

describe('MLX preview server concurrency', () => {
  it('serializes complete transcription requests with a reentrant model lock', () => {
    expect(source).toContain('model_lock = threading.RLock()');
    expect(source).toMatch(
      /def transcribe\(request: TranscribeRequest\):[\s\S]*?with model_lock:\s+return _transcribe_locked\(request\)/,
    );
  });
});
