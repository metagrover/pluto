import {
  Check,
  Download,
  Loader2,
  LockKeyhole,
  Mic,
  MonitorSpeaker,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { useModelDownloadProgress } from '../../hooks/useModelDownloadProgress';
import {
  type SetupReadinessInput,
  deriveSetupReadiness,
} from '../../services/setupReadiness';
import { Logo } from '../Brand/Logo';
import { ModelDownloadProgress } from '../ModelDownloadProgress';

interface SetupWizardProps {
  onComplete: () => void;
}

const requirementTone = (ready: boolean, blocked = false) =>
  ready
    ? 'border-emerald-200 bg-emerald-50/70 text-emerald-700'
    : blocked
      ? 'border-rose-200 bg-rose-50/70 text-rose-700'
      : 'border-pro-border bg-pro-surface text-pro-text-muted';

export const SetupWizard = ({ onComplete }: SetupWizardProps) => {
  const [step, setStep] = useState<1 | 2>(1);
  const [hydrated, setHydrated] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [requirements, setRequirements] = useState<SetupReadinessInput>({
    transcription: 'checking',
    microphone: 'checking',
    systemAudio: 'checking',
  });
  const modelDownloadProgress = useModelDownloadProgress();

  const readiness = useMemo(
    () => deriveSetupReadiness(requirements),
    [requirements],
  );

  const checkReadiness = useCallback(async () => {
    const status = await window.ipcRenderer.invoke(
      'RECORDING_READINESS_STATUS',
    );
    setRequirements((current) => {
      const isTranscriptionReady =
        status.details.parakeetClient &&
        status.details.parakeetModel &&
        status.details.parakeetEouReady &&
        status.details.audiocapExists &&
        status.details.audiocapExecutable;
      return {
        transcription:
          current.transcription === 'preparing'
            ? 'preparing'
            : isTranscriptionReady
              ? 'ready'
              : 'error',
        microphone: status.details.micPermission ? 'granted' : 'blocked',
        systemAudio: status.details.systemAudioPermission
          ? 'granted'
          : 'blocked',
      };
    });
  }, []);

  const prepareLocalModels = useCallback(async () => {
    setRequirements((current) => ({
      ...current,
      transcription: 'preparing',
    }));
    try {
      const status = await window.ipcRenderer.invoke(
        'RECORDING_READINESS_PREPARE',
      );
      const isTranscriptionReady =
        status.details.parakeetClient &&
        status.details.parakeetModel &&
        status.details.parakeetEouReady &&
        status.details.audiocapExists &&
        status.details.audiocapExecutable;
      setRequirements((current) => ({
        ...current,
        transcription: isTranscriptionReady ? 'ready' : 'error',
      }));
    } catch {
      setRequirements((current) => ({
        ...current,
        transcription: 'error',
      }));
    }
  }, []);

  useEffect(() => {
    const load = async () => {
      const [setupComplete, savedStep] = await Promise.all([
        window.ipcRenderer.invoke('GET_SETTING', 'setup_complete'),
        window.ipcRenderer.invoke('GET_SETTING', 'setup_step'),
      ]);
      if (setupComplete === 'true') {
        onComplete();
        return;
      }
      setStep(savedStep === '2' ? 2 : 1);
      setHydrated(true);
    };
    void load();
  }, [onComplete]);

  useEffect(() => {
    if (!hydrated || step !== 2) return;
    void Promise.all([prepareLocalModels(), checkReadiness()]);
  }, [checkReadiness, hydrated, prepareLocalModels, step]);

  const startSetup = async () => {
    await window.ipcRenderer.invoke('SET_SETTING', {
      key: 'setup_step',
      value: '2',
    });
    setStep(2);
  };

  const requestMicrophone = async () => {
    await window.ipcRenderer.invoke('REQUEST_MICROPHONE_PERMISSION');
    await checkReadiness();
  };

  const openSystemAudioSettings = async () => {
    await window.ipcRenderer.invoke(
      'OPEN_SYSTEM_SETTINGS_PRIVACY',
      'system-audio',
    );
  };

  const finish = async () => {
    if (!readiness.canComplete) return;
    setFinishing(true);
    try {
      await window.ipcRenderer.invoke('SET_SETTING', {
        key: 'setup_complete',
        value: 'true',
      });
      onComplete();
    } finally {
      setFinishing(false);
    }
  };

  if (!hydrated) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-pro-bg">
        <Loader2 className="h-7 w-7 animate-spin text-pro-accent" />
      </div>
    );
  }

  return (
    <main className="fixed inset-0 z-50 overflow-y-auto bg-pro-bg text-pro-text-main selection:bg-pro-accent/20">
      <div className="mx-auto flex min-h-full w-full max-w-5xl items-center px-6 py-10 sm:px-10 lg:px-12">
        {step === 1 ? (
          <section className="grid w-full items-center gap-12 lg:grid-cols-[minmax(0,0.82fr)_minmax(28rem,1.18fr)] lg:gap-16">
            <div className="max-w-md">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-pro-border bg-pro-surface shadow-sm">
                  <Logo size={46} />
                </div>
                <span className="text-sm font-semibold tracking-tight">
                  Pluto
                </span>
              </div>

              <p className="mt-12 text-xs font-semibold uppercase tracking-[0.14em] text-pro-accent">
                Private meeting memory
              </p>
              <h1 className="mt-4 text-[2.5rem] font-semibold leading-[1.08] tracking-[-0.035em] sm:text-[2.75rem]">
                Your meetings, remembered on this Mac.
              </h1>
              <p className="mt-6 max-w-[42ch] text-[15px] leading-7 text-pro-text-muted">
                Pluto records and organizes conversations while keeping
                transcription local.
              </p>

              <div className="mt-9 flex max-w-sm items-start gap-3 border-t border-pro-border pt-5 text-xs leading-5 text-pro-text-muted">
                <LockKeyhole
                  size={16}
                  className="mt-0.5 shrink-0 text-pro-accent"
                  aria-hidden="true"
                />
                <p>Your audio and transcript stay under your control.</p>
              </div>
            </div>

            <div className="overflow-hidden rounded-xl border border-pro-border bg-pro-surface shadow-sm">
              <div className="px-7 pb-5 pt-7 sm:px-8 sm:pt-8">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-pro-text-muted">
                  About three minutes
                </p>
                <h2 className="mt-2 text-xl font-semibold tracking-[-0.015em]">
                  Get ready to record
                </h2>
                <p className="mt-2 text-sm leading-6 text-pro-text-muted">
                  One local download and two macOS permissions.
                </p>
              </div>

              <ol className="border-y border-pro-border">
                <SetupPreviewRow
                  number="1"
                  icon={<Download size={18} />}
                  title="Download transcription"
                  detail="Saved once and reused for future meetings"
                />
                <SetupPreviewRow
                  number="2"
                  icon={<Mic size={18} />}
                  title="Allow microphone"
                  detail="Captures your side of the conversation"
                />
                <SetupPreviewRow
                  number="3"
                  icon={<MonitorSpeaker size={18} />}
                  title="Allow system audio"
                  detail="Captures everyone else in the meeting"
                />
              </ol>

              <div className="px-7 py-6 sm:px-8">
                <button
                  type="button"
                  onClick={() => void startSetup()}
                  className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-pro-accent px-6 text-sm font-semibold text-pro-bg shadow-sm transition-[background-color,transform] duration-200 ease-out hover:bg-pro-accent/90 active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pro-accent focus-visible:ring-offset-2 focus-visible:ring-offset-pro-surface"
                >
                  Continue setup
                </button>
                <p className="mt-3 text-center text-[11px] leading-5 text-pro-text-muted">
                  You can change permissions later in System Settings.
                </p>
              </div>
            </div>
          </section>
        ) : (
          <section className="grid min-w-0 w-full items-start gap-10 lg:grid-cols-[17rem_minmax(0,1fr)] lg:gap-12">
            <div className="min-w-0 max-w-sm lg:pt-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-pro-border bg-pro-surface shadow-sm">
                  <Logo size={38} />
                </div>
                <span className="text-sm font-semibold tracking-tight">
                  Pluto
                </span>
              </div>
              <p className="mt-10 text-xs font-semibold uppercase tracking-[0.14em] text-pro-accent">
                Recording setup
              </p>
              <h1 className="mt-3 text-[1.875rem] font-semibold leading-tight tracking-[-0.025em]">
                {readiness.status === 'ready'
                  ? 'Ready to record'
                  : 'Getting Pluto ready'}
              </h1>
              <p className="mt-4 text-sm leading-6 text-pro-text-muted">
                The transcription model is downloaded once. Pluto will keep this
                screen current as each requirement becomes ready.
              </p>
            </div>

            <div className="min-w-0">
              <div className="overflow-hidden rounded-xl border border-pro-border bg-pro-surface shadow-sm">
                <div className="border-b border-pro-border px-6 py-5">
                  <h2 className="text-sm font-semibold">Setup checklist</h2>
                  <p className="mt-1 text-xs leading-5 text-pro-text-muted">
                    Pluto checks each item automatically.
                  </p>
                </div>
                <div className="divide-y divide-pro-border">
                  <RequirementRow
                    icon={<Download size={20} />}
                    title="Local transcription"
                    detail={
                      requirements.transcription === 'preparing'
                        ? 'Downloading and verifying English Parakeet live transcription'
                        : requirements.transcription === 'ready'
                          ? 'English Parakeet live transcription is verified'
                          : requirements.transcription === 'error'
                            ? 'Could not prepare transcription'
                            : 'Checking local models'
                    }
                    state={requirements.transcription}
                    loadingIndicator={
                      requirements.transcription === 'preparing' ? (
                        <ModelDownloadProgress
                          progress={modelDownloadProgress}
                        />
                      ) : undefined
                    }
                    action={
                      requirements.transcription === 'error' ? (
                        <button
                          type="button"
                          onClick={() => void prepareLocalModels()}
                          className="rounded-md border border-rose-200 bg-rose-50 px-4 py-2 text-xs font-semibold text-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400"
                        >
                          Try again
                        </button>
                      ) : undefined
                    }
                  />
                  <RequirementRow
                    icon={<Mic size={20} />}
                    title="Microphone"
                    detail="Captures your side of the conversation"
                    state={requirements.microphone}
                    action={
                      requirements.microphone === 'blocked' ? (
                        <button
                          type="button"
                          onClick={() => void requestMicrophone()}
                          className="rounded-md border border-pro-border bg-pro-bg px-4 py-2 text-xs font-semibold transition-colors hover:bg-pro-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pro-accent"
                        >
                          Allow microphone
                        </button>
                      ) : undefined
                    }
                  />
                  <RequirementRow
                    icon={<MonitorSpeaker size={20} />}
                    title="System audio"
                    detail="Captures the other people in your meeting"
                    state={requirements.systemAudio}
                    action={
                      requirements.systemAudio === 'blocked' ? (
                        <div className="flex flex-wrap justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => void openSystemAudioSettings()}
                            className="rounded-md border border-pro-border bg-pro-bg px-4 py-2 text-xs font-semibold transition-colors hover:bg-pro-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pro-accent"
                          >
                            Open Settings
                          </button>
                          <button
                            type="button"
                            onClick={() => void checkReadiness()}
                            className="rounded-md px-3 py-2 text-xs font-semibold text-pro-text-muted transition-colors hover:bg-pro-hover hover:text-pro-text-main focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pro-accent"
                          >
                            Check again
                          </button>
                        </div>
                      ) : undefined
                    }
                  />
                </div>
              </div>

              <button
                type="button"
                onClick={() => void finish()}
                disabled={!readiness.canComplete || finishing}
                className="mt-5 inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-pro-accent px-6 text-sm font-semibold text-pro-bg shadow-sm transition-[background-color,transform,opacity] duration-200 ease-out hover:bg-pro-accent/90 active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pro-accent focus-visible:ring-offset-2 focus-visible:ring-offset-pro-bg disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-pro-accent"
              >
                {finishing ? 'Opening Pluto…' : 'Start using Pluto'}
              </button>
            </div>
          </section>
        )}
      </div>
    </main>
  );
};

