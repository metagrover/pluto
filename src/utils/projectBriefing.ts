import {
  type UserProjectMilestoneStatus,
  readUserProjectMilestones,
} from './projectMilestones';

export interface ProjectBriefingParticipant {
  entity_id: string;
  name: string;
}

export interface ProjectBriefingMeeting {
  id: string;
  title: string;
  started_at: string | null;
  created_at: string | null;
  participants?: ProjectBriefingParticipant[];
}

export interface ProjectMeetingStats {
  meetingCount: number;
  activeWeeks: number | null;
  participantCoverage: number;
  typicalParticipantCount: number | null;
  frequentParticipants: string[];
  recurringSeries: Array<{
    key: string;
    title: string;
    meetingCount: number;
    cadence: string;
    typicalParticipantCount: number | null;
    lastMetAt: string | null;
    meetingIds: string[];
  }>;
}

export interface ProjectMomentum {
  recentMeetingCount: number;
  openCommitmentCount: number;
  completedCommitmentCount: number;
  recentlyCompletedCount: number;
  lastActivityAt: string | null;
  headline:
    | 'Recent activity and completed work'
    | 'Recent project activity'
    | 'Completed work recorded'
    | 'No recent project activity recorded'
    | 'Not enough evidence for a trend';
}

export interface ProjectBriefingTask {
  id: string;
  name: string;
  status: string | null;
  due_date: string | null;
  updated_at: string;
  metadata: string | null;
}

export interface ProjectBriefingSnapshot {
  freshness?: string;
  generated_at?: string;
  payload?: {
    current_read?: {
      headline?: string;
      supporting_bullets?: string[];
      cited_meeting_count?: number;
      trust_message?: string;
    };
    needs_attention?: unknown[];
    open_loops?: unknown[];
    risks_and_unknowns?: unknown[];
  };
}

export type ProjectHealthState =
  | 'appears_on_track'
  | 'watch'
  | 'falling_behind'
  | 'not_enough_evidence';

export interface ProjectHealthRead {
  state: ProjectHealthState;
  headline: string;
  summary: string;
  updatedAt: string | null;
  freshness: string;
  evidenceTaskIds: string[];
}

export interface ProjectMilestone {
  id: string;
  title: string;
  status: 'complete' | 'overdue' | 'upcoming' | 'in_progress' | 'planned';
  timing: string | null;
  evidenceQuote: string | null;
  source: 'user' | 'commitment';
  userStatus?: UserProjectMilestoneStatus;
  targetDate: string | null;
  note: string | null;
}

export interface ProjectThemeSynthesisRead {
  version: 1;
  sourceMeetingIds: string[];
  candidateProjectIds: string[];
  outcome: string;
  currentFocus: string;
  recentChanges: Array<{
    sourceMeetingId: string;
    summary: string;
    evidenceQuote: string;
  }>;
  openThreads: Array<{
    sourceMeetingId: string;
    kind: 'decision' | 'action' | 'question' | 'risk';
    text: string;
    evidenceQuote: string;
  }>;
  synthesizedAt: string;
}

export interface ProjectBrief {
  project: {
    id: string;
    displayTitle: string;
    detectedTitle: string;
    metadata: string | null;
    status: string | null;
  };
  theme: ProjectThemeSynthesisRead | null;
  meetingStats: ProjectMeetingStats;
  momentum: ProjectMomentum;
  health: ProjectHealthRead;
  milestones: ProjectMilestone[];
  meetings: Array<
    ProjectBriefingMeeting & {
      meeting_type?: string | null;
      duration_seconds?: number | null;
      mention_count?: number;
      context?: string | null;
    }
  >;
  tasks: ProjectBriefingTask[];
  mergedProjects: Array<{ id: string; name: string; mergedAt: string }>;
}

