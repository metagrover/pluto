import type { AlignedEnergyWindow } from '../../utils/acousticSpeakerAttribution.ts';

type Interval = { startTime: number; endTime: number };
export type SystemEnergyWindow = Pick<
  AlignedEnergyWindow,
  'startTime' | 'endTime' | 'systemRms'
>;
export type RemoteSpeechSupport = {
  intervals: Interval[];
  duration: number;
  measured: boolean;
};

// The native evidence uses 100 ms windows. Only exact digital silence can be
// discarded here; quiet speech/noise and missing measurements remain coverage.
export const createRemoteSpeechSupport = (
  input: SystemEnergyWindow[] | undefined,
): ((interval: Interval) => RemoteSpeechSupport) => {
  const windows = [...(input ?? [])].sort((a, b) => a.startTime - b.startTime);
  const valid =
    windows.length > 0 &&
    windows.every(
      (window, index) =>
        Number.isFinite(window.startTime) &&
        Number.isFinite(window.endTime) &&
        Number.isFinite(window.systemRms) &&
        window.startTime >= 0 &&
        window.endTime > window.startTime &&
        window.systemRms >= 0 &&
        (index === 0 || window.startTime >= windows[index - 1].endTime - 1e-6),
    );
  return (interval) => {
    const raw = {
      intervals: [interval],
      duration: Math.max(0, interval.endTime - interval.startTime),
      measured: false,
    };
    if (!valid || raw.duration <= 0) return raw;
    let low = 0;
    let high = windows.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (windows[middle].endTime <= interval.startTime) low = middle + 1;
      else high = middle;
    }
    const intervals: Interval[] = [];
    let coveredUntil = interval.startTime;
    let duration = 0;
    for (let index = low; index < windows.length; index++) {
      const window = windows[index];
      if (window.startTime >= interval.endTime) break;
      if (window.startTime > coveredUntil + 1e-6) return raw;
      const startTime = Math.max(coveredUntil, window.startTime);
      const endTime = Math.min(interval.endTime, window.endTime);
      if (window.systemRms > 0 && endTime > startTime) {
        intervals.push({ startTime, endTime });
        duration += endTime - startTime;
      }
      coveredUntil = Math.max(coveredUntil, endTime);
    }
    if (coveredUntil < interval.endTime - 1e-6) return raw;
    // A word wholly contradicted by measured silence remains unassigned and
    // still counts against coverage; silence cannot validate hallucinated text.
    if (duration <= 0)
      return { intervals: [], duration: raw.duration, measured: true };
    return { intervals, duration, measured: true };
  };
};
