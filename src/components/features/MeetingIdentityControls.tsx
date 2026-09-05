import { ChevronDown, ChevronRight, Play } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  type IdentitySelection,
  type MeetingIdentityState,
  clearMeetingIdentityBinding,
  getMeetingIdentity,
  getMeetingSpeakerSample,
  identityErrorMessage,
  identityPersonLabel,
  isIdentityRevisionError,
  retryIdentityReconciliation,
  setMeetingIdentityBinding,
} from '../../api/identity';
import type { IdentityBinding, IdentityPerson } from '../../types/identity';
import { getAnonymousSpeakerDisplayLabel } from '../../utils/speakerReview';
import { identityButtonClass, identityFieldClass } from './IdentitySettings';
import { extractSpeakerDisplayNames } from './meetingTranscriptPresentation';

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

export interface SpeakerReviewSummary {
  turnCount: number;
  excerpt: string;
}

type StagedIdentity = {
  label: string;
  selection: IdentitySelection;
};

const AnonymousSpeakerReview = ({
  speaker,
  binding,
  people,
  selfPersonId,
  userProfile,
  attendeeNames,
  summary,
  busy,
  hasSystemAudio,
  sample,
  sampleLoading,
  sampleError,
  onPlaySample,
  onSave,
  onClear,
}: {
  speaker: string;
  binding?: IdentityBinding;
  people: IdentityPerson[];
  selfPersonId?: string | null;
  userProfile?: { preferredName?: string; aliases?: string[] } | null;
  attendeeNames: string[];
  summary?: SpeakerReviewSummary;
  busy: boolean;
  hasSystemAudio: boolean;
  sample: { sampleIndex: number; sampleCount: number } | null;
  sampleLoading: boolean;
  sampleError: boolean;
  onPlaySample: (sampleIndex: number) => void;
  onSave: (selection: IdentitySelection) => void;
  onClear: () => void;
}) => {
  const displayLabel = getAnonymousSpeakerDisplayLabel(speaker);
  const [choice, setChoice] = useState('');
  const [name, setName] = useState('');
  const [staged, setStaged] = useState<StagedIdentity | null>(null);

  const userNames = new Set<string>();
  if (userProfile?.preferredName?.trim()) {
    userNames.add(userProfile.preferredName.trim().toLocaleLowerCase('en-US'));
  }
  if (selfPersonId) {
    const selfPerson = people.find((p) => p.id === selfPersonId);
    if (selfPerson?.name?.trim()) {
      userNames.add(selfPerson.name.trim().toLocaleLowerCase('en-US'));
    }
  }
  if (Array.isArray(userProfile?.aliases)) {
    for (const alias of userProfile.aliases) {
      if (typeof alias === 'string' && alias.trim()) {
        userNames.add(alias.trim().toLocaleLowerCase('en-US'));
      }
    }
  }

  const peopleByName = people.reduce<Map<string, IdentityPerson[]>>(
    (index, person) => {
      const key = person.name.trim().toLocaleLowerCase('en-US');
      index.set(key, [...(index.get(key) ?? []), person]);
      return index;
    },
    new Map(),
  );
  const attendeesByName = attendeeNames.reduce<
    Map<string, { name: string; count: number }>
  >((index, value) => {
    const attendeeName = value.trim();
    if (!attendeeName) return index;
    const key = attendeeName.toLocaleLowerCase('en-US');
    const current = index.get(key);
    index.set(key, {
      name: current?.name ?? attendeeName,
      count: (current?.count ?? 0) + 1,
    });
    return index;
  }, new Map());
  const attendeeChoices = [...attendeesByName].flatMap(([key, attendee]) => {
    if (userNames.has(key)) return [];
    const matches = peopleByName.get(key) ?? [];
    if (attendee.count > 1 || matches.length > 1) return [];
    return [
      {
        label: attendee.name,
        selection: matches[0]
          ? ({ personId: matches[0].id } satisfies IdentitySelection)
          : ({ newName: attendee.name } satisfies IdentitySelection),
      },
    ];
  });
  const confirmedPerson =
    binding?.source === 'user' && binding.personId
      ? people.find((person) => person.id === binding.personId)
      : undefined;

  if (confirmedPerson) {
    return (
      <article className="speaker-review-row speaker-review-row--confirmed">
        <div className="speaker-review-row__heading">
          <div>
            <strong>{displayLabel}</strong>
            <span>Confirmed</span>
          </div>
          <button type="button" disabled={busy} onClick={onClear}>
            Undo
          </button>
        </div>
        <p>
          {displayLabel} is {confirmedPerson.name}. This meeting is linked to
          their People profile.
        </p>
      </article>
    );
  }

  const stagePerson = (person: IdentityPerson) => {
    setChoice(person.id);
    setName('');
    setStaged({ label: person.name, selection: { personId: person.id } });
  };

  return (
    <article className="speaker-review-row">
      <div className="speaker-review-row__heading">
        <div>
          <strong>{displayLabel}</strong>
          <span>
            {summary?.turnCount ?? 0}{' '}
            {(summary?.turnCount ?? 0) === 1 ? 'turn' : 'turns'}
          </span>
        </div>
      </div>
      {summary?.excerpt ? (
        <blockquote>“{summary.excerpt}”</blockquote>
      ) : (
        <p>Review this speaker’s transcript turns before confirming a name.</p>
      )}
      <div className="speaker-review-sample">
        {hasSystemAudio ? (
          <>
            <button
              type="button"
              disabled={busy || sampleLoading}
              onClick={() => onPlaySample(0)}
            >
              <Play
                size={11}
                className="fill-current mr-1 shrink-0"
                aria-hidden="true"
              />
              {sampleLoading ? 'Loading sample…' : 'Play voice sample'}
            </button>
            {sample && sample.sampleIndex + 1 < sample.sampleCount ? (
              <button
                type="button"
                disabled={busy || sampleLoading}
                onClick={() => onPlaySample(sample.sampleIndex + 1)}
              >
                Try another sample
              </button>
            ) : null}
          </>
        ) : (
          <span>Voice sample unavailable for this meeting.</span>
        )}
        {sampleError ? (
          <span role="alert">Could not play this voice sample.</span>
        ) : null}
      </div>
      {attendeeChoices.length > 0 ? (
        <div className="speaker-review-invitees">
          <span>Invited</span>
          <div>
            {attendeeChoices.map((attendee) => (
              <button
                key={attendee.label}
                type="button"
                disabled={busy}
                onClick={() => {
                  setChoice('');
                  setName('');
                  setStaged(attendee);
                }}
              >
                {attendee.label} · Invited
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <label className="speaker-review-field">
        <span>Choose an existing person or add someone new</span>
        <select
          aria-label={`Person for ${speaker}`}
          className={identityFieldClass}
          value={choice}
          disabled={busy}
          onChange={(event) => {
            const value = event.target.value;
            setChoice(value);
            setStaged(null);
            if (value === '__new__') return;
            const person = people.find((candidate) => candidate.id === value);
            if (person) stagePerson(person);
          }}
        >
          <option value="">Choose a person…</option>
          {people.map((person) => (
            <option key={person.id} value={person.id}>
              {identityPersonLabel(person, people)}
            </option>
          ))}
          <option value="__new__">Create a distinct person…</option>
        </select>
      </label>
      {choice === '__new__' ? (
        <div className="speaker-review-new-person">
          <label>
            <span>New person name</span>
            <input
              aria-label={`New person name for ${speaker}`}
              className={identityFieldClass}
              value={name}
              maxLength={200}
              disabled={busy}
              onChange={(event) => {
                setName(event.target.value);
                setStaged(null);
              }}
            />
          </label>
          <button
            type="button"
            disabled={busy || !name.trim()}
            onClick={() =>
              setStaged({
                label: name.trim(),
                selection: { newName: name.trim() },
              })
            }
          >
            Review new person
          </button>
        </div>
      ) : null}
      {staged ? (
        <div className="speaker-review-confirmation">
          <strong>
            {displayLabel} will appear as {staged.label}
          </strong>
          <p>
            {summary?.turnCount ?? 0} transcript{' '}
            {(summary?.turnCount ?? 0) === 1 ? 'turn' : 'turns'} will be linked
            to {staged.label} in People. Confirm that {displayLabel} is one
            individual throughout this meeting.
          </p>
          <div>
            <button
              type="button"
              disabled={busy}
              onClick={() => onSave(staged.selection)}
            >
              Confirm {staged.label}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setStaged(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </article>
  );
};

const MeetingIdentityPanel = ({
  meetingId,
  attendeeNames,
  hasSystemAudio,
  speakerSummaries,
  onDisplayNamesChange,
}: {
  meetingId: string;
  attendeeNames: string[];
  hasSystemAudio: boolean;
  speakerSummaries: Record<string, SpeakerReviewSummary>;
  onDisplayNamesChange?: (displayNames: Record<string, string>) => void;
}) => {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<MeetingIdentityState | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const request = useRef(0);
  const sampleRequest = useRef(0);
  const sampleAudio = useRef<HTMLAudioElement | null>(null);
  const sampleUrl = useRef<string | null>(null);
  const [sampleState, setSampleState] = useState<{
    speaker: string;
    sampleIndex: number;
    sampleCount: number;
  } | null>(null);
  const [sampleLoading, setSampleLoading] = useState<string | null>(null);
  const [sampleError, setSampleError] = useState<string | null>(null);

  const releaseSample = useCallback(() => {
    sampleAudio.current?.pause();
    sampleAudio.current = null;
    if (sampleUrl.current) URL.revokeObjectURL(sampleUrl.current);
    sampleUrl.current = null;
  }, []);

  const playSample = useCallback(
    async (speaker: string, sampleIndex: number) => {
      const token = ++sampleRequest.current;
      releaseSample();
      setSampleState(null);
      setSampleError(null);
      setSampleLoading(speaker);
      try {
        const result = await getMeetingSpeakerSample(
          meetingId,
          speaker,
          sampleIndex,
        );
        if (token !== sampleRequest.current) return;
        if (!result) {
          setSampleError(speaker);
          return;
        }
        const bytes = Uint8Array.from(result.bytes);
        const url = URL.createObjectURL(
          new Blob([bytes.buffer], { type: result.mimeType }),
        );
        const audio = new Audio(url);
        sampleUrl.current = url;
        sampleAudio.current = audio;
        audio.addEventListener('ended', () => {
          if (sampleAudio.current !== audio) return;
          releaseSample();
          setSampleState(null);
        });
        await audio.play();
        if (token !== sampleRequest.current) {
          releaseSample();
          return;
        }
        setSampleState({
          speaker,
          sampleIndex: result.sampleIndex,
          sampleCount: result.sampleCount,
        });
      } catch {
        if (token === sampleRequest.current) {
          releaseSample();
          setSampleError(speaker);
        }
      } finally {
        if (token === sampleRequest.current) setSampleLoading(null);
      }
    },
    [meetingId, releaseSample],
  );

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
    void load();
  }, [load]);

  useEffect(() => {
    if (!state) return;
    onDisplayNamesChange?.(extractSpeakerDisplayNames(state));
  }, [state, onDisplayNamesChange]);

  useEffect(
    () => () => {
      request.current++;
      sampleRequest.current++;
      releaseSample();
    },
    [releaseSample],
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
  const remoteSpeakers =
    state?.speakers.filter((speaker) =>
      /^Remote Speaker \d+$/u.test(speaker),
    ) ?? [];
  const unidentifiedCount = remoteSpeakers.filter((speaker) => {
    const binding = state?.bindings.find((item) => item.speaker === speaker);
    return !(binding?.source === 'user' && binding.personId);
  }).length;
  const disclosureLabel =
    unidentifiedCount > 0
      ? `${unidentifiedCount} unidentified ${unidentifiedCount === 1 ? 'speaker' : 'speakers'} · Review`
      : 'Speaker identities';

  return (
    <div className="meeting-speaker-review text-left py-3">
      <button
        id="meeting-speaker-review-toggle"
        type="button"
        aria-expanded={open}
        aria-controls={id}
        disabled={!open && busy}
        className="inline-flex items-center gap-1.5 text-[13px] text-pro-text-muted hover:text-pro-text-main rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pro-accent disabled:opacity-50"
        onClick={() => {
          if (open) {
            sampleRequest.current++;
            releaseSample();
            setSampleState(null);
            setSampleLoading(null);
          }
          setOpen(!open);
        }}
      >
        {open ? (
          <ChevronDown size={14} aria-hidden="true" />
        ) : (
          <ChevronRight size={14} aria-hidden="true" />
        )}
        {disclosureLabel}
      </button>
      {open && (
        <div id={id} className="speaker-review-panel">
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
          {state &&
            remoteSpeakers.map((speaker) => {
              const binding = state.bindings.find(
                (item) => item.speaker === speaker,
              );
              return (
                <AnonymousSpeakerReview
                  key={`${speaker}:${JSON.stringify(binding)}`}
                  speaker={speaker}
                  binding={binding}
                  people={state.people}
                  selfPersonId={state.selfPersonId}
                  userProfile={state.profile}
                  busy={busy || loading}
                  attendeeNames={attendeeNames}
                  summary={speakerSummaries[speaker]}
                  hasSystemAudio={hasSystemAudio}
                  sample={sampleState?.speaker === speaker ? sampleState : null}
                  sampleLoading={sampleLoading === speaker}
                  sampleError={sampleError === speaker}
                  onPlaySample={(sampleIndex) =>
                    void playSample(speaker, sampleIndex)
                  }
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
          {state?.speakers
            .filter((speaker) => !/^Remote Speaker \d+$/u.test(speaker))
            .map((speaker) => {
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
  attendeeNames = [],
  hasSystemAudio = false,
  speakerSummaries = {},
  onDisplayNamesChange,
}: {
  meetingId: string;
  attendeeNames?: string[];
  hasSystemAudio?: boolean;
  speakerSummaries?: Record<string, SpeakerReviewSummary>;
  onDisplayNamesChange?: (displayNames: Record<string, string>) => void;
}) => (
  <MeetingIdentityPanel
    key={meetingId}
    meetingId={meetingId}
    attendeeNames={attendeeNames}
    hasSystemAudio={hasSystemAudio}
    speakerSummaries={speakerSummaries}
    onDisplayNamesChange={onDisplayNamesChange}
  />
);
