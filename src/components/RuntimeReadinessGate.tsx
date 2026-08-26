import { type ReactNode, useCallback, useEffect, useState } from 'react';

import { useModelDownloadProgress } from '../hooks/useModelDownloadProgress';
import { Logo } from './Brand/Logo';
import { ModelDownloadProgress } from './ModelDownloadProgress';

type ReadinessStatus = {
  details: {
    parakeetClient: boolean;
    parakeetModel: boolean;
    parakeetEouReady: boolean;
    audiocapExists: boolean;
    audiocapExecutable: boolean;
  };
};

type RuntimeReadinessGateProps = {
  children: ReactNode;
};

type ReadinessPhase = 'checking' | 'preparing' | 'ready' | 'error';

const hasLocalTranscriptionRuntime = (status: ReadinessStatus) =>
  status.details.parakeetClient &&
  status.details.parakeetModel &&
  status.details.parakeetEouReady &&
  status.details.audiocapExists &&
  status.details.audiocapExecutable;

export const RuntimeReadinessGate = ({
  children,
}: RuntimeReadinessGateProps) => {
  const [phase, setPhase] = useState<ReadinessPhase>('checking');
  const modelDownloadProgress = useModelDownloadProgress();

  const verify = useCallback(async () => {
    setPhase('checking');
    try {
      const status = (await window.ipcRenderer.invoke(
        'RECORDING_READINESS_STATUS',
      )) as ReadinessStatus;
      if (hasLocalTranscriptionRuntime(status)) {
        setPhase('ready');
        return;
      }

      setPhase('preparing');
      const prepared = (await window.ipcRenderer.invoke(
        'RECORDING_READINESS_PREPARE',
      )) as ReadinessStatus;
      setPhase(hasLocalTranscriptionRuntime(prepared) ? 'ready' : 'error');
    } catch {
      setPhase('error');
    }
  }, []);

  useEffect(() => {
    void verify();
  }, [verify]);

  if (phase === 'ready') return children;

  const failed = phase === 'error';
  const title = failed
    ? 'Local transcription needs attention'
    : phase === 'preparing'
      ? 'Preparing local transcription'
      : 'Checking local transcription';
  const description = failed
    ? "Pluto couldn't prepare the English transcription models. Check your connection, then try again."
    : phase === 'preparing'
      ? 'Downloading or repairing the local models. Keep Pluto open.'
      : 'Verifying the English Parakeet models on this Mac.';

  return (
    <main className="app-init-drag flex h-screen w-screen items-center justify-center bg-pro-bg px-8 text-pro-text-main">
      <section
        className="w-full max-w-md"
        role={failed ? 'alert' : 'status'}
        aria-live="polite"
      >
        <Logo size={30} showText />
        <div className="mt-16 border-t border-pro-border pt-10">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-pro-text-muted">
            Local transcription
          </p>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight">
            {title}
          </h1>
          <p className="mt-3 max-w-sm text-sm leading-6 text-pro-text-muted">
            {description}
          </p>

          {failed ? (
            <button
              type="button"
              onClick={() => void verify()}
              className="app-no-drag mt-8 h-10 rounded-md bg-pro-text-main px-5 text-sm font-semibold text-white transition-opacity hover:opacity-90 dark:bg-pro-accent"
            >
              Try again
            </button>
          ) : (
            <div className="mt-10">
              {phase === 'preparing' ? (
                <ModelDownloadProgress progress={modelDownloadProgress} />
              ) : (
                <div className="h-1.5 overflow-hidden rounded-full bg-pro-border">
                  <div className="h-full w-1/2 animate-pulse rounded-full bg-pro-accent" />
                </div>
              )}
            </div>
          )}
        </div>
      </section>
    </main>
  );
};
