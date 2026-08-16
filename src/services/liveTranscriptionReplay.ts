export interface CausalReplayFrame {
  sequence: number;
  availableAtSeconds: number;
  audioEndSeconds: number;
}

export interface CausalReplayCompletion {
  completedAtSeconds: number;
  observedAudioEndSeconds: number;
}

export type CausalReplayConsumer = (
  frame: Readonly<CausalReplayFrame>,
  virtualAvailableAtSeconds: number,
) => Promise<CausalReplayCompletion> | CausalReplayCompletion;

const requireFiniteNonNegative = (value: number): void => {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error('causal_replay_invalid_number');
  }
};

/**
 * Replays immutable frames sequentially without exposing any frame before its
 * virtual availability time. The consumer receives no corpus or future-frame
 * handle, which keeps production-engine adapters honest at this seam.
 */
export const runCausalReplay = async (
  frames: readonly CausalReplayFrame[],
  consume: CausalReplayConsumer,
): Promise<CausalReplayCompletion[]> => {
  let previousAvailableAt = -1;
  let previousAudioEnd = -1;
  const completions: CausalReplayCompletion[] = [];

  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index];
    requireFiniteNonNegative(frame.availableAtSeconds);
    requireFiniteNonNegative(frame.audioEndSeconds);
    if (frame.audioEndSeconds > frame.availableAtSeconds) {
      throw new Error('causal_replay_future_audio');
    }
    if (!Number.isSafeInteger(frame.sequence) || frame.sequence !== index) {
      throw new Error('causal_replay_sequence');
    }
    if (
      frame.availableAtSeconds < previousAvailableAt ||
      frame.audioEndSeconds < previousAudioEnd
    ) {
      throw new Error('causal_replay_clock');
    }

    const immutableFrame = Object.freeze({ ...frame });
    const completion = await consume(immutableFrame, frame.availableAtSeconds);
    requireFiniteNonNegative(completion.completedAtSeconds);
    requireFiniteNonNegative(completion.observedAudioEndSeconds);
    if (completion.completedAtSeconds < frame.availableAtSeconds) {
      throw new Error('causal_replay_completion_clock');
    }
    if (completion.observedAudioEndSeconds > frame.audioEndSeconds) {
      throw new Error('causal_replay_future_audio');
    }
    completions.push({ ...completion });
    previousAvailableAt = frame.availableAtSeconds;
    previousAudioEnd = frame.audioEndSeconds;
  }

  return completions;
};
