import { useState } from 'react';
import { ChatGptConnectionSettings } from '../features/ChatGptConnectionSettings';
import { ClaudeConnectionSettings } from '../features/ClaudeConnectionSettings';

export function NotesConnectionsSetup({
  onComplete,
}: { onComplete: () => Promise<void> }) {
  const [choice, setChoice] = useState<'chatgpt' | 'claude' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const finish = async () => {
    setBusy(true);
    setError('');
    try {
      await window.ipcRenderer.invoke('SET_SETTING', {
        key: 'notes_connections_notice_seen',
        value: 'true',
      });
      await onComplete();
    } catch {
      setError('Could not finish setup. Please try again.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="w-full max-w-xl">
      <h2 className="font-serif text-[2rem] font-medium leading-[1.12] tracking-[-0.02em]">
        Your notes, where you think
      </h2>
      <p className="mt-3 text-[15px] leading-6 text-pro-text-muted">
        Optionally connect ChatGPT Desktop or Claude Desktop to explore your
        saved meeting notes. These connections are separate from the AI that
        powers Pluto’s notes and answers.
      </p>
      <div
        className="my-6 flex flex-wrap gap-3"
        aria-label="Meeting-note connections"
      >
        {(['chatgpt', 'claude'] as const).map((client) => (
          <button
            key={client}
            type="button"
            aria-pressed={choice === client}
            onClick={() => setChoice(client)}
            className={`rounded-lg border px-4 py-3 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-pro-accent ${choice === client ? 'border-pro-accent bg-pro-accent/10' : 'border-pro-border hover:bg-pro-surface'}`}
          >
            {client === 'chatgpt' ? 'ChatGPT Desktop' : 'Claude Desktop'}
          </button>
        ))}
      </div>
      {choice === 'chatgpt' ? <ChatGptConnectionSettings /> : null}
      {choice === 'claude' ? <ClaudeConnectionSettings /> : null}
      <p className="mt-4 text-[13px] leading-5 text-pro-text-muted">
        {!choice
          ? 'Access is off until you allow it for each app. Retrieved notes are sent to OpenAI or Anthropic; raw transcripts and audio are not shared. '
          : ''}
        You can manage both connections in Settings → Advanced.
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={() => void finish()}
        className="mt-6 rounded-lg bg-pro-text-main px-6 py-3 text-sm font-semibold text-pro-bg focus-visible:outline focus-visible:outline-2 focus-visible:outline-pro-accent disabled:opacity-40"
      >
        {busy ? 'Finishing…' : choice ? 'Finish setup' : 'Skip for now'}
      </button>
      {error ? (
        <p role="alert" className="mt-3 text-sm text-rose-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
