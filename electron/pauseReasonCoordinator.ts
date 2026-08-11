export type PauseReason = 'capture' | 'transcription' | 'downstream';

export const createPauseReasonCoordinator = (
  onPausedChange: (paused: boolean) => void,
) => {
  const counts = new Map<PauseReason, number>();

  const total = () =>
    Array.from(counts.values()).reduce((sum, count) => sum + count, 0);

  return {
    acquire(reason: PauseReason) {
      const wasPaused = total() > 0;
      counts.set(reason, (counts.get(reason) ?? 0) + 1);
      if (!wasPaused) onPausedChange(true);
    },
    release(reason: PauseReason) {
      const count = counts.get(reason) ?? 0;
      if (count <= 0) return;
      const wasPaused = total() > 0;
      if (count === 1) counts.delete(reason);
      else counts.set(reason, count - 1);
      if (wasPaused && total() === 0) onPausedChange(false);
    },
    snapshot(): Partial<Record<PauseReason, number>> {
      return Object.fromEntries(counts);
    },
  };
};