const parseMetadata = (metadata: string | null): Record<string, unknown> => {
  if (!metadata) return {};
  try {
    const parsed = JSON.parse(metadata);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
};

export const readProjectThemeSynthesis = (
  metadata: string | null,
): ProjectThemeSynthesisRead | null => {
  const theme = parseMetadata(metadata).projectThemeSynthesis;
  if (!theme || typeof theme !== 'object' || Array.isArray(theme)) return null;
  const value = theme as Record<string, unknown>;
  if (
    value.version !== 1 ||
    !Array.isArray(value.sourceMeetingIds) ||
    !value.sourceMeetingIds.every((id) => typeof id === 'string') ||
    !Array.isArray(value.candidateProjectIds) ||
    !value.candidateProjectIds.every((id) => typeof id === 'string') ||
    typeof value.outcome !== 'string' ||
    typeof value.currentFocus !== 'string' ||
    !Array.isArray(value.recentChanges) ||
    !Array.isArray(value.openThreads) ||
    typeof value.synthesizedAt !== 'string'
  )
    return null;
  return value as unknown as ProjectThemeSynthesisRead;
};

export const readProjectDisplayTitle = (
  metadata: string | null,
  detectedTitle: string,
): string => {
  const title = parseMetadata(metadata).projectDisplayTitle;
  return typeof title === 'string' && title.trim()
    ? title.trim()
    : compactProjectTitle(detectedTitle);
};

const compactProjectTitle = (detectedTitle: string): string => {
  const words = detectedTitle.trim().split(/\s+/);
  while (
    words.length > 1 &&
    /^(?:build|building|create|creating|develop|developing|implement|implementing|launch|launching|make|making|the)$/i.test(
      words[0],
    )
  )
    words.shift();
  while (
    words.length > 1 &&
    /^(?:initiative|project|program)$/i.test(words.at(-1) ?? '')
  )
    words.pop();
  const compact = words.slice(0, 6);
  while (
    compact.length > 1 &&
    /^(?:and|for|of|to|with)$/i.test(compact.at(-1) ?? '')
  )
    compact.pop();
  const result = compact.join(' ') || detectedTitle.trim();
  return result.replace(/^./u, (character) => character.toLocaleUpperCase());
};

export const withProjectDisplayTitle = (
  metadata: string | null,
  title: string,
): string =>
  JSON.stringify({
    ...parseMetadata(metadata),
    projectDisplayTitle: title.trim(),
    projectDisplayTitleSource: 'user',
    projectDisplayTitleUpdatedAt: new Date().toISOString(),
  });

const dateValue = (value: string | null | undefined): number | null => {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isNaN(parsed) ? null : parsed;
};

const median = (values: number[]): number | null => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
};

const seriesKey = (title: string): string =>
  title
    .toLocaleLowerCase()
    .replace(
      /\b(?:mon|tue|wed|thu|fri|sat|sun)(?:day)?\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b|\b\d{1,4}\b/gi,
      ' ',
    )
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');

const cadenceLabel = (days: number): string => {
  if (days >= 5 && days <= 9) return 'Weekly pattern';
  if (days >= 10 && days <= 18) return 'Every two weeks';
  if (days >= 24 && days <= 38) return 'Monthly pattern';
  return 'Recurring pattern';
};

const trustedParticipants = (
  meeting: ProjectBriefingMeeting,
): ProjectBriefingParticipant[] =>
  (meeting.participants ?? []).filter(
    (participant) =>
      participant.name.trim() &&
      !participant.entity_id.toLocaleLowerCase().startsWith('speaker:'),
  );

export const buildProjectMeetingStats = (
  meetings: ProjectBriefingMeeting[],
): ProjectMeetingStats => {
  const dates = meetings
    .map((meeting) => dateValue(meeting.started_at ?? meeting.created_at))
    .filter((value): value is number => value !== null)
    .sort((a, b) => a - b);
  const rooms = meetings
    .map(trustedParticipants)
    .filter((participants) => participants.length > 0);
  const participantFrequency = new Map<
    string,
    { name: string; count: number }
  >();
  for (const participants of rooms) {
    for (const participant of participants) {
      const key = participant.entity_id || participant.name.toLocaleLowerCase();
      const current = participantFrequency.get(key);
      participantFrequency.set(key, {
        name: participant.name,
        count: (current?.count ?? 0) + 1,
      });
    }
  }

  const groups = new Map<string, ProjectBriefingMeeting[]>();
  for (const meeting of meetings) {
    const key = seriesKey(meeting.title);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), meeting]);
  }
  const recurringSeries = [...groups.entries()].flatMap(([key, group]) => {
    if (group.length < 3) return [];
    const ordered = [...group].sort(
      (left, right) =>
        (dateValue(left.started_at ?? left.created_at) ?? 0) -
        (dateValue(right.started_at ?? right.created_at) ?? 0),
    );
    const intervals = ordered.slice(1).map((meeting, index) => {
      const previous = dateValue(
        ordered[index].started_at ?? ordered[index].created_at,
      );
      const current = dateValue(meeting.started_at ?? meeting.created_at);
      return previous === null || current === null
        ? Number.NaN
        : (current - previous) / 86_400_000;
    });
    const validIntervals = intervals.filter((value) => Number.isFinite(value));
    const cadenceDays = median(validIntervals);
    if (cadenceDays === null || cadenceDays <= 0) return [];
    const tolerance = Math.max(2, cadenceDays * 0.4);
    if (
      validIntervals.filter(
        (interval) => Math.abs(interval - cadenceDays) <= tolerance,
      ).length < Math.ceil(validIntervals.length * 0.66)
    )
      return [];
    const participantCounts = group
      .map(trustedParticipants)
      .filter((participants) => participants.length > 0)
      .map((participants) => participants.length);
    const last = ordered.at(-1);
    return [
      {
        key,
        title: last?.title || group[0].title,
        meetingCount: group.length,
        cadence: cadenceLabel(cadenceDays),
        typicalParticipantCount: median(participantCounts),
        lastMetAt: last?.started_at ?? last?.created_at ?? null,
        meetingIds: ordered.map((meeting) => meeting.id),
      },
    ];
  });

  return {
    meetingCount: meetings.length,
    activeWeeks:
      dates.length > 1
        ? Math.max(1, Math.ceil((dates.at(-1)! - dates[0]) / 604_800_000))
        : dates.length
          ? 1
          : null,
    participantCoverage: rooms.length,
    typicalParticipantCount: median(
      rooms.map((participants) => participants.length),
    ),
    frequentParticipants: [...participantFrequency.values()]
      .sort(
        (left, right) =>
          right.count - left.count || left.name.localeCompare(right.name),
      )
      .slice(0, 3)
      .map((participant) => participant.name),
    recurringSeries: recurringSeries.sort(
      (left, right) => right.meetingCount - left.meetingCount,
    ),
  };
};

