import type { DownstreamProcessingStage } from './downstreamProcessingLease';

export class DownstreamStageTimeoutError extends Error {
  readonly stage: DownstreamProcessingStage;

  constructor(stage: DownstreamProcessingStage) {
    super(`downstream_stage_timeout:${stage}`);
    this.name = 'DownstreamStageTimeoutError';
    this.stage = stage;
  }
}

export const throwIfDownstreamStageAborted = (signal: AbortSignal): void => {
  if (signal.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException('Downstream stage aborted', 'AbortError');
  }
};

export const runDownstreamStageBeforeDeadline = async <T>(
  stage: DownstreamProcessingStage,
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<T> => {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutError = new DownstreamStageTimeoutError(stage);
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(
      () => {
        controller.abort(timeoutError);
        reject(timeoutError);
      },
      Math.max(1, timeoutMs),
    );
  });

  try {
    return await Promise.race([operation(controller.signal), timeout]);
  } finally {
    if (timeoutId !== null) clearTimeout(timeoutId);
  }
};
