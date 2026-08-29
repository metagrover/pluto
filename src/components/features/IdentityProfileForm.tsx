import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  type IdentityState,
  dismissIdentityProfile,
  getIdentityState,
  isIdentityRevisionError,
  saveIdentityProfile,
} from '../../api/identity';
import {
  type IdentityProfileInput,
  type IdentityUseCase,
  emptyIdentityProfile,
} from '../../types/identity';

const fieldClass =
  'w-full rounded-lg border border-pro-border/80 bg-pro-bg px-3 py-2 text-[14px] text-pro-text-main outline-none focus:border-pro-accent focus:ring-1 focus:ring-pro-accent/50 disabled:opacity-50';
const buttonClass =
  'rounded-lg border border-pro-border px-3 py-2 text-[13px] font-medium text-pro-text-main hover:bg-pro-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pro-accent disabled:opacity-50';
const primaryButtonClass =
  'inline-flex min-h-10 items-center justify-center rounded-lg border border-transparent bg-pro-text-main px-4 py-2 text-[13px] font-semibold text-pro-bg shadow-sm transition-[background-color,color,transform,box-shadow] duration-200 ease-out hover:bg-pro-accent hover:text-[oklch(0.97_0.006_250)] hover:shadow-md active:translate-y-px active:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pro-accent focus-visible:ring-offset-2 focus-visible:ring-offset-pro-bg disabled:cursor-wait disabled:opacity-50 disabled:transform-none disabled:hover:bg-pro-text-main disabled:hover:text-pro-bg disabled:hover:shadow-sm';
const keyOf = (name: string) => name.normalize('NFC').toLocaleLowerCase();