export const buildProjectMomentum = (
  meetings: ProjectBriefingMeeting[],
  tasks: ProjectBriefingTask[],
  now = Date.now(),
): ProjectMomentum => {
  const recentBoundary = now - 30 * 86_400_000;
  const recentMeetingCount = meetings.filter(
    (meeting) =>
      (dateValue(meeting.started_at ?? meeting.created_at) ?? 0) >=
      recentBoundary,
  ).length;
  const completed = tasks.filter((task) => task.status === 'completed');
  const recentlyCompletedCount = completed.filter(
    (task) => (dateValue(task.updated_at) ?? 0) >= recentBoundary,
  ).length;
  const activity = [
    ...meetings.map((meeting) => meeting.started_at ?? meeting.created_at),
    ...tasks.map((task) => task.updated_at),
  ]
    .map((value) => ({ value, timestamp: dateValue(value) }))
    .filter(
      (entry): entry is { value: string; timestamp: number } =>
        Boolean(entry.value) && entry.timestamp !== null,
    )
    .sort((left, right) => right.timestamp - left.timestamp);
  const hasEvidence = meetings.length > 0 || tasks.length > 0;
  const headline: ProjectMomentum['headline'] =
    recentMeetingCount > 0 && recentlyCompletedCount > 0
      ? 'Recent activity and completed work'
      : recentMeetingCount > 0
        ? 'Recent project activity'
        : recentlyCompletedCount > 0
          ? 'Completed work recorded'
          : hasEvidence
            ? 'No recent project activity recorded'
            : 'Not enough evidence for a trend';
  return {
    recentMeetingCount,
    openCommitmentCount: tasks.length - completed.length,
    completedCommitmentCount: completed.length,
    recentlyCompletedCount,
    lastActivityAt: activity[0]?.value ?? null,
    headline,
  };
};

const formatTiming = (value: string | null): string | null => {
  const timestamp = dateValue(value);
  return timestamp === null
    ? null
    : new Date(timestamp).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
      });
};

