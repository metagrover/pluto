import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clock3,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  Play,
  Search,
  Sparkles,
  Undo2,
  UserRound,
  Volume2,
} from 'lucide-react';
import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type Entity,
  type EntityMeeting,
  type PersonBriefingDetail,
  getPeopleBriefingSummaries,
  getPersonBriefing,
  mergePerson,
  resolvePersonCommitmentOwner,
  restorePersonMerge,
  triggerDreamingNow,
  updatePersonName,
  upsertEntity,
} from '../../api/knowledgeGraph';
import {
  type ClientVoiceProfile,
  type VoiceProfileReconciliationStatus,
  deleteSpeakerVoiceProfile,
  getSpeakerVoiceProfileOverview,
  getVoiceReferenceSample,
  setSpeakerVoiceProfileStatus,
} from '../../api/speakerVoice';
import {
  DREAMING_STATUS_LABEL,
  type DreamingUiStatus,
} from '../../utils/dreamingStatus';
import type {
  PersonBriefingCommitment,
  PersonBriefingCommitmentCandidate,
  PersonBriefingMeeting,
  PersonBriefingSummary,
  PersonMeetingEvidence,
} from '../../utils/personBriefing';
import { parsePersonRole } from '../../utils/personBriefing';
import { PersonChatDock } from '../features/PersonChatDock';
import { PageHeader } from '../ui/PageHeader';
import { SearchSelect } from '../ui/SearchSelect';
import { compileKnowledgeBrief } from './knowledgeDocument';

export type PersonBriefingRow = PersonBriefingSummary;

export const buildPersonBriefingRow = (
  person: Entity,
  meetings: EntityMeeting[],
  openCommitmentCount = 0,
): PersonBriefingRow => {
  const sorted = [...meetings].sort((a, b) => {
    const aTime = Date.parse(a.started_at || a.created_at || '') || 0;
    const bTime = Date.parse(b.started_at || b.created_at || '') || 0;
    return bTime - aTime;
  });
  const latest = sorted[0] ?? null;
  return {
    id: person.id,
    name: person.name,
    role: parsePersonRole(person.metadata),
    meetingCount: meetings.length,
    mentionCount: meetings.reduce(
      (total, meeting) => total + meeting.mention_count,
      0,
    ),
    latestMeetingId: latest?.id ?? null,
    latestMeetingTitle: latest?.title ?? null,
    latestMeetingAt: latest?.started_at ?? latest?.created_at ?? null,
    context: latest?.context ?? null,
    openCommitmentCount,
    candidateCommitmentCount: 0,
    briefHeadline: null,
    briefStatus: null,
    briefUpdatedAt: null,
    possibleDuplicateCount: 0,
  };
};

const formatDate = (value: string | null) => {
  if (!value) return 'No recent conversation';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
  }).format(new Date(value));
};

export const PeopleBriefing = ({
  rows,
  selectedPersonId,
  onSelectPerson,
}: {
  rows: PersonBriefingRow[];
  selectedPersonId?: string | null;
  onSelectPerson: (personId: string) => void;
}) => {
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return normalized
      ? rows.filter((row) =>
          `${row.name} ${row.role} ${row.briefHeadline ?? ''} ${row.latestMeetingTitle ?? ''}`
            .toLowerCase()
            .includes(normalized),
        )
      : rows;
  }, [query, rows]);
  const prioritized = useMemo(
    () =>
      [...filtered].sort(
        (a, b) =>
          b.openCommitmentCount - a.openCommitmentCount ||
          b.candidateCommitmentCount - a.candidateCommitmentCount ||
          (Date.parse(b.briefUpdatedAt || '') || 0) -
            (Date.parse(a.briefUpdatedAt || '') || 0) ||
          (Date.parse(b.latestMeetingAt || '') || 0) -
            (Date.parse(a.latestMeetingAt || '') || 0),
      ),
    [filtered],
  );
  const briefingRows = useMemo(
    () =>
      prioritized.filter(
        (row) =>
          row.meetingCount > 0 &&
          (row.openCommitmentCount > 0 ||
            row.candidateCommitmentCount > 0 ||
            Boolean(row.briefHeadline)),
      ),
    [prioritized],
  );
  const briefingIds = useMemo(
    () => new Set(briefingRows.map((row) => row.id)),
    [briefingRows],
  );
  const recentRows = useMemo(
    () =>
      prioritized.filter(
        (row) => row.meetingCount > 0 && !briefingIds.has(row.id),
      ),
    [briefingIds, prioritized],
  );
  const unlinkedRows = useMemo(
    () => prioritized.filter((row) => row.meetingCount === 0),
    [prioritized],
  );
  const renderPerson = (person: PersonBriefingRow) => {
    const selected = selectedPersonId === person.id;
    const rawCue =
      person.briefHeadline ??
      (person.context && !person.context.startsWith('Role:')
        ? person.context
        : null) ??
      person.latestMeetingTitle ??
      'No linked conversation yet';
    const cue = rawCue.startsWith(`${person.name}: `)
      ? rawCue.slice(person.name.length + 2).trim() || rawCue
      : rawCue;
    const showRole = person.role !== 'Known from conversations';
    return (
      <article
        className={`person-row ${selected ? 'person-row--selected' : ''}`}
        data-person-id={person.id}
        data-selected={selected ? 'true' : undefined}
        key={person.id}
      >
        <button
          type="button"
          className="person-row__meeting"
          onClick={() => onSelectPerson(person.id)}
        >
          <span className="person-avatar" aria-hidden="true">
            {person.name.slice(0, 1).toUpperCase()}
          </span>
          <span className="person-copy">
            <span className="person-identity">
              <strong>{person.name}</strong>
            </span>
            <span className="person-context">
              {showRole ? (
                <span className="person-role">{person.role}</span>
              ) : null}
              <span>{cue}</span>
            </span>
          </span>
          <span className="person-meta">
            {person.possibleDuplicateCount > 0 ? (
              <span className="person-possible-duplicate">
                Possible duplicate
              </span>
            ) : null}
            {person.openCommitmentCount > 0 ? (
              <span className="person-commitments">
                {person.openCommitmentCount} open loop
                {person.openCommitmentCount === 1 ? '' : 's'}
              </span>
            ) : null}
            {person.candidateCommitmentCount > 0 ? (
              <span className="person-candidates">
                {person.candidateCommitmentCount} to confirm
              </span>
            ) : null}
            {person.possibleDuplicateCount === 0 &&
            person.openCommitmentCount === 0 &&
            person.candidateCommitmentCount === 0 ? (
              <span className="person-meeting-count">
                <MessageCircle aria-hidden="true" size={12} />
                {person.meetingCount} meeting link
                {person.meetingCount === 1 ? '' : 's'}
              </span>
            ) : null}
            {person.latestMeetingAt &&
            !Number.isNaN(Date.parse(person.latestMeetingAt)) &&
            Math.floor(
              (Date.now() - Date.parse(person.latestMeetingAt)) /
                (1000 * 60 * 60 * 24),
            ) > 45 ? (
              <span className="person-historical rounded-full border border-stone-500/20 bg-stone-500/5 px-2 py-0.5 text-[10px] font-medium text-stone-600 dark:text-stone-400">
                Historical
              </span>
            ) : null}
            <span className="person-date">
              <Clock3 aria-hidden="true" size={12} />
              {formatDate(person.latestMeetingAt)}
            </span>
          </span>
          <ChevronRight
            aria-hidden="true"
            className="person-row__chevron"
            size={13}
          />
        </button>
      </article>
    );
  };

  return (
    <section aria-label="People" className="people-briefing">
      <PageHeader title="People">
        <div className="flex flex-wrap items-center gap-2">
          {rows.length > 0 && (
            <label className="people-search">
              <Search aria-hidden="true" size={13} />
              <span className="sr-only">Search people</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search people"
              />
            </label>
          )}
        </div>
      </PageHeader>

      {rows.length === 0 ? (
        <div className="people-empty">
          <UserRound aria-hidden="true" size={22} />
          <h2>No relationship context yet</h2>
          <p>People will appear as Pluto connects them to conversations.</p>
        </div>
      ) : (
        <div className="people-list" aria-label="People relationships">
          {briefingRows.length > 0 ? (
            <section aria-label="Relationship briefs">
              <div className="people-list__heading">
                <h2>Relationship briefs</h2>
                <span>{briefingRows.length}</span>
              </div>
              {briefingRows.map(renderPerson)}
            </section>
          ) : null}
          {recentRows.length > 0 ? (
            <section
              aria-label="Recent conversations"
              className="people-recent"
            >
              <div className="people-list__heading">
                <h2>Recent conversations</h2>
                <span>{recentRows.length}</span>
              </div>
              {recentRows.map(renderPerson)}
            </section>
          ) : null}
          {unlinkedRows.length > 0 && (
            <details
              aria-label="People without linked conversations"
              className="people-unlinked"
            >
              <summary>
                <span>
                  <strong>Low-context people</strong>
                  <small>No linked conversations yet</small>
                </span>
                <span>{unlinkedRows.length}</span>
                <ChevronDown aria-hidden="true" size={14} />
              </summary>
              {unlinkedRows.map(renderPerson)}
            </details>
          )}
          {filtered.length === 0 && (
            <p className="people-no-results">No people match “{query}”.</p>
          )}
        </div>
      )}
    </section>
  );
};

