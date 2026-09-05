import { ChevronLeft, Play, X } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  type IdentitySelection,
  type MeetingIdentityState,
  clearMeetingIdentityBinding,
  getMeetingIdentity,
  getMeetingSpeakerSample,
  identityErrorMessage,
  identityPersonLabel,
  isIdentityRevisionError,
  setMeetingIdentityBinding,
} from '../../api/identity';
import type { IdentityBinding, IdentityPerson } from '../../types/identity';
import { getAnonymousSpeakerDisplayLabel } from '../../utils/speakerReview';
import type { SpeakerReviewSummary } from './MeetingIdentityControls';

export interface SpeakerIdentificationModalProps {
  isOpen: boolean;
  onClose: () => void;
  meetingId: string;
  initialSpeaker?: string | null;
  attendeeNames?: string[];
  hasSystemAudio?: boolean;
  speakerSummaries?: Record<string, SpeakerReviewSummary>;
  onDisplayNamesChange?: (displayNames: Record<string, string>) => void;
}

export const SpeakerIdentificationModal = ({
  isOpen,
  onClose,
  meetingId,
  initialSpeaker = null,
  attendeeNames = [],
  hasSystemAudio = true,
  speakerSummaries = {},
  onDisplayNamesChange,
}: SpeakerIdentificationModalProps) => {
  const dialogId = useId();
  const titleId = useId();
  const [state, setState] = useState<MeetingIdentityState | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [stepIndex, setStepIndex] = useState(0);
  const [isSummaryView, setIsSummaryView] = useState(false);

  // Form selection state for the current active speaker
  const [choice, setChoice] = useState('');
  const [customName, setCustomName] = useState('');

  // Audio sample playback
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
    async (speaker: string, sampleIdx: number) => {
      const token = ++sampleRequest.current;
      releaseSample();
      setSampleState(null);
      setSampleError(null);
      setSampleLoading(speaker);
      try {
        const result = await getMeetingSpeakerSample(
          meetingId,
          speaker,
          sampleIdx,
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

  const loadIdentity = useCallback(
    async (preserveError = false) => {
      setLoading(true);
      if (!preserveError) setError('');
      try {
        const next = await getMeetingIdentity(meetingId);
        setState(next);
      } catch {
        setError('Could not load speaker identities.');
      } finally {
        setLoading(false);
      }
    },
    [meetingId],
  );

  useEffect(() => {
    if (isOpen) {
      void loadIdentity();
      setIsSummaryView(false);
    } else {
      releaseSample();
      setSampleState(null);
      setSampleLoading(null);
    }
  }, [isOpen, loadIdentity, releaseSample]);

  // Compute remote speakers list
  const remoteSpeakers = useMemo(() => {
    if (!state) return [];
    return state.speakers.filter((speaker) =>
      /^Remote Speaker \d+$/u.test(speaker),
    );
  }, [state]);

  // Set initial step if initialSpeaker passed
  useEffect(() => {
    if (!isOpen || !initialSpeaker || remoteSpeakers.length === 0) return;
    const index = remoteSpeakers.indexOf(initialSpeaker);
    if (index >= 0) {
      setStepIndex(index);
    }
  }, [isOpen, initialSpeaker, remoteSpeakers]);

  // Sync display names callback
  useEffect(() => {
    if (!state) return;
    const peopleById = new Map(
      state.people.map((person) => [person.id, person.name]),
    );
    onDisplayNamesChange?.(
      Object.fromEntries(
        state.bindings.flatMap((binding) => {
          const name = binding.personId
            ? peopleById.get(binding.personId)?.trim()
            : '';
          return name ? [[binding.speaker, name]] : [];
        }),
      ),
    );
  }, [state, onDisplayNamesChange]);

  // Clean up audio on unmount
  useEffect(() => {
    return () => {
      releaseSample();
    };
  }, [releaseSample]);

  // Handle escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Reset form inputs whenever active speaker changes
  useEffect(() => {
    setChoice('');
    setCustomName('');
    releaseSample();
    setSampleState(null);
    setSampleLoading(null);
  }, [stepIndex, releaseSample]);

  const customInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (choice === '__new__') {
      customInputRef.current?.focus();
    }
  }, [choice]);

  if (!isOpen) return null;

  const currentSpeaker = remoteSpeakers[stepIndex];
  const totalSpeakers = remoteSpeakers.length;
  const currentBinding = state?.bindings.find(
    (b) => b.speaker === currentSpeaker,
  );
  const summary = currentSpeaker ? speakerSummaries[currentSpeaker] : undefined;
  const displayLabel = currentSpeaker
    ? getAnonymousSpeakerDisplayLabel(currentSpeaker)
    : '';

  // Filter candidate attendees (exclude workspace user & aliases)
  const userNames = new Set<string>();
  if (state?.profile?.preferredName?.trim()) {
    userNames.add(
      state.profile.preferredName.trim().toLocaleLowerCase('en-US'),
    );
  }
  if (state?.selfPersonId) {
    const selfPerson = state.people.find((p) => p.id === state.selfPersonId);
    if (selfPerson?.name?.trim()) {
      userNames.add(selfPerson.name.trim().toLocaleLowerCase('en-US'));
    }
  }
  if (Array.isArray(state?.profile?.aliases)) {
    for (const alias of state.profile.aliases) {
      if (typeof alias === 'string' && alias.trim()) {
        userNames.add(alias.trim().toLocaleLowerCase('en-US'));
      }
    }
  }

  const peopleByName = (state?.people ?? []).reduce<
    Map<string, IdentityPerson[]>
  >((index, person) => {
    const key = person.name.trim().toLocaleLowerCase('en-US');
    index.set(key, [...(index.get(key) ?? []), person]);
    return index;
  }, new Map());

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

  const saveBinding = async (
    speaker: string,
    selection: IdentitySelection,
    autoAdvance = true,
  ) => {
    if (!state || busy) return;
    setBusy(true);
    setError('');
    try {
      const next = await setMeetingIdentityBinding(
        meetingId,
        speaker,
        selection,
        state.revision,
      );
      setState(next);
      if (autoAdvance) {
        if (stepIndex + 1 < totalSpeakers) {
          setStepIndex(stepIndex + 1);
        } else {
          setIsSummaryView(true);
        }
      }
    } catch (failure) {
      setError(identityErrorMessage(failure));
      if (isIdentityRevisionError(failure)) {
        await loadIdentity(true);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleClearBinding = async (speaker: string) => {
    if (!state || busy) return;
    setBusy(true);
    setError('');
    try {
      const next = await clearMeetingIdentityBinding(
        meetingId,
        speaker,
        state.revision,
      );
      setState(next);
    } catch (failure) {
      setError(identityErrorMessage(failure));
      if (isIdentityRevisionError(failure)) {
        await loadIdentity(true);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleNextOrSkip = () => {
    if (stepIndex + 1 < totalSpeakers) {
      setStepIndex(stepIndex + 1);
    } else {
      setIsSummaryView(true);
    }
  };

  const handleConfirmCurrent = () => {
    if (!currentSpeaker) return;
    if (choice === '__new__') {
      if (!customName.trim()) return;
      void saveBinding(currentSpeaker, { newName: customName.trim() }, true);
    } else if (choice) {
      void saveBinding(currentSpeaker, { personId: choice }, true);
    }
  };

  return (
    <dialog
      open
      className="fixed inset-0 z-[1000] m-0 flex h-full w-full max-h-none max-w-none items-center justify-center border-none bg-black/40 p-4 backdrop-blur-sm animate-in"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div className="fixed inset-0" onClick={onClose} aria-hidden="true" />
      <div
        id={dialogId}
        className="relative z-10 w-full max-w-lg rounded-2xl border border-pro-border bg-pro-surface shadow-2xl overflow-hidden flex flex-col max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <header className="flex items-center justify-between px-6 py-4 border-b border-pro-border/40">
          <div className="flex items-center gap-2.5">
            <h2
              id={titleId}
              className="text-sm font-semibold text-pro-text-main"
            >
              Identify Speakers
            </h2>
            {!isSummaryView && totalSpeakers > 0 ? (
              <span className="rounded-full border border-pro-border/70 bg-pro-bg px-2.5 py-0.5 text-[11px] font-medium text-pro-text-muted">
                Speaker {stepIndex + 1} of {totalSpeakers}
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden sm:inline-block text-[10px] font-medium text-pro-text-muted/60 border border-pro-border/60 rounded px-1.5 py-0.5">
              Esc
            </span>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-lg p-1 text-pro-text-muted hover:bg-pro-hover hover:text-pro-text-main transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pro-accent"
            >
              <X size={16} />
            </button>
          </div>
        </header>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
          {error ? (
            <div
              role="alert"
              className="mb-4 rounded-lg bg-red-500/10 border border-red-500/20 p-3 text-xs text-red-400"
            >
              {error}
            </div>
          ) : null}

          {loading && !state ? (
            <div className="py-12 text-center text-xs text-pro-text-muted">
              Loading speaker identities…
            </div>
          ) : isSummaryView || totalSpeakers === 0 ? (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-medium text-pro-text-main">
                  All speakers reviewed
                </h3>
                <p className="mt-1 text-xs text-pro-text-muted">
                  The speaker assignments below apply to this meeting and update
                  People profiles.
                </p>
              </div>

              <div className="divide-y divide-pro-border/30 rounded-xl border border-pro-border/60 bg-pro-bg/40">
                {remoteSpeakers.map((speaker) => {
                  const binding = state?.bindings.find(
                    (b) => b.speaker === speaker,
                  );
                  const boundPerson = binding?.personId
                    ? state?.people.find((p) => p.id === binding.personId)
                    : null;
                  const label = getAnonymousSpeakerDisplayLabel(speaker);

                  return (
                    <div
                      key={speaker}
                      className="flex items-center justify-between px-4 py-3 text-xs"
                    >
                      <div>
                        <span className="font-semibold text-pro-text-main">
                          {label}
                        </span>
                        <span className="ml-2 text-pro-text-muted">
                          {boundPerson
                            ? `is ${boundPerson.name}`
                            : 'Unassigned'}
                        </span>
                      </div>
                      {boundPerson ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void handleClearBinding(speaker)}
                          className="rounded px-2 py-1 text-[11px] font-medium text-pro-text-muted hover:bg-pro-hover hover:text-pro-text-main transition-colors"
                        >
                          Undo
                        </button>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              {/* Speaker Title & Context */}
              <div className="flex items-baseline justify-between">
                <span className="text-base font-semibold text-pro-text-main">
                  {displayLabel}
                </span>
                <span className="text-xs text-pro-text-muted">
                  {summary?.turnCount ?? 0}{' '}
                  {(summary?.turnCount ?? 0) === 1 ? 'turn' : 'turns'} in this
                  meeting
                </span>
              </div>

              {/* Quote excerpt */}
              {summary?.excerpt ? (
                <blockquote className="rounded-xl border border-pro-border/60 bg-pro-bg/50 px-4 py-3 text-[13px] font-serif italic text-pro-text-main leading-relaxed">
                  “{summary.excerpt}”
                </blockquote>
              ) : null}

              {/* Audio sample button */}
              <div>
                {hasSystemAudio ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={busy || sampleLoading === currentSpeaker}
                      onClick={() => void playSample(currentSpeaker, 0)}
                      className="inline-flex items-center gap-1.5 rounded-full border border-pro-border/80 bg-pro-bg px-3 py-1.5 text-xs font-medium text-pro-text-main transition-colors hover:bg-pro-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pro-accent disabled:opacity-50"
                    >
                      <Play
                        size={11}
                        className="fill-current mr-0.5 shrink-0"
                        aria-hidden="true"
                      />
                      {sampleLoading === currentSpeaker
                        ? 'Loading sample…'
                        : 'Play voice sample'}
                    </button>
                    {sampleState?.speaker === currentSpeaker &&
                    sampleState.sampleIndex + 1 < sampleState.sampleCount ? (
                      <button
                        type="button"
                        disabled={busy || sampleLoading === currentSpeaker}
                        onClick={() =>
                          void playSample(
                            currentSpeaker,
                            sampleState.sampleIndex + 1,
                          )
                        }
                        className="rounded px-2 py-1 text-xs text-pro-text-muted hover:text-pro-text-main transition-colors"
                      >
                        Try another sample
                      </button>
                    ) : null}
                  </div>
                ) : (
                  <span className="text-xs text-pro-text-muted">
                    Voice sample unavailable for this meeting.
                  </span>
                )}
                {sampleError === currentSpeaker ? (
                  <span
                    role="alert"
                    className="mt-1 block text-xs text-red-400"
                  >
                    Could not play this voice sample.
                  </span>
                ) : null}
              </div>

              {/* Attendee 1-click suggestion chips */}
              {attendeeChoices.length > 0 ? (
                <div className="space-y-2">
                  <span className="block text-xs font-medium text-pro-text-muted">
                    Invited attendees
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {attendeeChoices.map((choiceItem) => (
                      <button
                        key={choiceItem.label}
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void saveBinding(
                            currentSpeaker,
                            choiceItem.selection,
                            true,
                          )
                        }
                        className="inline-flex items-center rounded-lg border border-pro-border/70 bg-pro-bg px-3 py-1.5 text-xs font-medium text-pro-text-main transition-colors hover:bg-pro-hover hover:border-pro-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pro-accent"
                      >
                        + {choiceItem.label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {/* Dropdown person selector */}
              <div className="space-y-2 pt-1 border-t border-pro-border/30">
                <label
                  htmlFor="speaker-person-select"
                  className="block text-xs font-medium text-pro-text-muted"
                >
                  Choose an existing person or add someone new
                </label>
                <select
                  id="speaker-person-select"
                  aria-label={`Person for ${displayLabel}`}
                  value={choice}
                  disabled={busy}
                  onChange={(e) => setChoice(e.target.value)}
                  className="w-full rounded-lg border border-pro-border bg-pro-bg px-3 py-2 text-xs text-pro-text-main outline-none transition-colors focus:border-pro-accent focus:ring-1 focus:ring-pro-accent"
                >
                  <option value="">Choose a person…</option>
                  {(state?.people ?? []).map((person) => (
                    <option key={person.id} value={person.id}>
                      {identityPersonLabel(person, state?.people ?? [])}
                    </option>
                  ))}
                  <option value="__new__">Create a distinct person…</option>
                </select>

                {choice === '__new__' ? (
                  <div className="pt-2">
                    <input
                      ref={customInputRef}
                      type="text"
                      placeholder="Person name"
                      aria-label={`New person name for ${displayLabel}`}
                      value={customName}
                      disabled={busy}
                      onChange={(e) => setCustomName(e.target.value)}
                      className="w-full rounded-lg border border-pro-border bg-pro-bg px-3 py-2 text-xs text-pro-text-main placeholder:text-pro-text-muted/60 outline-none transition-colors focus:border-pro-accent focus:ring-1 focus:ring-pro-accent"
                    />
                  </div>
                ) : null}
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <footer className="flex items-center justify-between px-6 py-4 border-t border-pro-border/40 bg-pro-bg/30">
          <div>
            {!isSummaryView && stepIndex > 0 ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => setStepIndex(stepIndex - 1)}
                className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-pro-text-muted hover:text-pro-text-main hover:bg-pro-hover transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pro-accent"
              >
                <ChevronLeft size={14} />
                Back
              </button>
            ) : null}
          </div>

          <div className="flex items-center gap-2">
            {isSummaryView || totalSpeakers === 0 ? (
              <button
                type="button"
                onClick={onClose}
                className="inline-flex items-center justify-center rounded-lg bg-pro-accent px-4 py-1.5 text-xs font-medium text-white shadow-sm transition-colors hover:bg-pro-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pro-accent"
              >
                Done
              </button>
            ) : (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleNextOrSkip}
                  className="rounded-lg px-3 py-1.5 text-xs font-medium text-pro-text-muted hover:text-pro-text-main hover:bg-pro-hover transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pro-accent"
                >
                  Skip
                </button>
                <button
                  type="button"
                  disabled={
                    busy ||
                    !choice ||
                    (choice === '__new__' && !customName.trim())
                  }
                  onClick={handleConfirmCurrent}
                  className="inline-flex items-center justify-center rounded-lg bg-pro-accent px-3.5 py-1.5 text-xs font-medium text-white shadow-sm transition-colors hover:bg-pro-accent/90 disabled:opacity-45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pro-accent"
                >
                  Confirm & Next
                </button>
              </>
            )}
          </div>
        </footer>
      </div>
    </dialog>
  );
};
