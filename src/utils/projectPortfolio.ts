import type { Entity } from '../api/knowledgeGraph';
import type { ProjectHealthState } from './projectBriefing';
import { readProjectQualification } from './projectQualification';

export interface ProjectPortfolioEntry extends Entity {
  meeting_count: number;
  last_mentioned_at: string | null;
  latest_context: string | null;
  display_title?: string;
  health_state?: ProjectHealthState;
  health_headline?: string;
  health_summary?: string;
  typical_participant_count?: number | null;
  participant_coverage?: number;
  recurring_cadence?: string | null;
  next_milestone?: string | null;
}

export function buildProjectPortfolio(
  entries: ProjectPortfolioEntry[],
  search = '',
) {
  const query = search.trim().toLocaleLowerCase();
  const current: ProjectPortfolioEntry[] = [];
  const completed: ProjectPortfolioEntry[] = [];
  const other: ProjectPortfolioEntry[] = [];
  const ordered = [...entries].sort(
    (a, b) =>
      (Date.parse(b.last_mentioned_at || b.updated_at) || 0) -
        (Date.parse(a.last_mentioned_at || a.updated_at) || 0) ||
      a.name.localeCompare(b.name),
  );
  for (const entry of ordered) {
    const qualification = readProjectQualification(entry.metadata);
    if (
      query &&
      ![
        entry.name,
        entry.display_title,
        entry.latest_context,
        qualification?.outcome,
      ].some((value) => value?.toLocaleLowerCase().includes(query))
    )
      continue;
    if (qualification?.state !== 'qualified') other.push(entry);
    else if (entry.status === 'completed') completed.push(entry);
    else current.push(entry);
  }
  return { current, completed, other };
}