const meetingLabels: Record<
  PersonMeetingEvidence,
  { title: string; empty: string; note: string | null }
> = {
  confirmed: {
    title: 'Confirmed conversations',
    empty: 'No confirmed conversations yet',
    note: null,
  },
  scheduled: {
    title: 'Scheduled or invited',
    empty: 'No scheduled conversations',
    note: 'Calendar match; attendance is not confirmed.',
  },
  mentioned: {
    title: 'Mentioned only',
    empty: 'No mention-only conversations',
    note: 'Participation not confirmed.',
  },
};

export const formatCommitmentChronology = (
  item: PersonBriefingCommitment,
  now = Date.now(),
): { label: string; isOverdue: boolean; isLingering: boolean } => {
  const updatedTime = Date.parse(item.updatedAt);
  const daysSinceUpdate = !Number.isNaN(updatedTime)
    ? Math.max(0, Math.floor((now - updatedTime) / (1000 * 60 * 60 * 24)))
    : null;

  if (item.status === 'completed') {
    if (daysSinceUpdate === null || daysSinceUpdate <= 1) {
      return {
        label: 'Recently completed',
        isOverdue: false,
        isLingering: false,
      };
    }
    if (daysSinceUpdate < 7) {
      return {
        label: `Completed ${daysSinceUpdate}d ago`,
        isOverdue: false,
        isLingering: false,
      };
    }
    const weeks = Math.round(daysSinceUpdate / 7);
    return {
      label: `Completed ${weeks}w ago`,
      isOverdue: false,
      isLingering: false,
    };
  }

  if (item.dueDate) {
    const dueTime = Date.parse(item.dueDate);
    if (!Number.isNaN(dueTime)) {
      const diffDays = Math.floor((now - dueTime) / (1000 * 60 * 60 * 24));
      const formattedDue = new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
      }).format(new Date(dueTime));

      if (diffDays > 0) {
        const weeks = Math.round(diffDays / 7);
        const overdueText =
          weeks > 0 ? `${weeks}w overdue` : `${diffDays}d overdue`;
        return {
          label: `Due ${formattedDue} · ${overdueText}`,
          isOverdue: true,
          isLingering: false,
        };
      }
      return {
        label: `Due ${formattedDue}`,
        isOverdue: false,
        isLingering: false,
      };
    }
  }

  if (daysSinceUpdate !== null) {
    if (daysSinceUpdate >= 45) {
      const months = Math.max(1, Math.round(daysSinceUpdate / 30));
      return {
        label: `Lingering loop · Agreed ${months}mo ago`,
        isOverdue: false,
        isLingering: true,
      };
    }
    if (daysSinceUpdate >= 7) {
      const weeks = Math.round(daysSinceUpdate / 7);
      return {
        label: `Agreed ${weeks}w ago`,
        isOverdue: false,
        isLingering: false,
      };
    }
  }

  return { label: 'Open', isOverdue: false, isLingering: false };
};

const CommitmentList = ({
  items,
  onOpenMeeting,
}: {
  items: PersonBriefingCommitment[];
  onOpenMeeting: (meetingId: string) => void;
}) => (
  <ul className="person-dossier__commitments">
    {items.slice(0, 3).map((item) => {
      const timing = formatCommitmentChronology(item);
      return (
        <li key={item.id}>
          <button
            type="button"
            onClick={() => onOpenMeeting(item.sourceMeetingId)}
          >
            <span
              className="person-dossier__commitment-icon"
              aria-hidden="true"
            >
              {item.status === 'completed' ? (
                <CheckCircle2 size={15} />
              ) : (
                <Clock3 size={15} />
              )}
            </span>
            <span className="person-dossier__commitment-copy">
              <strong>{item.text}</strong>
              <span className="flex flex-wrap items-center gap-1.5">
                <span
                  className={
                    timing.isOverdue
                      ? 'text-rose-600 dark:text-rose-400 font-medium'
                      : timing.isLingering
                        ? 'text-amber-700 dark:text-amber-400 font-medium'
                        : ''
                  }
                >
                  {timing.label}
                </span>
                {item.sourceMeetingTitle && (
                  <span className="text-pro-text-muted/70 text-[11px] truncate max-w-[200px]">
                    · &ldquo;{item.sourceMeetingTitle}&rdquo;
                  </span>
                )}
              </span>
            </span>
            <ChevronRight aria-hidden="true" size={14} />
          </button>
        </li>
      );
    })}
  </ul>
);

const CandidateCommitmentList = ({
  items,
  states,
  onOpenMeeting,
  onResolve,
}: {
  items: PersonBriefingCommitmentCandidate[];
  states: Record<string, 'saving' | 'error'>;
  onOpenMeeting: (meetingId: string) => void;
  onResolve: (
    candidate: PersonBriefingCommitmentCandidate,
    accepted: boolean,
  ) => void;
}) => (
  <ul className="person-dossier__candidates">
    {items.slice(0, 3).map((item) => {
      const saving = states[item.id] === 'saving';
      return (
        <li key={item.id}>
          <span className="person-dossier__commitment-icon" aria-hidden="true">
            <CircleHelp size={15} />
          </span>
          <span className="person-dossier__commitment-copy">
            <strong>{item.text}</strong>
            <span>Suggested owner: {item.suggestedOwnerName}</span>
            {item.evidence ? <q>{item.evidence}</q> : null}
          </span>
          <div className="person-dossier__candidate-actions">
            <button
              type="button"
              disabled={saving}
              onClick={() => onResolve(item, true)}
            >
              {saving ? 'Saving…' : 'Confirm owner'}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => onResolve(item, false)}
            >
              Not theirs
            </button>
            <button
              type="button"
              onClick={() => onOpenMeeting(item.sourceMeetingId)}
            >
              Source: {item.sourceMeetingTitle ?? 'Meeting'}
            </button>
          </div>
          {states[item.id] === 'error' ? (
            <p role="alert">
              Pluto could not save this owner decision. Try again.
            </p>
          ) : null}
        </li>
      );
    })}
  </ul>
);

