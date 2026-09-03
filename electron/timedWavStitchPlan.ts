export type TimedWavSegment = {
  path: string;
  startSec: number;
  endSec: number;
};

export type TimedWavStitchPlan =
  | {
      mode: 'sequential';
      initialDelayMs: number;
      targetDurationSeconds: number;
    }
  | { mode: 'sparse' };

const CONTIGUITY_TOLERANCE_SECONDS = 0.02;

export const planTimedWavStitch = (
  segments: TimedWavSegment[],
  firstAudioDurationSeconds: number,
): TimedWavStitchPlan => {
  if (segments.length === 0 || firstAudioDurationSeconds <= 0) {
    return { mode: 'sparse' };
  }
  const ordered = [...segments].sort(
    (left, right) => left.startSec - right.startSec,
  );
  for (let index = 1; index < ordered.length; index += 1) {
    if (
      Math.abs(ordered[index].startSec - ordered[index - 1].endSec) >
      CONTIGUITY_TOLERANCE_SECONDS
    ) {
      return { mode: 'sparse' };
    }
  }
  const first = ordered[0];
  const initialAudioStartSeconds = Math.max(
    first.startSec,
    first.endSec - firstAudioDurationSeconds,
  );
  return {
    mode: 'sequential',
    initialDelayMs: Math.max(0, Math.round(initialAudioStartSeconds * 1_000)),
    targetDurationSeconds: Math.max(
      ...ordered.map((segment) => segment.endSec),
    ),
  };
};
