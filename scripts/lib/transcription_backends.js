const DEFAULTS = {
  backend: 'whisperx_current',
  preset: 'balanced',
  model: 'small',
  device: 'cpu',
  computeType: 'int8',
  language: 'en',
};

const IS_APPLE_SILICON =
  process.platform === 'darwin' && process.arch === 'arm64';

const BACKEND_LABELS = {
  whisperx_current: 'WhisperX Current',
  whisperx_tuned: 'WhisperX Tuned',
  local_alt_apple_silicon: 'Local Alt (Apple Silicon)',
};

const resolveBackendConfig = ({
  backend = DEFAULTS.backend,
  preset = DEFAULTS.preset,
  model,
  device,
  computeType,
  language,
} = {}) => {
  const resolvedBackend = BACKEND_LABELS[backend] ? backend : DEFAULTS.backend;
  const resolvedPreset =
    preset === 'accuracy_first' || preset === 'balanced'
      ? preset
      : DEFAULTS.preset;

  let defaults = DEFAULTS;
  if (resolvedBackend === 'whisperx_tuned') {
    defaults =
      resolvedPreset === 'accuracy_first'
        ? {
            ...DEFAULTS,
            backend: resolvedBackend,
            preset: resolvedPreset,
            model: 'large-v3',
            computeType: 'float32',
          }
        : {
            ...DEFAULTS,
            backend: resolvedBackend,
            preset: resolvedPreset,
            model: 'medium',
          };
  } else if (resolvedBackend === 'local_alt_apple_silicon') {
    defaults =
      resolvedPreset === 'accuracy_first'
        ? {
            ...DEFAULTS,
            backend: resolvedBackend,
            preset: resolvedPreset,
            model: 'large-v3',
            computeType: 'float32',
          }
        : {
            ...DEFAULTS,
            backend: resolvedBackend,
            preset: resolvedPreset,
            model: 'medium',
          };
  }

  const resolvedDevice = device === 'cuda' ? 'cuda' : defaults.device;
  const resolvedComputeType =
    resolvedDevice === 'cpu' && computeType === 'float16'
      ? resolvedPreset === 'accuracy_first'
        ? 'float32'
        : defaults.computeType
      : computeType || defaults.computeType;

  return {
    backend: resolvedBackend,
    preset: resolvedPreset,
    model: model || defaults.model,
    device: resolvedDevice,
    computeType: resolvedComputeType,
    language: language || defaults.language,
    providerLabel: BACKEND_LABELS[resolvedBackend],
  };
};

const listSupportedBenchmarkBackends = () => {
  const backends = [
    { backend: 'whisperx_current', preset: 'balanced' },
    { backend: 'whisperx_tuned', preset: 'balanced' },
    { backend: 'whisperx_tuned', preset: 'accuracy_first' },
  ];
  if (IS_APPLE_SILICON) {
    backends.push({
      backend: 'local_alt_apple_silicon',
      preset: 'accuracy_first',
    });
  }
  return backends;
};

module.exports = {
  BACKEND_LABELS,
  IS_APPLE_SILICON,
  listSupportedBenchmarkBackends,
  resolveBackendConfig,
};
