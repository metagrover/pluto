import { useEffect, useRef, useState } from 'react';
import type {
  ChatGPTModel,
  ChatGPTStatus,
} from '../../../electron/chatgpt/types';
import type {
  ChatGPTUsagePolicy,
  ChatGPTUsageSummary,
} from '../../../electron/chatgpt/usage';
import {
  CHATGPT_DEFAULT_USAGE_POLICY,
  chatGPTBackgroundBudget,
} from '../../../electron/chatgpt/usagePolicy';
import chatGPTLogo from '../../assets/brand/chatgpt.svg';
import { ChatGPTPlanWelcome } from './ChatGPTPlanWelcome';

export function ChatGPTIntelligenceSettings({
  activationPending = false,
  onConnected,
}: { activationPending?: boolean; onConnected?: () => Promise<void> } = {}) {
  const signInAttempt = useRef(0);
  const operation = useRef(0);
  const [status, setStatus] = useState<ChatGPTStatus | null>(null);
  const [models, setModels] = useState<ChatGPTModel[]>([]);
  const [model, setModel] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [usage, setUsage] = useState<ChatGPTUsageSummary | null>(null);
  const [policy, setPolicy] = useState<ChatGPTUsagePolicy | null>(null);
  const [welcome, setWelcome] = useState(false);
  const invoke = (channel: string, ...args: unknown[]) =>
    window.ipcRenderer.invoke(channel, ...args);
  const buttonClass =
    'rounded-lg border border-pro-border px-3 py-2 text-[13px] font-medium text-pro-text-main transition-colors hover:bg-pro-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-pro-accent disabled:opacity-50';
  const primaryClass =
    'inline-flex items-center justify-center gap-2 rounded-lg bg-pro-accent px-4 py-2.5 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pro-accent disabled:opacity-50';

  const refresh = async () => {
    const next = (await invoke('CHATGPT_STATUS')) as ChatGPTStatus;
    setStatus(next);
    const summary = (await invoke('CHATGPT_USAGE')) as
      | ChatGPTUsageSummary
      | undefined;
    if (summary) {
      setUsage(summary);
      setPolicy(summary.policy);
    }
    if (next?.planEnabled) {
      const available = (await invoke('CHATGPT_MODELS')) as ChatGPTModel[];
      setModels(available);
      const selected = await invoke('GET_SETTING', 'chatgpt_model');
      setModel(typeof selected === 'string' ? selected : '');
      if (!available.length)
        setError(
          'No models are available for this account. Check your ChatGPT plan and workspace access, then refresh the connection.',
        );
      return available.some((item) => item.id === selected);
    }
    setModels([]);
    setModel('');
    return false;
  };

  useEffect(() => {
    void refresh().catch(() =>
      setError(
        'Could not load ChatGPT access. Refresh the connection to try again.',
      ),
    );
    const updateUsage = () => {
      void invoke('CHATGPT_STATUS')
        .then(setStatus)
        .catch(() => {});
      void invoke('CHATGPT_USAGE')
        .then((next) => {
          if (next) setUsage(next);
        })
        .catch(() => {});
    };
    window.addEventListener('focus', updateUsage);
    const timer = setInterval(updateUsage, 15_000);
    return () => {
      ++signInAttempt.current;
      ++operation.current;
      clearInterval(timer);
      window.removeEventListener('focus', updateUsage);
    };
  }, []);

  const run = async (action: string, callback: () => Promise<unknown>) => {
    const current = ++operation.current;
    setBusy(action);
    setError(null);
    setNotice(null);
    try {
      await callback();
    } catch (failure) {
      if (current !== operation.current) return;
      setError(
        failure instanceof Error
          ? failure.message
          : 'ChatGPT could not connect. Try again.',
      );
      await invoke('CHATGPT_STATUS')
        .then(setStatus)
        .catch(() => {});
    } finally {
      if (current === operation.current) setBusy(null);
    }
  };
  const manageUsage = () =>
    void invoke('CHATGPT_MANAGE_USAGE').catch(() =>
      setError(
        'Could not open ChatGPT settings. Visit chatgpt.com/settings/usage.',
      ),
    );
  const ready = status?.connected && status.planEnabled;
  const background = usage ? chatGPTBackgroundBudget(usage.policy) : null;
  const localLimit =
    usage &&
    (usage.requests >= usage.policy.dailyRequests ||
      usage.inputTokens + usage.outputTokens + usage.estimatedTokens + 8192 >
        usage.policy.dailyTokens);

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <img
          src={chatGPTLogo}
          alt=""
          className="mt-0.5 h-6 w-6 shrink-0 dark:invert"
        />
        <div className="min-w-0 flex-1">
          <h4 className="text-[15px] font-semibold text-pro-text-main">
            {ready
              ? activationPending
                ? 'Ready to use your ChatGPT plan'
                : 'Using your ChatGPT plan in Pluto'
              : 'Use your ChatGPT plan in Pluto'}
          </h4>
          <p
            role="status"
            className="mt-1 break-words text-[13px] leading-5 text-pro-text-main/75"
          >
            {ready
              ? (status.email ?? 'ChatGPT account connected')
              : status?.connected
                ? 'Signed in. Allow plan usage to finish connecting.'
                : 'Sign in to run Pluto’s AI features with the models available on your eligible ChatGPT plan.'}
          </p>
        </div>
        {status?.connected ? (
          <button
            type="button"
            disabled={busy !== null}
            className={buttonClass}
            onClick={() =>
              void run('sign-out', async () => {
                const result = (await invoke('CHATGPT_SIGN_OUT')) as {
                  remoteRevoked: boolean;
                };
                setWelcome(false);
                await refresh();
                if (!result.remoteRevoked)
                  setNotice(
                    'Signed out locally. Remote revocation could not be confirmed; disconnect Pluto in ChatGPT settings.',
                  );
              })
            }
          >
            {busy === 'sign-out' ? 'Signing out…' : 'Sign out'}
          </button>
        ) : null}
      </div>

      {!ready ? (
        <div className="space-y-4">
          <p className="text-[13px] leading-5 text-pro-text-main/75">
            Recording and transcription stay on this Mac. By signing in and
            enabling plan usage, you allow Pluto to send relevant transcript
            text, notes, and questions to OpenAI.
          </p>
          <p className="text-[13px] leading-5 text-pro-text-main/75">
            Start with Terra when available,{' '}
            {CHATGPT_DEFAULT_USAGE_POLICY.dailyRequests} requests a day, and
            limited automatic People and Project updates. You can adjust these
            later.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={busy !== null || !status}
              className={primaryClass}
              onClick={() =>
                void run('sign-in', async () => {
                  const attempt = ++signInAttempt.current;
                  await invoke('CHATGPT_SIGN_IN');
                  if (attempt !== signInAttempt.current) return;
                  const configured = await refresh();
                  if (attempt !== signInAttempt.current) return;
                  const connection = (await invoke(
                    'CHATGPT_STATUS',
                  )) as ChatGPTStatus;
                  if (attempt !== signInAttempt.current) return;
                  if (!connection?.planEnabled || !configured)
                    throw new Error(
                      'Allow ChatGPT plan usage in the browser to finish connecting.',
                    );
                  await onConnected?.();
                  if (attempt !== signInAttempt.current) return;
                  setWelcome(true);
                })
              }
            >
              <img src={chatGPTLogo} alt="" className="h-4 w-4 invert" />
              {busy === 'sign-in'
                ? 'Waiting for browser…'
                : status?.connected
                  ? 'Enable ChatGPT plan usage'
                  : 'Sign in with ChatGPT'}
            </button>
            {busy === 'sign-in' ? (
              <button
                type="button"
                className={buttonClass}
                onClick={() =>
                  void (async () => {
                    ++signInAttempt.current;
                    ++operation.current;
                    await invoke('CHATGPT_CANCEL_SIGN_IN');
                    setBusy(null);
                    setNotice(
                      'Sign-in cancelled. Your current provider is unchanged.',
                    );
                  })().catch(() =>
                    setError(
                      'Could not cancel sign-in. Close the browser sign-in page.',
                    ),
                  )
                }
              >
                Cancel sign-in
              </button>
            ) : null}
          </div>
          {busy === 'sign-in' ? (
            <div
              role="status"
              className="rounded-lg bg-pro-surface p-4 text-[13px] leading-5 text-pro-text-main"
            >
              <p className="font-medium">Finish signing in in your browser</p>
              <p className="mt-1 text-pro-text-main/75">
                Choose your account and allow Pluto to use your ChatGPT plan.
                Return to Pluto after approving access.
              </p>
            </div>
          ) : null}
        </div>
      ) : (
        <>
          <p className="text-[13px] leading-5 text-pro-text-main/75">
            {models.find((available) => available.id === model)?.name ??
              'Your selected model'}{' '}
            powers notes and answers. Recording and transcription stay on this
            Mac.
          </p>
          {activationPending ? (
            <p className="text-[13px] leading-5 text-pro-text-main/75">
              By choosing Use ChatGPT, you allow relevant transcript text,
              notes, questions, and context to go to OpenAI, including for
              automatic People and Project updates. Audio stays local.
            </p>
          ) : null}
          {activationPending ? (
            <button
              type="button"
              disabled={
                busy !== null || !models.some((item) => item.id === model)
              }
              className={primaryClass}
              onClick={() =>
                void run('activate', async () => {
                  await onConnected?.();
                  setWelcome(true);
                })
              }
            >
              Use ChatGPT
            </button>
          ) : null}
          {usage ? (
            <section
              aria-label="ChatGPT usage protection"
              className="space-y-4 border-y border-pro-border py-5"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h4 className="text-[13px] font-semibold">Pluto usage today</h4>
                <button
                  type="button"
                  onClick={manageUsage}
                  className="rounded text-[13px] font-medium text-pro-accent underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-pro-accent"
                >
                  Manage usage
                </button>
              </div>
              <p className="text-[14px] text-pro-text-main">
                <span className="font-semibold tabular-nums">
                  {usage.requests.toLocaleString()} of{' '}
                  {usage.policy.dailyRequests.toLocaleString()}
                </span>{' '}
                requests used
              </p>
              <p className="text-[12px] leading-5 text-pro-text-main/75">
                A meeting or answer can use several requests for its checks.
                Pluto reuses saved work to avoid duplicate requests. Limits
                reset at midnight on this Mac.
              </p>
              {localLimit ? (
                <p
                  role="status"
                  className="text-[13px] leading-5 text-pro-text-main"
                >
                  Today’s Pluto allowance is nearly or fully used. Requests that
                  do not fit will wait. You can adjust Pluto’s daily limits
                  below or wait until tomorrow.
                </p>
              ) : null}
              <label className="flex items-start gap-3 text-[13px] leading-5 text-pro-text-main">
                <input
                  type="checkbox"
                  disabled={busy !== null}
                  checked={usage.policy.backgroundEnabled}
                  onChange={(event) => {
                    const enabled = event.target.checked;
                    void run('usage', async () => {
                      const updated = (await invoke(
                        'CHATGPT_SET_USAGE_POLICY',
                        { ...usage.policy, backgroundEnabled: enabled },
                      )) as ChatGPTUsageSummary;
                      setUsage(updated);
                      setPolicy((draft) =>
                        draft
                          ? { ...draft, backgroundEnabled: enabled }
                          : updated.policy,
                      );
                      setNotice(
                        enabled
                          ? 'Automatic updates enabled within your daily limits.'
                          : 'Automatic updates paused. Meeting notes and your questions still run.',
                      );
                    });
                  }}
                  className="mt-1 h-4 w-4 shrink-0 accent-pro-accent"
                />
                <span>
                  <span className="block font-medium">
                    Keep People and Projects up to date
                  </span>
                  <span className="mt-1 block text-pro-text-main/75">
                    Up to {background?.requests} automatic requests a day, with
                    20% of Pluto’s daily token budget reserved for this work.
                    These are included in your daily limit.
                  </span>
                </span>
              </label>
              <p className="text-[12px] leading-5 text-pro-text-main/75">
                These safeguards cover this Pluto profile. Your ChatGPT
                allowance is shared with other apps; view it in Manage usage.
              </p>
            </section>
          ) : null}
        </>
      )}

      {status?.usageLimited ? (
        <section aria-label="ChatGPT requests paused" className="space-y-3">
          <h4 className="text-[14px] font-semibold">
            ChatGPT requests are paused
          </h4>
          <p className="text-[13px] leading-5 text-pro-text-main/75">
            A ChatGPT usage limit was reached. Review your plan allowance before
            trying again.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={primaryClass}
              onClick={manageUsage}
            >
              Manage ChatGPT usage
            </button>
            <button
              type="button"
              disabled={busy !== null}
              className={buttonClass}
              onClick={() =>
                void run('resume', async () => {
                  setStatus(await invoke('CHATGPT_RESUME_USAGE'));
                })
              }
            >
              Try again
            </button>
          </div>
        </section>
      ) : null}

      {ready ? (
        <details className="group text-[13px] text-pro-text-main">
          <summary className="cursor-pointer rounded py-1 font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-pro-accent">
            Advanced settings
          </summary>
          <div className="mt-4 space-y-5">
            <div className="space-y-2">
              <label htmlFor="chatgpt-model" className="block font-medium">
                Model
              </label>
              <p className="text-[12px] leading-5 text-pro-text-main/75">
                Terra is Pluto’s preferred default from our meeting tests.
                Choose another model if you prefer; usage varies by model and
                request.
              </p>
              <select
                id="chatgpt-model"
                value={model}
                disabled={busy !== null || models.length === 0}
                onChange={(event) => {
                  const selected = event.target.value;
                  void run('model', async () => {
                    await invoke('SET_SETTING', {
                      key: 'chatgpt_model',
                      value: selected,
                    });
                    setModel(selected);
                    setNotice('ChatGPT model saved.');
                  });
                }}
                className="w-full rounded-lg border border-pro-border bg-pro-bg px-3 py-2.5 text-[13px] text-pro-text-main focus-visible:outline focus-visible:outline-2 focus-visible:outline-pro-accent"
              >
                {!models.some((available) => available.id === model) ? (
                  <option value="">Choose a model</option>
                ) : null}
                {models.map((available) => (
                  <option key={available.id} value={available.id}>
                    {available.name}
                  </option>
                ))}
              </select>
            </div>
            {policy && usage ? (
              <div className="space-y-3">
                <h4 className="font-medium">Daily limits for Pluto</h4>
                <div className="flex flex-wrap gap-4">
                  <label className="space-y-1">
                    Requests
                    <input
                      aria-label="Daily ChatGPT request limit"
                      type="number"
                      min={1}
                      max={1000}
                      value={policy.dailyRequests}
                      onChange={(event) =>
                        setPolicy({
                          ...policy,
                          dailyRequests: Number(event.target.value),
                        })
                      }
                      className="block w-32 rounded-lg border border-pro-border bg-pro-bg px-3 py-2"
                    />
                  </label>
                  <label className="space-y-1">
                    Token budget
                    <input
                      aria-label="Daily ChatGPT token budget"
                      type="number"
                      min={1000}
                      max={10000000}
                      step={1000}
                      value={policy.dailyTokens}
                      onChange={(event) =>
                        setPolicy({
                          ...policy,
                          dailyTokens: Number(event.target.value),
                        })
                      }
                      className="block w-36 rounded-lg border border-pro-border bg-pro-bg px-3 py-2"
                    />
                  </label>
                </div>
                <p className="text-[12px] leading-5 text-pro-text-main/75">
                  Default: {CHATGPT_DEFAULT_USAGE_POLICY.dailyRequests} requests
                  and{' '}
                  {CHATGPT_DEFAULT_USAGE_POLICY.dailyTokens.toLocaleString()}{' '}
                  tokens. Pluto reserves an estimate before sending. A response
                  can exceed it, so this is not a hard token cap or your
                  remaining ChatGPT quota.
                </p>
                <button
                  type="button"
                  className={buttonClass}
                  disabled={
                    busy !== null ||
                    !Number.isInteger(policy.dailyRequests) ||
                    policy.dailyRequests < 1 ||
                    policy.dailyRequests > 1000 ||
                    !Number.isInteger(policy.dailyTokens) ||
                    policy.dailyTokens < 1000 ||
                    policy.dailyTokens > 10000000
                  }
                  onClick={() =>
                    void run('usage', async () => {
                      const updated = (await invoke(
                        'CHATGPT_SET_USAGE_POLICY',
                        {
                          ...policy,
                          backgroundEnabled: usage.policy.backgroundEnabled,
                        },
                      )) as ChatGPTUsageSummary;
                      setUsage(updated);
                      setPolicy(updated.policy);
                      setNotice('Usage protection saved.');
                    })
                  }
                >
                  {busy === 'usage' ? 'Saving…' : 'Save usage protection'}
                </button>
                <details className="text-[12px] text-pro-text-main/75">
                  <summary className="cursor-pointer">Usage details</summary>
                  <p className="mt-2 leading-5">
                    {usage.requests.toLocaleString()} requests ·{' '}
                    {(usage.inputTokens + usage.outputTokens).toLocaleString()}{' '}
                    reported tokens · {usage.duplicatesAvoided.toLocaleString()}{' '}
                    duplicate requests avoided.
                  </p>
                  {usage.unmeasuredRequests > 0 ? (
                    <p className="mt-2 leading-5">
                      {usage.unmeasuredRequests} pending or unmeasured requests
                      retain a reserved estimate, including interrupted
                      requests.
                    </p>
                  ) : null}
                  <ul className="mt-2 space-y-1">
                    {Object.entries(usage.tasks).map(([task, totals]) => (
                      <li key={task}>
                        {task}: {totals.requests} requests ·{' '}
                        {totals.inputTokens.toLocaleString()} input /{' '}
                        {totals.outputTokens.toLocaleString()} output tokens ·{' '}
                        {totals.failed} failed
                      </li>
                    ))}
                  </ul>
                </details>
              </div>
            ) : null}
            <button
              type="button"
              className={buttonClass}
              disabled={busy !== null}
              onClick={() => void run('refresh', refresh)}
            >
              {busy === 'refresh' ? 'Refreshing…' : 'Refresh connection'}
            </button>
          </div>
        </details>
      ) : error ? (
        <button
          type="button"
          className={buttonClass}
          disabled={busy !== null}
          onClick={() => void run('refresh', refresh)}
        >
          Refresh connection
        </button>
      ) : null}
      {notice ? (
        <p
          role="status"
          className="text-[13px] leading-5 text-pro-text-main/75"
        >
          {notice}
        </p>
      ) : null}
      {error ? (
        <p
          role="alert"
          className="text-[13px] leading-5 text-rose-700 dark:text-rose-400"
        >
          {error}
        </p>
      ) : null}
      <ChatGPTPlanWelcome
        enabled={welcome && Boolean(ready)}
        onContinue={() => setWelcome(false)}
      />
    </div>
  );
}
