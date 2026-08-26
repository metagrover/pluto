import {
  ArrowRight,
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
    ? 'text-emerald-700'
    : blocked
      ? 'text-rose-700'
      : 'text-[oklch(0.53_0.12_255)]';

export const SetupWizard = ({ onComplete }: SetupWizardProps) => {
  const [step, setStep] = useState<1 | 2>(1);
  const [hydrated, setHydrated] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [typedSetupQualifier, setTypedSetupQualifier] = useState('');
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

  useEffect(() => {
    if (!hydrated || step !== 1) return;

    const qualifier = 'just ';
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setTypedSetupQualifier(qualifier);
      return;
    }

    const timers = [...qualifier].map((_, index) =>
      window.setTimeout(
        () => setTypedSetupQualifier(qualifier.slice(0, index + 1)),
        450 + index * 70,
      ),
    );

    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [hydrated, step]);

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
    <main className="fixed inset-0 z-50 overflow-y-auto bg-[oklch(0.965_0.008_85)] text-[oklch(0.25_0.02_258)] selection:bg-[oklch(0.76_0.09_85/0.35)]">
      <div
        className="drag-region fixed inset-x-0 top-0 z-[60] h-9"
        aria-hidden="true"
      />
      {step === 1 ? (
        <div className="grid min-h-full lg:grid-cols-[minmax(22rem,0.78fr)_minmax(32rem,1.22fr)]">
          <ObservatoryPanel
            eyebrow="Your second brain for meetings"
            title={
              <span className="block font-serif text-[0.84em] font-medium leading-[1.16] tracking-[-0.025em]">
                Every conversation, remembered and understood.
              </span>
            }
            description="Pluto connects notes, decisions, people, and next steps so you can focus on the conversation. Transcription stays on this Mac."
            footer="Your audio and transcript stay under your control."
          />

          <section className="flex min-h-[38rem] items-center px-7 py-12 sm:px-12 lg:px-16 xl:px-24">
            <div className="w-full max-w-xl">
              <h2
                aria-label="Ready in just three minutes."
                className="font-serif text-[2rem] font-medium leading-[1.12] tracking-[-0.02em] sm:text-[2.25rem]"
              >
                <span aria-hidden="true">
                  Ready in {typedSetupQualifier}three minutes.
                </span>
              </h2>
              <p className="mt-2 text-[15px] leading-6 text-[oklch(0.56_0.018_258)]">
                One download. Two permissions.
              </p>

              <ol className="mt-9 border-y border-[oklch(0.86_0.012_85)]">
                <SetupPreviewRow
                  icon={<Download size={19} />}
                  title="Local transcription"
                  detail="Downloaded once and kept on this Mac"
                />
                <SetupPreviewRow
                  icon={<Mic size={19} />}
                  title="Microphone access"
                  detail="Records your voice"
                />
                <SetupPreviewRow
                  icon={<MonitorSpeaker size={19} />}
                  title="System audio access"
                  detail="Records everyone else in the meeting"
                />
              </ol>

              <button
                type="button"
                onClick={() => void startSetup()}
                className="group mt-8 inline-flex min-h-12 min-w-48 items-center justify-center gap-3 rounded-lg bg-[oklch(0.25_0.035_258)] px-6 text-sm font-semibold tracking-[0.01em] text-[oklch(0.965_0.008_85)] shadow-sm transition-[background-color,transform] duration-200 ease-out hover:bg-[oklch(0.31_0.045_258)] active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[oklch(0.53_0.12_255)] focus-visible:ring-offset-2 focus-visible:ring-offset-[oklch(0.965_0.008_85)]"
              >
                Begin setup
                <ArrowRight
                  size={16}
                  aria-hidden="true"
                  className="transition-transform duration-200 ease-out group-hover:translate-x-0.5"
                />
              </button>
            </div>
          </section>
        </div>
      ) : (
        <div className="grid min-h-full lg:grid-cols-[minmax(22rem,0.78fr)_minmax(32rem,1.22fr)]">
          <ObservatoryPanel
            eyebrow="Recording setup"
            title={
              <span className="block font-serif text-[0.84em] font-medium leading-[1.16] tracking-[-0.025em]">
                {readiness.status === 'ready'
                  ? 'Ready to record.'
                  : 'Preparing your local workspace.'}
              </span>
            }
            description="Pluto keeps this screen current as each recording requirement becomes ready."
            footer="The transcription model is downloaded once."
          />

          <section className="flex min-h-[38rem] items-center px-7 py-12 sm:px-12 lg:px-16 xl:px-24">
            <div className="w-full max-w-xl">
              <h2 className="font-serif text-[2rem] font-medium leading-[1.12] tracking-[-0.02em] sm:text-[2.25rem]">
                {readiness.status === 'ready'
                  ? 'Everything is ready.'
                  : 'Getting Pluto ready.'}
              </h2>
              <p className="mt-2 text-[15px] leading-6 text-[oklch(0.56_0.018_258)]">
                Pluto checks each item automatically.
              </p>

              <div className="mt-9 border-y border-[oklch(0.86_0.012_85)]">
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
                      <ModelDownloadProgress progress={modelDownloadProgress} />
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
                  detail="Records your voice"
                  state={requirements.microphone}
                  action={
                    requirements.microphone === 'blocked' ? (
                      <button
                        type="button"
                        onClick={() => void requestMicrophone()}
                        className="rounded-md border border-[oklch(0.82_0.015_85)] bg-[oklch(0.985_0.005_85)] px-4 py-2 text-xs font-semibold transition-colors hover:bg-[oklch(0.93_0.01_85)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[oklch(0.53_0.12_255)]"
                      >
                        Allow microphone
                      </button>
                    ) : undefined
                  }
                />
                <RequirementRow
                  icon={<MonitorSpeaker size={20} />}
                  title="System audio"
                  detail="Records everyone else in the meeting"
                  state={requirements.systemAudio}
                  action={
                    requirements.systemAudio === 'blocked' ? (
                      <div className="flex flex-wrap justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => void openSystemAudioSettings()}
                          className="rounded-md border border-[oklch(0.82_0.015_85)] bg-[oklch(0.985_0.005_85)] px-4 py-2 text-xs font-semibold transition-colors hover:bg-[oklch(0.93_0.01_85)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[oklch(0.53_0.12_255)]"
                        >
                          Open Settings
                        </button>
                        <button
                          type="button"
                          onClick={() => void checkReadiness()}
                          className="rounded-md px-3 py-2 text-xs font-semibold text-[oklch(0.5_0.018_258)] transition-colors hover:bg-[oklch(0.93_0.01_85)] hover:text-[oklch(0.25_0.02_258)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[oklch(0.53_0.12_255)]"
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
                className="mt-8 inline-flex min-h-12 min-w-48 items-center justify-center rounded-lg bg-[oklch(0.25_0.035_258)] px-6 text-sm font-semibold tracking-[0.01em] text-[oklch(0.965_0.008_85)] shadow-sm transition-[background-color,transform,opacity] duration-200 ease-out hover:bg-[oklch(0.31_0.045_258)] active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[oklch(0.53_0.12_255)] focus-visible:ring-offset-2 focus-visible:ring-offset-[oklch(0.965_0.008_85)] disabled:cursor-not-allowed disabled:opacity-30"
              >
                {finishing ? 'Opening Pluto…' : 'Start using Pluto'}
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
};

const ObservatoryPanel = ({
  eyebrow,
  title,
  description,
  footer,
}: {
  eyebrow: string;
  title: React.ReactNode;
  description: string;
  footer: string;
}) => (
  <aside className="relative isolate flex min-h-[30rem] overflow-hidden bg-[oklch(0.225_0.035_258)] px-7 py-8 text-[oklch(0.955_0.01_85)] sm:px-12 sm:py-10 lg:min-h-full lg:px-14 lg:pb-12 lg:pt-16 xl:px-20">
    <div
      aria-hidden="true"
      className="pointer-events-none absolute -right-48 top-[8%] h-[34rem] w-[34rem] rotate-[-18deg] rounded-[50%] border border-[oklch(0.76_0.09_85/0.17)]"
    />
    <div
      aria-hidden="true"
      className="pointer-events-none absolute -right-24 top-[26%] h-[19rem] w-[28rem] rotate-[20deg] rounded-[50%] border border-[oklch(0.78_0.025_258/0.11)]"
    />
    <div className="relative z-10 flex w-full flex-col">
      <div className="flex items-center gap-3.5">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[oklch(0.955_0.01_85)] shadow-sm">
          <Logo size={34} />
        </div>
        <span className="font-serif text-xl font-semibold leading-none tracking-[0.01em]">
          Pluto
        </span>
      </div>

      <div className="my-auto max-w-md py-16 lg:py-12">
        <p className="text-xs font-semibold uppercase tracking-[0.17em] text-[oklch(0.79_0.085_85)]">
          {eyebrow}
        </p>
        <h1 className="mt-5 text-[2.6rem] font-semibold leading-[1.06] tracking-[-0.04em] sm:text-[3rem] lg:text-[3.25rem]">
          {title}
        </h1>
        <p className="mt-6 max-w-[38ch] text-[15px] leading-7 text-[oklch(0.79_0.025_258)]">
          {description}
        </p>
      </div>

      <div className="flex max-w-sm items-start gap-3 border-t border-[oklch(0.78_0.025_258/0.17)] pt-5 text-xs leading-5 text-[oklch(0.76_0.022_258)]">
        <LockKeyhole
          size={16}
          className="mt-0.5 shrink-0 text-[oklch(0.79_0.085_85)]"
          aria-hidden="true"
        />
        <p>{footer}</p>
      </div>
    </div>
  </aside>
);

const SetupPreviewRow = ({
  icon,
  title,
  detail,
}: {
  icon: React.ReactNode;
  title: string;
  detail: string;
}) => (
  <li className="grid grid-cols-[2.5rem_1fr] items-center gap-4 border-b border-[oklch(0.88_0.01_85)] py-5 last:border-b-0">
    <span className="flex h-10 w-10 items-center justify-center text-[oklch(0.53_0.12_255)]">
      {icon}
    </span>
    <span className="min-w-0">
      <span className="block text-[15px] font-semibold tracking-[-0.01em]">
        {title}
      </span>
      <span className="mt-0.5 block text-[13px] leading-5 text-[oklch(0.56_0.018_258)]">
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
    <div className="flex min-h-24 items-center gap-4 border-b border-[oklch(0.88_0.01_85)] py-5 last:border-b-0">
      <div
        className={`flex h-10 w-10 shrink-0 items-center justify-center ${requirementTone(ready, blocked)}`}
      >
        {ready ? <Check size={20} /> : icon}
      </div>
      <div className="min-w-0 flex-1">
        <h2 className="text-[15px] font-semibold tracking-[-0.01em]">
          {title}
        </h2>
        <p className="mt-0.5 text-[13px] leading-5 text-[oklch(0.56_0.018_258)]">
          {detail}
        </p>
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