const evidenceQuote = (metadata: string | null): string | null => {
  const parsed = parseMetadata(metadata);
  for (const key of ['evidence_quote', 'evidence', 'source_quote']) {
    const value = parsed[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
};

export const buildProjectMilestones = (
  tasks: ProjectBriefingTask[],
  now = Date.now(),
): ProjectMilestone[] =>
  tasks
    .filter((task) => task.status === 'completed' || Boolean(task.due_date))
    .map((task) => {
      const dueAt = dateValue(task.due_date);
      const status: ProjectMilestone['status'] =
        task.status === 'completed'
          ? 'complete'
          : dueAt !== null && dueAt < now
            ? 'overdue'
            : dueAt !== null && dueAt - now <= 14 * 86_400_000
              ? 'upcoming'
              : 'in_progress';
      return {
        id: task.id,
        title: task.name,
        status,
        timing: formatTiming(task.due_date),
        evidenceQuote: evidenceQuote(task.metadata),
        source: 'commitment' as const,
        targetDate: task.due_date,
        note: null,
      };
    })
    .sort((left, right) => {
      const priority = {
        overdue: 0,
        upcoming: 1,
        in_progress: 2,
        planned: 3,
        complete: 4,
      };
      return priority[left.status] - priority[right.status];
    });

export const buildUserProjectMilestones = (
  metadata: string | null,
  now = Date.now(),
): ProjectMilestone[] =>
  readUserProjectMilestones(metadata).map((milestone) => {
    const dueAt = milestone.targetDate
      ? dateValue(`${milestone.targetDate}T23:59:59.999Z`)
      : null;
    const status: ProjectMilestone['status'] =
      milestone.status === 'completed'
        ? 'complete'
        : dueAt !== null && dueAt < now
          ? 'overdue'
          : dueAt !== null && dueAt - now <= 14 * 86_400_000
            ? 'upcoming'
            : milestone.status;
    return {
      id: milestone.id,
      title: milestone.title,
      status,
      timing: formatTiming(milestone.targetDate),
      evidenceQuote: null,
      source: 'user',
      userStatus: milestone.status,
      targetDate: milestone.targetDate,
      note: milestone.note,
    };
  });

export const sortProjectMilestones = (
  milestones: ProjectMilestone[],
): ProjectMilestone[] => {
  const priority: Record<ProjectMilestone['status'], number> = {
    overdue: 0,
    upcoming: 1,
    in_progress: 2,
    planned: 3,
    complete: 4,
  };
  return [...milestones].sort(
    (left, right) => priority[left.status] - priority[right.status],
  );
};

export const buildProjectHealth = (
  tasks: ProjectBriefingTask[],
  snapshot?: ProjectBriefingSnapshot,
  now = Date.now(),
): ProjectHealthRead => {
  const overdue = tasks.filter((task) => {
    const dueAt = dateValue(task.due_date);
    return (
      task.status === 'overdue' ||
      (task.status !== 'completed' && dueAt !== null && dueAt < now)
    );
  });
  const upcoming = tasks.filter((task) => {
    const dueAt = dateValue(task.due_date);
    return (
      task.status !== 'completed' &&
      dueAt !== null &&
      dueAt >= now &&
      dueAt - now <= 14 * 86_400_000
    );
  });
  const recentCompleted = tasks.filter(
    (task) =>
      task.status === 'completed' &&
      (dateValue(task.updated_at) ?? 0) >= now - 30 * 86_400_000,
  );
  const snapshotRead = snapshot?.payload?.current_read;
  const snapshotSummary = [
    snapshotRead?.headline,
    ...(snapshotRead?.supporting_bullets ?? []),
  ]
    .filter((value): value is string => Boolean(value?.trim()))
    .join(' ');
  const snapshotAttention = [
    ...(snapshot?.payload?.needs_attention ?? []),
    ...(snapshot?.payload?.open_loops ?? []),
    ...(snapshot?.payload?.risks_and_unknowns ?? []),
  ].filter(
    (item): item is Record<string, unknown> =>
      Boolean(item) && typeof item === 'object' && !Array.isArray(item),
  );
  const citedAttention = snapshotAttention.filter((item) => {
    const citations = item.citations;
    return Array.isArray(citations) && citations.length > 0;
  });
  const common = {
    updatedAt: snapshot?.generated_at ?? null,
    freshness: snapshot?.freshness ?? 'unknown',
  };

  if (overdue.length > 0)
    return {
      ...common,
      state: 'falling_behind',
      headline: 'Falling behind',
      summary: `${overdue.length} confirmed milestone${overdue.length === 1 ? '' : 's'} or commitment${overdue.length === 1 ? ' is' : 's are'} overdue.`,
      evidenceTaskIds: overdue.map((task) => task.id),
    };
  if (upcoming.length > 0)
    return {
      ...common,
      state: 'watch',
      headline: 'Watch',
      summary: `${upcoming.length} confirmed milestone${upcoming.length === 1 ? '' : 's'} or commitment${upcoming.length === 1 ? ' is' : 's are'} due within two weeks.`,
      evidenceTaskIds: upcoming.map((task) => task.id),
    };
  if (citedAttention.length > 0)
    return {
      ...common,
      state: 'watch',
      headline: 'Watch',
      summary:
        snapshotSummary ||
        `${citedAttention.length} source-backed risk${citedAttention.length === 1 ? ' needs' : 's need'} attention.`,
      evidenceTaskIds: [],
    };
  if (recentCompleted.length > 0)
    return {
      ...common,
      state: 'appears_on_track',
      headline: 'Appears on track',
      summary:
        snapshotSummary ||
        `${recentCompleted.length} confirmed milestone${recentCompleted.length === 1 ? '' : 's'} or commitment${recentCompleted.length === 1 ? ' was' : 's were'} completed recently, with no recorded overdue work.`,
      evidenceTaskIds: recentCompleted.map((task) => task.id),
    };
  return {
    ...common,
    state: 'not_enough_evidence',
    headline: 'Not enough evidence',
    summary:
      snapshotSummary ||
      'Pluto has not found enough dated progress or blocker evidence to assess this project.',
    evidenceTaskIds: [],
  };
};
