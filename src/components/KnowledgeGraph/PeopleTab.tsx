import {
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  Clock3,
  MessageCircle,
  Quote,
  Search,
  UserRound,
} from 'lucide-react';
import type React from 'react';
import { useEffect, useMemo, useState } from 'react';
import {
  type Entity,
  type EntityMeeting,
  type PersonBriefingDetail,
  getPeopleBriefingSummaries,
  getPersonBriefing,
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
            {person.openCommitmentCount > 0 ? (
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
}: {
  detail: PersonBriefingDetail;
  onBack: () => void;
  onOpenMeeting: (meetingId: string) => void;
}) => {
  const role = parsePersonRole(detail.person.metadata);
  const brief = compileKnowledgeBrief(
    detail.knowledgeDoc,
    detail.workingMemorySnapshot,
  );
  const confirmedIds = new Set(
    detail.meetings
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

  return (
    <article className="person-dossier">
      <button type="button" className="person-dossier__back" onClick={onBack}>
        <ArrowLeft aria-hidden="true" size={15} />
        All people
      </button>
      <header className="person-dossier__identity">
        <span className="person-avatar" aria-hidden="true">
          {detail.person.name.slice(0, 1).toUpperCase()}
        </span>
        <div>
          <h1>{detail.person.name}</h1>
          <p>{role}</p>
        </div>
      </header>

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
        {detail.commitments.open.length > 0 ? (
          <section className="person-dossier__section">
            <div className="person-dossier__section-heading">
              <h2>Open expectations</h2>
              <span>{detail.commitments.open.length}</span>
            </div>
            <CommitmentList
              items={detail.commitments.open}
              onOpenMeeting={onOpenMeeting}
            />
          </section>
        ) : null}
        {detail.commitments.delivered.length > 0 ? (
          <section className="person-dossier__section">
            <div className="person-dossier__section-heading">
              <h2>Recently delivered</h2>
              <span>{detail.commitments.delivered.length}</span>
            </div>
            <CommitmentList
              items={detail.commitments.delivered}
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
            meetings={detail.meetings.filter(
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
    return (
      <PersonDossier
        detail={selectedDetail}
        onBack={() => onSelectPerson(null)}
        onOpenMeeting={onOpenMeeting}
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
