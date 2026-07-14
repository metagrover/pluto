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
};

const parseRole = (metadata: string | null) => {
  if (!metadata) return 'Relationship context';
  try {
    const value = JSON.parse(metadata) as { role?: unknown };
    return typeof value.role === 'string' && value.role.trim()
      ? value.role.trim()
      : 'Relationship context';
  } catch {
    return 'Relationship context';
  }
};

export const buildPersonBriefingRow = (
  person: Entity,
  meetings: EntityMeeting[],
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
  onOpenMeeting,
}: {
  rows: PersonBriefingRow[];
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

  return (
    <section aria-labelledby="people-heading" className="people-briefing">
      <header className="people-briefing__header">
        <div>
          <p className="workspace-eyebrow">Relationship context</p>
          <h1 id="people-heading">People in your memory</h1>
          <p>
            Re-enter the conversations, commitments, and context connected to
            each person.
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
        <div className="people-list" aria-label="Recently in conversation">
          <div className="people-list__heading">
            <h2>Recently in conversation</h2>
            <span>{filtered.length} people</span>
          </div>
          {filtered.map((person) => (
            <article className="person-row" key={person.id}>
              <div className="person-avatar" aria-hidden="true">
                {person.name.slice(0, 1).toUpperCase()}
              </div>
              <div className="person-identity">
                <h3>{person.name}</h3>
                <p>{person.role}</p>
              </div>
              <div className="person-context">
                <p>
                  {person.latestMeetingTitle ?? 'No linked conversation yet'}
                </p>
                <span>
                  {person.context ??
                    'Pluto will add context as this person appears in meetings.'}
                </span>
              </div>
              <div className="person-meta">
                <span>
                  <MessageCircle aria-hidden="true" size={13} />
                  {person.meetingCount} conversation
                  {person.meetingCount === 1 ? '' : 's'}
                </span>
                <span>
                  <Clock3 aria-hidden="true" size={13} />
                  {formatDate(person.latestMeetingAt)}
                </span>
              </div>
              <button
                type="button"
                disabled={!person.latestMeetingId}
                onClick={() =>
                  person.latestMeetingId &&
                  onOpenMeeting(person.latestMeetingId)
                }
              >
                Open latest <ArrowRight aria-hidden="true" size={14} />
              </button>
            </article>
          ))}
          {filtered.length === 0 && (
            <p className="people-no-results">No people match “{query}”.</p>
          )}
        </div>
      )}
    </section>
  );
};

export const PeopleTab: React.FC<{
  onOpenMeeting?: (meetingId: string) => void;
}> = ({ onOpenMeeting = () => {} }) => {
  const [rows, setRows] = useState<PersonBriefingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const fetchPeople = async () => {
      setLoading(true);
      setError(false);
      try {
        const people = await getEntitiesByType('person');
        const briefingRows = await Promise.all(
          people.map(async (person) =>
            buildPersonBriefingRow(person, await getEntityMeetings(person.id)),
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
  return <PeopleBriefing rows={rows} onOpenMeeting={onOpenMeeting} />;
};
