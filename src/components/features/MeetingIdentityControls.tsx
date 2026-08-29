import { ChevronDown, ChevronRight } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  type IdentitySelection,
  type MeetingIdentityState,
  clearMeetingIdentityBinding,
  getMeetingIdentity,
  identityErrorMessage,
  identityPersonLabel,
  isIdentityRevisionError,
  retryIdentityReconciliation,
  setMeetingIdentityBinding,
} from '../../api/identity';
import type { IdentityBinding, IdentityPerson } from '../../types/identity';
import { identityButtonClass, identityFieldClass } from './IdentitySettings';

const SpeakerCorrection = ({
  speaker,
  binding,
  people,
  busy,
  onSave,
  onClear,
}: {
  speaker: string;
  binding?: IdentityBinding;
  people: IdentityPerson[];
  busy: boolean;
  onSave: (selection: IdentitySelection) => void;
  onClear: () => void;
}) => {
  const id = useId();
  const [choice, setChoice] = useState(binding?.personId ?? '');
  const [name, setName] = useState('');
  const [individual, setIndividual] = useState(
    binding?.source === 'user' && binding.individual === true,
  );
  return (
    <form
      className="space-y-3 py-4 border-t border-pro-border/40"
      onSubmit={(event) => {
        event.preventDefault();
        if (!individual || busy || (choice === '__new__' && !name.trim()))
          return;
        onSave(
          choice === '__new__'
            ? { newName: name.trim() }
            : { personId: choice || null },
        );
      }}
    >
      <label
        htmlFor={id}
        className="block text-[14px] font-medium text-pro-text-main"
      >
        {speaker}
      </label>
      <p className="text-[12px] text-pro-text-muted">
        {binding && binding.source !== 'user'
          ? 'Source-supported identity. Confirm individual scope before correcting it.'
          : binding?.individual
            ? binding.personId
              ? 'Identity confirmed for this meeting.'
              : 'Individual speaker confirmed, name unknown.'
            : 'No individual identity confirmed.'}
      </p>
      <select
        id={id}
        aria-label={`Person for ${speaker}`}
        className={identityFieldClass}
        value={choice}
        disabled={busy}
        onChange={(event) => setChoice(event.target.value)}
      >
        <option value="">Individual speaker (name unknown)</option>
        {people.map((person) => (
          <option key={person.id} value={person.id}>
            {identityPersonLabel(person, people)}
          </option>
        ))}
        <option value="__new__">Create a distinct person…</option>
      </select>
      {choice === '__new__' && (
        <label className="block text-[13px] text-pro-text-main">
          New person name
          <input
            aria-label={`New person name for ${speaker}`}
            className={`${identityFieldClass} mt-1`}
            value={name}
            maxLength={200}
            required
            disabled={busy}
            onChange={(event) => setName(event.target.value)}
          />
          <span className="block mt-1 text-pro-text-muted">
            Creates a separate person, even if the name already exists.
          </span>
        </label>
      )}
      <label className="flex items-start gap-2 text-[13px] text-pro-text-muted leading-relaxed">
        <input
          type="checkbox"
          className="mt-1 accent-pro-accent"
          checked={individual}
          disabled={busy}
          onChange={(event) => setIndividual(event.target.checked)}
        />
        <span>
          I confirm “{speaker}” is one individual throughout this meeting, not a
          shared or mixed channel.
        </span>
      </label>
      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          className={identityButtonClass}
          disabled={
            busy || !individual || (choice === '__new__' && !name.trim())
          }
        >
          Save correction
        </button>
        {binding && (
          <button
            type="button"
            className={identityButtonClass}
            disabled={busy}
            onClick={onClear}
          >
            Clear correction
          </button>
        )}
      </div>
    </form>
  );
};

