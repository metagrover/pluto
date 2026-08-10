export type DiarizationProvider = 'sherpa_local';

export const resolveProductionDiarizationProvider = (
  _legacyHfToken = '',
): DiarizationProvider => 'sherpa_local';
