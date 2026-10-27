import { useEffect, useState } from 'react';
import type { PlutoMcpSnapshot } from '../../../electron/mcp/types';
import {
  getClaudeConnectionStatus,
  openClaude,
  openClaudeSetupGuide,
  setClaudeConnectionEnabled,
} from '../../api/claudeConnection';
import claudeLogo from '../../assets/brand/claude.svg';

const actionClass =
  'rounded-lg border border-pro-border bg-pro-surface px-3 py-2 text-[13px] font-medium text-pro-text-main hover:bg-pro-bg disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pro-accent';

export const ClaudeConnectionSettings = () => {
  const [status, setStatus] = useState<PlutoMcpSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = Boolean(
    status?.enabled && status.running && status.pluginReady,
  );
  const development = status?.pluginName === 'pluto-notes-development';
  const label = development ? 'pluto-notes-development' : 'pluto-notes';

  useEffect(() => {
    let mounted = true;
    void getClaudeConnectionStatus()
      .then((snapshot) => {
        if (mounted) setStatus(snapshot);
      })
      .catch(() => {
        if (mounted)
          setError(
            'Connection settings are unavailable. Open this setting in the Pluto desktop app.',
          );
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const launch = async () => {
    try {
      await openClaude();
    } catch {
      setError(
        'Claude could not be opened. Install Claude Desktop on this Mac, then open it again.',
      );
    }
  };

  const changeEnabled = async () => {
    if (!status || busy || (!status.enabled && !consent)) return;
    setBusy(true);
    setError(null);
    try {
      const next = await setClaudeConnectionEnabled(!status.enabled);
      setStatus(next);
      if (!next.enabled) setConsent(false);
      if (!status.enabled && next.enabled && next.running && next.pluginReady)
        await launch();
    } catch {
      setError(
        status.enabled
          ? 'Access could not be disabled. Try again; access may still be enabled.'
          : 'The local connection could not be enabled. Try again.',
      );
    } finally {
      setBusy(false);
    }
  };

  const steps = (
    <ol className="list-decimal space-y-2 pl-4 text-xs leading-relaxed text-pro-text-main">
      <li>
        <strong className="font-medium">Restart Claude once.</strong> Fully quit
        Claude (⌘Q), then reopen it to load Pluto.
      </li>
      <li>
        <strong className="font-medium">Check Claude’s local servers.</strong>{' '}
        Open Claude Settings → Developer → Local MCP servers and look for{' '}
        {label}. Then start a new chat and enable it in the + → Connectors menu.
      </li>
      <li>
        Try asking:{' '}
        <q>Use Pluto to tell me what we decided in my latest meeting.</q> Keep
        Pluto running with access enabled.
      </li>
    </ol>
  );

  return (
    <section
      className="mb-8 max-w-3xl"
      aria-labelledby="claude-connection-heading"
    >
      <h3
        id="claude-connection-heading"
        className="mb-3 ml-1 flex items-center gap-2 text-[13px] font-semibold text-pro-text-main"
      >
        <img src={claudeLogo} alt="" aria-hidden="true" className="h-5 w-5" />
        Claude connection
      </h3>
      <div className="space-y-4 rounded-xl border border-pro-border/60 bg-pro-surface/70 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="space-y-1">
            <p className="text-[13px] font-medium text-pro-text-main">
              Your meeting notes in Claude
            </p>
            <p className="text-xs leading-relaxed text-pro-text-main/75">
              Ask questions, compare meetings, and explore decisions in Claude
              Desktop on this Mac.
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
                  ? 'Local setup ready'
                  : status.enabled
                    ? 'Connection needs attention'
                    : 'Access disabled'}
          </p>
        </div>
        {development ? (
          <p className="text-xs leading-relaxed text-pro-text-main/75">
            Development connection. Choose {label}; the installed release uses
            pluto-notes. Each reads notes from its own running app.
          </p>
        ) : null}
        {ready ? (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={actionClass}
              disabled={busy}
              onClick={() => {
                setError(null);
                void launch();
              }}
            >
              Open Claude Desktop
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
        ) : null}
        <div className="space-y-3 border-t border-pro-border/60 pt-4">
          <h4 className="text-xs font-medium text-pro-text-main">
            {ready ? 'Load Pluto in Claude' : 'After you connect'}
          </h4>
          <p className="text-xs leading-relaxed text-pro-text-main/75">
            Pluto is a local connector. It won’t appear in Claude’s public
            connector directory. Restart Claude after first connecting, then
            check its local servers below.
          </p>
          {steps}
        </div>
        <div className="space-y-3 border-t border-pro-border/60 pt-4">
          <p
            id="claude-access-disclosure"
            className="text-xs leading-relaxed text-pro-text-main/75"
          >
            Claude can read all your meeting notes. Retrieved notes are sent to
            Anthropic. Raw transcripts and audio are not shared. Disabling
            revokes future access; notes already shared in Claude remain there.
            ChatGPT access is managed separately.
          </p>
          <p className="text-xs leading-relaxed text-pro-text-main/75">
            Connecting adds Pluto to Claude Desktop’s local configuration and
            preserves existing connectors. No API key is needed.
          </p>
          {status && !status.enabled ? (
            <label className="flex items-start gap-2 text-xs leading-relaxed text-pro-text-main">
              <input
                type="checkbox"
                checked={consent}
                disabled={busy}
                onChange={(event) => setConsent(event.target.checked)}
                aria-describedby="claude-access-disclosure"
                className="mt-0.5 accent-pro-accent"
              />
              Allow Claude to read my meeting notes
            </label>
          ) : null}
          {!ready ? (
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
                  : 'Connect to Claude'}
            </button>
          ) : null}
          <details className="text-xs leading-relaxed text-pro-text-main/75">
            <summary className="cursor-pointer font-medium text-pro-text-main">
              Troubleshooting
            </summary>
            <div className="mt-3 space-y-3">
              <p>
                Update Claude Desktop and fully restart it after connecting.
                Check Developer settings for {label} and any connection errors.
                Your organization may restrict local connectors.
              </p>
              <p>
                Local setup ready means Pluto has prepared access; it does not
                confirm that Claude has loaded the connector. If Claude shows
                “No servers added,” fully quit it with ⌘Q and reopen it.
                Disabling access leaves the connector configured but stops
                future reads.
              </p>
              <button
                type="button"
                className={actionClass}
                onClick={() => {
                  setError(null);
                  void openClaudeSetupGuide().catch(() =>
                    setError(
                      'The setup guide could not be opened. Try again in the Pluto desktop app.',
                    ),
                  );
                }}
              >
                Open Claude setup guide
              </button>
            </div>
          </details>
        </div>
        {error || status?.error ? (
          <p role="alert" className="text-xs leading-relaxed text-red-500">
            {error ??
              'The Claude connection could not be prepared. Check that Claude’s configuration is valid and has no conflicting Pluto entry, then disable access and try again.'}
          </p>
        ) : null}
      </div>
    </section>
  );
};