const MeetingIdentityPanel = ({ meetingId }: { meetingId: string }) => {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<MeetingIdentityState | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const request = useRef(0);

  const load = useCallback(
    async (preserveError = false) => {
      const token = ++request.current;
      setLoading(true);
      if (!preserveError) setError('');
      try {
        const next = await getMeetingIdentity(meetingId);
        if (token !== request.current) return;
        if (next.meetingId !== meetingId)
          throw new Error('Unexpected meeting identity');
        setState(next);
      } catch {
        if (token === request.current)
          setError(
            'Could not refresh speaker identities. Try reloading before making changes.',
          );
      } finally {
        if (token === request.current) setLoading(false);
      }
    },
    [meetingId],
  );

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  useEffect(
    () => () => {
      request.current++;
    },
    [],
  );

  useEffect(() => {
    if (
      !open ||
      busy ||
      loading ||
      error ||
      (state?.job?.state !== 'pending' && state?.job?.state !== 'running')
    )
      return;
    const timer = window.setTimeout(() => void load(), 3000);
    return () => window.clearTimeout(timer);
  }, [open, busy, loading, error, state, load]);

  const mutate = async (operation: () => Promise<MeetingIdentityState>) => {
    if (busy || loading) return;
    const token = ++request.current;
    setBusy(true);
    setError('');
    setSaved(false);
    try {
      const next = await operation();
      if (token !== request.current) return;
      if (next.meetingId !== meetingId)
        throw new Error('Unexpected meeting identity');
      setState(next);
      setSaved(true);
    } catch (failure) {
      if (token !== request.current) return;
      setError(identityErrorMessage(failure));
      if (isIdentityRevisionError(failure)) {
        await load(true);
        setBusy(false);
      }
    } finally {
      if (token === request.current) setBusy(false);
    }
  };

  const status =
    state?.job?.state === 'pending'
      ? `${saved ? 'Saved. ' : ''}Identity recheck pending.`
      : state?.job?.state === 'running'
        ? 'Rechecking affected suggestions…'
        : state?.job?.state === 'failed'
          ? 'Recheck failed. Saved corrections are retained.'
          : state?.job?.state === 'complete'
            ? 'Recheck complete. Uncertain owners remain unresolved.'
            : saved
              ? 'Saved.'
              : '';

  return (
    <div className="text-left py-3">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        disabled={!open && busy}
        className="inline-flex items-center gap-1.5 text-[13px] text-pro-text-muted hover:text-pro-text-main rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pro-accent disabled:opacity-50"
        onClick={() => setOpen(!open)}
      >
        {open ? (
          <ChevronDown size={14} aria-hidden="true" />
        ) : (
          <ChevronRight size={14} aria-hidden="true" />
        )}
        Speaker identities
      </button>
      {open && (
        <div id={id} className="mt-3 max-w-[560px] space-y-3">
          <p className="text-[13px] text-pro-text-muted leading-relaxed">
            Corrections apply only to this meeting and recheck affected
            suggestions automatically. The original transcript and speaker
            labels stay unchanged.
          </p>
          {state && (
            <p className="text-[12px] text-pro-text-muted">
              {state.capture.origin === 'imported'
                ? 'Imported recording. Speaker labels do not identify the workspace user.'
                : state.capture.origin === 'local'
                  ? 'Local recording. Capture-time identity does not by itself identify every speaker.'
                  : 'Recording origin unknown. Speaker labels do not identify the workspace user.'}
            </p>
          )}
          <output className="block text-[13px] text-pro-text-muted">
            {busy
              ? 'Saving…'
              : loading && !state
                ? 'Loading speaker identities…'
                : status}
          </output>
          {state?.job?.state === 'failed' && (
            <button
              type="button"
              className={identityButtonClass}
              disabled={busy || loading}
              onClick={() =>
                void mutate(() => retryIdentityReconciliation(meetingId))
              }
            >
              Retry recheck
            </button>
          )}
          {error && (
            <p role="alert" className="text-[13px] text-pro-text-muted">
              {error}
            </p>
          )}
          {error && (
            <button
              type="button"
              className={identityButtonClass}
              disabled={busy || loading}
              onClick={() => void load()}
            >
              Reload identities
            </button>
          )}
          {state?.speakers.length === 0 && (
            <p className="text-[13px] text-pro-text-muted">
              No transcript speakers are available to correct yet.
            </p>
          )}
          {state?.speakers.map((speaker) => {
            const binding = state.bindings.find(
              (item) => item.speaker === speaker,
            );
            return (
              <SpeakerCorrection
                key={`${speaker}:${JSON.stringify(binding)}`}
                speaker={speaker}
                binding={binding}
                people={state.people}
                busy={busy || loading}
                onSave={(selection) =>
                  void mutate(() =>
                    setMeetingIdentityBinding(
                      meetingId,
                      speaker,
                      selection,
                      state.revision,
                    ),
                  )
                }
                onClear={() =>
                  void mutate(() =>
                    clearMeetingIdentityBinding(
                      meetingId,
                      speaker,
                      state.revision,
                    ),
                  )
                }
              />
            );
          })}
        </div>
      )}
    </div>
  );
};

export const MeetingIdentityControls = ({
  meetingId,
}: { meetingId: string }) => (
  <MeetingIdentityPanel key={meetingId} meetingId={meetingId} />
);
