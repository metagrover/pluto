import { describe, expect, it } from 'vitest';

import { resolveProductionDiarizationProvider } from '../../src/utils/diarizationProvider';

describe('production diarization provider selection', () => {
  it('uses the credential-free local runtime without a Hugging Face token', () => {
    expect(resolveProductionDiarizationProvider('')).toBe('sherpa_local');
  });

  it('preserves token-backed WhisperX as an explicit optional provider', () => {
    expect(resolveProductionDiarizationProvider('hf_example')).toBe(
      'whisperx_hf',
    );
  });
});
