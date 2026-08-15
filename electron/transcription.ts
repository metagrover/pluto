import {
  type TranscriptionCapabilities as SharedTranscriptionCapabilities,
  getTranscriptionCapabilities,
  listTranscriptionBackends,
  resolveBackendOptions,
} from '../src/utils/transcriptionBackendConfig';
import {
  type TranscriptionBackend,
  type TranscriptionPreset,
  resolveTranscriptionBackend,
  resolveTranscriptionPreset,
} from '../src/utils/transcriptionSettings';
import type {
  WhisperComputeType,
  WhisperDevice,
  WhisperModel,
} from '../src/utils/transcriptionSettings';
import {
  type HealthStatus as WhisperHealthStatus,
  type TranscribeOptions as WhisperTranscribeOptions,
  type Transcript as WhisperTranscript,
  whisperX,
} from './whisperx';

export interface TranscriptionMeta {
  backend: TranscriptionBackend;
  preset: TranscriptionPreset;
  model: WhisperModel;
  device: WhisperDevice;
  computeType: WhisperComputeType;
  canonicalSource?: 'mic' | 'mix';
  diarization: boolean;
  elapsedMs: number;
  providerLabel: string;
  warnings?: string[];
  vocabularyHintPolicyVersion?: string;
  vocabularyHintCount?: number;
  diarizationRuntime?: {
    engine: 'sherpa-onnx';
    engineVersion: string;
    modelChecksums: string[];
  };
}

export interface TranscriptionResult extends WhisperTranscript {
  meta: TranscriptionMeta;
}

export type TranscriptionCapabilities = SharedTranscriptionCapabilities;

export interface TranscriptionRequestOptions extends WhisperTranscribeOptions {
  backend?: TranscriptionBackend;
  preset?: TranscriptionPreset;
  canonicalSource?: 'mic' | 'mix';
}

export interface TranscriptionBackendStatus {
  backend: TranscriptionBackend;
  capabilities: TranscriptionCapabilities;
  health: WhisperHealthStatus;
}

export { listTranscriptionBackends };

const toWhisperOptions = (
  resolved: ReturnType<typeof resolveBackendOptions>,
  options: TranscriptionRequestOptions = {},
): WhisperTranscribeOptions => {
  return {
    model: resolved.model,
    device: 'mlx',
    computeType: 'float16',
    language: resolved.language,
    diarize: options.diarize,
    wordTimestamps: options.wordTimestamps,
    initialPrompt: options.initialPrompt,
    vocabularyHintPolicyVersion: options.vocabularyHintPolicyVersion,
    vocabularyHintCount: options.vocabularyHintCount,
    signal: options.signal,
  };
};

export const getTranscriptionBackendStatus = async (
  backend: TranscriptionBackend,
): Promise<TranscriptionBackendStatus> => {
  await whisperX.start();
  return {
    backend,
    capabilities: getTranscriptionCapabilities(backend),
    health: await whisperX.health(),
  };
};

export const transcribeWithBackend = async (
  audioPath: string,
  options: TranscriptionRequestOptions = {},
): Promise<TranscriptionResult> => {
  const resolved = resolveBackendOptions({
    backend: resolveTranscriptionBackend(options.backend),
    preset: resolveTranscriptionPreset(options.preset),
    model: options.model,
    device: options.device,
    computeType: options.computeType,
    language: options.language,
  });
  const start = Date.now();
  if (options.diarize && options.diarizationProvider === 'sherpa_local') {
    const diarization = await whisperX.diarize(audioPath, options.signal);
    return {
      segments: diarization.segments.map((segment) => ({
        ...segment,
        text: '',
      })),
      language: resolved.language || 'en',
      duration: 0,
      meta: {
        backend: resolved.backend,
        preset: resolved.preset,
        model: resolved.model,
        device: resolved.device,
        computeType: resolved.computeType,
        canonicalSource: options.canonicalSource,
        diarization: true,
        elapsedMs: Date.now() - start,
        providerLabel: `sherpa-onnx ${diarization.version}`,
        diarizationRuntime: {
          engine: 'sherpa-onnx',
          engineVersion: diarization.version,
          modelChecksums: [
            diarization.modelProvenance.segmentationSha256,
            diarization.modelProvenance.embeddingSha256,
          ],
        },
      },
    };
  }
  const result = await whisperX.transcribe(
    audioPath,
    toWhisperOptions(resolved, options),
  );

  return {
    ...result,
    meta: {
      backend: resolved.backend,
      preset: resolved.preset,
      model: resolved.model,
      device: resolved.device,
      computeType: resolved.computeType,
      canonicalSource: options.canonicalSource,
      diarization: Boolean(options.diarize),
      elapsedMs: Date.now() - start,
      providerLabel: resolved.providerLabel,
      warnings: resolved.warnings.length > 0 ? resolved.warnings : undefined,
      vocabularyHintPolicyVersion: options.vocabularyHintPolicyVersion,
      vocabularyHintCount: options.vocabularyHintCount,
    },
  };
};
