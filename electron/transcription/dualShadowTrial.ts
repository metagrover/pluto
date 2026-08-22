import { createHash } from 'node:crypto';
import type { LiveTranscriptionRolloutStore } from './liveTranscriptionRolloutStore';

export const DUAL_SHADOW_TRIAL_PUBLIC_LABEL = 'pluto-dual-shadow-trial-v1';
export const DUAL_SHADOW_TRIAL_EVIDENCE_DIGEST = createHash('sha256')
  .update(DUAL_SHADOW_TRIAL_PUBLIC_LABEL)
  .digest('hex');

export type DualShadowTrial =
  | { enabled: false }
  | {
      enabled: true;
      stage: 'dual_shadow';
      evidenceDigest: typeof DUAL_SHADOW_TRIAL_EVIDENCE_DIGEST;
    };

export const resolveDualShadowTrial = (input: {
  isPackaged: boolean;
  environment: Readonly<Record<string, string | undefined>>;
}): DualShadowTrial => {
  // The receipt-bound dual-source pass is now normal guarded recording work.
  // Keep this resolver and its evidence token so an existing persisted rollout
  // state remains compatible, but do not make a user-visible recording depend
  // on a development-only launch flag or the packaging mode.
  void input;
  return {
    enabled: true,
    stage: 'dual_shadow',
    evidenceDigest: DUAL_SHADOW_TRIAL_EVIDENCE_DIGEST,
  };
};

/** Makes the approved guarded shadow stage durable before capture admission. */
export const activateDualShadowTrial = (input: {
  trial: DualShadowTrial;
  store: Pick<LiveTranscriptionRolloutStore, 'promote' | 'read'>;
  ownerToken: string;
}): { enabled: boolean } => {
  if (!input.trial.enabled) return { enabled: false };
  const current = input.store.read();
  if (
    current.mode === 'parakeet' &&
    current.stage === input.trial.stage &&
    current.evidenceDigest === input.trial.evidenceDigest
  ) {
    return { enabled: true };
  }
  if (current.engineEpoch === Number.MAX_SAFE_INTEGER)
    return { enabled: false };
  return {
    enabled: input.store.promote({
      stage: input.trial.stage,
      evidenceDigest: input.trial.evidenceDigest,
      engineEpoch: current.engineEpoch + 1,
      ownerToken: input.ownerToken,
    }).accepted,
  };
};
