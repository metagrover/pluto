export type FinalTranscriptionResourcePolicy = {
  thermalState: 'unknown' | 'nominal' | 'fair' | 'serious' | 'critical';
  freeMemoryBytes: number;
  totalMemoryBytes: number;
  availableMemoryBytes?: number;
  memoryPressureFreePercent?: number;
};

export type FinalTranscriptionAdmission =
  | { admitted: true }
  | {
      admitted: false;
      reason: 'thermal_pressure' | 'memory_pressure';
    };

const MINIMUM_FREE_MEMORY_BYTES = 1024 ** 3;
const MINIMUM_FREE_MEMORY_RATIO = 0.08;

export const parseMacMemoryPressureFreePercent = (
  output: string,
): number | null => {
  const match = output.match(/System-wide memory free percentage:\s*(\d+)%/i);
  if (!match) return null;
  const percentage = Number.parseInt(match[1], 10);
  return Number.isFinite(percentage) && percentage >= 0 && percentage <= 100
    ? percentage
    : null;
};

export const evaluateFinalTranscriptionAdmission = (
  policy: FinalTranscriptionResourcePolicy,
): FinalTranscriptionAdmission => {
  if (policy.thermalState === 'serious' || policy.thermalState === 'critical') {
    return { admitted: false, reason: 'thermal_pressure' };
  }
  const availableMemoryBytes = Number.isFinite(policy.availableMemoryBytes)
    ? Number(policy.availableMemoryBytes)
    : policy.freeMemoryBytes;
  const memoryValid =
    Number.isFinite(availableMemoryBytes) &&
    Number.isFinite(policy.totalMemoryBytes) &&
    availableMemoryBytes >= 0 &&
    policy.totalMemoryBytes > 0;
  if (
    !memoryValid ||
    availableMemoryBytes < MINIMUM_FREE_MEMORY_BYTES ||
    availableMemoryBytes / policy.totalMemoryBytes < MINIMUM_FREE_MEMORY_RATIO
  ) {
    return { admitted: false, reason: 'memory_pressure' };
  }
  return { admitted: true };
};
