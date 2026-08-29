import { useEffect, useRef, useState } from 'react';
import {
  type IdentityState,
  dismissIdentityProfile,
  getIdentityState,
  isIdentityRevisionError,
} from '../../api/identity';

export const IdentityProfileInvitation = ({
  onOpenSettings,
}: { onOpenSettings: () => void }) => {
  const [state, setState] = useState<IdentityState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    void getIdentityState()
      .then((next) => {
        if (active.current) setState(next);
      })
      .catch(() => {});
    return () => {
      active.current = false;
    };
  }, []);
  const dismiss = async () => {
    if (!state || busy) return;
    setBusy(true);
    setError('');
    try {
      const next = await dismissIdentityProfile(state.revision);
      if (active.current) setState(next);
    } catch (failure) {
      if (!active.current) return;
      if (isIdentityRevisionError(failure)) {
        try {
          const next = await getIdentityState();
          if (active.current) setState(next);
        } catch {}
      }
      if (active.current)
        setError('Could not dismiss this invitation. Please try again.');
    } finally {
      if (active.current) setBusy(false);
    }
  };
  if (!state?.profile || state.profile.disposition !== 'pending') return null;
  return (
    <aside
      aria-label="About you invitation"
      className="mx-6 mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-pro-border/60 px-4 py-3 text-[13px] text-pro-text-main/75"
    >
      <p className="min-w-0 flex-1">
        Help Pluto recognize you. Add a name and optional context in Settings.
      </p>
      <button
        type="button"
        onClick={onOpenSettings}
        className="rounded-md px-2 py-1 font-medium text-pro-text-main focus-visible:ring-2 focus-visible:ring-pro-accent"
      >
        About you
      </button>
      <button
        type="button"
        disabled={busy}
        aria-label="Dismiss About you invitation"
        onClick={() => void dismiss()}
        className="rounded-md px-2 py-1 focus-visible:ring-2 focus-visible:ring-pro-accent disabled:opacity-50"
      >
        Not now
      </button>
      {error && (
        <p role="alert" className="w-full">
          {error}
        </p>
      )}
    </aside>
  );
};
