import {
  ArrowRight,
  Clock3,
  MessageCircle,
  Search,
  UserRound,
} from 'lucide-react';
import type React from 'react';
import { useEffect, useMemo, useState } from 'react';
import {
  type Entity,
  type EntityMeeting,
  getEntitiesByType,
  getEntityMeetings,
} from '../../api/knowledgeGraph';

export type PersonBriefingRow = {
  id: string;
  name: string;
  role: string;
  meetingCount: number;
  mentionCount: number;
  latestMeetingId: string | null;
  latestMeetingTitle: string | null;
  latestMeetingAt: string | null;
  context: string | null;
  openCommitmentCount: number;
};

const parseRole = (metadata: string | null) => {
  if (!metadata) return 'Known from conversations';
  try {
    const value = JSON.parse(metadata) as { role?: unknown };
    if (typeof value.role !== 'string') return 'Known from conversations';
    const role = value.role.trim();
    return role && !['undefined', 'null', 'n/a'].includes(role.toLowerCase())
      ? role
      : 'Known from conversations';
  } catch {
    return 'Known from conversations';
  }
};

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
    role: parseRole(person.metadata),
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

const personMatchesTask = (person: Entity, task: Entity) => {
  const assignee = task.assigned_to?.trim().toLowerCase();
  if (assignee === person.id || assignee === person.normalized_name)
    return true;
  try {
    const metadata = JSON.parse(task.metadata || '{}') as {
      assignee_name?: unknown;
    };
    return (
      typeof metadata.assignee_name === 'string' &&
      metadata.assignee_name.trim().toLowerCase() === person.normalized_name
    );
  } catch {
    return false;
  }
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
  onOpenMeeting,
}: {
  rows: PersonBriefingRow[];
  selectedPersonId?: string | null;
  onOpenMeeting: (meetingId: string) => void;
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
  const focusRows = useMemo(() => {
    if (query) return prioritized;

    const selectedRow = selectedPersonId
      ? prioritized.find((row) => row.id === selectedPersonId)
      : null;
    if (!selectedRow) return prioritized.slice(0, 6);

    return [
      selectedRow,
      ...prioritized.filter((row) => row.id !== selectedRow.id).slice(0, 5),
    ];
  }, [prioritized, query, selectedPersonId]);
  const hasCommitments = focusRows.some((row) => row.openCommitmentCount > 0);

  const renderPerson = (person: PersonBriefingRow) => {
    const selected = selectedPersonId === person.id;
    return (
      <article
        className={`person-row ${selected ? 'person-row--selected' : ''}`}
        data-person-id={person.id}
        data-selected={selected ? 'true' : undefined}
        key={person.id}
      >
        <div className="person-avatar" aria-hidden="true">
          {person.name.slice(0, 1).toUpperCase()}
        </div>
        <div className="person-identity">
          <h3>{person.name}</h3>
          <p>{person.role}</p>
        </div>
        <div className="person-context">
          <p>{person.latestMeetingTitle ?? 'No linked conversation yet'}</p>
          {person.context && <span>{person.context}</span>}
        </div>
        <div className="person-meta">
          {person.openCommitmentCount > 0 ? (
            <span className="person-commitments">
              {person.openCommitmentCount} open commitment
              {person.openCommitmentCount === 1 ? '' : 's'}
            </span>
          ) : (
            <span>
              <MessageCircle aria-hidden="true" size={13} />
              {person.meetingCount} conversation
              {person.meetingCount === 1 ? '' : 's'}
            </span>
          )}
          <span>
            <Clock3 aria-hidden="true" size={13} />
            {formatDate(person.latestMeetingAt)}
          </span>
        </div>
        <button
          type="button"
          disabled={!person.latestMeetingId}
          onClick={() =>
            person.latestMeetingId && onOpenMeeting(person.latestMeetingId)
          }
        >
          Open <ArrowRight aria-hidden="true" size={14} />
        </button>
      </article>
    );
  };

  return (
    <section aria-labelledby="people-heading" className="people-briefing">
      <header className="people-briefing__header">
        <div>
          <p className="workspace-eyebrow">Relationship context</p>
          <h1 id="people-heading">Relationships in motion</h1>
          <p>
            Start with the people tied to open commitments, then return to
            recent context.
          </p>
        </div>
        {rows.length > 0 && (
          <label className="people-search">
            <Search aria-hidden="true" size={16} />
            <span className="sr-only">Search people</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search people"
            />
          </label>
        )}
      </header>

      {rows.length === 0 ? (
        <div className="people-empty">
          <UserRound aria-hidden="true" size={22} />
          <h2>No relationship context yet</h2>
          <p>People will appear as Pluto connects them to conversations.</p>
        </div>
      ) : (
        <div className="people-list" aria-label="Relationship priorities">
          <div className="people-list__heading">
            <div>
              <p className="workspace-eyebrow">Prioritized</p>
              <h2>{hasCommitments ? 'Needs you now' : 'Recently active'}</h2>
            </div>
            <span>
              Showing {focusRows.length} of {filtered.length}
            </span>
          </div>
          {focusRows.map(renderPerson)}
          {!query && prioritized.length > focusRows.length && (
            <details className="people-directory">
              <summary>Browse all {prioritized.length} people</summary>
              <div>{prioritized.slice(focusRows.length).map(renderPerson)}</div>
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

export const PeopleTab: React.FC<{
  selectedPersonId?: string | null;
  onOpenMeeting?: (meetingId: string) => void;
}> = ({ selectedPersonId = null, onOpenMeeting = () => {} }) => {
  const [rows, setRows] = useState<PersonBriefingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const fetchPeople = async () => {
      setLoading(true);
      setError(false);
      try {
        const [people, actionItems] = await Promise.all([
          getEntitiesByType('person'),
          getEntitiesByType('action_item'),
        ]);
        const openActionItems = actionItems.filter(
          (item) => item.status === 'active' || item.status === 'overdue',
        );
        const briefingRows = await Promise.all(
          people.map(async (person) =>
            buildPersonBriefingRow(
              person,
              await getEntityMeetings(person.id),
              openActionItems.filter((task) => personMatchesTask(person, task))
                .length,
            ),
          ),
        );
        if (!cancelled) {
          setRows(
            briefingRows.sort(
              (a, b) =>
                (Date.parse(b.latestMeetingAt || '') || 0) -
                (Date.parse(a.latestMeetingAt || '') || 0),
            ),
          );
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
  return (
    <PeopleBriefing
      rows={rows}
      selectedPersonId={selectedPersonId}
      onOpenMeeting={onOpenMeeting}
    />
  );
};
