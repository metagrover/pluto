import { useEffect, useState } from 'react';
import { getChatGptConnectionStatus } from '../../api/chatgptConnection';
import { getClaudeConnectionStatus } from '../../api/claudeConnection';

export function NotesConnectionsNotice({
  onOpenSettings,
}: {
  onOpenSettings: () => void;
}) {
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    const read = (key: string) => window.ipcRenderer.invoke('GET_SETTING', key);
    void Promise.all([
      read('setup_complete'),
      read('notes_connections_notice_seen'),
      getChatGptConnectionStatus(),
      getClaudeConnectionStatus(),
    ])
      .then(([setup, seen, chatgpt, claude]) => {
        if (active)
          setVisible(
            setup === 'true' &&
              seen !== 'true' &&
              !chatgpt.enabled &&
              !claude.enabled,
          );
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const dismiss = async (review: boolean) => {
    setBusy(true);
    setError('');
    try {
      await window.ipcRenderer.invoke('SET_SETTING', {
        key: 'notes_connections_notice_seen',
        value: 'true',
      });
      setVisible(false);
      if (review) onOpenSettings();
    } catch {
      setError('Could not save your preference. Try again.');
    } finally {
      setBusy(false);
    }
  };

  if (!visible) return null;
  return (
    <aside
      aria-label="Meeting-note connections are available"
      className="mx-6 mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-pro-border/60 px-4 py-3 text-[13px] text-pro-text-main"
    >
      <div className="min-w-0 flex-1 basis-64">
        <p className="font-medium">
          Use your meeting notes in ChatGPT or Claude.
        </p>
        <p className="mt-1 leading-5 text-pro-text-muted">
          Connect either desktop app to explore your saved notes. Access is
          optional and managed separately for each app.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void dismiss(false)}
          className="rounded-md px-3 py-2 font-medium text-pro-text-muted hover:bg-pro-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-pro-accent disabled:opacity-50"
        >
          Not now
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void dismiss(true)}
          className="rounded-md border border-pro-border px-3 py-2 font-medium hover:bg-pro-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-pro-accent disabled:opacity-50"
        >
          Review connections
        </button>
      </div>
      {error ? (
        <p role="alert" className="w-full text-rose-700">
          {error}
        </p>
      ) : null}
    </aside>
  );
}