export const IdentityProfileForm = ({
  initialState,
  onComplete,
  onSaved,
}: {
  initialState?: IdentityState;
  onComplete?: () => void | Promise<void>;
  onSaved?: (state: IdentityState) => void;
}) => {
  const [state, setState] = useState(initialState ?? null);
  const [draft, setDraft] = useState<IdentityProfileInput>(
    initialState?.profile ?? emptyIdentityProfile(),
  );
  const [alternate, setAlternate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const active = useRef(true);
  const id = useId().replace(/:/g, '');
  const load = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const next = await getIdentityState();
      if (!active.current) return;
      setState(next);
      setDraft(next.profile);
    } catch {
      if (active.current)
        setError('Could not load About you. Please try again.');
    } finally {
      if (active.current) setBusy(false);
    }
  }, []);
  useEffect(() => {
    active.current = true;
    if (!initialState) void load();
    return () => {
      active.current = false;
    };
  }, [initialState, load]);
  const update = (change: Partial<IdentityProfileInput>) => {
    setDraft((current) => ({ ...current, ...change }));
    setSaved(false);
  };
  const withAlternate = () => {
    const name = alternate.trim();
    if (!name || draft.aliases.some((alias) => keyOf(alias) === keyOf(name)))
      return draft.aliases;
    if (draft.aliases.length >= 12)
      throw new Error('You can add up to 12 alternate names.');
    if (name.length > 200 || /[\p{Cc}\p{Cf}]/u.test(name))
      throw new Error(
        'Use an alternate name of up to 200 characters without control characters.',
      );
    return [...draft.aliases, name];
  };
  const addAlternate = () => {
    try {
      update({ aliases: withAlternate() });
      setAlternate('');
      setError('');
    } catch (failure) {
      setError((failure as Error).message);
    }
  };
  const persist = async (skip: boolean) => {
    if (!state || busy) return;
    setBusy(true);
    setError('');
    setSaved(false);
    let profilePersisted = false;
    try {
      const next = skip
        ? await dismissIdentityProfile(state.revision)
        : await saveIdentityProfile(
            {
              ...draft,
              preferredName: draft.preferredName.trim(),
              aliases: withAlternate(),
              role: draft.role.trim(),
              industry: draft.industry.trim(),
            },
            state.revision,
          );
      if (!active.current) return;
      profilePersisted = true;
      setState(next);
      setDraft(next.profile);
      setAlternate('');
      setSaved(!skip);
      onSaved?.(next);
      await onComplete?.();
    } catch (failure) {
      if (!active.current) return;
      if (isIdentityRevisionError(failure)) {
        try {
          const next = await getIdentityState();
          if (active.current) setState(next);
        } catch {
          /* The edited draft remains available for retry. */
        }
        if (active.current)
          setError(
            'About you changed elsewhere. Your edits are kept; review them and try saving again.',
          );
      } else
        setError(
          profilePersisted
            ? 'About you was saved, but setup could not finish. Please try again.'
            : 'Could not save About you. Your edits are kept; please try again.',
        );
    } finally {
      if (active.current) setBusy(false);
    }
  };
  if (!state)
    return (
      <div>
        {busy ? (
          <output className="text-sm text-pro-text-main/75">
            Loading About you…
          </output>
        ) : (
          <>
            <p role="alert" className="text-sm text-pro-text-main/75">
              {error}
            </p>
            <button
              type="button"
              className={buttonClass}
              onClick={() => void load()}
            >
              Try again
            </button>
          </>
        )}
      </div>
    );
  const clearing = Boolean(state.selfPersonId && !draft.preferredName.trim());
  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        void persist(false);
      }}
    >
      <p className="text-[13px] leading-relaxed text-pro-text-main/75">
        All fields are optional. Your name helps Pluto recognize you in future
        local recordings. This does not rewrite past recordings.
      </p>
      <fieldset disabled={busy} className="space-y-4">
        <label className="block text-[13px] font-medium text-pro-text-main">
          What should Pluto call you?
          <input
            aria-label="Preferred name"
            autoComplete="nickname"
            maxLength={200}
            value={draft.preferredName}
            onChange={(event) => update({ preferredName: event.target.value })}
            className={`${fieldClass} mt-1.5`}
          />
        </label>
        <div>
          <label
            htmlFor={`${id}-alternate`}
            className="block text-[13px] font-medium text-pro-text-main"
          >
            What other names do people use for you?
          </label>
          <p className="mt-1 text-[12px] text-pro-text-main/75">
            Names people use for you, including nicknames or other scripts.
          </p>
          <div className="mt-2 flex gap-2">
            <input
              id={`${id}-alternate`}
              aria-label="Alternate name"
              maxLength={200}
              value={alternate}
              onChange={(event) => setAlternate(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  addAlternate();
                }
              }}
              className={fieldClass}
            />
            <button
              type="button"
              className={`${buttonClass} shrink-0`}
              onClick={addAlternate}
            >
              Add name
            </button>
          </div>
          {draft.aliases.length > 0 && (
            <ul
              aria-label="Alternate names"
              className="mt-2 flex flex-wrap gap-2"
            >
              {draft.aliases.map((alias) => (
                <li
                  key={keyOf(alias)}
                  className="inline-flex max-w-full items-center gap-2 rounded-full border border-pro-border px-3 py-1 text-[13px] text-pro-text-main"
                >
                  <span className="break-all">{alias}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${alias}`}
                    className="shrink-0 rounded-full px-1 focus-visible:ring-2 focus-visible:ring-pro-accent"
                    onClick={() =>
                      update({
                        aliases: draft.aliases.filter((item) => item !== alias),
                      })
                    }
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
          {!draft.preferredName.trim() && draft.aliases.length > 0 && (
            <p className="mt-2 text-[12px] text-pro-text-main/75">
              These names stay unlinked until you add a preferred name.
            </p>
          )}
        </div>
        <fieldset>
          <legend className="text-[13px] font-medium text-pro-text-main">
            What brings you to Pluto?
          </legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {(['work', 'study', 'personal'] as IdentityUseCase[]).map(
              (value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={draft.useCases.includes(value)}
                  className={`${buttonClass} ${draft.useCases.includes(value) ? 'border-pro-accent bg-pro-accent/10' : ''}`}
                  onClick={() =>
                    update({
                      useCases: draft.useCases.includes(value)
                        ? draft.useCases.filter((item) => item !== value)
                        : [...draft.useCases, value],
                    })
                  }
                >
                  {value[0].toUpperCase() + value.slice(1)}
                </button>
              ),
            )}
          </div>
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-[13px] font-medium text-pro-text-main">
            Role or field
            <input
              aria-label="Role or field"
              list={`${id}-roles`}
              maxLength={160}
              value={draft.role}
              onChange={(event) => update({ role: event.target.value })}
              className={`${fieldClass} mt-1.5`}
            />
          </label>
          <label className="block text-[13px] font-medium text-pro-text-main">
            Industry
            <input
              aria-label="Industry"
              list={`${id}-industries`}
              maxLength={160}
              value={draft.industry}
              onChange={(event) => update({ industry: event.target.value })}
              className={`${fieldClass} mt-1.5`}
            />
          </label>
        </div>
        <datalist id={`${id}-roles`}>
          {[
            'Engineering',
            'Sales',
            'Business',
            'Design',
            'Research',
            'Teaching',
            'Student',
            'Operations',
          ].map((value) => (
            <option key={value} value={value} />
          ))}
        </datalist>
        <datalist id={`${id}-industries`}>
          {[
            'Technology',
            'Education',
            'Healthcare',
            'Finance',
            'Creative arts',
            'Public service',
          ].map((value) => (
            <option key={value} value={value} />
          ))}
        </datalist>
      </fieldset>
      <p className="text-[12px] leading-relaxed text-pro-text-main/75">
        Context is saved in this workspace for future terminology work; it does
        not change transcription today. Names may be included in identity
        analysis with your configured provider.
      </p>
      {clearing && (
        <p className="text-[13px] text-pro-text-main/75">
          Saving with no preferred name clears your self identity. Your context
          stays saved; alternate names remain unlinked.
        </p>
      )}
      {error && (
        <p role="alert" className="text-[13px] text-pro-text-main/75">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={busy} className={primaryButtonClass}>
          {busy
            ? 'Saving…'
            : clearing
              ? 'Clear identity and save'
              : onComplete
                ? 'Save and continue'
                : 'Save profile'}
        </button>
        {onComplete && (
          <button
            type="button"
            disabled={busy}
            className={buttonClass}
            onClick={() => void persist(true)}
          >
            Skip for now
          </button>
        )}
        <output className="text-[13px] text-pro-text-main/75">
          {saved ? 'Saved' : ''}
        </output>
      </div>
    </form>
  );
};
