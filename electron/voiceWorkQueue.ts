import { createBackgroundKnowledgeRefreshCoordinator } from './backgroundKnowledgeRefresh';
import { runWithLocalInferenceCoordinator } from './llm/inferenceCoordinator';
import type { PauseReason } from './pauseReasonCoordinator';
import type { ParakeetRuntimeDiagnostics } from './transcription/parakeetRuntimeHost';

export const canRunVoiceWork = (input: {
  active: boolean;
  runtime?: ParakeetRuntimeDiagnostics;
  pauses: Partial<Record<PauseReason, number>>;
  transcriptionCount: number;
  onBattery: boolean;
  thermalState: string;
  cpuLoad: number;
  cpuCount: number;
}): boolean => {
  const { active, runtime, pauses } = input;
  return Boolean(
    runtime &&
      runtime.state !== 'live' &&
      runtime.durableRetryHandoffCount === 0 &&
      !input.onBattery &&
      ['nominal', 'fair'].includes(input.thermalState) &&
      !pauses.capture &&
      !pauses.downstream &&
      !pauses.ask_pluto_session &&
      !pauses.llm_active &&
      input.transcriptionCount <= (active ? 1 : 0) &&
      (active ||
        (runtime.state === 'idle' &&
          runtime.queuedLeaseCount === 0 &&
          input.cpuLoad < input.cpuCount * 0.8)),
  );
};

// Voice work shares Gemma's admission gate, but keeps its own pending meetings
// so a knowledge job waiting for idle cannot block a requested enrollment.
export const createVoiceWorkQueue = (options: {
  canRun: (active: boolean) => boolean;
  hasMemoryCapacity: () => Promise<boolean>;
  run: (meetingId: string, signal: AbortSignal) => Promise<void>;
  onError?: (error: unknown, meetingId: string) => void;
}) => {
  let active = false;
  let lastError: string | null = null;
  const queue = createBackgroundKnowledgeRefreshCoordinator({
    quietMs: 0,
    retryMs: 5_000,
    monitorMs: 250,
    ignoreForegroundActivity: true,
    rotateOnRetry: true,
    getPolicy: () => ({
      systemIdleSeconds: 0,
      onBattery: false,
      thermalState: 'nominal',
      paused: !options.canRun(active),
    }),
    run: (meetingId, signal) =>
      runWithLocalInferenceCoordinator({
        key: Symbol('voice-enrollment'),
        task: 'speaker',
        workClass: 'background',
        signal,
        run: async (admittedSignal) => {
          if (!options.canRun(false) || !(await options.hasMemoryCapacity())) {
            throw new Error('voice_capacity_unavailable');
          }
          admittedSignal.throwIfAborted();
          if (!options.canRun(false))
            throw new Error('voice_capacity_unavailable');
          const controller = new AbortController();
          const workSignal = AbortSignal.any([
            admittedSignal,
            controller.signal,
          ]);
          let lastTick = performance.now();
          let lastMemoryCheck = lastTick;
          let checkingMemory = false;
          active = true;
          const monitor = setInterval(() => {
            const now = performance.now();
            if (now - lastTick > 350) {
              controller.abort(new Error('voice_event_loop_pressure'));
            }
            lastTick = now;
            if (now - lastMemoryCheck >= 5_000 && !checkingMemory) {
              lastMemoryCheck = now;
              checkingMemory = true;
              void options
                .hasMemoryCapacity()
                .then(
                  (available) => {
                    if (!available)
                      controller.abort(new Error('voice_memory_pressure'));
                  },
                  () =>
                    controller.abort(new Error('voice_memory_probe_failed')),
                )
                .finally(() => {
                  checkingMemory = false;
                });
            }
          }, 250);
          try {
            await options.run(meetingId, workSignal);
            workSignal.throwIfAborted();
            lastError = null;
          } catch (error) {
            const reason = workSignal.aborted ? workSignal.reason : error;
            lastError =
              reason instanceof Error ? reason.message : 'voice_work_failed';
            throw error;
          } finally {
            clearInterval(monitor);
            active = false;
          }
        },
      }),
    onError: (error, meetingId) => {
      lastError = error instanceof Error ? error.message : 'voice_work_failed';
      options.onError?.(error, meetingId);
    },
  });
  return { ...queue, snapshot: () => ({ ...queue.snapshot(), lastError }) };
};
