import { ChevronLeft, Play, X } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import {
  type IdentitySelection,
  type MeetingIdentityState,
  clearMeetingIdentityBinding,
  getMeetingIdentity,
  getMeetingSpeakerSample,
  getMeetingSpeakerSampleAvailability,
  identityErrorMessage,
  identityPersonLabel,
  isIdentityRevisionError,
  meetingSpeakerSampleUnavailableMessage,
  setMeetingIdentityBinding,
} from '../../api/identity';
import type { MeetingSpeakerSampleAvailability } from '../../api/identity';
import {
  type ClientCandidateMetadata,
  type ClientVoiceMatchOutcome,
  type SpeakerVoiceEnrollmentResult,
  type VoiceMatchSuggestion,
  enrollSpeakerVoice,
  getSpeakerVoiceSuggestions,
  rejectSpeakerVoiceSuggestion,
} from '../../api/speakerVoice';
import type { IdentityPerson } from '../../types/identity';
import {
  getAnonymousSpeakerDisplayLabel,
  isGenericSpeakerLabel,
  selectReviewableAnonymousSpeakers,
} from '../../utils/speakerReview';
import { SearchSelect } from '../ui/SearchSelect';
import type { SpeakerReviewSummary } from './MeetingIdentityControls';
import { extractSpeakerDisplayNames } from './meetingTranscriptPresentation';

export interface SpeakerIdentificationModalProps {
  isOpen: boolean;
  onClose: () => void;
  meetingId: string;
  initialSpeaker?: string | null;
  attendeeNames?: string[];
  hasSystemAudio?: boolean;
  speakerSummaries?: Record<string, SpeakerReviewSummary>;
  onDisplayNamesChange?: (displayNames: Record<string, string>) => void;
  metadataWaitTimeoutMs?: number;
}

const voiceMatchOutcomeMessage = (
  outcome: ClientVoiceMatchOutcome | undefined,
): string | null => {
  switch (outcome?.category) {
    case 'ambiguous':
      return 'Voice evidence matched more than one saved profile too closely. Choose the participant manually.';
    case 'no_profile':
      return 'No saved voice profile is available for automatic identification yet.';
    case 'incompatible':
      return 'Saved voice evidence is from a different recognition version. Confirm the participant to refresh it.';
    case 'rejected_for_candidate':
      return 'The available voice match was previously dismissed for this speaker.';
    case 'below_threshold':
      return 'No saved voice profile matched with enough confidence.';
    case 'impure':
      return 'There was not enough isolated speech for automatic voice identification.';
    case 'disabled':
      return 'Automatic voice identification is currently unavailable. Choose the participant manually.';
    case 'no_candidate':
      return 'Voice evidence is not available for this speaker yet.';
    default:
      return null;
  }
};

