export type DiarizationProvider = 'sherpa_local' | 'whisperx_hf';

export const resolveProductionDiarizationProvider = (
  hfToken: string,
): DiarizationProvider => {
  return hfToken.trim().length > 0 ? 'whisperx_hf' : 'sherpa_local';
};
