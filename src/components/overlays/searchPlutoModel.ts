import type { Entity } from '../../api/knowledgeGraph';
import type { Meeting } from '../../types';

export type SearchPlutoResultKind = 'project' | 'person' | 'meeting';

export interface SearchPlutoResult {
  kind: SearchPlutoResultKind;
  id: string | number;
  title: string;
  subtitle: string;
  updatedAt?: string | null;
}

interface BuildSearchPlutoResultsInput {
  query: string;
  meetings: Meeting[];
  entities: Entity[];
}

const normalize = (value: string | null | undefined) =>
  (value || '').trim().toLowerCase();

const matchesQuery = (query: string, ...values: Array<string | undefined>) =>
  values.some((value) => normalize(value).includes(query));

const sortLatestCreated = <T extends { created_at?: string | null }>(
  items: T[],
) =>
  [...items].sort((a, b) => {
    const bCreated = b.created_at ? new Date(b.created_at).getTime() : 0;
    const aCreated = a.created_at ? new Date(a.created_at).getTime() : 0;
    return bCreated - aCreated;
  });

export const buildSearchPlutoResults = ({
  query,
  meetings,
  entities,
}: BuildSearchPlutoResultsInput): SearchPlutoResult[] => {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return [];

  const projectResults = sortLatestCreated(
    entities.filter((entity) => entity.type === 'project'),
  ).map<SearchPlutoResult>((entity) => ({
    kind: 'project',
    id: entity.id,
    title: entity.name,
    subtitle: 'Project',
    updatedAt: entity.updated_at,
  }));

  const peopleResults = sortLatestCreated(
    entities.filter((entity) => entity.type === 'person'),
  ).map<SearchPlutoResult>((entity) => ({
    kind: 'person',
    id: entity.id,
    title: entity.name,
    subtitle: 'Person',
    updatedAt: entity.updated_at,
  }));

  const meetingResults = sortLatestCreated(
    meetings.filter((meeting) =>
      matchesQuery(
        normalizedQuery,
        meeting.title,
        meeting.enhanced_notes,
        meeting.user_notes,
      ),
    ),
  ).map<SearchPlutoResult>((meeting) => ({
    kind: 'meeting',
    id: meeting.id,
    title: meeting.title || 'Untitled Session',
    subtitle: 'Meeting',
    updatedAt: meeting.started_at || meeting.created_at,
  }));

  return [...projectResults, ...peopleResults, ...meetingResults];
};
