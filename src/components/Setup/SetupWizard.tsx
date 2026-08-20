import { Check, Download, Loader2, Mic, MonitorSpeaker } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  type SetupReadinessInput,
  deriveSetupReadiness,
} from '../../services/setupReadiness';
import { Logo } from '../Brand/Logo';

interface SetupWizardProps {
  onComplete: () => void;
}

const isGranted = (status: unknown) =>
  status === 'authorized' || status === 'granted';

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

  const readiness = useMemo(
    () => deriveSetupReadiness(requirements),
    [requirements],
  );

  const checkPermissions = useCallback(async () => {
    const [microphone, systemAudio] = await Promise.all([
      window.ipcRenderer.invoke('CHECK_MICROPHONE_PERMISSION'),
      window.ipcRenderer.invoke('CHECK_SYSTEM_AUDIO_PERMISSION'),
    ]);
    setRequirements((current) => ({
      ...current,
      microphone: isGranted(microphone) ? 'granted' : 'blocked',
      systemAudio: isGranted(systemAudio) ? 'granted' : 'blocked',
    }));
  }, []);

  const prepareLocalModels = useCallback(async () => {
    setRequirements((current) => ({
      ...current,
      transcription: 'preparing',
    }));
    try {
      const [transcription, speakers] = await Promise.all([
        window.ipcRenderer.invoke('TRANSCRIPTION_PREPARE_FINAL'),
        window.ipcRenderer.invoke('WHISPER_PREPARE_DIARIZATION_MODELS'),
      ]);
      if (transcription?.ready !== true || speakers?.ready !== true) {
        throw new Error('local_models_not_ready');
      }
      setRequirements((current) => ({
        ...current,
        transcription: 'ready',
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
    void Promise.all([prepareLocalModels(), checkPermissions()]);
  }, [checkPermissions, hydrated, prepareLocalModels, step]);

  const startSetup = async () => {
    await window.ipcRenderer.invoke('SET_SETTING', {
      key: 'setup_step',
      value: '2',
    });
    setStep(2);
  };

  const requestMicrophone = async () => {
    await window.ipcRenderer.invoke('REQUEST_MICROPHONE_PERMISSION');
    await checkPermissions();
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
      <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col justify-center px-8 py-14">
        {step === 1 ? (
          <section className="mx-auto w-full max-w-lg text-center">
            <div className="mx-auto mb-8 flex h-16 w-16 items-center justify-center rounded-lg border border-pro-border bg-pro-surface shadow-sm">
              <Logo size={62} />
            </div>
            <p className="mb-4 text-xs font-bold font-medium text-pro-accent">
              Welcome to Pluto
            </p>
            <h1 className="text-3xl font-semibold md:text-4xl">
              Meetings remembered, privately
            </h1>
            <p className="mx-auto mt-6 max-w-md text-base leading-7 text-pro-text-muted">
              Pluto records your meetings and turns them into useful memory.
              Transcription stays on this Mac.
            </p>
            <button
              type="button"
              onClick={() => void startSetup()}
              className="mt-10 h-10 w-full rounded-md bg-pro-text-main px-6 text-sm font-bold text-white shadow-sm transition-transform duration-200 hover:scale-[1.01] active:scale-[0.99] dark:bg-pro-accent dark:text-white"
            >
              Set up Pluto
            </button>
            <p className="mt-4 text-xs text-pro-text-muted/70">
              Pluto will download local transcription models and request the two
              permissions needed to record.
            </p>
          </section>
        ) : (
          <section className="w-full">
            <div className="mb-9">
              <p className="mb-3 text-xs font-bold font-medium text-pro-accent">
                Recording setup
              </p>
              <h1 className="text-3xl font-semibold md:text-3xl">
                {readiness.status === 'ready'
                  ? 'Ready to record'
                  : 'Getting Pluto ready'}
              </h1>
              <p className="mt-3 max-w-xl text-sm leading-6 text-pro-text-muted">
                The local transcription download may take a few minutes. It is
                saved once and reused for future meetings.
              </p>
            </div>

            <div className="divide-y divide-pro-border overflow-hidden rounded-lg border border-pro-border bg-pro-surface shadow-sm">
              <RequirementRow
                icon={<Download size={20} />}
                title="Local transcription"
                detail={
                  requirements.transcription === 'preparing'
                    ? 'Downloading and verifying Parakeet and speaker models'
                    : requirements.transcription === 'ready'
                      ? 'Downloaded and verified'
                      : requirements.transcription === 'error'
                        ? 'Could not prepare transcription'
                        : 'Checking local models'
                }
                state={requirements.transcription}
                action={
                  requirements.transcription === 'error' ? (
                    <button
                      type="button"
                      onClick={() => void prepareLocalModels()}
                      className="rounded-md border border-rose-200 bg-rose-50 px-4 py-2 text-xs font-bold text-rose-700"
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
                      className="rounded-md border border-pro-border px-4 py-2 text-xs font-bold"
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
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => void openSystemAudioSettings()}
                        className="rounded-md border border-pro-border px-4 py-2 text-xs font-bold"
                      >
                        Open Settings
                      </button>
                      <button
                        type="button"
                        onClick={() => void checkPermissions()}
                        className="rounded-md bg-pro-bg px-4 py-2 text-xs font-bold"
                      >
                        Check again
                      </button>
                    </div>
                  ) : undefined
                }
              />
            </div>

            <button
              type="button"
              onClick={() => void finish()}
              disabled={!readiness.canComplete || finishing}
              className="mt-8 h-10 w-full rounded-md bg-pro-text-main px-6 text-sm font-bold text-white shadow-sm transition-all disabled:cursor-not-allowed disabled:opacity-35 dark:bg-pro-accent dark:text-white"
            >
              {finishing ? 'Opening Pluto…' : 'Start using Pluto'}
            </button>
          </section>
        )}
      </div>
    </main>
  );
};

const RequirementRow = ({
  icon,
  title,
  detail,
  state,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  detail: string;
  state: 'checking' | 'preparing' | 'ready' | 'error' | 'granted' | 'blocked';
  action?: React.ReactNode;
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
          <div className="mt-3 h-1.5 overflow-hidden rounded bg-pro-bg">
            <div className="h-full w-2/3 animate-pulse rounded bg-pro-accent" />
          </div>
        )}
      </div>
      {action}
    </div>
  );
};
