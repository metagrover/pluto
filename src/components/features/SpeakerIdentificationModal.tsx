import {
  Check,
  ChevronDown,
  ChevronLeft,
  Play,
  Plus,
  Search,
  X,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
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
  identityErrorMessage,
  identityPersonLabel,
  isIdentityRevisionError,
  setMeetingIdentityBinding,
} from '../../api/identity';
import {
  type ClientCandidateMetadata,
  type VoiceMatchSuggestion,
  enrollSpeakerVoice,
  getSpeakerVoiceSuggestions,
  getVoiceReferenceSample,
  rejectSpeakerVoiceSuggestion,
} from '../../api/speakerVoice';
import type { IdentityPerson } from '../../types/identity';
import {
  getAnonymousSpeakerDisplayLabel,
  isGenericSpeakerLabel,
  selectReviewableAnonymousSpeakers,
} from '../../utils/speakerReview';
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
  const comboboxInputId = useId();
  const comboboxListId = useId();
  const [state, setState] = useState<MeetingIdentityState | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [stepIndex, setStepIndex] = useState(0);
  const [isSummaryView, setIsSummaryView] = useState(false);

  // Combobox & search state for current active speaker
  const [searchQuery, setSearchQuery] = useState('');
  const [isComboboxOpen, setIsComboboxOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [selectedSelection, setSelectedSelection] =
    useState<IdentitySelection | null>(null);
  const [, setSelectedLabel] = useState('');
  const isComboboxOpenRef = useRef(isComboboxOpen);
  isComboboxOpenRef.current = isComboboxOpen;

  const comboboxContainerRef = useRef<HTMLDivElement | null>(null);
  const comboboxInputRef = useRef<HTMLInputElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [popoverStyle, setPopoverStyle] = useState<React.CSSProperties>({});

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

  // Voice profiles & match suggestions state
  const [voiceSuggestions, setVoiceSuggestions] = useState<
    Record<string, VoiceMatchSuggestion>
  >({});
  const [speakerCandidates, setSpeakerCandidates] = useState<
    Record<string, ClientCandidateMetadata>
  >({});
  const [rememberVoice, setRememberVoice] = useState(false);
  const [refSampleLoading, setRefSampleLoading] = useState(false);
  const [refSampleUnavailable, setRefSampleUnavailable] = useState(false);

  const releaseSample = useCallback(() => {
    sampleAudio.current?.pause();
    sampleAudio.current = null;
    if (sampleUrl.current) URL.revokeObjectURL(sampleUrl.current);
    sampleUrl.current = null;
    setRefSampleLoading(false);
  }, []);

  const playReferenceSample = useCallback(
    async (suggestion: VoiceMatchSuggestion) => {
      if (!suggestion.referenceInterval) return;
      const token = ++sampleRequest.current;
      releaseSample();
      setSampleState(null);
      setSampleError(null);
      setRefSampleLoading(true);
      setRefSampleUnavailable(false);
      try {
        const result = await getVoiceReferenceSample(
          suggestion.referenceInterval.sourceMeetingId,
          suggestion.referenceInterval.startTime,
          suggestion.referenceInterval.endTime,
        );
        if (token !== sampleRequest.current) return;
        if (!result) {
          setRefSampleUnavailable(true);
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
        });
        await audio.play();
      } catch {
        if (token === sampleRequest.current) {
          releaseSample();
          setRefSampleUnavailable(true);
        }
      } finally {
        if (token === sampleRequest.current) {
          setRefSampleLoading(false);
        }
      }
    },
    [releaseSample],
  );

  const attendeeNamesRef = useRef(attendeeNames);
  attendeeNamesRef.current = attendeeNames;

  const loadVoiceSuggestions = useCallback(async () => {
    try {
      const res = await getSpeakerVoiceSuggestions(
        meetingId,
        attendeeNamesRef.current,
      );
      setVoiceSuggestions(res.suggestions);
      setSpeakerCandidates(res.candidates);
    } catch {
      // non-fatal
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
    if (!isOpen || !initialSpeaker || reviewableSpeakers.length === 0) return;
    const index = reviewableSpeakers.indexOf(initialSpeaker);
    if (index >= 0) {
      setStepIndex(index);
    }
  }, [isOpen, initialSpeaker, reviewableSpeakers]);

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

  // Handle escape key (combobox priority: close dropdown first if open)
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isComboboxOpenRef.current) {
          setIsComboboxOpen(false);
          return;
        }
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const updatePopoverPosition = useCallback(() => {
    if (!comboboxInputRef.current) return;
    const rect = comboboxInputRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const popoverHeight = 220;
    const showAbove =
      rect.bottom > 0 && spaceBelow < popoverHeight && rect.top > popoverHeight;

    setPopoverStyle({
      position: 'fixed',
      left: `${rect.left}px`,
      width: rect.width > 0 ? `${rect.width}px` : '100%',
      maxWidth: '32rem',
      top: showAbove ? undefined : `${(rect.bottom || 0) + 6}px`,
      bottom: showAbove ? `${window.innerHeight - rect.top + 6}px` : undefined,
      zIndex: 1050,
    });
  }, []);

  useLayoutEffect(() => {
    if (!isComboboxOpen) return;
    updatePopoverPosition();

    const handleScrollOrResize = () => {
      updatePopoverPosition();
    };

    window.addEventListener('resize', handleScrollOrResize);
    window.addEventListener('scroll', handleScrollOrResize, true);
    return () => {
      window.removeEventListener('resize', handleScrollOrResize);
      window.removeEventListener('scroll', handleScrollOrResize, true);
    };
  }, [isComboboxOpen, updatePopoverPosition]);

  // Handle click outside combobox to close suggestions
  useEffect(() => {
    if (!isComboboxOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        comboboxContainerRef.current &&
        !comboboxContainerRef.current.contains(target) &&
        popoverRef.current &&
        !popoverRef.current.contains(target)
      ) {
        setIsComboboxOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isComboboxOpen]);

  // Reset or initialize combobox inputs whenever active speaker changes
  useEffect(() => {
    if (!currentSpeaker || !state) {
      setSearchQuery('');
      setSelectedSelection(null);
      setSelectedLabel('');
      setIsComboboxOpen(false);
      setHighlightedIndex(-1);
      return;
    }
    const binding = state.bindings.find((b) => b.speaker === currentSpeaker);
    if (binding?.personId) {
      const person = state.people.find((p) => p.id === binding.personId);
      if (person) {
        setSearchQuery(person.name);
        setSelectedSelection({ personId: person.id });
        setSelectedLabel(person.name);
        setIsComboboxOpen(false);
        setHighlightedIndex(-1);
        return;
      }
    }
    setSearchQuery('');
    setSelectedSelection(null);
    setSelectedLabel('');
    setIsComboboxOpen(false);
    setHighlightedIndex(-1);
    setRememberVoice(false);
    setRefSampleUnavailable(false);
    releaseSample();
    setSampleState(null);
    setSampleLoading(null);
  }, [stepIndex, currentSpeaker, releaseSample]);

  // Filtered people and create-new calculation
  const trimmedQuery = searchQuery.trim().toLowerCase();

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

  const filteredPeople = useMemo(() => {
    if (!trimmedQuery) return eligiblePeople;
    return eligiblePeople.filter(
      (p) =>
        p.name.toLowerCase().includes(trimmedQuery) ||
        p.aliases?.some((a) => a.toLowerCase().includes(trimmedQuery)),
    );
  }, [eligiblePeople, trimmedQuery]);

  const exactMatch = useMemo(() => {
    if (!trimmedQuery) return null;
    return (
      eligiblePeople.find(
        (p) => p.name.trim().toLowerCase() === trimmedQuery,
      ) ?? null
    );
  }, [eligiblePeople, trimmedQuery]);

  const canCreateNew = Boolean(
    searchQuery.trim() &&
      !exactMatch &&
      !isGenericSpeakerLabel(searchQuery.trim()) &&
      (!currentSpeaker ||
        searchQuery.trim().toLowerCase() !== currentSpeaker.toLowerCase()),
  );
  const totalComboboxItems = filteredPeople.length + (canCreateNew ? 1 : 0);

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

      // Opt-in voice profile enrollment
      const candidate = speakerCandidates[speaker];
      if (
        rememberVoice &&
        selection.personId &&
        candidate &&
        candidate.isEligibleForEnrollment
      ) {
        try {
          await enrollSpeakerVoice({
            personId: selection.personId,
            sourceMeetingId: meetingId,
            sourceRevision: candidate.sourceRevision,
            speaker,
            candidateDigest: candidate.candidateDigest,
            expectedRevision: next.revision,
          });
        } catch {
          // non-fatal if enrollment fails
        }
      }

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

  const handleRejectSuggestion = async (suggestion: VoiceMatchSuggestion) => {
    if (!currentSpeaker || busy) return;
    setBusy(true);
    setError('');
    try {
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
    setSelectedLabel(person.name);
    setSearchQuery(person.name);
    setIsComboboxOpen(false);
    setHighlightedIndex(-1);
    void saveBinding(currentSpeaker, { personId: person.id }, true);
  };

  const handleCreateNew = (name: string) => {
    if (!currentSpeaker) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    setSelectedSelection({ newName: trimmed });
    setSelectedLabel(trimmed);
    setSearchQuery(trimmed);
    setIsComboboxOpen(false);
    setHighlightedIndex(-1);
    void saveBinding(currentSpeaker, { newName: trimmed }, true);
  };

  const handleComboboxKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!isComboboxOpen) {
        setIsComboboxOpen(true);
        setHighlightedIndex(0);
        return;
      }
      if (totalComboboxItems > 0) {
        setHighlightedIndex((prev) => (prev + 1) % totalComboboxItems);
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!isComboboxOpen) {
        setIsComboboxOpen(true);
        setHighlightedIndex(Math.max(0, totalComboboxItems - 1));
        return;
      }
      if (totalComboboxItems > 0) {
        setHighlightedIndex(
          (prev) => (prev - 1 + totalComboboxItems) % totalComboboxItems,
        );
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (isComboboxOpen) {
        if (highlightedIndex >= 0 && highlightedIndex < filteredPeople.length) {
          handleSelectPerson(filteredPeople[highlightedIndex]);
        } else if (highlightedIndex === filteredPeople.length && canCreateNew) {
          handleCreateNew(searchQuery.trim());
        } else if (filteredPeople.length > 0) {
          handleSelectPerson(filteredPeople[0]);
        } else if (canCreateNew) {
          handleCreateNew(searchQuery.trim());
        }
      } else {
        handleConfirmCurrent();
      }
    } else if (e.key === 'Escape') {
      if (isComboboxOpen) {
        e.stopPropagation();
        e.preventDefault();
        setIsComboboxOpen(false);
      }
    }
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

              {/* Voice Match Suggestion Banner */}
              {currentSpeaker && voiceSuggestions[currentSpeaker] ? (
                <div className="rounded-xl border border-pro-accent/40 bg-pro-accent/5 p-3.5 space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-semibold text-pro-text-main">
                        {displayLabel} may be{' '}
                        {voiceSuggestions[currentSpeaker].suggestedPersonName}
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
                    {voiceSuggestions[currentSpeaker].referenceInterval ? (
                      <button
                        type="button"
                        disabled={busy || refSampleLoading}
                        onClick={() =>
                          void playReferenceSample(
                            voiceSuggestions[currentSpeaker],
                          )
                        }
                        className="inline-flex items-center gap-1.5 rounded-full border border-pro-border/80 bg-pro-bg px-2.5 py-1 text-xs font-medium text-pro-text-main hover:bg-pro-hover transition-colors disabled:opacity-50"
                      >
                        <Play
                          size={10}
                          className="fill-current mr-0.5 shrink-0"
                          aria-hidden="true"
                        />
                        {refSampleLoading
                          ? 'Loading reference…'
                          : refSampleUnavailable
                            ? 'Reference recording unavailable'
                            : 'Play reference sample'}
                      </button>
                    ) : null}

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
              <div
                ref={comboboxContainerRef}
                className="relative space-y-2 pt-1 border-t border-pro-border/30"
              >
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

                <div className="relative">
                  <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-pro-text-muted">
                    <Search size={14} aria-hidden="true" />
                  </div>
                  <input
                    id={comboboxInputId}
                    ref={comboboxInputRef}
                    type="text"
                    role="combobox"
                    aria-expanded={isComboboxOpen}
                    aria-autocomplete="list"
                    aria-controls={comboboxListId}
                    aria-label={`Person for ${displayLabel}`}
                    placeholder="Search people or type a new name…"
                    value={searchQuery}
                    disabled={busy}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setSelectedSelection(null);
                      setSelectedLabel('');
                      setIsComboboxOpen(true);
                      setHighlightedIndex(0);
                    }}
                    onFocus={() => {
                      setIsComboboxOpen(true);
                    }}
                    onClick={() => {
                      if (!isComboboxOpen) setIsComboboxOpen(true);
                    }}
                    onKeyDown={handleComboboxKeyDown}
                    className="w-full rounded-lg border border-pro-border bg-pro-bg pl-9 pr-14 py-2 text-xs text-pro-text-main placeholder:text-pro-text-muted/60 outline-none transition-colors hover:border-pro-border/90 focus:border-pro-accent focus:ring-1 focus:ring-pro-accent"
                  />
                  <div className="absolute inset-y-0 right-0 flex items-center pr-2 gap-0.5">
                    {searchQuery ? (
                      <button
                        type="button"
                        aria-label="Clear person input"
                        onClick={() => {
                          setSearchQuery('');
                          setSelectedSelection(null);
                          setSelectedLabel('');
                          setHighlightedIndex(-1);
                          comboboxInputRef.current?.focus();
                        }}
                        className="rounded p-1 text-pro-text-muted hover:text-pro-text-main hover:bg-pro-hover transition-colors"
                      >
                        <X size={12} />
                      </button>
                    ) : null}
                    <button
                      type="button"
                      tabIndex={-1}
                      aria-label={
                        isComboboxOpen
                          ? 'Close suggestions'
                          : 'Open suggestions'
                      }
                      onClick={() => {
                        setIsComboboxOpen((prev) => !prev);
                        comboboxInputRef.current?.focus();
                      }}
                      className="rounded p-1 text-pro-text-muted hover:text-pro-text-main transition-colors"
                    >
                      <ChevronDown
                        size={13}
                        className={`transition-transform duration-150 ${
                          isComboboxOpen ? 'rotate-180' : ''
                        }`}
                      />
                    </button>
                  </div>
                </div>

                {/* Floating Suggestions Dropdown Popover */}
                {isComboboxOpen && typeof document !== 'undefined'
                  ? createPortal(
                      <div
                        ref={popoverRef}
                        id={comboboxListId}
                        role="listbox"
                        tabIndex={-1}
                        aria-label="People suggestions"
                        style={popoverStyle}
                        onMouseDown={(e) => {
                          // Prevent input from losing focus on suggestion click
                          e.preventDefault();
                        }}
                        className="max-h-52 overflow-y-auto rounded-xl border border-pro-border/80 bg-pro-surface shadow-2xl p-1 custom-scrollbar space-y-0.5 animate-in fade-in zoom-in-95 duration-100"
                      >
                        {filteredPeople.map((person, idx) => {
                          const isSelected =
                            selectedSelection &&
                            'personId' in selectedSelection &&
                            selectedSelection.personId === person.id;
                          const isHighlighted = highlightedIndex === idx;

                          return (
                            <div
                              key={person.id}
                              id={`${comboboxListId}-option-${idx}`}
                              role="option"
                              tabIndex={-1}
                              aria-selected={isSelected || isHighlighted}
                              onMouseEnter={() => setHighlightedIndex(idx)}
                              onClick={() => handleSelectPerson(person)}
                              className={`flex items-center justify-between rounded-lg px-2.5 py-1.5 text-xs cursor-pointer select-none transition-colors ${
                                isHighlighted
                                  ? 'bg-pro-hover text-pro-text-main'
                                  : 'text-pro-text-muted hover:bg-pro-hover/70 hover:text-pro-text-main'
                              }`}
                            >
                              <div className="flex items-center gap-2.5 min-w-0">
                                <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-pro-bg border border-pro-border/80 text-[10px] font-semibold text-pro-text-muted">
                                  {person.name.charAt(0).toUpperCase()}
                                </div>
                                <span className="truncate text-pro-text-main font-medium">
                                  {identityPersonLabel(
                                    person,
                                    state?.people ?? [],
                                  )}
                                </span>
                              </div>
                              {isSelected ? (
                                <Check
                                  size={13}
                                  className="text-pro-accent shrink-0 ml-2"
                                />
                              ) : null}
                            </div>
                          );
                        })}

                        {canCreateNew ? (
                          <div
                            key="__create_new__"
                            id={`${comboboxListId}-option-${filteredPeople.length}`}
                            role="option"
                            tabIndex={-1}
                            aria-selected={
                              highlightedIndex === filteredPeople.length
                            }
                            onMouseEnter={() =>
                              setHighlightedIndex(filteredPeople.length)
                            }
                            onClick={() => handleCreateNew(searchQuery.trim())}
                            className={`flex items-center justify-between rounded-lg px-2.5 py-2 text-xs cursor-pointer select-none transition-colors border-t border-pro-border/40 mt-1 ${
                              highlightedIndex === filteredPeople.length
                                ? 'bg-pro-hover text-pro-text-main'
                                : 'text-pro-text-muted hover:bg-pro-hover/70 hover:text-pro-text-main'
                            }`}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-pro-accent/15 text-pro-accent">
                                <Plus size={12} />
                              </div>
                              <div className="truncate">
                                <span className="text-pro-text-muted">
                                  Create{' '}
                                </span>
                                <strong className="text-pro-text-main">
                                  “{searchQuery.trim()}”
                                </strong>
                              </div>
                            </div>
                            <span className="rounded-full bg-pro-accent/10 px-2 py-0.5 text-[10px] font-medium text-pro-accent shrink-0 ml-2">
                              New person
                            </span>
                          </div>
                        ) : null}

                        {filteredPeople.length === 0 && !canCreateNew ? (
                          <div className="px-3 py-3 text-center text-xs text-pro-text-muted select-none">
                            No matching people found.
                          </div>
                        ) : null}
                      </div>,
                      document.body,
                    )
                  : null}
              </div>

              {/* Opt-in voice profile enrollment choice */}
              {currentSpeaker &&
              speakerCandidates[currentSpeaker]?.isEligibleForEnrollment ? (
                <div className="pt-2">
                  <label className="flex items-center gap-2 text-xs text-pro-text-muted cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={rememberVoice}
                      onChange={(e) => setRememberVoice(e.target.checked)}
                      className="rounded border-pro-border text-pro-accent focus:ring-pro-accent"
                    />
                    <span>Remember this voice for future meetings</span>
                  </label>
                </div>
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
                <button
                  type="button"
                  disabled={busy || (!selectedSelection && !searchQuery.trim())}
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
    </dialog>,
    document.body,
  );
};
