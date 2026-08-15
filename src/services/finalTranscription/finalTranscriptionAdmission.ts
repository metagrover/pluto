export type FinalTranscriptionResourcePolicy = {
  thermalState: 'unknown' | 'nominal' | 'fair' | 'serious' | 'critical';
  freeMemoryBytes: number;
  totalMemoryBytes: number;
};

export type FinalTranscriptionAdmission =
  | { admitted: true }
  | {
      admitted: false;
      reason: 'thermal_pressure' | 'memory_pressure';
    };

const MINIMUM_FREE_MEMORY_BYTES = 1024 ** 3;
const MINIMUM_FREE_MEMORY_RATIO = 0.08;

export const evaluateFinalTranscriptionAdmission = (
  policy: FinalTranscriptionResourcePolicy,
): FinalTranscriptionAdmission => {
  if (policy.thermalState === 'serious' || policy.thermalState === 'critical') {
    return { admitted: false, reason: 'thermal_pressure' };
  }
  const memoryValid =
    Number.isFinite(policy.freeMemoryBytes) &&
    Number.isFinite(policy.totalMemoryBytes) &&
    policy.freeMemoryBytes >= 0 &&
    policy.totalMemoryBytes > 0;
  if (
    !memoryValid ||
    policy.freeMemoryBytes < MINIMUM_FREE_MEMORY_BYTES ||
    policy.freeMemoryBytes / policy.totalMemoryBytes < MINIMUM_FREE_MEMORY_RATIO
  ) {
    return { admitted: false, reason: 'memory_pressure' };
  }
  return { admitted: true };
};
