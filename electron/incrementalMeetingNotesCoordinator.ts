import {
  type FinalTranscriptionResourcePolicy,
  evaluateFinalTranscriptionAdmission,
} from '../src/services/finalTranscription/finalTranscriptionAdmission';

export type IncrementalMeetingNotesAdmissionPolicy =
  FinalTranscriptionResourcePolicy & {
    captureOwned: boolean;
    liveTranscriptHealthy: boolean;
    onBattery: boolean;
  };

export const evaluateIncrementalMeetingNotesAdmission = (
  policy: IncrementalMeetingNotesAdmissionPolicy,
):
  | { admitted: true }
  | {
      admitted: false;
      reason:
        | 'capture_not_owned'
        | 'live_transcript_unhealthy'
        | 'battery_power'
        | 'thermal_headroom'
        | 'memory_pressure';
    } => {
  if (!policy.captureOwned) {
    return { admitted: false, reason: 'capture_not_owned' };
  }
  if (!policy.liveTranscriptHealthy) {
    return { admitted: false, reason: 'live_transcript_unhealthy' };
  }
  if (policy.onBattery) return { admitted: false, reason: 'battery_power' };
  if (policy.thermalState !== 'nominal') {
    return { admitted: false, reason: 'thermal_headroom' };
  }
  const resourceAdmission = evaluateFinalTranscriptionAdmission(policy);
  return resourceAdmission.admitted
    ? { admitted: true }
    : { admitted: false, reason: 'memory_pressure' };
};

export type IncrementalMeetingNotesOffer = {
  meetingId: string;
  sourceRevision: string;
  sourceSegmentCount: number;
  sourceCharacterCount: number;
};

export type IncrementalMeetingNotesOutcome =
  | 'generated'
  | 'reused'
  | 'superseded'
  | 'preempted'
  | 'discarded';

export type IncrementalMeetingNotesMetric = {
  outcome: IncrementalMeetingNotesOutcome;
  sourceSegmentCount: number;
  sourceCharacterCount: number;
};

type Dependencies<T extends IncrementalMeetingNotesOffer> = {
  admit(input: T): Promise<boolean>;
  run(
    input: T,
    signal: AbortSignal,
  ): Promise<'generated' | 'reused' | 'discarded'>;
  onMetric?: (event: IncrementalMeetingNotesMetric) => void;
};

export const createIncrementalMeetingNotesCoordinator = <
  T extends IncrementalMeetingNotesOffer,
>(
  dependencies: Dependencies<T>,
) => {
  let pending: T | null = null;
  let active: { input: T; controller: AbortController } | undefined;
  let loop: Promise<void> | null = null;
  const latestCharacterCountByMeeting = new Map<string, number>();

  const record = (
    outcome: IncrementalMeetingNotesOutcome,
    input: IncrementalMeetingNotesOffer,
  ) =>
    dependencies.onMetric?.({
      outcome,
      sourceSegmentCount: input.sourceSegmentCount,
      sourceCharacterCount: input.sourceCharacterCount,
    });

  const pump = async (): Promise<void> => {
    while (pending) {
      const input = pending;
      pending = null;
      const controller = new AbortController();
      active = { input, controller };
      try {
        const admitted = await dependencies.admit(input);
        if (controller.signal.aborted) {
          record('preempted', input);
          continue;
        }
        if (!admitted) {
          record('discarded', input);
          continue;
        }
        record(await dependencies.run(input, controller.signal), input);
      } catch {
        record(controller.signal.aborted ? 'preempted' : 'discarded', input);
      } finally {
        if (active?.controller === controller) active = undefined;
      }
    }
  };

  const ensureLoop = () => {
    if (loop) return;
    loop = pump().finally(() => {
      loop = null;
      if (pending) ensureLoop();
    });
  };

  return {
    offer(input: T): void {
      const latest = latestCharacterCountByMeeting.get(input.meetingId) ?? -1;
      if (input.sourceCharacterCount <= latest) {
        record('discarded', input);
        return;
      }
      latestCharacterCountByMeeting.set(
        input.meetingId,
        input.sourceCharacterCount,
      );
      if (pending) record('superseded', pending);
      pending = input;
      ensureLoop();
    },
    cancel(meetingId: string): void {
      latestCharacterCountByMeeting.delete(meetingId);
      if (pending?.meetingId === meetingId) {
        record('discarded', pending);
        pending = null;
      }
      if (active?.input.meetingId === meetingId) {
        active.controller.abort(
          new DOMException('Incremental notes cancelled', 'AbortError'),
        );
      }
    },
    cancelAll(): void {
      latestCharacterCountByMeeting.clear();
      if (pending) {
        record('discarded', pending);
        pending = null;
      }
      active?.controller.abort(
        new DOMException('Incremental notes cancelled', 'AbortError'),
      );
    },
    async drain(): Promise<void> {
      while (loop) await loop;
    },
  };
};
