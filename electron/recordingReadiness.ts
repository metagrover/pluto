import fs from 'node:fs';
import { systemPreferences } from 'electron';
import type { TranscriptionRuntimeHealth } from '../src/services/transcription/contracts';
import type {
  ParakeetFinalClient,
  ParakeetPreparationProgress,
} from './transcription/parakeetFinalClient';

export interface ReadinessStatus {
  ready: boolean;
  blockers: string[];
  details: {
    parakeetClient: boolean;
    parakeetModel: boolean;
    parakeetEouReady: boolean;
    audiocapExists: boolean;
    audiocapExecutable: boolean;
    micPermission: boolean;
    systemAudioPermission: boolean;
  };
}

type ReadinessOptions = {
  parakeetFinalClient: ParakeetFinalClient | null;
  parakeetModelRoot: string;
  audiocapPath: string;
  systemAudioPermission?: boolean;
};

const evaluateRecordingReadiness = (
  options: ReadinessOptions,
  capability: TranscriptionRuntimeHealth | null,
): ReadinessStatus => {
  const details = {
    parakeetClient: options.parakeetFinalClient !== null,
    parakeetModel:
      capability?.ready === true &&
      capability.engine === 'parakeet_coreml' &&
      typeof capability.modelVersion === 'string' &&
      capability.modelVersion.length > 0,
    parakeetEouReady:
      capability?.ready === true &&
      capability.liveEngine === 'parakeet_eou_320ms',
    audiocapExists: false,
    audiocapExecutable: false,
    micPermission: false,
    systemAudioPermission: false,
  };
  const blockers: string[] = [];

  if (!details.parakeetClient) {
    blockers.push('parakeet_client_missing');
  }
  if (!details.parakeetModel) {
    blockers.push('parakeet_model_missing');
  }
  if (!details.parakeetEouReady) blockers.push('parakeet_eou_unavailable');

  // Audiocap
  try {
    if (fs.existsSync(options.audiocapPath)) {
      details.audiocapExists = true;
      try {
        fs.accessSync(options.audiocapPath, fs.constants.X_OK);
        details.audiocapExecutable = true;
      } catch (e) {
        blockers.push('audiocap_not_executable');
      }
    } else {
      blockers.push('audiocap_missing');
    }
  } catch (e) {
    blockers.push('audiocap_missing');
  }

  // Permissions
  const micStatus = systemPreferences.getMediaAccessStatus('microphone');
  if (micStatus === 'granted') {
    details.micPermission = true;
  } else {
    blockers.push('mic_permission_missing');
  }

  // Core Audio tap permission is distinct from screen recording permission.
  // Only a successful native capture probe establishes audio-only access.
  details.systemAudioPermission =
    process.platform !== 'darwin' || options.systemAudioPermission === true;
  if (!details.systemAudioPermission) {
    blockers.push('system_audio_permission_missing');
  }

  void options.parakeetModelRoot;
  return {
    ready: blockers.length === 0,
    blockers,
    details,
  };
};

const prepareParakeetCapability = async (
  client: ParakeetFinalClient | null,
  onProgress?: (progress: ParakeetPreparationProgress) => void,
): Promise<TranscriptionRuntimeHealth | null> => {
  if (!client) return null;
  try {
    return await client.prepare(onProgress);
  } catch (error) {
    console.error('[Readiness] Parakeet prepare failed:', error);
    return null;
  }
};

export async function getRecordingReadinessStatus(
  options: ReadinessOptions,
): Promise<ReadinessStatus> {
  return evaluateRecordingReadiness(
    options,
    options.parakeetFinalClient?.getPreparedCapability() ?? null,
  );
}

export async function prepareRecordingReadiness(
  options: ReadinessOptions,
  onProgress?: (progress: ParakeetPreparationProgress) => void,
): Promise<ReadinessStatus> {
  const capability = await prepareParakeetCapability(
    options.parakeetFinalClient,
    onProgress,
  );
  return evaluateRecordingReadiness(options, capability);
}
