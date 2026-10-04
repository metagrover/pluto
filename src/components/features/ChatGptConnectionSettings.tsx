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
            className={actionClass}
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
        {status?.enabled && status.running && status.pluginReady ? (
          <div className="space-y-3">
            <p className="text-xs leading-relaxed text-pro-text-muted">
              To finish setup, fully quit ChatGPT (⌘Q) and reopen it. Keep Pluto
              running with access enabled, then start a new Work chat and
              mention Pluto. ChatGPT needs this restart to load the installed
              plugin; opening another window is not enough.
            </p>
            <button
              type="button"
              className={actionClass}
              onClick={() => {
                setError(null);
                void openChatGpt().catch(() => {
                  setError(
                    'ChatGPT could not be opened. Install the ChatGPT desktop app on this computer, then try again.',
                  );
                });
              }}
            >
              Open ChatGPT
            </button>
          </div>
        ) : null}
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