export const SpeakerIdentificationModal = ({
  isOpen,
  onClose,
  meetingId,
  initialSpeaker = null,
  attendeeNames = [],
  hasSystemAudio = true,
  speakerSummaries = {},
  onDisplayNamesChange,
  metadataWaitTimeoutMs = 2000,
}: SpeakerIdentificationModalProps) => {
  const dialogId = useId();
  const titleId = useId();
  const comboboxInputId = useId();
  const [state, setState] = useState<MeetingIdentityState | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [stepIndex, setStepIndex] = useState(0);
  const [isSummaryView, setIsSummaryView] = useState(false);

  // Combobox & search state for current active speaker
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSelection, setSelectedSelection] =
    useState<IdentitySelection | null>(null);

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
  const [sampleError, setSampleError] = useState<{
    speaker: string;
    message: string;
  } | null>(null);
  const [sampleAvailability, setSampleAvailability] = useState<{
    speaker: string;
    value: MeetingSpeakerSampleAvailability;
  } | null>(null);
  const [sampleAvailabilityLoading, setSampleAvailabilityLoading] =
    useState(false);

  // Voice profiles & match suggestions state
  const [voiceSuggestions, setVoiceSuggestions] = useState<
    Record<string, VoiceMatchSuggestion>
  >({});
  const [speakerCandidates, setSpeakerCandidates] = useState<
    Record<string, ClientCandidateMetadata>
  >({});
  const [voiceMatchOutcomes, setVoiceMatchOutcomes] = useState<
    Record<string, ClientVoiceMatchOutcome>
  >({});
  const [voiceEnrollmentAvailability, setVoiceEnrollmentAvailability] =
    useState<Record<string, boolean>>({});
  const [voiceSuggestionsLoading, setVoiceSuggestionsLoading] = useState(false);
  const [pendingVoiceSpeakers, setPendingVoiceSpeakers] = useState<Set<string>>(
    new Set(),
  );
  const voiceSuggestionsPromiseRef = useRef<Promise<void> | null>(null);
  const speakerCandidatesRef = useRef<Record<string, ClientCandidateMetadata>>(
    {},
  );
  const voiceEnrollmentAvailabilityRef = useRef<Record<string, boolean>>({});
  const isMountedRef = useRef(true);
  const meetingIdRef = useRef(meetingId);
  meetingIdRef.current = meetingId;
  const initializedReview = useRef<string | null>(null);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const releaseSample = useCallback(() => {
    sampleAudio.current?.pause();
    sampleAudio.current = null;
    if (sampleUrl.current) URL.revokeObjectURL(sampleUrl.current);
    sampleUrl.current = null;
  }, []);

  const attendeeNamesRef = useRef(attendeeNames);
  attendeeNamesRef.current = attendeeNames;

  const loadVoiceSuggestions = useCallback(async () => {
    const requestedMeetingId = meetingId;
    const refreshStart = performance.now();
    if (isMountedRef.current) setVoiceSuggestionsLoading(true);
    const currentPromise = (async () => {
      try {
        const res = await getSpeakerVoiceSuggestions(
          meetingId,
          attendeeNamesRef.current,
        );
        speakerCandidatesRef.current = res.candidates;
        voiceEnrollmentAvailabilityRef.current = res.enrollmentAvailability;
        if (
          !isMountedRef.current ||
          meetingIdRef.current !== requestedMeetingId
        )
          return;
        setVoiceSuggestions(res.suggestions);
        setSpeakerCandidates(res.candidates);
        setVoiceMatchOutcomes(res.outcomes);
        setVoiceEnrollmentAvailability(res.enrollmentAvailability);
        const refreshDurationMs = Math.round(performance.now() - refreshStart);
        console.log(
          '[Pluto][SpeakerVoice] post-confirmation refresh completed',
          {
            meetingId,
            durationMs: refreshDurationMs,
          },
        );
      } catch {
        // non-fatal
      } finally {
        if (isMountedRef.current && meetingIdRef.current === requestedMeetingId)
          setVoiceSuggestionsLoading(false);
      }
    })();
    voiceSuggestionsPromiseRef.current = currentPromise;
    try {
      await currentPromise;
    } finally {
      if (voiceSuggestionsPromiseRef.current === currentPromise) {
        voiceSuggestionsPromiseRef.current = null;
      }
    }
  }, [meetingId]);

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
        if (result.status === 'unavailable') {
          setSampleAvailability({ speaker, value: result });
          setSampleError({
            speaker,
            message: meetingSpeakerSampleUnavailableMessage(result.reason),
          });
          return;
        }
        const { sample } = result;
        const bytes = Uint8Array.from(sample.bytes);
        const url = URL.createObjectURL(
          new Blob([bytes.buffer], { type: sample.mimeType }),
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
          sampleIndex: sample.sampleIndex,
          sampleCount: sample.sampleCount,
        });
      } catch {
        if (token === sampleRequest.current) {
          releaseSample();
          setSampleError({
            speaker,
            message: 'Pluto could not play this recording excerpt.',
          });
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
      void loadVoiceSuggestions();
      setIsSummaryView(false);
    } else {
      releaseSample();
      setSampleState(null);
      setSampleLoading(null);
    }
  }, [isOpen, loadIdentity, loadVoiceSuggestions, releaseSample]);

  const reviewableSpeakers = useMemo(
    () => selectReviewableAnonymousSpeakers(state?.speakers ?? []),
    [state],
  );

  // Set initial step if initialSpeaker passed
  useEffect(() => {
    if (!isOpen) {
      initializedReview.current = null;
      return;
    }
    if (state?.meetingId !== meetingId || reviewableSpeakers.length === 0)
      return;
    const reviewKey = JSON.stringify([meetingId, initialSpeaker]);
    if (initializedReview.current === reviewKey) return;
    initializedReview.current = reviewKey;
    setStepIndex(Math.max(0, reviewableSpeakers.indexOf(initialSpeaker ?? '')));
  }, [isOpen, meetingId, initialSpeaker, reviewableSpeakers, state?.meetingId]);

  // Sync display names callback
  useEffect(() => {
    if (!state) return;
    onDisplayNamesChange?.(extractSpeakerDisplayNames(state));
  }, [state, onDisplayNamesChange]);

  // Clean up audio on unmount
  useEffect(() => {
    return () => {
      releaseSample();
    };
  }, [releaseSample]);

  const currentSpeaker = reviewableSpeakers[stepIndex];
  const totalSpeakers = reviewableSpeakers.length;
  const summary = currentSpeaker ? speakerSummaries[currentSpeaker] : undefined;
  const displayLabel = currentSpeaker
    ? getAnonymousSpeakerDisplayLabel(currentSpeaker)
    : '';
  const currentBinding = currentSpeaker
    ? state?.bindings.find((b) => b.speaker === currentSpeaker)
    : null;
  const currentBoundPerson = currentBinding?.personId
    ? state?.people.find((p) => p.id === currentBinding.personId)
    : null;

  useEffect(() => {
    if (!isOpen || !currentSpeaker) {
      setSampleAvailability(null);
      setSampleAvailabilityLoading(false);
      return;
    }
    if (!hasSystemAudio) {
      setSampleAvailability({
        speaker: currentSpeaker,
        value: { status: 'unavailable', reason: 'source_unavailable' },
      });
      setSampleAvailabilityLoading(false);
      return;
    }
    let active = true;
    setSampleAvailability(null);
    setSampleAvailabilityLoading(true);
    void getMeetingSpeakerSampleAvailability(meetingId, currentSpeaker)
      .then((value) => {
        if (!active) return;
        setSampleAvailability({
          speaker: currentSpeaker,
          value:
            value?.status === 'available' || value?.status === 'unavailable'
              ? value
              : {
                  status: 'unavailable',
                  reason: 'availability_check_failed',
                },
        });
      })
      .catch(() => {
        if (active) {
          setSampleAvailability({
            speaker: currentSpeaker,
            value: {
              status: 'unavailable',
              reason: 'availability_check_failed',
            },
          });
        }
      })
      .finally(() => {
        if (active) setSampleAvailabilityLoading(false);
      });
    return () => {
      active = false;
    };
  }, [currentSpeaker, hasSystemAudio, isOpen, meetingId]);

  // Close the modal when its nested controls have not consumed Escape.
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

  // Reset or initialize combobox inputs whenever active speaker changes
  useEffect(() => {
    ++sampleRequest.current;
    releaseSample();
    setSampleState(null);
    setSampleLoading(null);
    if (!currentSpeaker || !state) {
      setSearchQuery('');
      setSelectedSelection(null);
      return;
    }
    const binding = state.bindings.find((b) => b.speaker === currentSpeaker);
    if (binding?.personId) {
      const person = state.people.find((p) => p.id === binding.personId);
      if (person) {
        setSearchQuery(person.name);
        setSelectedSelection({ personId: person.id });
        return;
      }
    }
    setSearchQuery('');
    setSelectedSelection(null);
  }, [isOpen, stepIndex, currentSpeaker, releaseSample]);

  const eligiblePeople = useMemo(() => {
    return (state?.people ?? []).filter((p) => {
      const name = p.name.trim();
      if (!name) return false;
      if (isGenericSpeakerLabel(name)) return false;
      if (
        currentSpeaker &&
        name.toLowerCase() === currentSpeaker.toLowerCase()
      ) {
        return false;
      }
      return true;
    });
  }, [state?.people, currentSpeaker]);

  const exactMatch = useMemo(() => {
    const trimmedQuery = searchQuery.trim().toLowerCase();
    if (!trimmedQuery) return null;
    return (
      eligiblePeople.find(
        (p) => p.name.trim().toLowerCase() === trimmedQuery,
      ) ?? null
    );
  }, [eligiblePeople, searchQuery]);

  if (!isOpen) return null;

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
    if (isGenericSpeakerLabel(attendee.name)) return [];
    if (
      currentSpeaker &&
      attendee.name.toLowerCase() === currentSpeaker.toLowerCase()
    ) {
      return [];
    }
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

  const isUnchangedBinding = (
    speaker: string,
    selection: IdentitySelection,
  ) => {
    const binding = state?.bindings.find((item) => item.speaker === speaker);
    return Boolean(
      selection.personId &&
        binding?.personId === selection.personId &&
        binding.source === 'user' &&
        binding.individual &&
        !binding.assignment,
    );
  };

  const saveBinding = async (
    speaker: string,
    selection: IdentitySelection,
    autoAdvance = true,
  ) => {
    if (!state || busy) return;
    if (isUnchangedBinding(speaker, selection)) {
      if (autoAdvance) handleNextOrSkip();
      return;
    }
    setBusy(true);
    setError('');
    const bindingStart = performance.now();
    try {
      const next = await setMeetingIdentityBinding(
        meetingId,
        speaker,
        selection,
        state.revision,
      );
      const bindingDurationMs = Math.round(performance.now() - bindingStart);
      console.log('[Pluto][SpeakerVoice] binding persistence completed', {
        meetingId,
        speaker,
        durationMs: bindingDurationMs,
      });
      setState(next);

      const enrolledPersonId =
        next.bindings.find((binding) => binding.speaker === speaker)
          ?.personId ?? selection.personId;

      // Auto-advance immediately upon persistence so wizard is never stalled.
      if (autoAdvance) {
        if (stepIndex + 1 < totalSpeakers) {
          setStepIndex(stepIndex + 1);
        } else {
          setIsSummaryView(true);
        }
      }

      // Voice enrollment is a non-blocking follow-up.
      if (enrolledPersonId) {
        void (async () => {
          try {
            // Await in-flight metadata suggestions if still loading, but bound the wait
            // so an unbounded or hung metadata reconciliation never stalls enrollment.
            if (voiceSuggestionsPromiseRef.current) {
              try {
                await Promise.race([
                  voiceSuggestionsPromiseRef.current,
                  new Promise((resolve) =>
                    setTimeout(resolve, metadataWaitTimeoutMs),
                  ),
                ]);
              } catch {
                // Non-fatal: fall back to enrollment without cached suggestions
              }
            }
            const candidate = speakerCandidatesRef.current[speaker];
            const availability = voiceEnrollmentAvailabilityRef.current;
            const hasAvailabilityInfo = speaker in availability;
            const isAvailable = availability[speaker];

            // If metadata has loaded and explicitly determined that this speaker is unavailable
            // and has no eligible candidate, skip enrollment.
            if (
              hasAvailabilityInfo &&
              !isAvailable &&
              !candidate?.isEligibleForEnrollment
            ) {
              return;
            }

            // Otherwise (metadata confirmed availability, OR metadata timed out/failed/not loaded),
            // proceed to enroll (using cached candidate evidence if available, or falling back to
            // backend candidate generation without cached metadata).
            const attemptEnrollment = async (rev: number) => {
              return await enrollSpeakerVoice({
                personId: enrolledPersonId,
                sourceMeetingId: meetingId,
                speaker,
                expectedRevision: rev,
                ...(candidate?.isEligibleForEnrollment
                  ? {
                      sourceRevision: candidate.sourceRevision,
                      candidateDigest: candidate.candidateDigest,
                    }
                  : {}),
              });
            };

            let res: SpeakerVoiceEnrollmentResult;
            try {
              res = await attemptEnrollment(next.revision);
            } catch (firstErr: any) {
              // If revision changed due to unrelated identity changes (e.g. user confirmed next speaker),
              // re-check if this speaker is still bound to enrolledPersonId and retry once.
              if (isIdentityRevisionError(firstErr)) {
                const latestIdentity = await getMeetingIdentity(meetingId);
                const currentBinding = latestIdentity.bindings.find(
                  (b) => b.speaker === speaker,
                );
                if (currentBinding?.personId === enrolledPersonId) {
                  res = await attemptEnrollment(latestIdentity.revision);
                } else {
                  throw firstErr;
                }
              } else {
                throw firstErr;
              }
            }

            if (res?.timings) {
              console.log('[Pluto][SpeakerVoice] voice enrollment timings', {
                meetingId,
                speaker,
                personId: enrolledPersonId,
                ...res.timings,
              });
            }
            if (res?.queued && isMountedRef.current) {
              setPendingVoiceSpeakers((current) =>
                new Set(current).add(speaker),
              );
            }
            if (isMountedRef.current) {
              void loadVoiceSuggestions();
            }
          } catch (err) {
            console.warn(
              '[Pluto][SpeakerVoice] background voice profile enrollment failed',
              {
                meetingId,
                speaker,
                personId: enrolledPersonId,
                err,
              },
            );
          }
        })();
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

  const handleRejectSuggestion = async (suggestion: VoiceMatchSuggestion) => {
    if (!currentSpeaker || busy) return;
    setBusy(true);
    setError('');
    try {
      if (
        currentBinding &&
        currentBinding.personId === suggestion.suggestedPersonId &&
        state
      ) {
        try {
          const next = await clearMeetingIdentityBinding(
            meetingId,
            currentSpeaker,
            state.revision,
          );
          setState(next);
        } catch {
          // non-fatal if clearing fails
        }
      }
      await rejectSpeakerVoiceSuggestion({
        meetingId,
        speaker: currentSpeaker,
        sourceRevision: suggestion.sourceRevision,
        candidateDigest: suggestion.candidateDigest,
        personId: suggestion.suggestedPersonId,
      });
      setVoiceSuggestions((prev) => {
        const next = { ...prev };
        delete next[currentSpeaker];
        return next;
      });
    } catch {
      setError('Could not record voice rejection.');
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmSuggestion = async (suggestion: VoiceMatchSuggestion) => {
    if (!currentSpeaker || !state || busy) return;
    await saveBinding(
      currentSpeaker,
      { personId: suggestion.suggestedPersonId },
      true,
    );
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

  const handleSelectPerson = (person: IdentityPerson) => {
    if (!currentSpeaker) return;
    setSelectedSelection({ personId: person.id });
    setSearchQuery(person.name);
    void saveBinding(currentSpeaker, { personId: person.id }, true);
  };

  const handleCreateNew = (name: string) => {
    if (!currentSpeaker) return;
    const trimmed = name.trim();
    if (
      !trimmed ||
      isGenericSpeakerLabel(trimmed) ||
      trimmed.toLowerCase() === currentSpeaker.toLowerCase()
    )
      return;
    setSelectedSelection({ newName: trimmed });
    setSearchQuery(trimmed);
    void saveBinding(currentSpeaker, { newName: trimmed }, true);
  };

  const handleConfirmCurrent = () => {
    if (!currentSpeaker || busy) return;
    if (selectedSelection) {
      void saveBinding(currentSpeaker, selectedSelection, true);
    } else if (searchQuery.trim()) {
      if (exactMatch) {
        void saveBinding(currentSpeaker, { personId: exactMatch.id }, true);
      } else {
        void saveBinding(currentSpeaker, { newName: searchQuery.trim() }, true);
      }
    }
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
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
                {reviewableSpeakers.map((speaker) => {
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
                        {boundPerson && pendingVoiceSpeakers.has(speaker) ? (
                          <p className="mt-1 text-[11px] text-pro-text-muted">
                            Voice enrollment pending. Waiting for processing
                            capacity.
                          </p>
                        ) : null}
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
                {sampleAvailability?.speaker === currentSpeaker &&
                sampleAvailability.value?.status === 'available' ? (
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
                        : sampleAvailability.value.scope === 'remote_channel'
                          ? 'Play recording excerpt'
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
                ) : sampleAvailabilityLoading ? (
                  <span className="text-xs text-pro-text-muted">
                    Checking recording…
                  </span>
                ) : sampleError?.speaker !== currentSpeaker ? (
                  <span className="text-xs text-pro-text-muted">
                    {sampleAvailability?.speaker === currentSpeaker &&
                    sampleAvailability.value?.status === 'unavailable'
                      ? meetingSpeakerSampleUnavailableMessage(
                          sampleAvailability.value.reason,
                        )
                      : 'The participant recording is unavailable.'}
                  </span>
                ) : null}
                {sampleError?.speaker === currentSpeaker ? (
                  <span
                    role="alert"
                    className="mt-1 block text-xs text-red-400"
                  >
                    {sampleError.message}
                  </span>
                ) : null}
              </div>

              {/* Voice Match Suggestion Banner */}
              {currentSpeaker && voiceSuggestions[currentSpeaker] ? (
                <div className="rounded-xl border border-pro-accent/40 bg-pro-accent/5 p-3.5 space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-semibold text-pro-text-main">
                        {currentBinding?.assignment?.kind ===
                          'voice_match_strong_v1' &&
                        currentBinding.personId ===
                          voiceSuggestions[currentSpeaker].suggestedPersonId
                          ? `${displayLabel} recognized as ${voiceSuggestions[currentSpeaker].suggestedPersonName}`
                          : `${displayLabel} may be ${voiceSuggestions[currentSpeaker].suggestedPersonName}`}
                      </span>
                      <span className="rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 px-2 py-0.5 text-[10px] font-medium">
                        Strong match
                      </span>
                      {voiceSuggestions[currentSpeaker].isCalendarAttendee ? (
                        <span className="rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 px-2 py-0.5 text-[10px] font-medium">
                          On calendar
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    {currentBinding?.assignment?.kind ===
                      'voice_match_strong_v1' &&
                    currentBinding.personId ===
                      voiceSuggestions[currentSpeaker].suggestedPersonId ? (
                      <span className="rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 px-3 py-1 text-xs font-medium">
                        Automatically identified
                      </span>
                    ) : (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void handleConfirmSuggestion(
                            voiceSuggestions[currentSpeaker],
                          )
                        }
                        className="rounded-lg bg-pro-accent px-3 py-1 text-xs font-medium text-white hover:bg-pro-accent/90 transition-colors"
                      >
                        Confirm{' '}
                        {voiceSuggestions[currentSpeaker].suggestedPersonName}
                      </button>
                    )}

                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void handleRejectSuggestion(
                          voiceSuggestions[currentSpeaker],
                        )
                      }
                      className="rounded-lg border border-pro-border/80 px-2.5 py-1 text-xs font-medium text-pro-text-muted hover:bg-pro-hover hover:text-pro-text-main transition-colors"
                    >
                      Not {voiceSuggestions[currentSpeaker].suggestedPersonName}
                    </button>
                  </div>
                </div>
              ) : null}

              {currentSpeaker &&
              !voiceSuggestions[currentSpeaker] &&
              (voiceSuggestionsLoading ||
                speakerCandidates[currentSpeaker]?.analysisStatus ||
                voiceMatchOutcomes[currentSpeaker]) ? (
                <p className="text-xs text-pro-text-muted">
                  {voiceSuggestionsLoading
                    ? 'Checking saved voice profiles…'
                    : speakerCandidates[currentSpeaker]?.analysisStatus ===
                        'queued'
                      ? 'Voice analysis is queued until processing capacity is available.'
                      : speakerCandidates[currentSpeaker]?.analysisStatus ===
                          'retryable_failure'
                        ? 'Voice analysis was interrupted. Pluto will retry automatically.'
                        : speakerCandidates[currentSpeaker]?.analysisStatus ===
                            'abstained'
                          ? 'There was not enough reliable isolated speech for voice identification.'
                          : (voiceMatchOutcomeMessage(
                              voiceMatchOutcomes[currentSpeaker],
                            ) ??
                            (speakerCandidates[currentSpeaker]
                              ?.analysisStatus === 'eligible'
                              ? 'No saved voice profile matched with enough confidence.'
                              : null))}
                </p>
              ) : null}

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

              {/* Searchable Combobox person selector */}
              <div className="relative space-y-2 pt-1 border-t border-pro-border/30">
                <div className="flex items-center justify-between">
                  <label
                    htmlFor={comboboxInputId}
                    className="block text-xs font-medium text-pro-text-muted"
                  >
                    Choose an existing person or add someone new
                  </label>
                  {currentBoundPerson ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleClearBinding(currentSpeaker)}
                      className="text-[11px] text-pro-text-muted hover:text-pro-text-main hover:underline transition-colors"
                    >
                      Unassign ({currentBoundPerson.name})
                    </button>
                  ) : null}
                </div>

                <SearchSelect
                  id={comboboxInputId}
                  ariaLabel={`Person for ${displayLabel}`}
                  value={
                    selectedSelection && 'personId' in selectedSelection
                      ? (selectedSelection.personId ?? '')
                      : ''
                  }
                  inputValue={searchQuery}
                  onInputValueChange={(next) => {
                    setSearchQuery(next);
                    setSelectedSelection(null);
                  }}
                  onValueChange={(personId) => {
                    const person = eligiblePeople.find(
                      (candidate) => candidate.id === personId,
                    );
                    if (person) handleSelectPerson(person);
                  }}
                  onCreateOption={handleCreateNew}
                  canCreateOption={(name) =>
                    !isGenericSpeakerLabel(name) &&
                    name.trim().toLowerCase() !== currentSpeaker?.toLowerCase()
                  }
                  createOptionLabel={(name) => (
                    <span className="flex w-full items-center justify-between gap-3">
                      <span>
                        Create{' '}
                        <strong className="text-pro-text-main">“{name}”</strong>
                      </span>
                      <span className="rounded-full bg-pro-accent/10 px-2 py-0.5 text-[10px] text-pro-accent">
                        New person
                      </span>
                    </span>
                  )}
                  options={eligiblePeople.map((person) => ({
                    value: person.id,
                    label: identityPersonLabel(person, state?.people ?? []),
                    keywords: person.aliases,
                  }))}
                  placeholder="Search people or type a new name…"
                  searchPlaceholder="Search people or type a new name…"
                  emptyMessage="No matching people found."
                  disabled={busy}
                  clearable
                  clearLabel="Clear person input"
                />
              </div>
              {currentSpeaker &&
              (speakerCandidates[currentSpeaker]?.isEligibleForEnrollment ||
                voiceEnrollmentAvailability[currentSpeaker]) ? (
                <p className="pt-2 text-xs text-pro-text-muted">
                  Confirming identifies this speaker. Eligible voice samples
                  help with future meetings.
                </p>
              ) : null}
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
                {(!voiceSuggestions[currentSpeaker] ||
                  selectedSelection ||
                  searchQuery.trim()) && (
                  <button
                    type="button"
                    disabled={
                      busy || (!selectedSelection && !searchQuery.trim())
                    }
                    onClick={handleConfirmCurrent}
                    className="inline-flex items-center justify-center rounded-lg bg-pro-accent px-3.5 py-1.5 text-xs font-medium text-white shadow-sm transition-colors hover:bg-pro-accent/90 disabled:opacity-45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pro-accent"
                  >
                    {busy
                      ? 'Saving…'
                      : isUnchangedBinding(
                            currentSpeaker,
                            selectedSelection ?? {
                              personId: exactMatch?.id ?? null,
                            },
                          )
                        ? 'Next'
                        : 'Confirm & Next'}
                  </button>
                )}
              </>
            )}
          </div>
        </footer>
      </div>
    </dialog>,
    document.body,
  );
};