const SetupPreviewRow = ({
  number,
  icon,
  title,
  detail,
}: {
  number: string;
  icon: React.ReactNode;
  title: string;
  detail: string;
}) => (
  <li className="grid grid-cols-[2rem_2.25rem_1fr] items-center gap-3 px-7 py-4 sm:px-8">
    <span className="font-mono text-[11px] tabular-nums text-pro-text-muted">
      {number}
    </span>
    <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-pro-bg text-pro-accent">
      {icon}
    </span>
    <span className="min-w-0">
      <span className="block text-sm font-semibold">{title}</span>
      <span className="mt-0.5 block text-xs leading-5 text-pro-text-muted">
        {detail}
      </span>
    </span>
  </li>
);

const RequirementRow = ({
  icon,
  title,
  detail,
  state,
  action,
  loadingIndicator,
}: {
  icon: React.ReactNode;
  title: string;
  detail: React.ReactNode;
  state: 'checking' | 'preparing' | 'ready' | 'error' | 'granted' | 'blocked';
  action?: React.ReactNode;
  loadingIndicator?: React.ReactNode;
}) => {
  const ready = state === 'ready' || state === 'granted';
  const blocked = state === 'error' || state === 'blocked';
  return (
    <div className="flex min-h-24 items-center gap-4 px-6 py-5">
      <div
        className={`flex h-8 w-11 shrink-0 items-center justify-center rounded-md border ${requirementTone(ready, blocked)}`}
      >
        {ready ? <Check size={20} /> : icon}
      </div>
      <div className="min-w-0 flex-1">
        <h2 className="text-sm font-bold">{title}</h2>
        <p className="mt-1 text-xs leading-5 text-pro-text-muted">{detail}</p>
        {(state === 'checking' || state === 'preparing') && (
          <div className="mt-3">
            {loadingIndicator ?? (
              <div className="h-1.5 overflow-hidden rounded-full bg-pro-bg">
                <div className="h-full w-2/3 animate-pulse rounded-full bg-pro-accent" />
              </div>
            )}
          </div>
        )}
      </div>
      {action}
    </div>
  );
};
