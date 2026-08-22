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
  it('enables guarded dual-source shadow work for an ordinary development launch', () => {
    expect(
      resolveDualShadowTrial({
        isPackaged: false,
        environment: {},
      }),
    ).toEqual({
      enabled: true,
      stage: 'dual_shadow',
      evidenceDigest: DUAL_SHADOW_TRIAL_EVIDENCE_DIGEST,
    });
  });

  it('enables guarded dual-source shadow work for packaged builds without a flag', () => {
    expect(
      resolveDualShadowTrial({ isPackaged: true, environment: {} }),
    ).toEqual({
      enabled: true,
      stage: 'dual_shadow',
      evidenceDigest: DUAL_SHADOW_TRIAL_EVIDENCE_DIGEST,
    });
  });
});

describe('activateDualShadowTrial', () => {
  it('promotes only the approved dual shadow mode for a normal launch', () => {
    const store = createStore();

    expect(
      activateDualShadowTrial({
        trial: resolveDualShadowTrial({
          isPackaged: false,
          environment: {},
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

  it('does not require a development flag in packaged builds', () => {
    const store = createStore();

    expect(
      activateDualShadowTrial({
        trial: resolveDualShadowTrial({ isPackaged: true, environment: {} }),
        store,
        ownerToken: 'process-owner',
      }),
    ).toEqual({ enabled: true });
    expect(store.read()).toMatchObject({
      mode: 'parakeet',
      stage: 'dual_shadow',
    });
  });
});
