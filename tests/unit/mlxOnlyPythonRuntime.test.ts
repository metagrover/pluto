import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

describe('MLX-only Python runtime', () => {
  it('does not install or import MLX preview or PyTorch', () => {
    const files = [
      'python/requirements.txt',
      'python/requirements-mlx.txt',
      'python/mlx_transcription_server.py',
      'python/mlx_transcription_server.spec',
      'python/speaker_attribution_benchmark_adapter.py',
      'scripts/setup_python.sh',
    ];
    const source = files.map((file) => readFileSync(file, 'utf8')).join('\n');
    expect(source).not.toMatch(/(?:import|from)\s+whisperx\b/);
    expect(source).not.toMatch(/(?:import|from)\s+torch\b/);
    expect(source).not.toMatch(/m-bain\/whisperx/);
    expect(source).not.toContain('current-whisperx');
    expect(readFileSync('scripts/setup_python.sh', 'utf8')).toContain(
      'pip install --no-deps -r "$PYTHON_DIR/requirements-mlx.txt"',
    );
    expect(
      readFileSync('python/mlx_transcription_server.spec', 'utf8'),
    ).toContain(
      "excludes=['torch', 'torchaudio', 'whisperx', 'mlx_whisper.torch_whisper']",
    );
  });
});
