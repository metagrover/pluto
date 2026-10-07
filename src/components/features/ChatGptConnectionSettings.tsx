import { useEffect, useState } from 'react';
import {
  type PlutoMcpSnapshot,
  getChatGptConnectionStatus,
  openChatGpt,
  openChatGptSetupGuide,
  setChatGptConnectionEnabled,
} from '../../api/chatgptConnection';
import chatGptLogo from '../../assets/brand/chatgpt.svg';

const actionClass =
  'rounded-lg border border-pro-border bg-pro-surface px-3 py-2 text-[13px] font-medium text-pro-text-main hover:bg-pro-bg disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-pro-accent';

export const ChatGptConnectionSettings = () => {
  const [status, setStatus] = useState<PlutoMcpSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = Boolean(
    status?.enabled && status.running && status.pluginReady,
  );
  const pluginLabel =
    status?.pluginName === 'pluto-notes-development'
      ? 'Pluto (Development)'
      : 'Pluto';

  useEffect(() => {
    let mounted = true;
    void getChatGptConnectionStatus()
      .then((snapshot) => {
        if (mounted) setStatus(snapshot);
      })
      .catch(() => {
        if (mounted) {
          setError(
            'Connection settings are unavailable. Open this setting in the Pluto desktop app.',
          );
        }
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const changeEnabled = async () => {
    if (!status || busy || (!status.enabled && !consent)) return;
    setBusy(true);
    setError(null);
    try {
      const next = await setChatGptConnectionEnabled(!status.enabled);
      setStatus(next);
      if (!next.enabled) setConsent(false);
      if (!status.enabled && next.enabled && next.running && next.pluginReady) {
        try {
          await openChatGpt();
        } catch {
          setError(
            'Local setup is complete. Open ChatGPT desktop to start a Work chat on this computer. If ChatGPT is not installed, install it on this computer first.',
          );
        }
      }
    } catch {
      setError(
        status.enabled
          ? 'Access could not be disabled. Try again; access may still be enabled.'
          : 'The local service could not be enabled. Try again.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mb-8" aria-labelledby="chatgpt-connection-heading">
      <h3
        id="chatgpt-connection-heading"
        className="mb-3 ml-1 flex items-center gap-2 text-[13px] font-semibold text-pro-text-main"
      >
        <img
          src={chatGptLogo}
          alt=""
          aria-hidden="true"
          className="h-5 w-5 dark:invert"
        />
        ChatGPT connection
      </h3>
      <div className="space-y-4 rounded-xl border border-pro-border/60 bg-pro-surface/70 p-5">
        <div className="space-y-1">
          <p className="text-[13px] font-medium text-pro-text-main">
            Discuss your meetings in ChatGPT
          </p>
          <p className="text-xs leading-relaxed text-pro-text-muted">
            Get feedback, compare meetings, and explore patterns grounded in
            your meeting notes. Connect Pluto to the ChatGPT desktop app on this
            computer.
          </p>
        </div>
        <div className="border-y border-pro-border/60 py-4">
          <h4 className="mb-4 text-[13px] font-semibold text-pro-text-main">
            {ready
              ? 'Your next steps in ChatGPT'
              : 'Here’s what happens after you connect'}
          </h4>
          <ol className="space-y-4 text-xs leading-relaxed text-pro-text-muted">
            <li className="flex gap-3">
              <span
                aria-hidden="true"
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-pro-bg font-semibold text-pro-text-main"
              >
                1
              </span>
              <div>
                <p className="font-medium text-pro-text-main">
                  Restart ChatGPT once
                </p>
                <p>
                  Pluto installs the connection and opens ChatGPT. To load it,
                  fully quit ChatGPT (⌘Q), then reopen it. Opening another
                  window isn’t enough.
                </p>
              </div>
            </li>
            <li className="flex gap-3">
              <span
                aria-hidden="true"
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-pro-bg font-semibold text-pro-text-main"
              >
                2
              </span>
              <div>
                <p className="font-medium text-pro-text-main">
                  Start a new Work chat
                </p>
                <p>
                  In ChatGPT, choose{' '}
                  <strong className="font-semibold text-pro-text-main">
                    Work
                  </strong>{' '}
                  and start a new chat on this Mac. You can also use “Start a
                  ChatGPT chat” here after connecting.
                </p>
              </div>
            </li>
            <li className="flex gap-3">
              <span
                aria-hidden="true"
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-pro-accent/10 font-semibold text-pro-accent"
              >
                3
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-pro-text-main">
                  Type @ and select {pluginLabel}
                </p>
                <p>
                  Choose Pluto from the menu that appears, then ask about your
                  meetings.
                </p>
                <figure className="mt-3">
                  <div className="rounded-xl border border-pro-accent/40 bg-pro-bg p-3 text-pro-text-main">
                    <span className="inline-flex rounded-md bg-pro-accent/10 px-2 py-1 font-semibold text-pro-accent">
                      @{pluginLabel}
                    </span>
                    <p className="mt-2">
                      What did we decide in my latest meeting?
                    </p>
                  </div>
                  <figcaption className="mt-1.5 text-[11px] text-pro-text-muted">
                    Example message · select Pluto before sending
                  </figcaption>
                </figure>
              </div>
            </li>
          </ol>
        </div>
        {ready ? (
          <div className="space-y-3">
            <p className="text-xs leading-relaxed text-pro-text-main">
              <strong className="font-semibold">
                Just connected or updated?
              </strong>{' '}
              Restart ChatGPT first, then open your chat below. Keep Pluto
              running with access enabled.
            </p>
            <button
              type="button"
              className={`${actionClass} border-pro-accent/50 text-pro-accent`}
              onClick={() => {
                setError(null);
                void openChatGpt().catch(() => {
                  setError(
                    'ChatGPT could not be opened. Install the ChatGPT desktop app on this computer, then try again.',
                  );
                });
              }}
            >
              Start a ChatGPT chat
            </button>
            <details className="text-xs leading-relaxed text-pro-text-muted">
              <summary className="cursor-pointer rounded font-medium text-pro-text-main focus-visible:outline focus-visible:outline-2 focus-visible:outline-pro-accent">
                Can’t find Pluto in ChatGPT?
              </summary>
              <p className="mt-2">
                Your plugin appears under Plugins → Personal on this Mac. If
                ChatGPT restores an older screen, start a new Work chat and
                mention Pluto using @. You need a ChatGPT desktop app with local
                plugin support.
              </p>
            </details>
          </div>
        ) : null}
        <p role="status" className="text-xs font-medium text-pro-text-main">
          {loading
            ? 'Checking local service…'
            : !status
              ? 'Local service unavailable'
              : status.running && status.pluginReady
                ? 'Local setup complete'
                : status.enabled
                  ? 'Connection needs attention'
                  : 'Access disabled'}
        </p>
        <p
          id="chatgpt-access-disclosure"
          className="text-xs leading-relaxed text-pro-text-muted"
        >
          Enabling makes all your meeting notes available for reading through
          this connection. Notes retrieved in ChatGPT are sent to OpenAI. Raw
          transcripts and audio are not shared. Disabling revokes future access;
          notes already shared in ChatGPT remain there.
        </p>
        {status && !status.enabled ? (
          <label className="flex items-start gap-2 text-xs leading-relaxed text-pro-text-main">
            <input
              type="checkbox"
              checked={consent}
              disabled={busy}
              onChange={(event) => setConsent(event.target.checked)}
              aria-describedby="chatgpt-access-disclosure"
              className="mt-0.5 accent-pro-accent"
            />
            I allow my meeting notes to be read through this connection and sent
            to OpenAI when retrieved in ChatGPT.
          </label>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={`${actionClass} ${!status?.enabled ? 'border-pro-accent/50 text-pro-accent' : ''}`}
            disabled={
              loading || !status || busy || (!status.enabled && !consent)
            }
            onClick={() => void changeEnabled()}
          >
            {busy
              ? status?.enabled
                ? 'Disabling…'
                : 'Preparing…'
              : status?.enabled
                ? 'Disable access'
                : 'Connect to ChatGPT'}
          </button>
          <button
            type="button"
            className={actionClass}
            onClick={() => {
              setError(null);
              void openChatGptSetupGuide().catch(() => {
                setError(
                  'The setup guide could not be opened. Try again in the Pluto desktop app.',
                );
              });
            }}
          >
            Connection help
          </button>
        </div>
        {error || status?.error ? (
          <p role="alert" className="text-xs leading-relaxed text-red-500">
            {error ??
              'The connection could not be prepared. Make sure the ChatGPT desktop app supports local plugins and you are signed in, then disable access and try again.'}
          </p>
        ) : null}
      </div>
    </section>
  );
};
