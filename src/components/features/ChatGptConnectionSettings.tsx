import { useEffect, useState } from 'react';
import {
  type PlutoMcpSnapshot,
  getChatGptConnectionStatus,
  openChatGpt,
  openChatGptSetupGuide,
  setChatGptConnectionEnabled,
} from '../../api/chatgptConnection';
import chatGptLogo from '../../assets/brand/chatgpt.svg';

const buttonClass =
  'rounded-lg border px-3 py-2 text-[13px] font-medium disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pro-accent';
const actionClass = `${buttonClass} border-pro-border bg-pro-surface text-pro-text-main hover:bg-pro-bg`;
const primaryActionClass = `${buttonClass} border-transparent bg-pro-text-main text-pro-bg hover:opacity-90`;

export const ChatGptConnectionSettings = () => {
  const [status, setStatus] = useState<PlutoMcpSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = Boolean(
    status?.enabled && status.running && status.pluginReady,
  );
  const development = status?.pluginName === 'pluto-notes-development';
  const pluginLabel = development ? 'Pluto (Development)' : 'Pluto';

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

  const setupSteps = (
    <div className="space-y-3">
      <ol className="list-decimal space-y-2 pl-4 text-xs leading-relaxed text-pro-text-main marker:text-pro-text-main/75">
        <li>
          <strong className="font-medium">Restart ChatGPT once.</strong> Fully
          quit ChatGPT (⌘Q), then reopen it to load the plugin.
        </li>
        <li>
          <strong className="font-medium">Start a new Work chat.</strong> Choose
          Work in the ChatGPT desktop app on this Mac.
        </li>
        <li>
          <strong className="font-medium">
            Type @ and select {pluginLabel}.
          </strong>{' '}
          Choose it from the menu before sending your message.
        </li>
      </ol>
      <p className="text-xs leading-relaxed text-pro-text-main/75">
        Try asking:{' '}
        <q className="text-pro-text-main">
          What did we decide in my latest meeting?
        </q>
      </p>
    </div>
  );

  return (
    <section
      className="mb-8 max-w-3xl"
      aria-labelledby="chatgpt-connection-heading"
    >
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
      <div className="space-y-4 rounded-xl border border-pro-border/60 bg-pro-surface/70 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="space-y-1">
            <p className="text-[13px] font-medium text-pro-text-main">
              Your meeting notes in ChatGPT
            </p>
            <p className="text-xs leading-relaxed text-pro-text-main/75">
              Ask questions, compare meetings, and explore decisions.
            </p>
          </div>
          <p
            role="status"
            className="text-xs leading-relaxed text-pro-text-main/75"
          >
            {loading
              ? 'Checking access…'
              : !status
                ? 'Connection unavailable'
                : ready
                  ? 'Note access enabled'
                  : status.enabled
                    ? 'Connection needs attention'
                    : 'Access disabled'}
          </p>
        </div>
        {development ? (
          <p className="text-xs leading-relaxed text-pro-text-main">
            <strong className="font-medium">Development connection.</strong>{' '}
            This source build uses {pluginLabel}. The installed release uses
            Pluto; each reads notes from its own running app.
          </p>
        ) : null}
        {ready ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className={primaryActionClass}
                disabled={busy}
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
              <button
                type="button"
                className={actionClass}
                disabled={busy}
                onClick={() => void changeEnabled()}
              >
                {busy ? 'Disabling…' : 'Disable access'}
              </button>
            </div>
            <p className="text-xs leading-relaxed text-pro-text-main/75">
              Opens a draft with @{pluginLabel} and “What should I focus on?”
              for you to review and send. Keep Pluto running; restart ChatGPT
              after connecting or updating.
            </p>
          </div>
        ) : null}
        <div className="border-t border-pro-border/60 pt-4">
          {ready ? (
            <details className="text-xs leading-relaxed text-pro-text-main/75">
              <summary className="cursor-pointer rounded font-medium text-pro-text-main focus-visible:outline focus-visible:outline-2 focus-visible:outline-pro-accent">
                How to use Pluto in ChatGPT
              </summary>
              <div className="mt-3">{setupSteps}</div>
            </details>
          ) : (
            <details className="text-xs leading-relaxed text-pro-text-main/75">
              <summary className="cursor-pointer rounded font-medium text-pro-text-main focus-visible:outline focus-visible:outline-2 focus-visible:outline-pro-accent">
                After you connect
              </summary>
              <div className="mt-3">{setupSteps}</div>
            </details>
          )}
        </div>
        <div className="space-y-3 border-t border-pro-border/60 pt-4">
          <p
            id="chatgpt-access-disclosure"
            className="text-xs leading-relaxed text-pro-text-main/75"
          >
            ChatGPT can read all your meeting notes. Retrieved notes are sent to
            OpenAI. Raw transcripts and audio are not shared. Disabling revokes
            future access; notes already shared in ChatGPT remain there.
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
              Allow ChatGPT to read my meeting notes
            </label>
          ) : null}
          {!ready ? (
            <button
              type="button"
              className={status?.enabled ? actionClass : primaryActionClass}
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
          ) : null}
          <details className="text-xs leading-relaxed text-pro-text-main/75">
            <summary className="cursor-pointer rounded font-medium text-pro-text-main focus-visible:outline focus-visible:outline-2 focus-visible:outline-pro-accent">
              Troubleshooting
            </summary>
            <div className="mt-3 space-y-3">
              <p>
                Can’t find {pluginLabel}? Look under Plugins → Personal on this
                Mac, then start a new Work chat and mention {pluginLabel} using
                @. ChatGPT Desktop must support local plugins.
              </p>
              <p>
                ChatGPT may ask for permission before reading notes. Note access
                enabled means Pluto is ready; it does not confirm a successful
                conversation in ChatGPT.
              </p>
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
                Open setup guide
              </button>
            </div>
          </details>
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
