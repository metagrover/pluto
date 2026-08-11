export const GRACE_SHORT_MS = 60_000;
export const GRACE_LONG_MS = 120_000;

export type PollInput = {
  active: boolean;
  appName: string | null;
  confidence: 'low' | 'medium' | 'high';
  reason: string;
};

export type AutoEndInput = {
  poll: PollInput;
  trackedApp: string | null;
  graceActive: boolean;
};

export type AutoEndAction =
  | { type: 'lock_app'; appName: string }
  | { type: 'start_grace'; graceMs: number; reasonCode: string }
  | { type: 'cancel_grace' }
  | { type: 'no_op' };

export function autoEndDecision(input: AutoEndInput): AutoEndAction {
  const { poll, trackedApp, graceActive } = input;
  const hasAttachedCallEvidence =
    poll.confidence === 'medium' &&
    (poll.reason === 'call-app-running-silent-fallback' ||
      poll.reason === 'browser-call-tab-open-silent-fallback');
  const isConfirmedActive =
    poll.active &&
    Boolean(poll.appName) &&
    (poll.confidence === 'high' || hasAttachedCallEvidence);

  // Phase 1: No app locked yet — waiting to discover which call app is in use
  if (!trackedApp) {
    if (isConfirmedActive && poll.appName) {
      return { type: 'lock_app', appName: poll.appName };
    }
    return { type: 'no_op' };
  }

  // Phase 2: We have a tracked app — check if it's still active
  const isTrackedAppActive = isConfirmedActive && poll.appName === trackedApp;

  if (isTrackedAppActive) {
    return graceActive ? { type: 'cancel_grace' } : { type: 'no_op' };
  }

  // Tracked app is inactive — start grace if not already running
  if (!graceActive) {
    const hasExplicitExitEvidence =
      poll.reason === 'no-call-app-running' ||
      poll.reason === 'browser-call-tab-closed';
    const reasonCode = hasExplicitExitEvidence
      ? 'call_app_exited'
      : 'audio_inactive_timeout';
    const graceMs = hasExplicitExitEvidence ? GRACE_SHORT_MS : GRACE_LONG_MS;
    return { type: 'start_grace', graceMs, reasonCode };
  }

  // Grace already running, let it continue
  return { type: 'no_op' };
}
