const DEFAULTS = {
  backend: 'local_alt_apple_silicon',
  preset: 'balanced',
  model: 'medium',
  device: 'mlx',
  computeType: 'float16',
  language: 'en',
};

const IS_APPLE_SILICON =
  process.platform === 'darwin' && process.arch === 'arm64';

const BACKEND_LABELS = {
  local_alt_apple_silicon: 'MLX Whisper',
};

const resolveBackendConfig = ({
  preset = DEFAULTS.preset,
  model,
  language,
} = {}) => {
  const resolvedPreset = preset === 'accuracy_first' ? preset : 'balanced';
  return {
    ...DEFAULTS,
    preset: resolvedPreset,
    model:
      model || (resolvedPreset === 'accuracy_first' ? 'large-v3' : 'medium'),
    language: language || DEFAULTS.language,
    providerLabel: BACKEND_LABELS.local_alt_apple_silicon,
  };
};

const listSupportedBenchmarkBackends = () => [
  { backend: 'local_alt_apple_silicon', preset: 'balanced' },
  { backend: 'local_alt_apple_silicon', preset: 'accuracy_first' },
];

module.exports = {
  BACKEND_LABELS,
  IS_APPLE_SILICON,
  listSupportedBenchmarkBackends,
  resolveBackendConfig,
};
