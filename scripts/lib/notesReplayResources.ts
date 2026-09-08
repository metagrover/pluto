import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
export type NotesReplayResources = {
  swapUsedBytes: number;
  memoryFreePercent: number;
  thermalNominal: boolean;
};

export function parseNotesReplayResources(
  swap: string,
  memory: string,
  thermal: string,
): NotesReplayResources {
  const swapMatch = /used = ([0-9.]+)M/.exec(swap);
  const memoryMatch = /free percentage:\s*(\d+)%/i.exec(memory);
  if (!swapMatch || !memoryMatch)
    throw new Error('resource_telemetry_unavailable');
  const swapUsedBytes = Number(swapMatch[1]) * 1024 * 1024;
  const memoryFreePercent = Number(memoryMatch[1]);
  if (
    !Number.isFinite(swapUsedBytes) ||
    memoryFreePercent < 0 ||
    memoryFreePercent > 100
  )
    throw new Error('resource_telemetry_invalid');
  return {
    swapUsedBytes,
    memoryFreePercent,
    thermalNominal:
      /No thermal warning level has been recorded/i.test(thermal) &&
      /No performance warning level has been recorded/i.test(thermal),
  };
}
export async function readNotesReplayResources(): Promise<NotesReplayResources> {
  const options = { timeout: 3000, maxBuffer: 64 * 1024 };
  const [swap, memory, thermal] = await Promise.all([
    exec('/usr/sbin/sysctl', ['vm.swapusage'], options),
    exec('/usr/bin/memory_pressure', ['-Q'], options),
    exec('/usr/bin/pmset', ['-g', 'therm'], options),
  ]);
  return parseNotesReplayResources(swap.stdout, memory.stdout, thermal.stdout);
}
export function notesReplayResourceStop(
  baseline: NotesReplayResources,
  sample: NotesReplayResources,
): string | null {
  if (!sample.thermalNominal) return 'thermal_or_performance_warning';
  if (sample.memoryFreePercent < 10) return 'low_memory_headroom';
  if (sample.swapUsedBytes - baseline.swapUsedBytes > 512 * 1024 * 1024)
    return 'swap_growth_exceeded';
  return null;
}
export function watchNotesReplayResources(input: {
  baseline: NotesReplayResources;
  read?: () => Promise<NotesReplayResources>;
  record: (event: Record<string, unknown>) => void;
  stop: (reason: string) => void;
  intervalMs?: number;
}) {
  let stopped = false;
  let active = Promise.resolve();
  let timer: ReturnType<typeof setTimeout>;
  const tick = () => {
    active = (async () => {
      try {
        const sample = await (input.read ?? readNotesReplayResources)();
        if (stopped) return;
        input.record({ event: 'resource_sample', ...sample });
        const reason = notesReplayResourceStop(input.baseline, sample);
        if (reason) {
          stopped = true;
          input.stop(reason);
        }
      } catch {
        if (!stopped) {
          stopped = true;
          input.stop('resource_telemetry_unavailable');
        }
      }
      if (!stopped) timer = setTimeout(tick, input.intervalMs ?? 5000);
    })();
  };
  timer = setTimeout(tick, input.intervalMs ?? 5000);
  return async () => {
    stopped = true;
    clearTimeout(timer);
    await active;
  };
}
