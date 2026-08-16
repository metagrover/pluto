import type { LiveEngineMode } from '../../src/services/liveTranscription/contracts';

export type LiveTranscriptionAdmissionInput = {
  requestedMode: LiveEngineMode;
  aecAvailable: boolean;
  parakeetAvailable?: boolean;
};

export type LiveTranscriptionAdmission = {
  admitted: true;
  mode: LiveEngineMode;
  reason:
    | 'requested'
    | 'aec_unavailable_system_shadow'
    | 'parakeet_unavailable_mlx';
};

const isParakeetMode = (mode: LiveEngineMode): boolean =>
  mode === 'dual_shadow' ||
  mode === 'parakeet_primary' ||
  mode === 'system_shadow';

/** Select the safest mode that can be admitted for this meeting. */
export const selectLiveTranscriptionMode = ({
  requestedMode,
  aecAvailable,
  parakeetAvailable = false,
}: LiveTranscriptionAdmissionInput): LiveEngineMode => {
  if (requestedMode === 'mlx') return 'mlx';
  if (!parakeetAvailable && isParakeetMode(requestedMode)) return 'mlx';
  if (!aecAvailable && requestedMode !== 'system_shadow')
    return 'system_shadow';
  return requestedMode;
};

export const evaluateLiveTranscriptionAdmission = (
  input: LiveTranscriptionAdmissionInput,
): LiveTranscriptionAdmission => {
  const mode = selectLiveTranscriptionMode(input);
  const reason =
    mode === 'system_shadow' && !input.aecAvailable
      ? 'aec_unavailable_system_shadow'
      : mode === 'mlx' && input.requestedMode !== 'mlx'
        ? 'parakeet_unavailable_mlx'
        : 'requested';
  return { admitted: true, mode, reason };
};

export const resolveLiveTranscriptionAdmission =
  evaluateLiveTranscriptionAdmission;

export const resolveLiveTranscriptionPolicy =
  evaluateLiveTranscriptionAdmission;

export const admitLiveTranscription = evaluateLiveTranscriptionAdmission;