const MeetingList = ({
  meetings,
  onOpenMeeting,
}: {
  meetings: PersonBriefingMeeting[];
  onOpenMeeting: (meetingId: string) => void;
}) => (
  <div className="person-dossier__meetings">
    {meetings.map((meeting) => (
      <button
        type="button"
        key={meeting.id}
        onClick={() => onOpenMeeting(meeting.id)}
      >
        <span>
          <strong>{meeting.title}</strong>
          {meeting.context ? <small>{meeting.context}</small> : null}
        </span>
        <span className="person-dossier__meeting-date">
          {formatDate(meeting.started_at || meeting.created_at)}
          <ChevronRight aria-hidden="true" size={14} />
        </span>
      </button>
    ))}
  </div>
);

const MeetingGroup = ({
  evidence,
  meetings,
  onOpenMeeting,
}: {
  evidence: PersonMeetingEvidence;
  meetings: PersonBriefingMeeting[];
  onOpenMeeting: (meetingId: string) => void;
}) => {
  const copy = meetingLabels[evidence];
  return (
    <section className="person-dossier__meeting-group">
      <div className="person-dossier__section-heading">
        <h2>{copy.title}</h2>
        <span>{meetings.length}</span>
      </div>
      {copy.note ? (
        <p className="person-dossier__disclosure">{copy.note}</p>
      ) : null}
      {meetings.length === 0 ? (
        <p className="person-dossier__empty-line">{copy.empty}</p>
      ) : (
        <MeetingList meetings={meetings} onOpenMeeting={onOpenMeeting} />
      )}
    </section>
  );
};

