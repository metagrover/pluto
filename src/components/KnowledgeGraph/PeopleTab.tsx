import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clock3,
  ListChecks,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  Quote,
  Search,
  Undo2,
  UserRound,
} from 'lucide-react';
import type React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  type Entity,
  type EntityMeeting,
  type PersonBriefingDetail,
  getPeopleBriefingSummaries,
  getPersonBriefing,
  mergePerson,
  recordEntityCorrection,
  resolvePersonCommitmentOwner,
  restorePersonMerge,
  triggerDreamingNow,
  updatePersonName,
} from '../../api/knowledgeGraph';
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
import { PreparedUpdates } from '../features/dreaming/PreparedUpdates';
import { PageHeader } from '../ui/PageHeader';
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
    const cue =
      person.briefHeadline ??
      (person.context && !person.context.startsWith('Role:')
        ? person.context
        : null) ??
      person.latestMeetingTitle ??
      'No linked conversation yet';
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
          <span className="person-identity">
            <strong>{person.name}</strong>
            {showRole ? <span>{person.role}</span> : null}
          </span>
          <span className="person-context">{cue}</span>
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

const formatDueDate = (value: string | null) => {
  if (!value) return null;
  return `Due ${new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
  }).format(new Date(value))}`;
};

const CommitmentList = ({
  items,
  onOpenMeeting,
}: {
  items: PersonBriefingCommitment[];
  onOpenMeeting: (meetingId: string) => void;
}) => (
  <ul className="person-dossier__commitments">
    {items.slice(0, 3).map((item) => (
      <li key={item.id}>
        <span className="person-dossier__commitment-icon" aria-hidden="true">
          {item.status === 'completed' ? (
            <CheckCircle2 size={15} />
          ) : (
            <Clock3 size={15} />
          )}
        </span>
        <span className="person-dossier__commitment-copy">
          <strong>{item.text}</strong>
          <span>
            {formatDueDate(item.dueDate) ??
              (item.status === 'completed' ? 'Recently completed' : 'Open')}
          </span>
          {item.evidence ? <q>{item.evidence}</q> : null}
        </span>
        <button
          type="button"
          onClick={() => onOpenMeeting(item.sourceMeetingId)}
        >
          Source: {item.sourceMeetingTitle ?? 'Meeting'}
        </button>
      </li>
    ))}
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
      )}
    </section>
  );
};

