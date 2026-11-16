import { useEffect, useState } from 'react';
import type { PlutoMcpSnapshot } from '../../../electron/mcp/types';
import {
  getClaudeConnectionStatus,
  openClaude,
  setClaudeConnectionEnabled,
} from '../../api/claudeConnection';
import claudeLogo from '../../assets/brand/claude.svg';

const buttonClass =
  'rounded-lg border px-3 py-2 text-[13px] font-medium disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pro-accent';
const actionClass = `${buttonClass} border-pro-border bg-pro-surface text-pro-text-main hover:bg-pro-bg`;
const primaryActionClass = `${buttonClass} border-transparent bg-pro-text-main text-pro-bg hover:opacity-90`;

export const ClaudeConnectionSettings = () => {
  const [status, setStatus] = useState<PlutoMcpSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'connect' | 'disable' | null>(null);
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

  const changeEnabled = async (enabled: boolean) => {
    if (!status || busy || (enabled && !status.enabled && !consent)) return;
    setBusy(enabled ? 'connect' : 'disable');
    setError(null);
    try {
      const next = await setClaudeConnectionEnabled(enabled);
      setStatus(next);
      if (!next.enabled) setConsent(false);
    } catch {
      setError(
        enabled
          ? 'The local connection could not be enabled. Try again.'
          : 'Access could not be disabled. Try again. Access may still be enabled.',
      );
    } finally {
      setBusy(null);
    }
  };

  const steps = (
    <ol className="list-decimal space-y-2 pl-4 text-xs leading-relaxed text-pro-text-main">
      <li>
        <strong className="font-medium">Restart Claude once.</strong> Fully quit
        Claude (⌘Q), then reopen it to load Pluto.
      </li>
      <li>
        <strong className="font-medium">Enable Pluto in a new chat.</strong>{' '}
        Open + → Connectors and turn on {label}. Allow access when asked.
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
      className="mb-5 max-w-3xl"
      aria-labelledby="claude-connection-heading"
    >
      <div className="space-y-4 rounded-xl border border-pro-border/60 bg-pro-surface/70 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3
            id="claude-connection-heading"
            className="flex items-center gap-2 text-sm font-semibold text-pro-text-main"
          >
            <img src={claudeLogo} alt="" className="h-5 w-5" />
            Claude Desktop
          </h3>
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
          <p className="text-xs leading-relaxed text-pro-text-main">
            <strong className="font-medium">Development connection.</strong>{' '}
            Choose {label}; the installed release uses pluto-notes. Each reads
            notes from its own running app.
          </p>
        ) : null}
        {ready ? (
          <>
            <p className="text-xs leading-relaxed text-pro-text-main">
              First time connecting? If Claude is open, fully quit it with ⌘Q,
              then reopen it below. Keep Pluto running.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={primaryActionClass}
                disabled={busy !== null}
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
                disabled={busy !== null}
                onClick={() => void changeEnabled(false)}
              >
                {busy === 'disable' ? 'Disabling…' : 'Disable access'}
              </button>
            </div>
          </>
        ) : null}
        <div className="space-y-3">
          <p
            id="claude-access-disclosure"
            className="text-xs leading-relaxed text-pro-text-main/75"
          >
            Claude can read all your meeting notes, including meeting titles and
            dates. Retrieved content is sent to Anthropic. Raw transcripts and
            audio are not shared. Disabling revokes future access. Anything
            already shared in Claude remains there.
          </p>
          {status && !status.enabled ? (
            <label className="flex items-start gap-2 text-xs leading-relaxed text-pro-text-main">
              <input
                type="checkbox"
                checked={consent}
                disabled={busy !== null}
                onChange={(event) => setConsent(event.target.checked)}
                aria-describedby="claude-access-disclosure"
                className="mt-0.5 accent-pro-accent"
              />
              Allow Claude to read my meeting notes
            </label>
          ) : null}
          {!ready ? (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={primaryActionClass}
                disabled={
                  loading ||
                  !status ||
                  busy !== null ||
                  (!status.enabled && !consent)
                }
                onClick={() => void changeEnabled(true)}
              >
                {busy === 'connect'
                  ? 'Preparing…'
                  : status?.enabled
                    ? 'Retry setup'
                    : 'Connect to Claude'}
              </button>
              {status?.enabled ? (
                <button
                  type="button"
                  className={actionClass}
                  disabled={busy !== null}
                  onClick={() => void changeEnabled(false)}
                >
                  {busy === 'disable' ? 'Disabling…' : 'Disable access'}
                </button>
              ) : null}
            </div>
          ) : null}
          <details open={ready} className="space-y-3">
            <summary className="cursor-pointer rounded text-xs font-medium text-pro-text-main focus-visible:outline focus-visible:outline-2 focus-visible:outline-pro-accent">
              {ready ? 'Load Pluto in Claude' : 'After you connect'}
            </summary>
            <p className="text-xs leading-relaxed text-pro-text-main/75">
              Connecting adds Pluto to Claude Desktop’s local configuration and
              preserves existing connectors. No API key is needed.
            </p>
            {steps}
          </details>
          <details className="text-xs leading-relaxed text-pro-text-main/75">
            <summary className="cursor-pointer rounded font-medium text-pro-text-main focus-visible:outline focus-visible:outline-2 focus-visible:outline-pro-accent">
              Troubleshooting
            </summary>
            <div className="mt-3 space-y-3">
              <p>
                Can’t find Pluto in a new chat? Open Claude Settings → Developer
                → Local MCP servers and look for {label}. Pluto is a local
                connector and won’t appear in the public directory. Your
                organization may restrict local connectors.
              </p>
              <p>
                Local setup ready means Pluto has prepared access; it does not
                confirm that Claude has loaded the connector. If Claude shows
                “No servers added,” fully quit it with ⌘Q and reopen it.
                Disabling access leaves the connector configured but stops
                future reads.
              </p>
            </div>
          </details>
        </div>
        {error || status?.error ? (
          <p role="alert" className="text-xs leading-relaxed text-red-500">
            {error ??
              'The Claude connection could not be prepared. Check that Claude’s configuration is valid and has no conflicting Pluto entry, then retry setup.'}
          </p>
        ) : null}
      </div>
    </section>
  );
};