export const PersonDossier = ({
  detail,
  onBack,
  backLabel,
  onOpenMeeting,
  mergeCandidates = [],
  possibleDuplicateCount = 0,
  onIdentityChanged = async () => {},
}: {
  detail: PersonBriefingDetail;
  onBack: () => void;
  backLabel?: string;
  onOpenMeeting: (meetingId: string) => void;
  mergeCandidates?: PersonBriefingRow[];
  possibleDuplicateCount?: number;
  onIdentityChanged?: () => Promise<void>;
}) => {
  const [currentDetail, setCurrentDetail] = useState(detail);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(detail.person.name);
  const [nameState, setNameState] = useState<
    'idle' | 'saving' | 'saved' | 'error'
  >('idle');
  const [mergeOpen, setMergeOpen] = useState(false);
  const [profileSettingsOpen, setProfileSettingsOpen] = useState(false);
  const [mergeSourceId, setMergeSourceId] = useState('');
  const [mergeState, setMergeState] = useState<
    'idle' | 'saving' | 'saved' | 'error'
  >('idle');
  const [candidateState, setCandidateState] = useState<
    Record<string, 'saving' | 'error'>
  >({});
  const [lastMerged, setLastMerged] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [dreamingState, setDreamingState] = useState<DreamingUiStatus>('idle');
  const prepareGeneration = useRef(0);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const [voiceProfile, setVoiceProfile] = useState<ClientVoiceProfile | null>(
    null,
  );
  const [voiceOptedOut, setVoiceOptedOut] = useState(false);
  const [voiceReconciliationStatus, setVoiceReconciliationStatus] = useState<
    VoiceProfileReconciliationStatus | undefined
  >();
  const [voiceLoading, setVoiceLoading] = useState(false);
  const [voiceError, setVoiceError] = useState('');
  const [samplePlaying, setSamplePlaying] = useState(false);
  const [sampleLoading, setSampleLoading] = useState(false);
  const [sampleUnavailable, setSampleUnavailable] = useState(false);
  const voiceAudioRef = useRef<HTMLAudioElement | null>(null);
  const voiceUrlRef = useRef<string | null>(null);

  const releaseVoiceAudio = useCallback(() => {
    if (voiceAudioRef.current) {
      voiceAudioRef.current.pause();
      voiceAudioRef.current = null;
    }
    if (voiceUrlRef.current) {
      URL.revokeObjectURL(voiceUrlRef.current);
      voiceUrlRef.current = null;
    }
    setSamplePlaying(false);
    setSampleLoading(false);
  }, []);

  const loadVoiceProfile = useCallback(async () => {
    setVoiceLoading(true);
    setVoiceError('');
    try {
      const { profiles, optedOutPersonIds, reconciliationStatus } =
        await getSpeakerVoiceProfileOverview(currentDetail.person.id);
      const match =
        profiles.find((p) => p.canonicalPersonId === currentDetail.person.id) ??
        null;
      setVoiceProfile(match);
      setVoiceOptedOut(
        !match && optedOutPersonIds.includes(currentDetail.person.id),
      );
      setVoiceReconciliationStatus(reconciliationStatus);
    } catch {
      setVoiceProfile(null);
      setVoiceOptedOut(false);
      setVoiceReconciliationStatus(undefined);
      setVoiceError('Voice profile could not be loaded.');
    } finally {
      setVoiceLoading(false);
    }
  }, [currentDetail.person.id]);

  useEffect(() => {
    releaseVoiceAudio();
    setSampleUnavailable(false);
    void loadVoiceProfile();
  }, [loadVoiceProfile, releaseVoiceAudio]);

  useEffect(() => {
    if (voiceReconciliationStatus !== 'queued') return;
    const timer = window.setInterval(() => {
      void loadVoiceProfile();
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [loadVoiceProfile, voiceReconciliationStatus]);

  useEffect(() => {
    return () => {
      releaseVoiceAudio();
    };
  }, [releaseVoiceAudio]);

  useEffect(() => {
    setCurrentDetail(detail);
    setNameDraft(detail.person.name);
  }, [detail]);

  useEffect(() => {
    prepareGeneration.current += 1;
    setDreamingState('idle');
  }, [detail.person.id]);

  useEffect(
    () => () => {
      prepareGeneration.current += 1;
    },
    [],
  );

  useEffect(() => {
    if (editingName) nameInputRef.current?.focus();
  }, [editingName]);

  const role = parsePersonRole(currentDetail.person.metadata);
  const brief = compileKnowledgeBrief(
    currentDetail.knowledgeDoc,
    currentDetail.workingMemorySnapshot,
  );
  const hasReliableRead =
    brief.isCompiled &&
    ![
      'No reliable compiled brief yet.',
      'Indexed knowledge needs a stronger synthesis.',
    ].includes(brief.headline);
  const meetingCount = currentDetail.meetings.length;
  const confirmedMeetings = currentDetail.meetings.filter(
    (meeting) => meeting.evidence === 'confirmed',
  );
  const otherMeetingLinks = currentDetail.meetings.filter(
    (meeting) => meeting.evidence !== 'confirmed',
  );
  const mentionedCount = otherMeetingLinks.filter(
    (meeting) => meeting.evidence === 'mentioned',
  ).length;
  const eligibleMergeCandidates = mergeCandidates.filter(
    (candidate) => candidate.id !== currentDetail.person.id,
  );
  const selectedMergeSource = eligibleMergeCandidates.find(
    (candidate) => candidate.id === mergeSourceId,
  );

  // Temporal provenance for working context
  const latestMeeting = currentDetail.meetings[0] ?? null;
  const rawDate =
    latestMeeting?.started_at || latestMeeting?.created_at || brief.freshnessAt;
  const parsedDate = rawDate ? Date.parse(rawDate) : Number.NaN;
  const isValidDate = !Number.isNaN(parsedDate);

  const daysSince = isValidDate
    ? Math.floor((Date.now() - parsedDate) / (1000 * 60 * 60 * 24))
    : null;

  let recencyTier: 'fresh' | 'aging' | 'historical' = 'fresh';
  let ageLabel = '';
  if (daysSince !== null) {
    if (daysSince <= 14) {
      recencyTier = 'fresh';
      ageLabel = daysSince <= 1 ? 'recently' : `${daysSince}d ago`;
    } else if (daysSince <= 45) {
      recencyTier = 'aging';
      const weeks = Math.max(2, Math.round(daysSince / 7));
      ageLabel = `${weeks} weeks ago`;
    } else {
      recencyTier = 'historical';
      const months = Math.max(2, Math.round(daysSince / 30));
      ageLabel = `${months} months ago`;
    }
  }

  const formattedDate = isValidDate
    ? new Date(parsedDate).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        ...(new Date(parsedDate).getFullYear() !== new Date().getFullYear()
          ? { year: 'numeric' }
          : {}),
      })
    : null;

  const saveName = async () => {
    const name = nameDraft.trim();
    if (!name || name === currentDetail.person.name) {
      setEditingName(false);
      setNameDraft(currentDetail.person.name);
      return;
    }
    setNameState('saving');
    try {
      const person = await updatePersonName(currentDetail.person.id, name);
      setCurrentDetail((current) => ({ ...current, person }));
      setNameDraft(person.name);
      setEditingName(false);
      setNameState('saved');
      await onIdentityChanged();
    } catch {
      setNameState('error');
    }
  };

  const performMerge = async () => {
    if (!selectedMergeSource) return;
    setMergeState('saving');
    try {
      await mergePerson(selectedMergeSource.id, currentDetail.person.id);
      setLastMerged({
        id: selectedMergeSource.id,
        name: selectedMergeSource.name,
      });
      setMergeState('saved');
      setMergeOpen(false);
      setMergeSourceId('');
      await onIdentityChanged();
      void loadVoiceProfile();
    } catch {
      setMergeState('error');
    }
  };

  const restoreMerge = async (personId: string) => {
    setMergeState('saving');
    try {
      await restorePersonMerge(personId);
      setLastMerged(null);
      setMergeState('idle');
      await onIdentityChanged();
      void loadVoiceProfile();
    } catch {
      setMergeState('error');
    }
  };

  const isMergedFamily = (currentDetail.mergedPeople ?? []).length > 0;

  const playVoiceSample = async () => {
    if (!voiceProfile?.referenceInterval) return;
    releaseVoiceAudio();
    setSampleLoading(true);
    setSampleUnavailable(false);
    try {
      const sample = await getVoiceReferenceSample(
        voiceProfile.referenceInterval.sourceMeetingId,
        voiceProfile.referenceInterval.startTime,
        voiceProfile.referenceInterval.endTime,
      );
      if (!sample) {
        setSampleUnavailable(true);
        return;
      }
      if (
        typeof Audio === 'undefined' ||
        typeof URL.createObjectURL === 'undefined'
      ) {
        setSamplePlaying(true);
        return;
      }
      const bytes = Uint8Array.from(sample.bytes);
      const url = URL.createObjectURL(
        new Blob([bytes.buffer], { type: sample.mimeType }),
      );
      const audio = new Audio(url);
      voiceUrlRef.current = url;
      voiceAudioRef.current = audio;
      audio.addEventListener('ended', () => {
        releaseVoiceAudio();
      });
      setSamplePlaying(true);
      await audio.play();
    } catch {
      releaseVoiceAudio();
      setSampleUnavailable(true);
    } finally {
      setSampleLoading(false);
    }
  };

  const handleToggleVoiceStatus = async () => {
    if (!voiceProfile || voiceLoading) return;
    const nextStatus = !voiceProfile.isActive;
    setVoiceLoading(true);
    setVoiceError('');
    try {
      await setSpeakerVoiceProfileStatus(currentDetail.person.id, nextStatus);
      setVoiceProfile((prev) =>
        prev ? { ...prev, isActive: nextStatus } : null,
      );
      await onIdentityChanged();
    } catch (err) {
      setVoiceError(
        err instanceof Error ? err.message : 'Could not update voice status.',
      );
    } finally {
      setVoiceLoading(false);
    }
  };

  const handleDeleteVoiceProfile = async () => {
    if (isMergedFamily || voiceLoading) return;
    setVoiceLoading(true);
    setVoiceError('');
    try {
      await deleteSpeakerVoiceProfile(currentDetail.person.id);
      setVoiceProfile(null);
      setVoiceOptedOut(true);
      setVoiceReconciliationStatus('opted_out');
      await onIdentityChanged();
    } catch (err) {
      setVoiceError(
        err instanceof Error ? err.message : 'Could not delete voice profile.',
      );
    } finally {
      setVoiceLoading(false);
    }
  };

  const handleAllowVoiceEnrollment = async () => {
    if (!voiceOptedOut || voiceLoading) return;
    setVoiceLoading(true);
    setVoiceError('');
    try {
      await setSpeakerVoiceProfileStatus(currentDetail.person.id, true);
      setVoiceOptedOut(false);
      setVoiceReconciliationStatus(undefined);
      await onIdentityChanged();
    } catch (err) {
      setVoiceError(
        err instanceof Error
          ? err.message
          : 'Could not allow voice enrollment.',
      );
    } finally {
      setVoiceLoading(false);
    }
  };

  const resolveCandidate = async (
    candidate: PersonBriefingCommitmentCandidate,
    personId: string | null,
  ) => {
    setCandidateState((current) => ({
      ...current,
      [candidate.id]: 'saving',
    }));
    try {
      await resolvePersonCommitmentOwner(candidate.id, personId);
      const { suggestedOwnerName: _suggestedOwnerName, ...verifiedCommitment } =
        candidate;
      setCurrentDetail((current) => ({
        ...current,
        commitments: {
          ...current.commitments,
          candidates: current.commitments.candidates.filter(
            (item) => item.id !== candidate.id,
          ),
          open:
            personId === current.person.id
              ? [...current.commitments.open, verifiedCommitment]
              : current.commitments.open,
        },
      }));
      setCandidateState((current) => {
        const next = { ...current };
        delete next[candidate.id];
        return next;
      });
      await onIdentityChanged();
    } catch {
      setCandidateState((current) => ({
        ...current,
        [candidate.id]: 'error',
      }));
    }
  };

  const handleDreamNow = async () => {
    const generation = ++prepareGeneration.current;
    const preparedPersonId = currentDetail.person.id;
    setDreamingState('running');
    try {
      const result = await triggerDreamingNow({
        entityId: preparedPersonId,
      });
      if (
        generation !== prepareGeneration.current ||
        preparedPersonId !== currentDetail.person.id
      )
        return;
      if (result.status === 'proposed' || result.status === 'existing') {
        await onIdentityChanged();
        if (
          generation !== prepareGeneration.current ||
          preparedPersonId !== currentDetail.person.id
        )
          return;
        setDreamingState(result.status);
      } else {
        setDreamingState(result.status);
      }
    } catch {
      if (
        generation === prepareGeneration.current &&
        preparedPersonId === currentDetail.person.id
      )
        setDreamingState('error');
    }
  };

  const handleMarkContextOutdated = async () => {
    try {
      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(currentDetail.person.metadata || '{}');
      } catch {
        parsed = {};
      }
      const updatedMetadata = {
        ...parsed,
        contextOutdatedAt: new Date().toISOString(),
      };
      const updatedPerson = await upsertEntity({
        id: currentDetail.person.id,
        type: 'person',
        name: currentDetail.person.name,
        metadata: updatedMetadata,
      });
      setCurrentDetail((prev) => ({
        ...prev,
        person: updatedPerson,
      }));
      await onIdentityChanged();
    } catch (err) {
      console.error('Failed to mark context as outdated:', err);
    }
  };

  const isContextOutdated = Boolean(
    (() => {
      try {
        const parsed = JSON.parse(currentDetail.person.metadata || '{}');
        return parsed?.contextOutdatedAt;
      } catch {
        return false;
      }
    })(),
  );

  const handleSynthesizeFreshRead = async () => {
    try {
      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(currentDetail.person.metadata || '{}');
      } catch {
        parsed = {};
      }
      parsed.contextOutdatedAt = undefined;
      const updatedPerson = await upsertEntity({
        id: currentDetail.person.id,
        type: 'person',
        name: currentDetail.person.name,
        metadata: parsed,
      });
      setCurrentDetail((prev) => ({
        ...prev,
        person: updatedPerson,
      }));
      await handleDreamNow();
      await onIdentityChanged();
    } catch (err) {
      console.error('Failed to synthesize fresh read:', err);
    }
  };

  const collaborationJourney = useMemo(() => {
    if (!currentDetail.meetings || currentDetail.meetings.length === 0)
      return null;
    const sorted = [...currentDetail.meetings].sort(
      (a, b) =>
        (Date.parse(a.started_at || a.created_at || '') || 0) -
        (Date.parse(b.started_at || b.created_at || '') || 0),
    );
    const earliest = sorted[0];
    const latest = sorted[sorted.length - 1];
    const earliestDate = earliest.started_at || earliest.created_at;
    const latestDate = latest.started_at || latest.created_at;

    let spanMonths = 0;
    if (earliestDate && latestDate) {
      const diffMs = Math.max(
        0,
        Date.parse(latestDate) - Date.parse(earliestDate),
      );
      spanMonths = Math.max(1, Math.round(diffMs / (1000 * 60 * 60 * 24 * 30)));
    }

    return {
      meetingCount: sorted.length,
      earliestTitle: earliest.title || 'First conversation',
      earliestDate: earliestDate ? formatDate(earliestDate) : null,
      latestTitle: latest.title || 'Recent conversation',
      latestDate: latestDate ? formatDate(latestDate) : null,
      latestMeetingId: latest.id,
      spanMonths,
    };
  }, [currentDetail.meetings]);

  return (
    <article className="person-dossier">
      <div className="person-dossier__topline">
        <button type="button" className="person-dossier__back" onClick={onBack}>
          <ArrowLeft aria-hidden="true" size={15} />
          {backLabel || 'All people'}
        </button>
        <div className="flex items-center gap-2.5">
          {dreamingState !== 'idle' ? (
            <div
              className="person-dossier__prepare-status flex items-center gap-2 rounded-full border border-pro-border/70 bg-pro-surface/60 px-3 py-1 text-xs font-medium text-pro-text-muted"
              aria-live="polite"
            >
              {dreamingState === 'running' ? (
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full bg-pro-accent animate-pulse"
                  aria-hidden="true"
                />
              ) : null}
              <span>{DREAMING_STATUS_LABEL[dreamingState]}</span>
            </div>
          ) : null}
          <details className="person-dossier__more">
            <summary>
              <MoreHorizontal aria-hidden="true" size={16} />
              More
            </summary>
            <div>
              <button
                type="button"
                onClick={(event) => {
                  event.currentTarget
                    .closest('details')
                    ?.removeAttribute('open');
                  setEditingName(true);
                  setNameState('idle');
                }}
              >
                <Pencil aria-hidden="true" size={14} />
                Edit name
              </button>
              <button
                type="button"
                disabled={eligibleMergeCandidates.length === 0}
                onClick={(event) => {
                  event.currentTarget
                    .closest('details')
                    ?.removeAttribute('open');
                  setMergeOpen(true);
                  setMergeState('idle');
                }}
              >
                Merge another person
              </button>
              <button
                type="button"
                onClick={(event) => {
                  event.currentTarget
                    .closest('details')
                    ?.removeAttribute('open');
                  setProfileSettingsOpen(true);
                }}
              >
                <Volume2 aria-hidden="true" size={14} />
                Identity &amp; voice
              </button>
              <button
                type="button"
                disabled={dreamingState === 'running'}
                onClick={(event) => {
                  event.currentTarget
                    .closest('details')
                    ?.removeAttribute('open');
                  void handleDreamNow();
                }}
              >
                {DREAMING_STATUS_LABEL[dreamingState]}
              </button>
              {hasReliableRead && (
                <button
                  type="button"
                  onClick={(event) => {
                    event.currentTarget
                      .closest('details')
                      ?.removeAttribute('open');
                    void handleMarkContextOutdated();
                  }}
                >
                  <Clock3 aria-hidden="true" size={14} />
                  Mark context as outdated
                </button>
              )}
            </div>
          </details>
        </div>
      </div>
      <header className="person-dossier__identity">
        <span className="person-avatar" aria-hidden="true">
          {currentDetail.person.name.slice(0, 1).toUpperCase()}
        </span>
        <div className="person-dossier__identity-copy">
          {editingName ? (
            <form
              className="person-dossier__name-form"
              onSubmit={(event) => {
                event.preventDefault();
                void saveName();
              }}
            >
              <label htmlFor="person-name">Person name</label>
              <div>
                <input
                  ref={nameInputRef}
                  id="person-name"
                  value={nameDraft}
                  onChange={(event) => setNameDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      setEditingName(false);
                      setNameDraft(currentDetail.person.name);
                      setNameState('idle');
                    }
                  }}
                />
                <button
                  type="submit"
                  disabled={!nameDraft.trim() || nameState === 'saving'}
                >
                  {nameState === 'saving' ? 'Saving…' : 'Save name'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditingName(false);
                    setNameDraft(currentDetail.person.name);
                    setNameState('idle');
                  }}
                >
                  Keep current name
                </button>
              </div>
              {nameState === 'error' ? (
                <p role="alert">
                  Pluto could not save this name. The current name is unchanged.
                </p>
              ) : null}
            </form>
          ) : (
            <div className="person-dossier__name group">
              <h1>{currentDetail.person.name}</h1>
              <button
                type="button"
                aria-label="Edit person name"
                onClick={() => {
                  setEditingName(true);
                  setNameState('idle');
                }}
              >
                <Pencil aria-hidden="true" size={15} />
              </button>
            </div>
          )}
          <div className="person-dossier__identity-meta">
            <p>{role}</p>
            {possibleDuplicateCount > 0 ? (
              <button
                type="button"
                onClick={() => {
                  setMergeOpen(true);
                  setMergeState('idle');
                }}
              >
                Review possible duplicate
              </button>
            ) : null}
          </div>
          {nameState === 'saved' && !editingName ? (
            <output className="person-dossier__saved">Name saved</output>
          ) : null}
        </div>
      </header>

      {mergeOpen ? (
        <section
          className="person-dossier__merge"
          aria-labelledby="merge-person-heading"
        >
          <div className="person-dossier__section-heading">
            <h2 id="merge-person-heading">Merge duplicate person</h2>
          </div>
          <p>
            Choose the duplicate record. Meetings and open loops will appear
            under one person, and the original evidence will remain intact.
          </p>
          <label htmlFor="merge-person-source">Duplicate record</label>
          <SearchSelect
            id="merge-person-source"
            value={mergeSourceId}
            ariaLabel="Duplicate record"
            placeholder="Choose a person"
            searchPlaceholder="Search people…"
            options={eligibleMergeCandidates.map((candidate) => ({
              value: candidate.id,
              label: candidate.name,
            }))}
            onValueChange={(value) => {
              setMergeSourceId(value);
              setMergeState('idle');
            }}
          />
          {selectedMergeSource ? (
            <div className="person-dossier__merge-preview">
              <div>
                <strong>{selectedMergeSource.name}</strong>
                <span>
                  {selectedMergeSource.meetingCount} meeting
                  {selectedMergeSource.meetingCount === 1 ? '' : 's'} ·{' '}
                  {selectedMergeSource.openCommitmentCount} open loop
                  {selectedMergeSource.openCommitmentCount === 1 ? '' : 's'}
                </span>
                <small>
                  Confirmed speaker links and saved name variants stay attached.
                </small>
              </div>
              <p>
                {currentDetail.person.name} will remain as the person’s name.
              </p>
              <button
                type="button"
                disabled={mergeState === 'saving'}
                onClick={() => void performMerge()}
              >
                {mergeState === 'saving'
                  ? 'Merging…'
                  : `Merge ${selectedMergeSource.name}`}
              </button>
            </div>
          ) : null}
          <button
            type="button"
            className="person-dossier__merge-cancel"
            onClick={() => {
              setMergeOpen(false);
              setMergeSourceId('');
              setMergeState('idle');
            }}
          >
            Keep people separate
          </button>
          {mergeState === 'error' ? (
            <p role="alert">
              Pluto could not change these identities. They remain separate.
            </p>
          ) : null}
        </section>
      ) : null}

      {lastMerged ? (
        <output className="person-dossier__merge-result">
          <span>
            {lastMerged.name} was merged into {currentDetail.person.name}.
          </span>
          <button
            type="button"
            onClick={() => void restoreMerge(lastMerged.id)}
          >
            <Undo2 aria-hidden="true" size={14} />
            Undo merge
          </button>
        </output>
      ) : null}

      {(currentDetail.mergedPeople ?? []).length > 0 ? (
        <details className="person-dossier__merged">
          <summary>Manage merged names</summary>
          <ul>
            {(currentDetail.mergedPeople ?? []).map((person) => (
              <li key={person.id}>
                <span>{person.name}</span>
                <button
                  type="button"
                  onClick={() => void restoreMerge(person.id)}
                >
                  Restore {person.name}
                </button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {profileSettingsOpen ? (
        <section
          className="person-dossier__voice-profile"
          aria-labelledby="voice-profile-heading"
        >
          <div className="person-dossier__major-heading">
            <div className="flex items-center gap-2 text-pro-text-main">
              <Volume2 aria-hidden="true" size={16} />
              <h2 id="voice-profile-heading">Voice Profile</h2>
            </div>
            <div className="person-dossier__voice-heading-actions">
              {voiceProfile ? (
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    voiceProfile.isActive
                      ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                      : 'bg-pro-hover text-pro-text-muted border border-pro-border'
                  }`}
                >
                  {voiceProfile.isActive
                    ? 'Remembered voice (Active)'
                    : 'Disabled'}
                </span>
              ) : null}
              <button
                type="button"
                onClick={() => setProfileSettingsOpen(false)}
              >
                Done
              </button>
            </div>
          </div>

          {voiceProfile ? (
            <div className="mt-4 space-y-3">
              <p className="text-xs text-pro-text-muted">
                {voiceProfile.sampleCount}{' '}
                {voiceProfile.sampleCount === 1 ? 'sample' : 'samples'} (
                {Math.round(voiceProfile.cleanDurationSeconds)}s speech)
              </p>

              <div className="flex flex-wrap items-center gap-2 pt-1">
                {voiceProfile.referenceInterval ? (
                  <button
                    type="button"
                    disabled={voiceLoading || sampleLoading}
                    onClick={() => void playVoiceSample()}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-pro-border/80 bg-pro-bg px-2.5 py-1 text-xs font-medium text-pro-text-main hover:bg-pro-hover transition-colors disabled:opacity-50"
                  >
                    <Play
                      size={10}
                      className="fill-current mr-0.5 shrink-0"
                      aria-hidden="true"
                    />
                    {sampleLoading
                      ? 'Loading sample…'
                      : samplePlaying
                        ? 'Playing…'
                        : sampleUnavailable
                          ? 'Reference recording unavailable'
                          : 'Play reference sample'}
                  </button>
                ) : null}

                <button
                  type="button"
                  disabled={voiceLoading}
                  onClick={() => void handleToggleVoiceStatus()}
                  className="rounded-lg border border-pro-border/80 px-2.5 py-1 text-xs font-medium text-pro-text-muted hover:bg-pro-hover hover:text-pro-text-main transition-colors disabled:opacity-50"
                >
                  {voiceProfile.isActive
                    ? 'Disable voice recognition'
                    : 'Enable voice recognition'}
                </button>

                <button
                  type="button"
                  disabled={voiceLoading || isMergedFamily}
                  title={
                    isMergedFamily
                      ? 'Restore this person merge before permanently deleting voice samples.'
                      : undefined
                  }
                  onClick={() => void handleDeleteVoiceProfile()}
                  className="rounded-lg border border-red-500/20 text-red-600 dark:text-red-400 px-2.5 py-1 text-xs font-medium hover:bg-red-500/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Delete voice profile
                </button>
              </div>

              {isMergedFamily ? (
                <p className="text-xs text-pro-text-muted">
                  Restore this person merge before permanently deleting voice
                  samples.
                </p>
              ) : null}
              {sampleUnavailable ? (
                <p role="alert" className="text-xs text-pro-urgent">
                  Reference recording unavailable
                </p>
              ) : null}
              {voiceError ? (
                <p role="alert" className="text-xs text-pro-urgent">
                  {voiceError}
                </p>
              ) : null}
            </div>
          ) : voiceError ? (
            <p role="alert" className="mt-4 text-sm text-pro-urgent">
              {voiceError}
            </p>
          ) : voiceOptedOut ? (
            <div className="mt-4 space-y-3">
              <p className="text-sm text-pro-text-muted">
                Voice profile deleted. Pluto will not automatically recreate it.
              </p>
              <button
                type="button"
                disabled={voiceLoading}
                onClick={() => void handleAllowVoiceEnrollment()}
                className="rounded-lg border border-pro-border/80 px-2.5 py-1 text-xs font-medium text-pro-text-muted hover:bg-pro-hover hover:text-pro-text-main transition-colors disabled:opacity-50"
              >
                Allow voice enrollment
              </button>
            </div>
          ) : voiceReconciliationStatus === 'queued' ? (
            <p className="mt-4 text-sm text-pro-text-muted">
              Voice enrollment pending. Pluto will finish it when processing
              capacity is available.
            </p>
          ) : voiceReconciliationStatus === 'evidence_unavailable' ? (
            <p className="mt-4 text-sm text-pro-text-muted">
              No eligible voice profile could be created from retained meeting
              evidence.
            </p>
          ) : voiceReconciliationStatus === 'failed' ? (
            <p role="alert" className="mt-4 text-sm text-pro-urgent">
              Voice profile enrollment could not be completed.
            </p>
          ) : (
            <p className="mt-4 text-sm text-pro-text-muted">
              No voice profile enrolled for this person.
            </p>
          )}
        </section>
      ) : null}

      <section className="person-dossier__about" aria-label="About this person">
        {hasReliableRead ? (
          <div>
            <div className="person-dossier__section-heading mb-3">
              <h2>
                {recencyTier === 'fresh'
                  ? 'Active Focus'
                  : recencyTier === 'aging'
                    ? `Recent Focus${formattedDate ? ` · as of ${formattedDate}` : ''}`
                    : `Historical Context${formattedDate ? ` · Discussed ${formattedDate}` : ''}`}
              </h2>
            </div>

            {isContextOutdated && (
              <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3.5 text-xs text-amber-800 dark:text-amber-300 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-semibold">Context marked as outdated</p>
                  <button
                    type="button"
                    disabled={dreamingState === 'running'}
                    onClick={() => void handleSynthesizeFreshRead()}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-amber-600/30 bg-amber-500/20 px-2.5 py-1 text-xs font-medium text-amber-900 dark:text-amber-200 hover:bg-amber-500/30 transition-colors disabled:opacity-50"
                  >
                    <Sparkles className="h-3 w-3" />
                    <span>
                      {dreamingState === 'running'
                        ? 'Synthesizing…'
                        : 'Synthesize fresh read'}
                    </span>
                  </button>
                </div>
                <p className="text-pro-text-muted">
                  You acknowledged this working context as stale. Pluto will
                  synthesize a new brief across available conversation history.
                </p>
              </div>
            )}

            {isValidDate && formattedDate ? (
              <div className="mb-4 rounded-xl border border-pro-border/70 bg-pro-surface/50 p-3 space-y-1.5 shadow-2xs">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2 font-medium">
                    {recencyTier === 'fresh' ? (
                      <>
                        <span
                          className="h-2 w-2 rounded-full bg-emerald-500"
                          aria-hidden="true"
                        />
                        <span className="text-emerald-900 dark:text-emerald-300">
                          Active context · Last discussed {formattedDate}
                        </span>
                      </>
                    ) : recencyTier === 'aging' ? (
                      <>
                        <Clock3
                          className="h-3.5 w-3.5 text-stone-500"
                          aria-hidden="true"
                        />
                        <span className="text-pro-text-muted">
                          Discussed {formattedDate} ({ageLabel})
                        </span>
                      </>
                    ) : (
                      <>
                        <Clock3
                          className="h-3.5 w-3.5 text-stone-500"
                          aria-hidden="true"
                        />
                        <span className="text-pro-text-muted">
                          Historical context · Discussed {formattedDate} (
                          {ageLabel})
                        </span>
                      </>
                    )}
                  </div>

                  {latestMeeting && (
                    <button
                      type="button"
                      onClick={() => onOpenMeeting(latestMeeting.id)}
                      className="group inline-flex items-center gap-1 text-xs text-pro-accent hover:underline focus-visible:outline-none"
                      title={`Open source meeting: ${latestMeeting.title}`}
                    >
                      <span className="text-pro-text-muted font-normal">
                        From
                      </span>
                      <span className="font-medium max-w-[200px] truncate">
                        &ldquo;{latestMeeting.title}&rdquo;
                      </span>
                      <ChevronRight className="h-3 w-3 text-pro-accent/70 group-hover:translate-x-0.5 transition-transform" />
                    </button>
                  )}
                </div>

                {daysSince !== null && daysSince > 30 && (
                  <p className="text-[11.5px] text-pro-text-muted/80 leading-relaxed pt-0.5 border-t border-pro-border/40">
                    Captured during past conversations; active focus or
                    responsibilities may have evolved since then.
                  </p>
                )}
              </div>
            ) : null}

            <p className="max-w-[68ch] font-serif text-xl leading-8 text-pro-text-main">
              {brief.headline}
            </p>
            {brief.supportingBullets.length > 0 ? (
              <div className="mt-3 space-y-1">
                {brief.supportingBullets.map((bullet, idx) => (
                  <p key={idx} className="text-sm text-pro-text-muted">
                    {bullet}
                  </p>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <p className="person-dossier__about-empty">
            {meetingCount > 0
              ? 'There is not enough verified context to describe this person yet.'
              : 'No confirmed conversations are linked to this person yet.'}
          </p>
        )}
      </section>

      <section className="person-dossier__open-loops">
        <div className="person-dossier__major-heading">
          <h2>Commitments</h2>
          <span>{currentDetail.commitments.open.length}</span>
        </div>
        {currentDetail.commitments.open.length === 0 ? (
          <p className="person-dossier__section-empty">
            No verified commitments.
          </p>
        ) : (
          <CommitmentList
            items={currentDetail.commitments.open}
            onOpenMeeting={onOpenMeeting}
          />
        )}
        {currentDetail.commitments.candidates.length > 0 ||
        currentDetail.commitments.delivered.length > 0 ? (
          <details className="person-dossier__commitment-more">
            <summary>
              More commitments
              <span>
                {currentDetail.commitments.candidates.length +
                  currentDetail.commitments.delivered.length}
              </span>
              <ChevronDown aria-hidden="true" size={14} />
            </summary>
            {currentDetail.commitments.candidates.length > 0 ? (
              <section className="person-dossier__commitment-group">
                <div className="person-dossier__section-heading">
                  <h3>Needs confirmation</h3>
                  <span>{currentDetail.commitments.candidates.length}</span>
                </div>
                <p className="person-dossier__disclosure">
                  Extracted ownership is not treated as fact until you confirm
                  it.
                </p>
                <CandidateCommitmentList
                  items={currentDetail.commitments.candidates}
                  states={candidateState}
                  onOpenMeeting={onOpenMeeting}
                  onResolve={(candidate, accepted) =>
                    void resolveCandidate(
                      candidate,
                      accepted ? currentDetail.person.id : null,
                    )
                  }
                />
              </section>
            ) : null}
            {currentDetail.commitments.delivered.length > 0 ? (
              <section className="person-dossier__commitment-group">
                <div className="person-dossier__section-heading">
                  <h3>Delivered</h3>
                  <span>{currentDetail.commitments.delivered.length}</span>
                </div>
                <CommitmentList
                  items={currentDetail.commitments.delivered}
                  onOpenMeeting={onOpenMeeting}
                />
              </section>
            ) : null}
          </details>
        ) : null}
      </section>

      {collaborationJourney && collaborationJourney.meetingCount > 1 && (
        <section
          aria-labelledby="collaboration-journey"
          className="person-dossier__journey mb-8"
        >
          <div className="person-dossier__major-heading mb-3">
            <h2 id="collaboration-journey">Collaboration journey</h2>
            <span className="text-xs text-pro-text-muted">
              {collaborationJourney.meetingCount} meetings ·{' '}
              {collaborationJourney.spanMonths}mo span
            </span>
          </div>
          <div className="rounded-xl border border-pro-border/70 bg-pro-surface/50 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
              <span className="text-pro-text-muted">
                First met in{' '}
                <strong className="font-medium text-pro-text-main">
                  {collaborationJourney.earliestTitle}
                </strong>{' '}
                {collaborationJourney.earliestDate
                  ? `(${collaborationJourney.earliestDate})`
                  : ''}
              </span>
              <span className="text-pro-text-muted">
                Last met in{' '}
                <button
                  type="button"
                  onClick={() =>
                    onOpenMeeting(collaborationJourney.latestMeetingId)
                  }
                  className="font-medium text-pro-accent hover:underline focus-visible:outline-none"
                >
                  &ldquo;{collaborationJourney.latestTitle}&rdquo; ↗
                </button>{' '}
                {collaborationJourney.latestDate
                  ? `(${collaborationJourney.latestDate})`
                  : ''}
              </span>
            </div>
          </div>
        </section>
      )}

      <section className="person-dossier__history">
        <div className="person-dossier__major-heading">
          <h2>Meetings</h2>
          <span>{confirmedMeetings.length}</span>
        </div>
        {confirmedMeetings.length === 0 ? (
          <p className="person-dossier__section-empty">
            No confirmed meetings yet.
          </p>
        ) : (
          <MeetingList
            meetings={confirmedMeetings}
            onOpenMeeting={onOpenMeeting}
          />
        )}
        {otherMeetingLinks.length > 0 ? (
          <details className="person-dossier__other-links">
            <summary>
              Other meeting links
              <span>{otherMeetingLinks.length}</span>
              <ChevronDown aria-hidden="true" size={14} />
            </summary>
            {(['scheduled', 'mentioned'] as const).map((evidence) => {
              const meetings = otherMeetingLinks.filter(
                (meeting) => meeting.evidence === evidence,
              );
              return meetings.length > 0 ? (
                <MeetingGroup
                  key={evidence}
                  evidence={evidence}
                  meetings={meetings}
                  onOpenMeeting={onOpenMeeting}
                />
              ) : null;
            })}
            {mentionedCount > 0 ? (
              <p className="person-dossier__history-note">
                Mention-only links do not confirm participation or ownership.
              </p>
            ) : null}
          </details>
        ) : null}
      </section>
    </article>
  );
};

export const PeopleTab: React.FC<{
  selectedPersonId?: string | null;
  onSelectPerson?: (personId: string | null) => void;
  onOpenMeeting?: (
    meetingId: string,
    personContext?: { id: string; name: string },
  ) => void;
  backLabel?: string;
  onBack?: () => void;
}> = ({
  selectedPersonId = null,
  onSelectPerson = () => {},
  onOpenMeeting = () => {},
  backLabel,
  onBack,
}) => {
  const [rows, setRows] = useState<PersonBriefingRow[]>([]);
  const [details, setDetails] = useState<Record<string, PersonBriefingDetail>>(
    {},
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const fetchPeople = async () => {
      setLoading(true);
      setError(false);
      try {
        const briefingRows = await getPeopleBriefingSummaries();
        if (!cancelled) {
          setRows(briefingRows);
        }
      } catch (fetchError) {
        console.error('Failed to fetch people:', fetchError);
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void fetchPeople();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedPersonId || details[selectedPersonId]) return;
    let cancelled = false;
    const fetchDetail = async () => {
      setDetailLoading(true);
      setDetailError(false);
      try {
        const detail = await getPersonBriefing(selectedPersonId);
        if (!cancelled && detail) {
          setDetails((current) => ({ ...current, [selectedPersonId]: detail }));
        } else if (!cancelled) {
          setDetailError(true);
        }
      } catch (fetchError) {
        console.error('Failed to fetch person briefing:', fetchError);
        if (!cancelled) setDetailError(true);
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    };
    void fetchDetail();
    return () => {
      cancelled = true;
    };
  }, [details, selectedPersonId]);

  if (loading) {
    return (
      <div className="people-loading" aria-label="Loading relationship context">
        {[1, 2, 3, 4].map((item) => (
          <span key={item} />
        ))}
      </div>
    );
  }
  if (error) {
    return (
      <div className="people-empty" role="alert">
        <h2>People could not be loaded</h2>
        <p>
          Pluto could not read relationship context. Reopen this view to try
          again.
        </p>
      </div>
    );
  }
  if (selectedPersonId && detailLoading) {
    return (
      <div className="people-loading" aria-label="Loading person details">
        {[1, 2, 3].map((item) => (
          <span key={item} />
        ))}
      </div>
    );
  }
  if (selectedPersonId && detailError) {
    return (
      <div className="people-empty" role="alert">
        <h2>This person could not be loaded</h2>
        <p>Pluto could not read this relationship context.</p>
        <button type="button" onClick={() => onSelectPerson(null)}>
          Back to people
        </button>
      </div>
    );
  }
  const selectedDetail = selectedPersonId
    ? details[selectedPersonId]
    : undefined;
  if (selectedDetail) {
    const selectedSummary = rows.find(
      (row) =>
        row.id === selectedDetail.person.id || row.id === selectedPersonId,
    );
    return (
      <>
        <PersonDossier
          detail={selectedDetail}
          onBack={onBack || (() => onSelectPerson(null))}
          backLabel={backLabel}
          onOpenMeeting={(meetingId) =>
            onOpenMeeting(meetingId, {
              id: selectedDetail.person.id,
              name: selectedDetail.person.name,
            })
          }
          mergeCandidates={rows}
          possibleDuplicateCount={selectedSummary?.possibleDuplicateCount ?? 0}
          onIdentityChanged={async () => {
            const [nextRows, nextDetail] = await Promise.all([
              getPeopleBriefingSummaries(),
              getPersonBriefing(selectedDetail.person.id),
            ]);
            setRows(nextRows);
            if (nextDetail) {
              setDetails((current) => ({
                ...current,
                [selectedPersonId || nextDetail.person.id]: nextDetail,
                [nextDetail.person.id]: nextDetail,
              }));
            }
          }}
        />
        <PersonChatDock
          personId={selectedDetail.person.id}
          personName={selectedDetail.person.name}
          onOpenMeeting={onOpenMeeting}
        />
      </>
    );
  }
  return (
    <PeopleBriefing
      rows={rows}
      selectedPersonId={selectedPersonId}
      onSelectPerson={(personId) => onSelectPerson(personId)}
    />
  );
};
