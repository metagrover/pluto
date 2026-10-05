import { describe, expect, it } from 'vitest';
import {
  GRACE_LONG_MS,
  GRACE_SHORT_MS,
  autoEndDecision,
} from '../../src/autoEnd/decision';

describe('autoEndDecision', () => {
  it.each([false, true])(
    'does not end a browser recording when inspection is unavailable (grace=%s)',
    (graceActive) => {
      expect(
        autoEndDecision({
          poll: {
            active: false,
            appName: 'Chrome',
            confidence: 'low',
            reason: 'browser-tab-inspection-unavailable',
          },
          trackedApp: 'Google Meet',
          graceActive,
        }),
      ).toEqual({ type: graceActive ? 'cancel_grace' : 'no_op' });
    },
  );
  // =============================================
  // Phase 1: No tracked app yet
  // =============================================

  it('returns no_op when no tracked app and no active call', () => {
    const result = autoEndDecision({
      poll: {
        active: false,
        appName: null,
        confidence: 'low',
        reason: 'no-call-app-running',
      },
      trackedApp: null,
      graceActive: false,
    });
    expect(result).toEqual({ type: 'no_op' });
  });

  it('returns lock_app when no tracked app and an active call is detected', () => {
    const result = autoEndDecision({
      poll: {
        active: true,
        appName: 'Zoom',
        confidence: 'high',
        reason: 'call-app-running-with-active-audio',
      },
      trackedApp: null,
      graceActive: false,
    });
    expect(result).toEqual({ type: 'lock_app', appName: 'Zoom' });
  });

  it('returns no_op when poll active but appName is null', () => {
    const result = autoEndDecision({
      poll: { active: true, appName: null, confidence: 'low', reason: '' },
      trackedApp: null,
      graceActive: false,
    });
    expect(result).toEqual({ type: 'no_op' });
  });

  it('locks onto a silent desktop call with an attached audio process', () => {
    const result = autoEndDecision({
      poll: {
        active: true,
        appName: 'Zoom',
        confidence: 'medium',
        reason: 'call-app-running-silent-fallback',
      },
      trackedApp: null,
      graceActive: false,
    });
    expect(result).toEqual({ type: 'lock_app', appName: 'Zoom' });
  });

  it('still rejects generic medium-confidence activity', () => {
    const result = autoEndDecision({
      poll: {
        active: true,
        appName: 'Zoom',
        confidence: 'medium',
        reason: 'ambiguous-process-match',
      },
      trackedApp: null,
      graceActive: false,
    });
    expect(result).toEqual({ type: 'no_op' });
  });

  // =============================================
  // Phase 2: Tracked app is still active
  // =============================================

  it('returns no_op when tracked app is still active and no grace running', () => {
    const result = autoEndDecision({
      poll: {
        active: true,
        appName: 'Zoom',
        confidence: 'high',
        reason: 'call-app-running-with-active-audio',
      },
      trackedApp: 'Zoom',
      graceActive: false,
    });
    expect(result).toEqual({ type: 'no_op' });
  });

  it('returns cancel_grace when tracked app is active and grace IS running', () => {
    const result = autoEndDecision({
      poll: {
        active: true,
        appName: 'Zoom',
        confidence: 'high',
        reason: 'call-app-running-with-active-audio',
      },
      trackedApp: 'Zoom',
      graceActive: true,
    });
    expect(result).toEqual({ type: 'cancel_grace' });
  });

  // =============================================
  // Phase 3: Tracked app is inactive
  // =============================================

  it('returns start_grace (60s) when tracked app exited', () => {
    const result = autoEndDecision({
      poll: {
        active: false,
        appName: null,
        confidence: 'low',
        reason: 'no-call-app-running',
      },
      trackedApp: 'Zoom',
      graceActive: false,
    });
    expect(result).toEqual({
      type: 'start_grace',
      graceMs: GRACE_SHORT_MS,
      reasonCode: 'call_app_exited',
    });
  });

  it('returns start_grace (120s) when tracked app running but no audio', () => {
    const result = autoEndDecision({
      poll: {
        active: false,
        appName: 'Zoom',
        confidence: 'low',
        reason: 'call-app-running-without-target-audio',
      },
      trackedApp: 'Zoom',
      graceActive: false,
    });
    expect(result).toEqual({
      type: 'start_grace',
      graceMs: GRACE_LONG_MS,
      reasonCode: 'audio_inactive_timeout',
    });
  });

  it('returns start_grace (60s) when a tracked browser meeting tab closes', () => {
    const result = autoEndDecision({
      poll: {
        active: false,
        appName: 'Chrome',
        confidence: 'low',
        reason: 'browser-call-tab-closed',
      },
      trackedApp: 'Chrome',
      graceActive: false,
    });
    expect(result).toEqual({
      type: 'start_grace',
      graceMs: GRACE_SHORT_MS,
      reasonCode: 'call_app_exited',
    });
  });

  it('keeps a tracked call active when its audio process remains silently attached', () => {
    const result = autoEndDecision({
      poll: {
        active: true,
        appName: 'Zoom',
        confidence: 'medium',
        reason: 'call-app-running-silent-fallback',
      },
      trackedApp: 'Zoom',
      graceActive: false,
    });
    expect(result).toEqual({ type: 'no_op' });
  });

  it('returns no_op when tracked app inactive but grace already running', () => {
    const result = autoEndDecision({
      poll: {
        active: false,
        appName: null,
        confidence: 'low',
        reason: 'no-call-app-running',
      },
      trackedApp: 'Zoom',
      graceActive: true,
    });
    expect(result).toEqual({ type: 'no_op' });
  });

  // =============================================
  // Edge cases: Different app active (not tracked)
  // =============================================

  it('returns start_grace when a different app is active (not the tracked one)', () => {
    const result = autoEndDecision({
      poll: {
        active: true,
        appName: 'Chrome',
        confidence: 'high',
        reason: 'call-app-running-with-active-audio',
      },
      trackedApp: 'Zoom',
      graceActive: false,
    });
    expect(result).toEqual({
      type: 'start_grace',
      graceMs: GRACE_LONG_MS,
      reasonCode: 'audio_inactive_timeout',
    });
  });

  it('returns no_op when different app is active and grace already running for tracked app', () => {
    const result = autoEndDecision({
      poll: {
        active: true,
        appName: 'Chrome',
        confidence: 'high',
        reason: 'call-app-running-with-active-audio',
      },
      trackedApp: 'Zoom',
      graceActive: true,
    });
    expect(result).toEqual({ type: 'no_op' });
  });

  // =============================================
  // Grace constant sanity checks
  // =============================================

  it('GRACE_SHORT_MS is 60 seconds', () => {
    expect(GRACE_SHORT_MS).toBe(60_000);
  });

  it('GRACE_LONG_MS is 120 seconds', () => {
    expect(GRACE_LONG_MS).toBe(120_000);
  });
});
