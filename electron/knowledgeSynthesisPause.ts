import { createPauseReasonCoordinator } from './pauseReasonCoordinator';

let onPausedChange: (paused: boolean) => void = () => undefined;

export const knowledgeSynthesisPause = createPauseReasonCoordinator((paused) =>
  onPausedChange(paused),
);

export const configureKnowledgeSynthesisPause = (
  listener: (paused: boolean) => void,
): void => {
  onPausedChange = listener;
};
