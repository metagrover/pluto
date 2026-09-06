import { useCallback, useEffect, useRef, useState } from 'react';
import {
  type IdentitySelection,
  type IdentityState,
  getIdentityState,
  identityErrorMessage,
  identityPersonLabel,
  isIdentityRevisionError,
  setSelfIdentity,
} from '../../api/identity';
import { SettingsSelect } from '../ui/SettingsSelect';
import { IdentityProfileForm } from './IdentityProfileForm';

export const identityFieldClass =
  'w-full rounded-lg border border-pro-border/80 bg-pro-bg px-3 py-2.5 text-[14px] text-pro-text-main outline-none focus:border-pro-accent focus:ring-1 focus:ring-pro-accent/50 disabled:opacity-50';
export const identityButtonClass =
  'rounded-lg border border-pro-border bg-pro-bg px-3 py-2 text-[13px] font-medium text-pro-text-main hover:bg-pro-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pro-accent disabled:cursor-not-allowed disabled:opacity-50';

export const IdentitySettings = () => {
  const [state, setState] = useState<IdentityState | null>(null);
  const [choice, setChoice] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [formVersion, setFormVersion] = useState(0);
  const [clearConfirmed, setClearConfirmed] = useState(false);
  const request = useRef(0);

  const load = useCallback(async (preserveError = false) => {
    const token = ++request.current;
    setBusy(true);
    if (!preserveError) setError('');
    try {
      const next = await getIdentityState();
      if (token !== request.current) return;
      setChoice(next.selfPersonId ?? '');
      setState(next);
      setFormVersion((value) => value + 1);
      setName('');
    } catch {
      if (token === request.current)
        setError('Could not load identity information. Try reloading.');
    } finally {
      if (token === request.current) setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
    return () => {
      request.current++;
    };
  }, [load]);

  const save = async (selection: IdentitySelection) => {
    if (!state || busy) return;
    const token = ++request.current;
    setBusy(true);
    setError('');
    setSaved(false);
    try {
      const next = await setSelfIdentity(selection, state.revision);
      if (token !== request.current) return;
      setState(next);
      setChoice(next.selfPersonId ?? '');
      setName('');
      setSaved(true);
      setFormVersion((value) => value + 1);
      setClearConfirmed(false);
    } catch (failure) {
      if (token !== request.current) return;
      setError(identityErrorMessage(failure));
      if (isIdentityRevisionError(failure)) await load(true);
    } finally {
      if (token === request.current) setBusy(false);
    }
  };

  return (
    <section className="mb-10" aria-labelledby="identity-settings-heading">
      <h3
        id="identity-settings-heading"
        className="text-[13px] font-semibold text-pro-text-main mb-3 ml-1"
      >
        About you
      </h3>
      <div className="bg-pro-surface border border-pro-border/60 rounded-xl p-5 shadow-sm space-y-3">
        {state ? (
          <>
            <IdentityProfileForm
              key={formVersion}
              initialState={state}
              onSaved={(next) => {
                setState(next);
                setChoice(next.selfPersonId ?? '');
              }}
            />
            <details className="border-t border-pro-border/60 pt-4">
              <summary className="cursor-pointer text-[13px] font-medium text-pro-text-main">
                Advanced identity options
              </summary>
              <p className="mt-3 max-w-[70ch] text-[13px] leading-relaxed text-pro-text-main/75">
                Choose your person for future local recordings in this
                workspace. Changing this does not reassign past meetings or
                identify speakers in imported recordings.
              </p>
              <form
                className="mt-4 space-y-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  void save(
                    choice === '__new__'
                      ? { newName: name.trim() }
                      : { personId: choice || null },
                  );
                }}
              >
                <label
                  htmlFor="self-identity-person"
                  className="block text-[14px] font-medium text-pro-text-main"
                >
                  Your person
                </label>
                <SettingsSelect
                  id="self-identity-person"
                  label="Your person"
                  searchable
                  value={choice}
                  disabled={busy}
                  onChange={(value) => {
                    setChoice(value);
                    setSaved(false);
                  }}
                  options={[
                    {
                      value: '',
                      label: 'Not set',
                      disabled: Boolean(state.selfPersonId),
                    },
                    ...state.people.map((person) => ({
                      value: person.id,
                      label: identityPersonLabel(person, state.people),
                    })),
                    {
                      value: '__new__',
                      label: 'Create a distinct person…',
                      alwaysVisible: true,
                    },
                  ]}
                />
                {choice === '__new__' && (
                  <label className="block text-[13px] text-pro-text-main">
                    New person name
                    <input
                      aria-label="New person name"
                      className={`${identityFieldClass} mt-1`}
                      value={name}
                      maxLength={200}
                      required
                      disabled={busy}
                      onChange={(event) => setName(event.target.value)}
                    />
                    <span className="block mt-1 text-pro-text-muted">
                      Creates a separate person, even if the name already
                      exists.
                    </span>
                  </label>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    className={identityButtonClass}
                    type="submit"
                    disabled={busy || (choice === '__new__' && !name.trim())}
                  >
                    Save identity
                  </button>
                  {state.selfPersonId && (
                    <>
                      <label className="flex w-full items-start gap-2 text-[13px] text-pro-text-muted">
                        <input
                          type="checkbox"
                          aria-label="Confirm clearing identity"
                          checked={clearConfirmed}
                          disabled={busy}
                          onChange={(event) =>
                            setClearConfirmed(event.target.checked)
                          }
                          className="mt-1 accent-pro-accent"
                        />
                        Clear my self identity and alternate names. My context
                        stays saved and past recordings stay unchanged.
                      </label>
                      <button
                        className={identityButtonClass}
                        type="button"
                        disabled={busy || !clearConfirmed}
                        onClick={() => void save({ personId: null })}
                      >
                        Clear identity
                      </button>
                    </>
                  )}
                  <output className="text-[13px] text-pro-text-muted">
                    {busy ? 'Saving…' : saved ? 'Saved' : ''}
                  </output>
                </div>
              </form>
            </details>
          </>
        ) : busy ? (
          <output className="block text-[13px] text-pro-text-muted">
            Loading identity…
          </output>
        ) : null}
        {error && (
          <div className="space-y-2">
            <p role="alert" className="text-[13px] text-pro-text-muted">
              {error}
            </p>
            <button
              className={identityButtonClass}
              type="button"
              disabled={busy}
              onClick={() => void load()}
            >
              Reload identity
            </button>
          </div>
        )}
      </div>
    </section>
  );
};
