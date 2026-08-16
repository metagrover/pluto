import { describe, expect, it } from 'vitest';

import {
  evaluateFinalTranscriptionAdmission,
  parseMacMemoryPressureFreePercent,
} from '../../src/services/finalTranscription/finalTranscriptionAdmission.ts';

describe('evaluateFinalTranscriptionAdmission', () => {
  it.each(['nominal', 'fair', 'unknown'] as const)(
    'admits healthy %s thermal state',
    (thermalState) => {
      expect(
        evaluateFinalTranscriptionAdmission({
          thermalState,
          freeMemoryBytes: 8 * 1024 ** 3,
          totalMemoryBytes: 32 * 1024 ** 3,
        }),
      ).toEqual({ admitted: true });
    },
  );

  it.each(['serious', 'critical'] as const)(
    'denies %s thermal pressure',
    (thermalState) => {
      expect(
        evaluateFinalTranscriptionAdmission({
          thermalState,
          freeMemoryBytes: 8 * 1024 ** 3,
          totalMemoryBytes: 32 * 1024 ** 3,
        }),
      ).toEqual({ admitted: false, reason: 'thermal_pressure' });
    },
  );

  it('denies low absolute or proportional free memory', () => {
    expect(
      evaluateFinalTranscriptionAdmission({
        thermalState: 'nominal',
        freeMemoryBytes: 512 * 1024 ** 2,
        totalMemoryBytes: 32 * 1024 ** 3,
      }),
    ).toEqual({ admitted: false, reason: 'memory_pressure' });
    expect(
      evaluateFinalTranscriptionAdmission({
        thermalState: 'nominal',
        freeMemoryBytes: 2 * 1024 ** 3,
        totalMemoryBytes: 64 * 1024 ** 3,
      }),
    ).toEqual({ admitted: false, reason: 'memory_pressure' });
  });

  it('uses reclaimable macOS availability instead of raw free pages', () => {
    expect(
      evaluateFinalTranscriptionAdmission({
        thermalState: 'nominal',
        freeMemoryBytes: 512 * 1024 ** 2,
        availableMemoryBytes: 12 * 1024 ** 3,
        memoryPressureFreePercent: 76,
        totalMemoryBytes: 16 * 1024 ** 3,
      }),
    ).toEqual({ admitted: true });
  });

  it('parses the stable memory_pressure percentage without accepting noise', () => {
    expect(
      parseMacMemoryPressureFreePercent(
        'System-wide memory free percentage: 76%\n',
      ),
    ).toBe(76);
    expect(parseMacMemoryPressureFreePercent('unrecognized output')).toBeNull();
  });
});
