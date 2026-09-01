import {
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  Clock3,
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
  restorePersonMerge,
  updatePersonName,
} from '../../api/knowledgeGraph';
import type {
  PersonBriefingCommitment,
  PersonBriefingMeeting,
  PersonBriefingSummary,
  PersonMeetingEvidence,
} from '../../utils/personBriefing';
import { parsePersonRole } from '../../utils/personBriefing';
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
          `${row.name} ${row.role} ${row.latestMeetingTitle ?? ''}`
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
          (Date.parse(b.latestMeetingAt || '') || 0) -
            (Date.parse(a.latestMeetingAt || '') || 0),
      ),
    [filtered],
  );
  const linkedRows = useMemo(
    () => prioritized.filter((row) => row.meetingCount > 0),
    [prioritized],
  );
  const unlinkedRows = useMemo(
    () => prioritized.filter((row) => row.meetingCount === 0),
    [prioritized],
  );
  const renderPerson = (person: PersonBriefingRow) => {
    const selected = selectedPersonId === person.id;
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
            <span>{person.role}</span>
          </span>
          <span className="person-context">
            {person.latestMeetingTitle ?? 'No linked conversation yet'}
          </span>
          <span className="person-meta">
            {person.possibleDuplicateCount > 0 ? (
              <span className="person-possible-duplicate">
                Possible duplicate
              </span>
            ) : person.openCommitmentCount > 0 ? (
              <span className="person-commitments">
                {person.openCommitmentCount} open commitment
                {person.openCommitmentCount === 1 ? '' : 's'}
              </span>
            ) : (
              <span className="person-meeting-count">
                <MessageCircle aria-hidden="true" size={12} />
                {person.meetingCount} meeting link
                {person.meetingCount === 1 ? '' : 's'}
              </span>
            )}
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
      </PageHeader>

      {rows.length === 0 ? (
        <div className="people-empty">
          <UserRound aria-hidden="true" size={22} />
          <h2>No relationship context yet</h2>
          <p>People will appear as Pluto connects them to conversations.</p>
        </div>
      ) : (
        <div className="people-list" aria-label="Relationship priorities">
          {linkedRows.map(renderPerson)}
          {unlinkedRows.length > 0 && (
            <section
              aria-label="People without linked conversations"
              className="people-unlinked"
            >
              <div className="people-list__heading">
                <h2>No linked conversations</h2>
                <div aria-hidden="true" />
              </div>
              {unlinkedRows.map(renderPerson)}
            </section>
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
  const [lastMerged, setLastMerged] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setCurrentDetail(detail);
    setNameDraft(detail.person.name);
  }, [detail]);

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
  const confirmedEvidence = brief.evidenceIndex.filter((entry) =>
    confirmedIds.has(entry.meeting_id),
  );
  const insights = brief.patterns
    .filter(
      (pattern) =>
        pattern.evidence_quality.mode === 'direct' &&
        pattern.evidence_quality.confidence >= 0.7 &&
        pattern.citations.length > 0 &&
        pattern.citations.every((citation) =>
          confirmedIds.has(citation.meeting_id),
        ),
    )
    .slice(0, 2);
  const showContext =
    brief.isCompiled && brief.trustStatus === 'grounded' && insights.length > 0;
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
          </div>
        </details>
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
            Choose the duplicate record. Meetings and expectations will appear
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
                  {selectedMergeSource.openCommitmentCount} open expectation
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

      {showContext ? (
        <section className="person-dossier__context">
          <div className="person-dossier__eyebrow">
            <Quote aria-hidden="true" size={13} />
            Current context
          </div>
          <ul className="person-dossier__insights">
            {insights.map((insight) => {
              const citation = insight.citations.find((item) =>
                confirmedIds.has(item.meeting_id),
              );
              const source = confirmedEvidence.find(
                (entry) => entry.meeting_id === citation?.meeting_id,
              );
              return (
                <li key={insight.id}>
                  <strong>{insight.title}</strong>
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
        </section>
      ) : null}

      <div className="person-dossier__activity">
        {currentDetail.commitments.open.length > 0 ? (
          <section className="person-dossier__section">
            <div className="person-dossier__section-heading">
              <h2>Open expectations</h2>
              <span>{currentDetail.commitments.open.length}</span>
            </div>
            <CommitmentList
              items={currentDetail.commitments.open}
              onOpenMeeting={onOpenMeeting}
            />
          </section>
        ) : null}
        {currentDetail.commitments.delivered.length > 0 ? (
          <section className="person-dossier__section">
            <div className="person-dossier__section-heading">
              <h2>Recently delivered</h2>
              <span>{currentDetail.commitments.delivered.length}</span>
            </div>
            <CommitmentList
              items={currentDetail.commitments.delivered}
              onOpenMeeting={onOpenMeeting}
            />
          </section>
        ) : null}
      </div>

      <div className="person-dossier__history">
        {(['confirmed', 'scheduled', 'mentioned'] as const).map((evidence) => (
          <MeetingGroup
            key={evidence}
            evidence={evidence}
            meetings={currentDetail.meetings.filter(
              (meeting) => meeting.evidence === evidence,
            )}
            onOpenMeeting={onOpenMeeting}
          />
        ))}
      </div>
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
