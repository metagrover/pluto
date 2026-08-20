import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  DUAL_SHADOW_TRIAL_EVIDENCE_DIGEST,
  activateDualShadowTrial,
  resolveDualShadowTrial,
} from '../../electron/transcription/dualShadowTrial';
import { LiveTranscriptionRolloutStore } from '../../electron/transcription/liveTranscriptionRolloutStore';

const directories: string[] = [];

const createStore = () => {
  const directory = mkdtempSync(join(tmpdir(), 'pluto-dual-shadow-trial-'));
  directories.push(directory);
  return new LiveTranscriptionRolloutStore({
    filePath: join(directory, 'rollout.json'),
    ownerToken: 'process-owner',
    approvedStageEvidenceDigests: {
      dual_shadow: [DUAL_SHADOW_TRIAL_EVIDENCE_DIGEST],
    },
  });
};

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe('resolveDualShadowTrial', () => {
  it('enables only an explicit development launch', () => {
    expect(
      resolveDualShadowTrial({
        isPackaged: false,
        environment: { PLUTO_DUAL_PARAKEET_SHADOW_TRIAL: '1' },
      }),
    ).toEqual({
      enabled: true,
      stage: 'dual_shadow',
      evidenceDigest: DUAL_SHADOW_TRIAL_EVIDENCE_DIGEST,
    });
  });

  it.each([
    {
      isPackaged: true,
      environment: { PLUTO_DUAL_PARAKEET_SHADOW_TRIAL: '1' },
    },
    { isPackaged: false, environment: {} },
    {
      isPackaged: false,
      environment: { PLUTO_DUAL_PARAKEET_SHADOW_TRIAL: 'true' },
    },
  ])('keeps ordinary and packaged launches disabled', (input) => {
    expect(resolveDualShadowTrial(input)).toEqual({ enabled: false });
  });
});

describe('activateDualShadowTrial', () => {
  it('promotes only the approved dual shadow mode for an enabled dev launch', () => {
    const store = createStore();

    expect(
      activateDualShadowTrial({
        trial: resolveDualShadowTrial({
          isPackaged: false,
          environment: { PLUTO_DUAL_PARAKEET_SHADOW_TRIAL: '1' },
        }),
        store,
        ownerToken: 'process-owner',
      }),
    ).toEqual({ enabled: true });
    expect(store.read()).toMatchObject({
      mode: 'parakeet',
      stage: 'dual_shadow',
      evidenceDigest: DUAL_SHADOW_TRIAL_EVIDENCE_DIGEST,
      engineEpoch: 1,
    });
  });

  it('fails closed to MLX without the explicit dev trial flag', () => {
    const store = createStore();

    expect(
      activateDualShadowTrial({
        trial: resolveDualShadowTrial({ isPackaged: false, environment: {} }),
        store,
        ownerToken: 'process-owner',
      }),
    ).toEqual({ enabled: false });
    expect(store.read()).toMatchObject({ mode: 'mlx', stage: 'none' });
  });
});
