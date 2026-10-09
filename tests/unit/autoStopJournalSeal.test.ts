import { describe, expect, it, vi } from 'vitest';
import { autoEndDecision } from '../../src/autoEnd/decision';
import {
  beginRecordingFinalization,
  buildMeetingTiming,
  createSealedCaptureActivityHandoff,
  sealCaptureJournalBeforeFinalization,
} from '../../src/utils/recordingFinalization';
import { buildCaptureActivityEvidence } from '../../src/utils/transcriptActivityEvidence';

describe('auto-stop triggering and journal sealing contract', () => {
  it('preserves the confirmed call-exit reason through journal sealing and persistence', async () => {
    const action = autoEndDecision({
      poll: {
        active: false,
        appName: null,
        confidence: 'low',
        reason: 'no-call-app-running',
      },
      trackedApp: 'Zoom',
      graceActive: false,
    });
    expect(action.type).toBe('start_grace');
    if (action.type !== 'start_grace')
      throw new Error('Expected confirmed call exit');
    const endReason = `auto:${action.reasonCode}`;

    // 2. Begin recording finalization with snapshot
    const recordingStartedAtMs = 600_000;
    const nowMs = 1_000_000;
    const stopSnapshot = beginRecordingFinalization({
      meetingId: 'meeting-autostop-1',
      stopInFlight: false,
      recordingStartedAtMs,
      nowMs,
    });
    expect(stopSnapshot).not.toBeNull();

    // 3. Graceful journal sealing
    const mockActivityEvidence = await buildCaptureActivityEvidence([], {
      clock: {
        kind: 'meeting_relative_seconds',
        origin: 'recording_start',
      },
      thresholds: {
        rms: 0.01,
        dominanceRatio: 1.5,
        minimumSwitchIntervalMs: 250,
      },
      algorithmVersion: 'speaker_activity_v1',
    });

    const sealOutcome = await sealCaptureJournalBeforeFinalization({
      drainAppends: async () => {},
      hasWriteFailure: () => false,
      seal: async () => ({
        activityEvidence: mockActivityEvidence,
      }),
    });

    expect(sealOutcome.status).toBe('sealed');
    if (sealOutcome.status !== 'sealed') throw new Error('Seal failed');

    // 4. Persistence with end_reason
    const timing = buildMeetingTiming(stopSnapshot!);
    const provisionalMeeting = {
      id: stopSnapshot!.meetingId,
      title: 'Auto-stopped Meeting',
      meeting_type: 'Recording',
      started_at: timing.startedAtIso,
      ended_at: timing.endedAtIso,
      duration_seconds: timing.durationSeconds,
      end_reason: endReason,
      finalization_status: 'processing',
    };

    const persistFn = vi.fn(async (m: typeof provisionalMeeting) => m.id);
    const handoff = createSealedCaptureActivityHandoff(
      sealOutcome.activityEvidence,
    );
    await handoff.persistMeeting(
      provisionalMeeting,
      {
        schemaVersion: 2,
        state: 'provisional',
        causes: [],
        evidenceProvenance: { kind: 'sealed_capture_activity_v2' },
      },
      persistFn,
    );

    expect(persistFn).toHaveBeenCalledTimes(1);
    const savedMeeting = persistFn.mock.calls[0]?.[0];
    expect(savedMeeting.end_reason).toBe('auto:call_app_exited');
    expect(savedMeeting.duration_seconds).toBe(400);
  });
});