export const PersonDossier = ({
  detail,
  onBack,
  onOpenMeeting,
  mergeCandidates = [],
  possibleDuplicateCount = 0,
  onIdentityChanged = async () => {},
}: {
  detail: PersonBriefingDetail;
  onBack: () => void;
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
  const [preparedUpdatesReload, setPreparedUpdatesReload] = useState(0);
  const prepareGeneration = useRef(0);
  const [dismissedInsights, setDismissedInsights] = useState<string[]>([]);
  const nameInputRef = useRef<HTMLInputElement>(null);

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
  const confirmedIds = new Set(
    currentDetail.meetings
      .filter((meeting) => meeting.evidence === 'confirmed')
      .map((meeting) => meeting.id),
  );
  const insights = brief.patterns
    .filter(
      (pattern) =>
        pattern.evidence_quality.mode === 'direct' &&
        pattern.evidence_quality.confidence >= 0.7 &&
        pattern.citations.length > 0,
    )
    .slice(0, 2);
  const hasReliableRead =
    brief.isCompiled &&
    ![
      'No reliable compiled brief yet.',
      'Indexed knowledge needs a stronger synthesis.',
    ].includes(brief.headline);
  const confirmedContext =
    hasReliableRead &&
    brief.trustStatus === 'grounded' &&
    brief.evidenceIndex.some((entry) => confirmedIds.has(entry.meeting_id));
  const readEvidence = brief.evidenceIndex.slice(0, 2);
  const meetingCount = currentDetail.meetings.length;
  const briefConversationCount =
    brief.coverage.sourceCount ??
    brief.coverage.citedMeetingCount ??
    meetingCount;
  const mentionedCount = currentDetail.meetings.filter(
    (meeting) => meeting.evidence === 'mentioned',
  ).length;
  const scheduledMeeting = currentDetail.meetings.find(
    (meeting) => meeting.evidence === 'scheduled',
  );
  const eligibleMergeCandidates = mergeCandidates.filter(
    (candidate) => candidate.id !== currentDetail.person.id,
  );
  const selectedMergeSource = eligibleMergeCandidates.find(
    (candidate) => candidate.id === mergeSourceId,
  );

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
    } catch {
      setMergeState('error');
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
      if (result.status === 'proposed') {
        await onIdentityChanged();
        if (
          generation !== prepareGeneration.current ||
          preparedPersonId !== currentDetail.person.id
        )
          return;
        setPreparedUpdatesReload((value) => value + 1);
        setDreamingState('proposed');
      } else {
        if (result.status === 'existing') {
          setPreparedUpdatesReload((value) => value + 1);
        }
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

  const handleDismissInsight = async (observation: string) => {
    try {
      await recordEntityCorrection({
        entityId: currentDetail.person.id,
        itemType: 'insight',
        fingerprint: observation,
        reason: 'reported_inaccurate',
      });
      setDismissedInsights((prev) => [...prev, observation]);
    } catch {
      // keep on error
    }
  };

  return (
    <article className="person-dossier">
      <div className="person-dossier__topline">
        <button type="button" className="person-dossier__back" onClick={onBack}>
          <ArrowLeft aria-hidden="true" size={15} />
          All people
        </button>
        <details className="person-dossier__more">
          <summary>
            <MoreHorizontal aria-hidden="true" size={16} />
            More
          </summary>
          <div>
            <button
              type="button"
              onClick={(event) => {
                event.currentTarget.closest('details')?.removeAttribute('open');
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
                event.currentTarget.closest('details')?.removeAttribute('open');
                setMergeOpen(true);
                setMergeState('idle');
              }}
            >
              Merge another person
            </button>
            <button
              type="button"
              disabled={dreamingState === 'running'}
              onClick={(event) => {
                event.currentTarget.closest('details')?.removeAttribute('open');
                void handleDreamNow();
              }}
            >
              {DREAMING_STATUS_LABEL[dreamingState]}
            </button>
          </div>
        </details>
      </div>
      <div
        className="person-dossier__prepare-status flex min-h-6 items-center gap-3 text-sm text-pro-text-muted"
        aria-live="polite"
      >
        {dreamingState !== 'idle' ? (
          <>
            <span>{DREAMING_STATUS_LABEL[dreamingState]}</span>
            {dreamingState === 'proposed' ? (
              <button
                type="button"
                className="rounded font-medium text-pro-accent underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-pro-accent"
                onClick={() => {
                  const heading = document.getElementById(
                    `prepared-updates-person-${currentDetail.person.id}`,
                  );
                  heading?.focus();
                  heading?.scrollIntoView?.({ block: 'start' });
                }}
              >
                Review prepared updates
              </button>
            ) : null}
          </>
        ) : null}
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
          <select
            id="merge-person-source"
            value={mergeSourceId}
            onChange={(event) => {
              setMergeSourceId(event.target.value);
              setMergeState('idle');
            }}
          >
            <option value="">Choose a person</option>
            {eligibleMergeCandidates.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
              </option>
            ))}
          </select>
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

      <section className="person-dossier__current-read">
        <div className="person-dossier__current-read-heading">
          <div>
            <Quote aria-hidden="true" size={14} />
            <h2>Current read</h2>
          </div>
          <span>
            {confirmedContext ? 'Confirmed context' : 'Mention-backed context'}
          </span>
        </div>
        {hasReliableRead ? (
          <>
            <p className="person-dossier__headline">{brief.headline}</p>
            <div className="person-dossier__read-meta">
              <span>
                Updated from {briefConversationCount || meetingCount}{' '}
                conversation
                {(briefConversationCount || meetingCount) === 1 ? '' : 's'}
              </span>
              {brief.freshnessAt ? (
                <span>{formatDate(brief.freshnessAt)}</span>
              ) : null}
              {currentDetail.knowledgeDoc?.status === 'stale' ? (
                <span>Brief needs refresh</span>
              ) : null}
            </div>
            {readEvidence.length > 0 ? (
              <div className="person-dossier__read-sources">
                {readEvidence.map((entry) => (
                  <button
                    type="button"
                    key={entry.id}
                    onClick={() => onOpenMeeting(entry.meeting_id)}
                  >
                    Source: {entry.meeting_title ?? 'Meeting'}
                  </button>
                ))}
              </div>
            ) : null}
          </>
        ) : (
          <div className="person-dossier__read-empty">
            <strong>No reliable relationship brief yet</strong>
            <p>
              {meetingCount > 0
                ? 'Pluto has conversation links, but not enough verified context for a current read.'
                : 'Link a conversation or confirm this identity before Pluto summarizes the relationship.'}
            </p>
            {meetingCount > 0 ? (
              <span>Conversation links available: {meetingCount}</span>
            ) : null}
          </div>
        )}
        {insights.length > 0 ? (
          <div className="person-dossier__patterns">
            <h3>Recent patterns</h3>
            <ul className="person-dossier__insights">
              {insights
                .filter((insight) => !dismissedInsights.includes(insight.title))
                .map((insight) => {
                  const citation = insight.citations[0];
                  const source = brief.evidenceIndex.find(
                    (entry) => entry.meeting_id === citation?.meeting_id,
                  );
                  return (
                    <li key={insight.id}>
                      <div className="flex items-start justify-between gap-2">
                        <strong>{insight.title}</strong>
                        <button
                          type="button"
                          onClick={() =>
                            void handleDismissInsight(insight.title)
                          }
                          title="Report inaccurate"
                          className="text-xs text-pro-text-muted hover:text-pro-urgent"
                        >
                          Report inaccurate
                        </button>
                      </div>
                      <p>{insight.summary}</p>
                      {citation ? <q>{citation.quote}</q> : null}
                      {citation ? (
                        <button
                          type="button"
                          onClick={() => onOpenMeeting(citation.meeting_id)}
                        >
                          Source: {source?.meeting_title ?? 'Meeting'}
                        </button>
                      ) : null}
                    </li>
                  );
                })}
            </ul>
          </div>
        ) : null}
      </section>

      <PreparedUpdates
        key={currentDetail.person.id}
        entityId={currentDetail.person.id}
        entityType="person"
        reloadToken={preparedUpdatesReload}
        evidenceMeetings={currentDetail.meetings.map((meeting) => ({
          id: meeting.id,
          title: meeting.title,
          date: meeting.started_at || meeting.created_at,
        }))}
        onCanonicalChange={onIdentityChanged}
        onOpenMeeting={onOpenMeeting}
        onReviewIdentity={() => {
          setMergeOpen(true);
          setMergeState('idle');
        }}
      />

      <section className="person-dossier__open-loops">
        <div className="person-dossier__major-heading">
          <div>
            <ListChecks aria-hidden="true" size={16} />
            <h2>Open loops</h2>
          </div>
          <span>
            {currentDetail.commitments.open.length +
              currentDetail.commitments.candidates.length}
          </span>
        </div>
        {currentDetail.commitments.open.length === 0 &&
        currentDetail.commitments.candidates.length === 0 ? (
          <p className="person-dossier__section-empty">
            No verified open loops or ownership candidates.
          </p>
        ) : (
          <div className="person-dossier__activity">
            {currentDetail.commitments.open.length > 0 ? (
              <section className="person-dossier__section">
                <div className="person-dossier__section-heading">
                  <h3>{currentDetail.isSelf ? 'You owe' : 'They owe'}</h3>
                  <span>{currentDetail.commitments.open.length}</span>
                </div>
                <CommitmentList
                  items={currentDetail.commitments.open}
                  onOpenMeeting={onOpenMeeting}
                />
              </section>
            ) : null}
            {currentDetail.commitments.candidates.length > 0 ? (
              <section className="person-dossier__section person-dossier__section--candidate">
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
          </div>
        )}
        {currentDetail.commitments.delivered.length > 0 ? (
          <details className="person-dossier__delivered">
            <summary>
              Recently delivered
              <span>{currentDetail.commitments.delivered.length}</span>
              <ChevronDown aria-hidden="true" size={14} />
            </summary>
            <CommitmentList
              items={currentDetail.commitments.delivered}
              onOpenMeeting={onOpenMeeting}
            />
          </details>
        ) : null}
      </section>

      {scheduledMeeting ? (
        <section className="person-dossier__upcoming">
          <div className="person-dossier__major-heading">
            <div>
              <CalendarDays aria-hidden="true" size={16} />
              <h2>Scheduled or invited</h2>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onOpenMeeting(scheduledMeeting.id)}
          >
            <span>
              <strong>{scheduledMeeting.title}</strong>
              <small>Attendance is not confirmed.</small>
            </span>
            <span>
              {formatDate(
                scheduledMeeting.started_at || scheduledMeeting.created_at,
              )}
            </span>
          </button>
        </section>
      ) : null}

      <details className="person-dossier__history">
        <summary>
          <span>
            <MessageCircle aria-hidden="true" size={15} />
            <strong>Evidence and conversation history</strong>
          </span>
          <span>{meetingCount}</span>
          <ChevronDown aria-hidden="true" size={14} />
        </summary>
        {meetingCount === 0 ? (
          <p className="person-dossier__section-empty">
            No conversations are linked to this identity.
          </p>
        ) : (
          (['confirmed', 'scheduled', 'mentioned'] as const).map((evidence) => {
            const meetings = currentDetail.meetings.filter(
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
          })
        )}
        {mentionedCount > 0 ? (
          <p className="person-dossier__history-note">
            Mention-only links do not confirm participation or ownership.
          </p>
        ) : null}
      </details>
    </article>
  );
};

export const PeopleTab: React.FC<{
  selectedPersonId?: string | null;
  onSelectPerson?: (personId: string | null) => void;
  onOpenMeeting?: (meetingId: string) => void;
}> = ({
  selectedPersonId = null,
  onSelectPerson = () => {},
  onOpenMeeting = () => {},
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
      <PersonDossier
        detail={selectedDetail}
        onBack={() => onSelectPerson(null)}
        onOpenMeeting={onOpenMeeting}
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
