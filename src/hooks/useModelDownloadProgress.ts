import { useEffect, useRef, useState } from 'react';

import {
  DownloadSpeedTracker,
  type ModelDownloadProgress,
  isModelPreparationProgressEvent,
} from '../services/modelDownloadProgress';

export const useModelDownloadProgress = (): ModelDownloadProgress | null => {
  const [progress, setProgress] = useState<ModelDownloadProgress | null>(null);
  const speedTracker = useRef(new DownloadSpeedTracker());

  useEffect(
    () =>
      window.ipcRenderer.on(
        'RECORDING_READINESS_PROGRESS',
        (_event, value: unknown) => {
          if (!isModelPreparationProgressEvent(value)) return;
          if (value.phase !== 'downloading') speedTracker.current.reset();
          const bytesPerSecond =
            value.phase === 'downloading'
              ? speedTracker.current.update(value.downloadedBytes, Date.now())
              : null;
          setProgress({ ...value, bytesPerSecond });
        },
      ),
    [],
  );

  return progress;
};
