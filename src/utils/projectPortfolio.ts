import type { Entity } from '../api/knowledgeGraph';
import type { ProjectHealthState } from './projectBriefing';
import {
  readProjectPortfolioDisposition,
  readProjectQualification,
} from './projectQualification';

export type ProjectActivityState = 'active' | 'dormant' | 'stale';

export type ProjectCadence =
  | 'weekly'
  | 'biweekly'
  | 'monthly'
  | 'quarterly'
  | 'adhoc';

export function readProjectCadence(metadata: unknown): ProjectCadence | null {
  try {
    const parsed =
      typeof metadata === 'string' ? JSON.parse(metadata) : metadata;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const val = (parsed as Record<string, unknown>).projectCadence;
      if (
        val === 'weekly' ||
        val === 'biweekly' ||
        val === 'monthly' ||
        val === 'quarterly' ||
        val === 'adhoc'
      ) {
        return val;
      }
    }
  } catch {
    // fallback
  }
  return null;
}

export function withProjectCadence(
  metadata: string | null | undefined,
  cadence: ProjectCadence | null,
): string {
  let parsed: Record<string, unknown> = {};
  try {
    if (metadata) {
      const p = typeof metadata === 'string' ? JSON.parse(metadata) : metadata;
      if (p && typeof p === 'object' && !Array.isArray(p)) {
        parsed = p as Record<string, unknown>;
      }
    }
  } catch {
    parsed = {};
  }
  if (cadence) {
    parsed.projectCadence = cadence;
  } else {
    parsed.projectCadence = undefined;
  }
  return JSON.stringify(parsed);
}

export function getProjectActivityState(
  lastMentionedAt: string | null | undefined,
  now = Date.now(),
  cadence?: ProjectCadence | null,
): {
  state: ProjectActivityState;
  daysSinceActivity: number | null;
  label: string;
} {
  if (!lastMentionedAt) {
    return { state: 'dormant', daysSinceActivity: null, label: 'No recent activity' };
  }
  const time = Date.parse(lastMentionedAt);
  if (Number.isNaN(time)) {
    return { state: 'dormant', daysSinceActivity: null, label: 'No recent activity' };
  }
  const diffDays = Math.max(0, Math.floor((now - time) / (1000 * 60 * 60 * 24)));

  let activeThreshold = 30;
  let dormantThreshold = 60;

  if (cadence === 'weekly') {
    activeThreshold = 14;
    dormantThreshold = 28;
  } else if (cadence === 'biweekly') {
    activeThreshold = 28;
    dormantThreshold = 56;
  } else if (cadence === 'monthly') {
    activeThreshold = 60;
    dormantThreshold = 120;
  } else if (cadence === 'quarterly') {
    activeThreshold = 120;
    dormantThreshold = 240;
  }

  if (diffDays <= activeThreshold) {
    if (diffDays <= 1) {
      return {
        state: 'active',
        daysSinceActivity: diffDays,
        label: diffDays === 0 ? 'Active today' : 'Active yesterday',
      };
    }
    if (diffDays < 7) {
      return {
        state: 'active',
        daysSinceActivity: diffDays,
        label: `Active ${diffDays}d ago`,
      };
    }
    const weeks = Math.max(1, Math.round(diffDays / 7));
    return {
      state: 'active',
      daysSinceActivity: diffDays,
      label: `Active ${weeks}w ago`,
    };
  }
  if (diffDays <= dormantThreshold) {
    const weeks = Math.round(diffDays / 7);
    return {
      state: 'dormant',
      daysSinceActivity: diffDays,
      label: `Inactive for ${weeks} weeks`,
    };
  }
  const months = Math.max(2, Math.round(diffDays / 30));
  return {
    state: 'stale',
    daysSinceActivity: diffDays,
    label: `Dormant · ${months} months ago`,
  };
}

export interface ProjectPortfolioEntry extends Entity {
  meeting_count: number;
  last_mentioned_at: string | null;
  latest_context: string | null;
  display_title?: string;
  cadence?: ProjectCadence | null;
  health_state?: ProjectHealthState;
  health_headline?: string;
  health_summary?: string;
  typical_participant_count?: number | null;
  participant_coverage?: number;
  recurring_cadence?: string | null;
  next_milestone?: string | null;
  current_focus?: string | null;
  recent_change?: string | null;
  open_thread_count?: number;
  activity_state?: ProjectActivityState;
  days_since_activity?: number | null;
  activity_label?: string;
}

