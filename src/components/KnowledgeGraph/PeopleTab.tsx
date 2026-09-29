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
  Trash2,
  Undo2,
  UserRound,
  Volume2,
  X,
} from 'lucide-react';
import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { refreshKnowledgeDoc } from '../../api/knowledgeDocs';
import {
  type Entity,
  type EntityMeeting,
  type PersonBriefingDetail,
  deleteEntity,
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
import {
  parsePersonRole,
  scorePersonActivity,
} from '../../utils/personBriefing';
import {
  buildPersonDossierRead,
  isCurrentPersonDossier,
} from '../../utils/personDossierRead';
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

export const isRegularCollaborator = (
  row: PersonBriefingRow,
  now = Date.now(),
): boolean => {
  if (row.meetingCount <= 0) return false;
  if (row.meetingCount >= 3) return true;
  if (row.meetingCount >= 2) {
    if (!row.latestMeetingAt) return true;
    const time = Date.parse(row.latestMeetingAt);
    if (Number.isNaN(time)) return true;
    const daysSince = Math.abs(now - time) / (1000 * 60 * 60 * 24);
    return daysSince <= 60;
  }
  return false;
};

export const sortPeopleRows = (
  rows: PersonBriefingRow[],
): PersonBriefingRow[] => {
  return [...rows].sort((a, b) => {
    const aTime = Date.parse(a.latestMeetingAt || '') || 0;
    const bTime = Date.parse(b.latestMeetingAt || '') || 0;
    if (bTime !== aTime) return bTime - aTime;

    if (b.meetingCount !== a.meetingCount)
      return b.meetingCount - a.meetingCount;

    if (b.openCommitmentCount !== a.openCommitmentCount)
      return b.openCommitmentCount - a.openCommitmentCount;

    if (b.candidateCommitmentCount !== a.candidateCommitmentCount)
      return b.candidateCommitmentCount - a.candidateCommitmentCount;

    return a.name.localeCompare(b.name);
  });
};

export const PeopleBriefing = ({
  rows,
  selectedPersonId,
  onSelectPerson,
  onDeletePerson,
}: {
  rows: PersonBriefingRow[];
  selectedPersonId?: string | null;
  onSelectPerson: (personId: string) => void;
  onDeletePerson?: (personId: string, personName: string) => Promise<void>;
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

  const regularRows = useMemo(
    () => sortPeopleRows(filtered.filter((row) => isRegularCollaborator(row))),
    [filtered],
  );
  const regularIds = useMemo(
    () => new Set(regularRows.map((row) => row.id)),
    [regularRows],
  );
  const otherRows = useMemo(
    () =>
      sortPeopleRows(
        filtered.filter(
          (row) => row.meetingCount > 0 && !regularIds.has(row.id),
        ),
      ),
    [filtered, regularIds],
  );
  const unlinkedRows = useMemo(
    () =>
      [...filtered.filter((row) => row.meetingCount === 0)].sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
    [filtered],
  );

  const renderPerson = (person: PersonBriefingRow) => {
    const selected = selectedPersonId === person.id;
    const cue = person.latestMeetingTitle
      ? `Latest link: ${person.latestMeetingTitle}`
      : 'No linked conversation yet';
    const showRole =
      person.role !== 'Known from conversations' &&
      Boolean(person.roleSourceMeetingId);
    return (
      <article
        className={`person-row group relative ${selected ? 'person-row--selected' : ''}`}
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
            {person.meetingCount > 0 ? (
              <span className="person-meeting-count">
                <MessageCircle aria-hidden="true" size={11} />
                {person.meetingCount} meeting
                {person.meetingCount === 1 ? '' : 's'}
              </span>
            ) : null}
            {person.latestMeetingAt &&
            !Number.isNaN(Date.parse(person.latestMeetingAt)) &&
            Math.floor(
              (Date.now() - Date.parse(person.latestMeetingAt)) /
                (1000 * 60 * 60 * 24),
            ) > 45 ? (
              <span className="person-historical">Historical</span>
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
        {!person.isSelf && onDeletePerson && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              void onDeletePerson(person.id, person.name);
            }}
            title="Delete person"
            aria-label={`Delete ${person.name}`}
            className="absolute right-2 top-1/2 -translate-y-1/2 flex h-7 w-7 items-center justify-center rounded-lg bg-pro-bg/90 text-pro-text-muted/40 opacity-0 pointer-events-none transition-all hover:bg-rose-500/10 hover:text-rose-600 dark:hover:text-rose-400 group-hover:opacity-100 group-hover:pointer-events-auto focus:opacity-100 focus:pointer-events-auto focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-rose-500 shadow-2xs"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
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
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  aria-label="Clear search"
                  className="people-search__clear"
                >
                  <X aria-hidden="true" size={12} />
                </button>
              )}
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
          {regularRows.length > 0 ? (
            <section
              aria-label="Regular collaborators"
              className="people-section"
            >
              <div className="people-list__heading">
                <h2>Regular collaborators</h2>
                <span>{regularRows.length}</span>
              </div>
              {regularRows.map(renderPerson)}
            </section>
          ) : null}
          {otherRows.length > 0 ? (
            <section
              aria-label="Other conversations"
              className="people-section people-other"
            >
              <div className="people-list__heading">
                <h2>Other conversations</h2>
                <span>{otherRows.length}</span>
              </div>
              {otherRows.map(renderPerson)}
            </section>
          ) : null}
          {unlinkedRows.length > 0 && (
            <details aria-label="Unlinked contacts" className="people-unlinked">
              <summary>
                <span>
                  <strong>Unlinked contacts</strong>
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
  const [isDeleting, setIsDeleting] = useState(false);
  const prepareGeneration = useRef(0);
  const autoRefreshedPersonId = useRef<string | null>(null);
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
  let roleSourceMeetingId: string | null = null;
  let roleEvidence: string | null = null;
  try {
    const metadata = JSON.parse(
      currentDetail.person.metadata || '{}',
    ) as Record<string, unknown>;
    roleSourceMeetingId =
      typeof metadata.role_source_meeting_id === 'string'
        ? metadata.role_source_meeting_id
        : null;
    roleEvidence =
      typeof metadata.role_evidence === 'string'
        ? metadata.role_evidence
        : null;
  } catch {
    // Older person metadata can be malformed.
  }
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
  const personRead = buildPersonDossierRead(
    currentDetail.person.name,
    brief.activeStreams,
    brief.evidenceIndex,
  );
  const personReadSourceCount = new Set(
    personRead.workstreams.flatMap((stream) =>
      stream.sources.map((source) => source.meeting_id),
    ),
  ).size;
  const summaryVersion = (() => {
    try {
      return JSON.parse(currentDetail.knowledgeDoc?.config || '{}')
        .synthesis_version;
    } catch {
      return null;
    }
  })();
  const hasPersonSummary =
    summaryVersion >= 6 &&
    (currentDetail.knowledgeDoc?.status === 'up_to_date' ||
      currentDetail.knowledgeDoc?.status === 'synthesizing') &&
    Boolean(personRead.headline);
  const personActivity = (currentDetail.recentActivity ?? []).filter(
    (item) => !/\bwill (?:notify|ping|inform)\b/i.test(item.text),
  );
  const activityNames = [
    currentDetail.person.name,
    currentDetail.person.name.split(' ')[0],
  ];
  const sourceNoteOverview = hasPersonSummary
    ? []
    : [...personActivity]
        .sort(
          (a, b) =>
            scorePersonActivity(b.text, activityNames) -
            scorePersonActivity(a.text, activityNames),
        )
        .slice(0, 2);
  const recurringQuotes = new Set(
    personRead.workstreams.flatMap((stream) =>
      stream.sources.map((source) => source.quote.toLocaleLowerCase()),
    ),
  );
  const remainingActivity = hasPersonSummary
    ? personActivity
        .filter(
          (item) =>
            !recurringQuotes.has(item.text.toLocaleLowerCase()) &&
            !/\bwill (?:notify|ping|inform)\b/i.test(item.text),
        )
        .slice(0, 3)
    : personActivity
        .filter((item) => !sourceNoteOverview.includes(item))
        .slice(0, 3);
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

  const citedDates = personRead.workstreams
    .flatMap((stream) => stream.sources)
    .map((source) => Date.parse(source.captured_at ?? ''))
    .filter(Number.isFinite);
  const latestCitedDate = citedDates.length ? Math.max(...citedDates) : null;
  const formattedDate =
    latestCitedDate !== null
      ? new Date(latestCitedDate).toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
          ...(new Date(latestCitedDate).getFullYear() !==
          new Date().getFullYear()
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
    if (!currentDetail.knowledgeDoc) return;
    setDreamingState('running');
    try {
      const refreshed = await refreshKnowledgeDoc(
        currentDetail.knowledgeDoc.id,
      );
      if (
        !refreshed ||
        refreshed.status !== 'up_to_date' ||
        refreshed.last_synthesized_at ===
          currentDetail.knowledgeDoc.last_synthesized_at
      ) {
        setDreamingState('error');
        return;
      }
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
      await onIdentityChanged();
      setDreamingState('idle');
    } catch (err) {
      setDreamingState('error');
      console.error('Failed to synthesize fresh read:', err);
    }
  };

  useEffect(() => {
    if (
      !currentDetail.knowledgeDoc ||
      meetingCount === 0 ||
      isCurrentPersonDossier(
        currentDetail.knowledgeDoc.status,
        summaryVersion,
      ) ||
      autoRefreshedPersonId.current === currentDetail.person.id
    ) {
      return;
    }
    autoRefreshedPersonId.current = currentDetail.person.id;
    void handleSynthesizeFreshRead();
  }, [
    currentDetail.person.id,
    currentDetail.knowledgeDoc,
    meetingCount,
    summaryVersion,
  ]);

  useEffect(() => {
    if (
      !currentDetail.knowledgeDoc ||
      isCurrentPersonDossier(currentDetail.knowledgeDoc.status, summaryVersion)
    ) {
      return;
    }
    let cancelled = false;
    const timer = window.setInterval(async () => {
      try {
        const fresh = await getPersonBriefing(currentDetail.person.id);
        if (!fresh || cancelled) return;
        setCurrentDetail((current) =>
          current.person.id === fresh.person.id &&
          current.knowledgeDoc?.updated_at !== fresh.knowledgeDoc?.updated_at
            ? fresh
            : current,
        );
      } catch {
        // Keep the last visible evidence while the background read retries.
      }
    }, 8000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [
    currentDetail.person.id,
    currentDetail.knowledgeDoc?.id,
    currentDetail.knowledgeDoc?.status,
    summaryVersion,
  ]);

  const handleDeletePerson = async () => {
    if (currentDetail.isSelf || isDeleting) return;
    const confirmed = window.confirm(
      `Are you sure you want to delete ${currentDetail.person.name}? This will remove them from your directory, unlink their voice profile and past speaker assignments, and cannot be undone.`,
    );
    if (!confirmed) return;
    setIsDeleting(true);
    try {
      await deleteEntity(currentDetail.person.id);
      onBack();
      await onIdentityChanged();
    } catch (err) {
      console.error('Failed to delete person:', err);
    } finally {
      setIsDeleting(false);
    }
  };

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
              {!currentDetail.isSelf && (
                <button
                  type="button"
                  disabled={isDeleting}
                  onClick={(event) => {
                    event.currentTarget
                      .closest('details')
                      ?.removeAttribute('open');
                    void handleDeletePerson();
                  }}
                  className="text-red-600 hover:bg-red-500/10 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-500/10 dark:hover:text-red-300"
                >
                  <Trash2 aria-hidden="true" size={14} />
                  Delete person
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
            <p>
              {roleSourceMeetingId && role !== 'Known from conversations'
                ? `Recorded title: ${role}`
                : `${currentDetail.meetings.filter((meeting) => meeting.evidence === 'confirmed').length} confirmed conversations`}
            </p>
            {role !== 'Known from conversations' && roleSourceMeetingId && (
              <button
                type="button"
                title={roleEvidence || undefined}
                onClick={() => onOpenMeeting(roleSourceMeetingId!)}
              >
                View role source
              </button>
            )}
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

      <section
        className="person-dossier__about"
        aria-labelledby="person-summary"
      >
        <div className="person-dossier__major-heading mb-3">
          <h2 id="person-summary">
            {hasPersonSummary
              ? 'What they work on'
              : 'Recent work we can verify'}
          </h2>
        </div>
        {isContextOutdated && (
          <p className="mb-4 max-w-[68ch] text-sm text-pro-text-muted">
            Context marked outdated.{' '}
            <button
              type="button"
              disabled={dreamingState === 'running'}
              className="font-semibold text-pro-accent hover:underline disabled:opacity-50"
              onClick={() => void handleSynthesizeFreshRead()}
            >
              {dreamingState === 'running' ? 'Refreshing…' : 'Refresh summary'}
            </button>
          </p>
        )}
        {hasPersonSummary ? (
          <div>
            <p className="max-w-[64ch] font-serif text-lg leading-7 text-pro-text-main">
              {personRead.headline}
            </p>
            <p className="mt-2 max-w-[68ch] font-sans text-xs leading-5 text-pro-text-main/80">
              {`Based on ${personReadSourceCount} cited conversations${formattedDate ? ` through ${formattedDate}` : ''}.`}
              {!roleSourceMeetingId || role === 'Known from conversations'
                ? ' A formal job title has not been established.'
                : ''}
            </p>
            {personRead.workstreams.length > 0 && (
              <div className="mt-6 space-y-4">
                {personRead.workstreams.length > 1 && (
                  <h3 className="text-sm font-semibold text-pro-text-main">
                    Recurring work
                  </h3>
                )}
                {personRead.workstreams.map((stream) => (
                  <div
                    key={stream.id}
                    className="max-w-[68ch] border-b border-pro-border/50 pb-4 last:border-0 last:pb-0"
                  >
                    {personRead.workstreams.length > 1 && (
                      <h4 className="text-sm font-semibold text-pro-text-main">
                        {stream.title}
                      </h4>
                    )}
                    <p className="mt-1 max-w-[68ch] text-sm leading-6 text-pro-text-main/80">
                      <span className="font-medium text-pro-text-main">
                        One example:{' '}
                      </span>
                      {stream.detail}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                      {stream.sources.slice(0, 2).map((source) => (
                        <button
                          key={source.meeting_id}
                          type="button"
                          className="text-left leading-5 text-pro-text-main underline decoration-pro-accent underline-offset-2 hover:decoration-pro-text-main focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pro-accent"
                          onClick={() => onOpenMeeting(source.meeting_id)}
                        >
                          {source.meeting_title || 'Open source meeting'}
                          {source.captured_at
                            ? ` · ${formatDate(source.captured_at)}`
                            : ''}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : sourceNoteOverview.length > 0 ? (
          <div>
            <div className="max-w-[68ch] space-y-3 font-serif text-lg leading-7 text-pro-text-main">
              {sourceNoteOverview.map((item) => (
                <p key={`${item.meetingId}-${item.text}`}>{item.text}</p>
              ))}
            </div>
            <p className="mt-3 max-w-[68ch] font-sans text-xs leading-5 text-pro-text-main/80">
              From person-specific meeting notes. A broader account of their
              role and contributions is being prepared.
            </p>
            <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs">
              {Array.from(
                new Map(
                  sourceNoteOverview.map((item) => [item.meetingId, item]),
                ).values(),
              ).map((item) => (
                <button
                  key={`${item.meetingId}-${item.text}`}
                  type="button"
                  className="text-left leading-5 text-pro-text-main underline decoration-pro-accent underline-offset-2 hover:decoration-pro-text-main focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pro-accent"
                  onClick={() => onOpenMeeting(item.meetingId)}
                >
                  {item.meetingTitle}
                  {item.occurredAt ? ` · ${formatDate(item.occurredAt)}` : ''}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div>
            <p className="max-w-[68ch] font-sans text-sm leading-6 text-pro-text-muted">
              {dreamingState === 'error'
                ? 'The person summary could not be updated. Recent developments remain available below.'
                : summaryVersion >= 6 &&
                    currentDetail.knowledgeDoc?.status === 'up_to_date'
                  ? 'The linked conversations do not yet establish a reliable summary of this person’s role and contributions.'
                  : confirmedMeetings.length === 0 &&
                      (currentDetail.recentActivity ?? []).length === 0
                    ? 'There is not enough verified context to describe this person yet.'
                    : meetingCount > 0
                      ? 'A source-backed summary of this person’s role and contributions is being prepared. Recent developments are below.'
                      : 'No conversations are linked to this person yet.'}
            </p>
            {dreamingState === 'error' && currentDetail.knowledgeDoc && (
              <button
                type="button"
                className="mt-2 text-sm text-pro-accent hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-pro-accent"
                onClick={() => void handleSynthesizeFreshRead()}
              >
                Retry summary
              </button>
            )}
          </div>
        )}
      </section>

      {(remainingActivity.length > 0 || sourceNoteOverview.length === 0) && (
        <section
          className="person-dossier__about"
          aria-labelledby="person-recent-work"
        >
          <div className="person-dossier__major-heading mb-3">
            <h2 id="person-recent-work">Recent developments</h2>
          </div>
          {remainingActivity.length > 0 ? (
            <>
              <span className="mb-5 block max-w-[68ch] text-sm leading-6 text-pro-text-muted">
                Specific updates from recent conversations. Open a meeting to
                see the source.
              </span>
              <ol className="space-y-4">
                {remainingActivity.map((item) => (
                  <li
                    key={`${item.meetingId}-${item.text}`}
                    className="border-b border-pro-border/50 pb-4 last:border-0"
                  >
                    <p className="max-w-[68ch] text-sm leading-6 text-pro-text-main">
                      {item.text}
                    </p>
                    <button
                      type="button"
                      className="mt-1 text-left text-xs leading-5 text-pro-text-main underline decoration-pro-accent underline-offset-2 hover:decoration-pro-text-main focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pro-accent"
                      onClick={() => onOpenMeeting(item.meetingId)}
                    >
                      {item.source === 'accepted_focus'
                        ? 'Accepted focus update'
                        : item.evidence === 'confirmed'
                          ? 'Confirmed conversation'
                          : 'Mentioned in notes'}
                      {' · '}
                      {item.meetingTitle}
                      {item.occurredAt
                        ? ` · ${formatDate(item.occurredAt)}`
                        : ''}
                    </button>
                  </li>
                ))}
              </ol>
            </>
          ) : sourceNoteOverview.length === 0 ? (
            <p className="person-dossier__about-empty">
              Recent notes do not yet describe this person's work specifically.
            </p>
          ) : null}
        </section>
      )}

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
            } else {
              setDetails((current) => {
                const next = { ...current };
                delete next[selectedDetail.person.id];
                if (selectedPersonId) delete next[selectedPersonId];
                return next;
              });
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
      onDeletePerson={async (personId, personName) => {
        const confirmed = window.confirm(
          `Are you sure you want to delete ${personName}? This will remove them from your directory, unlink their voice profile and past speaker assignments, and cannot be undone.`,
        );
        if (!confirmed) return;
        try {
          await deleteEntity(personId);
          const nextRows = await getPeopleBriefingSummaries();
          setRows(nextRows);
          setDetails((current) => {
            const next = { ...current };
            delete next[personId];
            return next;
          });
        } catch (err) {
          console.error('Failed to delete person:', err);
        }
      }}
    />
  );
};
