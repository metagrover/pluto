import type { SpeakerActivityWindow } from './speakerAttribution.ts';
import {
  type CaptureActivityEvidence,
  type CaptureActivityProducer,
  buildCaptureActivityEvidence,
} from './transcriptActivityEvidence.ts';

type CaptureSpeaker = SpeakerActivityWindow['speaker'];

type CaptureActivitySessionArgs = {
  producer: CaptureActivityProducer;
  persistSnapshot: (evidence: CaptureActivityEvidence) => Promise<unknown>;
};

export const createCaptureActivitySession = ({
  producer,
  persistSnapshot,
}: CaptureActivitySessionArgs) => {
  const frozenProducer: CaptureActivityProducer = Object.freeze({
    clock: Object.freeze({ ...producer.clock }),
    thresholds: Object.freeze({ ...producer.thresholds }),
    algorithmVersion: producer.algorithmVersion,
  });
  const completedWindows: SpeakerActivityWindow[] = [];
  let activeWindow: { speaker: CaptureSpeaker; startTime: number } | null =
    null;
  let durabilityFailure = false;
  let closed = false;
  let latestSeconds = Number.NEGATIVE_INFINITY;
  let queue = Promise.resolve();
  let snapshotPending = false;

  const latchDurabilityFailure = () => {
    durabilityFailure = true;
    console.error('[Pluto] Capture journal durability task failed');
  };

  const appendTask = (task: () => Promise<unknown>): Promise<void> => {
    queue = queue.then(task).then(() => undefined, latchDurabilityFailure);
    return queue;
  };

  const flushPendingSnapshot = () => {
    if (!snapshotPending) return queue;
    snapshotPending = false;
    const snapshotWindows = completedWindows.map((window) => ({ ...window }));
    appendTask(async () => {
      const snapshot = await buildCaptureActivityEvidence(
        snapshotWindows,
        frozenProducer,
      );
      await persistSnapshot(snapshot);
    });
    return queue;
  };

  const enqueue = (task: () => Promise<unknown>): Promise<void> => {
    if (closed) {
      latchDurabilityFailure();
      return queue;
    }
    flushPendingSnapshot();
    return appendTask(task);
  };

  const enqueueSnapshot = () => {
    snapshotPending = true;
  };

  const closeActiveWindow = (seconds: number): boolean => {
    if (!activeWindow) return false;
    if (seconds <= activeWindow.startTime) {
      activeWindow = null;
      return false;
    }

    completedWindows.push({
      startTime: activeWindow.startTime,
      endTime: seconds,
      speaker: activeWindow.speaker,
    });
    activeWindow = null;
    enqueueSnapshot();
    return true;
  };

  const transitionSpeaker = (next: CaptureSpeaker | null, seconds: number) => {
    if (
      closed ||
      !Number.isFinite(seconds) ||
      seconds < 0 ||
      seconds < latestSeconds ||
      (activeWindow !== null &&
        activeWindow.speaker !== next &&
        seconds <= activeWindow.startTime)
    ) {
      latchDurabilityFailure();
      return;
    }
    latestSeconds = seconds;
    if (activeWindow?.speaker === next) return;

    closeActiveWindow(seconds);
    if (next !== null) {
      activeWindow = { speaker: next, startTime: seconds };
    }
  };

  const closeAt = (seconds: number): Promise<void> => {
    if (closed) return queue;
    closed = true;
    if (!Number.isFinite(seconds) || seconds < 0 || seconds < latestSeconds) {
      latchDurabilityFailure();
      return queue;
    }
    latestSeconds = seconds;
    const persistedFinalWindow = closeActiveWindow(seconds);
    if (!persistedFinalWindow) enqueueSnapshot();
    return flushPendingSnapshot();
  };

  return {
    enqueue,
    markDurabilityFailure: latchDurabilityFailure,
    transitionSpeaker,
    closeAt,
    drain: () => queue,
    hasDurabilityFailure: () => durabilityFailure,
    windows: () => completedWindows.map((window) => ({ ...window })),
  };
};
