import { useEffect, useRef, useState } from 'react';
import type { PlutoActionBatch } from '../../types/plutoActions';

export function PlutoActionCard({ batchId }: { batchId: string }) {
  const hydrated = useRef(false);
  const running = useRef(false);
  const [batch, setBatch] = useState<PlutoActionBatch | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    let active = true;
    hydrated.current = false;
    const refresh = () =>
      void window.ipcRenderer
        .invoke('PLUTO_ACTION_GET', batchId)
        .then((value: PlutoActionBatch) => {
          if (active) {
            setBatch(value);
            if (!hydrated.current) {
              setSelected(value.items.map((i) => i.id));
              hydrated.current = true;
            }
          }
        })
        .catch(() => {
          if (active)
            setError(
              'Could not load this action. Reopen the conversation to retry.',
            );
        });
    refresh();
    const unsubscribe = window.ipcRenderer.on('PLUTO_ACTIONS_CHANGED', refresh);
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [batchId]);
  const run = async (undo = false) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result: PlutoActionBatch = await window.ipcRenderer.invoke(
        undo ? 'PLUTO_ACTION_UNDO' : 'PLUTO_ACTION_APPLY',
        undo ? batchId : { id: batchId, selectedIds: selected },
      );
      setBatch(result);
      if (!undo && result.state === 'pending')
        setNotice(
          'An item changed. Review the refreshed preview and apply again.',
        );
      window.dispatchEvent(new Event('pluto:notes-changed'));
      window.dispatchEvent(new Event('pluto:tasks-changed'));
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'The change could not be saved. Try again.',
      );
    } finally {
      running.current = false;
      setBusy(false);
    }
  };
  return (
    <section
      aria-label="Proposed changes"
      className="my-3 rounded-xl border border-pro-border p-3 text-sm space-y-3"
    >
      <p className="font-medium">
        {batch?.state === 'applied'
          ? 'Changes saved'
          : batch?.state === 'undone'
            ? 'Changes undone'
            : 'Review changes'}
      </p>
      {batch?.items.map((item) => (
        <label
          htmlFor={`pluto-action-${batchId}-${item.id}`}
          key={item.id}
          className="flex gap-2 items-start"
        >
          {batch.state === 'pending' && (
            <input
              id={`pluto-action-${batchId}-${item.id}`}
              type="checkbox"
              checked={selected.includes(item.id)}
              disabled={busy}
              onChange={(e) =>
                setSelected((s) =>
                  e.target.checked
                    ? [...s, item.id]
                    : s.filter((id) => id !== item.id),
                )
              }
            />
          )}
          <span>
            <strong>{item.destination}</strong>
            <span className="block whitespace-pre-wrap">{item.preview}</span>
          </span>
        </label>
      ))}
      {batch?.state === 'pending' && (
        <button
          type="button"
          disabled={busy || !selected.length}
          onClick={() => void run()}
          className="rounded-lg bg-pro-accent px-3 py-1.5 text-white disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Apply selected changes'}
        </button>
      )}
      {batch?.state === 'applied' && (
        <>
          <div className="flex flex-wrap gap-3">
            {batch.results?.map((result, index) => (
              <button
                type="button"
                key={index}
                className="underline"
                onClick={() =>
                  window.dispatchEvent(
                    new CustomEvent('pluto:open-action-result', {
                      detail: result,
                    }),
                  )
                }
              >
                Open {result.title}
              </button>
            ))}
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(true)}
            className="underline"
          >
            {busy ? 'Undoing…' : 'Undo'}
          </button>
        </>
      )}
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