export function isProjectStarred(metadata: unknown): boolean {
  try {
    const parsed =
      typeof metadata === 'string' ? JSON.parse(metadata) : metadata;
    return Boolean(
      parsed &&
        typeof parsed === 'object' &&
        !Array.isArray(parsed) &&
        (parsed as Record<string, unknown>).projectStarred,
    );
  } catch {
    return false;
  }
}

export interface ProjectPortfolioResult {
  current: ProjectPortfolioEntry[];
  starred: ProjectPortfolioEntry[];
  side: ProjectPortfolioEntry[];
  activeSide: ProjectPortfolioEntry[];
  dormant: ProjectPortfolioEntry[];
  completed: ProjectPortfolioEntry[];
  suggested: ProjectPortfolioEntry[];
  other: ProjectPortfolioEntry[];
  dismissed: ProjectPortfolioEntry[];
  /** Unfiled topic streams waiting for triage or reference */
  radarTopics: ProjectPortfolioEntry[];
  /** Topics filed under parent initiatives */
  initiativeTopics: Record<string, ProjectPortfolioEntry[]>;
}

export function buildProjectPortfolio(
  entries: ProjectPortfolioEntry[],
  search = '',
  now = Date.now(),
): ProjectPortfolioResult {
  const query = search.trim().toLocaleLowerCase();
  const current: ProjectPortfolioEntry[] = [];
  const starred: ProjectPortfolioEntry[] = [];
  const side: ProjectPortfolioEntry[] = [];
  const activeSide: ProjectPortfolioEntry[] = [];
  const dormant: ProjectPortfolioEntry[] = [];
  const completed: ProjectPortfolioEntry[] = [];
  const suggested: ProjectPortfolioEntry[] = [];
  const other: ProjectPortfolioEntry[] = [];
  const dismissed: ProjectPortfolioEntry[] = [];
  const radarTopics: ProjectPortfolioEntry[] = [];
  const initiativeTopics: Record<string, ProjectPortfolioEntry[]> = {};

  const ordered = [...entries].sort(
    (a, b) =>
      (Date.parse(b.last_mentioned_at || b.updated_at) || 0) -
        (Date.parse(a.last_mentioned_at || a.updated_at) || 0) ||
      a.name.localeCompare(b.name),
  );
  for (const entry of ordered) {
    const qualification = readProjectQualification(entry.metadata);
    const disposition = readProjectPortfolioDisposition(entry.metadata);
    let metadata: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(entry.metadata || '{}');
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
        metadata = parsed;
    } catch {
      metadata = {};
    }
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

    const cadence = readProjectCadence(entry.metadata);
    const activity = getProjectActivityState(
      entry.last_mentioned_at || entry.updated_at,
      now,
      cadence,
    );
    const enrichedEntry: ProjectPortfolioEntry = {
      ...entry,
      cadence,
      activity_state: activity.state,
      days_since_activity: activity.daysSinceActivity,
      activity_label: activity.label,
    };

    // Check if filed under a parent initiative
    const parentId = qualification?.parentProjectId;
    if (parentId) {
      if (!initiativeTopics[parentId]) initiativeTopics[parentId] = [];
      initiativeTopics[parentId].push(enrichedEntry);
      other.push(enrichedEntry);
      continue;
    }

    const legacySingleSource =
      qualification?.state === 'qualified' &&
      qualification.source !== 'user' &&
      Boolean(metadata.projectInitiativeDiscovery) &&
      !metadata.projectThemeSynthesis &&
      entry.meeting_count < 2;

    if (disposition === 'dismissed') {
      dismissed.push(enrichedEntry);
    } else if (legacySingleSource) {
      suggested.push(enrichedEntry);
      radarTopics.push(enrichedEntry);
    } else if (qualification?.state !== 'qualified') {
      other.push(enrichedEntry);
      radarTopics.push(enrichedEntry);
    } else if (entry.status === 'completed') {
      completed.push(enrichedEntry);
    } else {
      current.push(enrichedEntry);
      if (isProjectStarred(enrichedEntry.metadata)) {
        starred.push(enrichedEntry);
      } else {
        side.push(enrichedEntry);
        if (activity.state === 'active') {
          activeSide.push(enrichedEntry);
        } else {
          dormant.push(enrichedEntry);
        }
      }
    }
  }
  return {
    current,
    starred,
    side,
    activeSide,
    dormant,
    completed,
    suggested,
    other,
    dismissed,
    radarTopics,
    initiativeTopics,
  };
}
