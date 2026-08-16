const DEFAULTS = {
  backend: 'mlx_preview',
  preset: 'balanced',
  model: 'base',
  device: 'mlx',
  computeType: 'float16',
  language: 'en',
};

const IS_APPLE_SILICON =
  process.platform === 'darwin' && process.arch === 'arm64';

const BACKEND_LABELS = {
  mlx_preview: 'MLX Whisper',
};

const resolveBackendConfig = ({ preset = DEFAULTS.preset, language } = {}) => {
  const resolvedPreset = preset === 'balanced' ? preset : DEFAULTS.preset;
  return {
    ...DEFAULTS,
    preset: resolvedPreset,
    model: DEFAULTS.model,
    language: language || DEFAULTS.language,
    providerLabel: BACKEND_LABELS.mlx_preview,
  };
};

const listSupportedBenchmarkBackends = () => [
  { backend: 'mlx_preview', preset: 'balanced' },
];

module.exports = {
  BACKEND_LABELS,
  IS_APPLE_SILICON,
  listSupportedBenchmarkBackends,
  resolveBackendConfig,
};
