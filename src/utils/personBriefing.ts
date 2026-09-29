import { getCommitmentState, parseActionMetadata } from './actionCommitment';
import { isGenericSpeakerLabel } from './speakerReview';

export type PersonMeetingEvidence = 'confirmed' | 'scheduled' | 'mentioned';

export interface PersonBriefingSummary {
  id: string;
  name: string;
  role: string;
  roleSourceMeetingId?: string | null;
  meetingCount: number;
  mentionCount: number;
  latestMeetingId: string | null;
  latestMeetingTitle: string | null;
  latestMeetingAt: string | null;
  context: string | null;
  openCommitmentCount: number;
  candidateCommitmentCount: number;
  briefHeadline: string | null;
  briefStatus: string | null;
  briefUpdatedAt: string | null;
  possibleDuplicateCount: number;
  isSelf?: boolean;
}

const NON_PERSON_LABELS = new Set([
  'i',
  'me',
  'myself',
  'none',
  'none specified',
  'omit',
  'speaker',
  'them',
  'unknown',
  'unnamed',
  'you',
]);

const normalizePersonLabel = (value: string): string =>
  value.toLowerCase().replace(/[()]/g, '').replace(/\s+/g, ' ').trim();

export const isUsablePersonName = (value: unknown): value is string => {
  if (typeof value !== 'string' || !value.trim()) return false;
  const normalized = normalizePersonLabel(value);
  return (
    !NON_PERSON_LABELS.has(normalized) &&
    !/^(?:i|me|myself|speaker|them|you) again$/.test(normalized) &&
    !isGenericSpeakerLabel(value)
  );
};

export const parsePersonRole = (metadata: unknown): string => {
  if (typeof metadata !== 'string' || !metadata)
    return 'Known from conversations';
  try {
    const value = JSON.parse(metadata) as { role?: unknown };
    if (typeof value.role !== 'string') return 'Known from conversations';
    const role = value.role.trim();
    return isUsablePersonRole(role) &&
      !['undefined', 'null', 'n/a', 'none', 'nobody', 'unknown'].includes(
        role.toLowerCase(),
      )
      ? role
      : 'Known from conversations';
  } catch {
    return 'Known from conversations';
  }
};

export const parsePersonRoleSourceMeetingId = (
  metadata: unknown,
): string | null => {
  if (typeof metadata !== 'string') return null;
  try {
    const value = JSON.parse(metadata) as { role_source_meeting_id?: unknown };
    return typeof value.role_source_meeting_id === 'string'
      ? value.role_source_meeting_id
      : null;
  } catch {
    return null;
  }
};

export const isUsablePersonRole = (role: string): boolean =>
  Boolean(
    role.trim() &&
      role.length <= 80 &&
      !/^(?:colleague|collaborator|stakeholder|participant|team member|person\b|responsible for\b)/i.test(
        role.trim(),
      ) &&
      !/\b(?:helped|worked on|working on)\b/i.test(role),
  );

export interface PersonMeetingRecord {
  id: string;
  title: string;
  started_at: string | null;
  created_at: string | null;
  duration_seconds: number | null;
  context: string | null;
}

export interface PersonBriefingMeeting extends PersonMeetingRecord {
  evidence: PersonMeetingEvidence;
}

export interface PersonActivityItem {
  text: string;
  meetingId: string;
  meetingTitle: string;
  occurredAt: string | null;
  evidence: PersonMeetingEvidence;
  source?: 'accepted_focus';
}

/** Meeting notes can describe activity, but do not establish a person's role or ownership. */
export const selectPersonActivity = (
  meetings: PersonBriefingMeeting[],
  names: string[],
  analyses: Map<string, unknown>,
  limit = 5,
  acceptedFocus: Array<{ value: string; sourceMeetingIds: string[] }> = [],
  confirmedFirstName: string | null = null,
): PersonActivityItem[] => {
  const namePrefixes = names
    .map((name) => name.trim().toLocaleLowerCase())
    .filter((name) => name.length > 2);
  const seen = new Set<string>();
  const firstNamePrefix = confirmedFirstName?.trim().toLocaleLowerCase();
  const result: PersonActivityItem[] = [];
  for (const meeting of meetings) {
    let itemsFromMeeting = 0;
    const analysis = analyses.get(meeting.id);
    if (!analysis || typeof analysis !== 'object') continue;
    const record = analysis as {
      topics?: Array<{ key_points?: Array<{ text?: unknown }> }>;
      all_action_items?: Array<{ text?: unknown }>;
    };
    const points = [
      ...(Array.isArray(record.topics)
        ? record.topics.flatMap((topic) =>
            Array.isArray(topic.key_points) ? topic.key_points : [],
          )
        : []),
      ...(Array.isArray(record.all_action_items)
        ? record.all_action_items
        : []),
    ];
    for (const point of points) {
      if (typeof point.text !== 'string') continue;
      const value = point.text.trim();
      const key = value.toLocaleLowerCase();
      if (
        value.length < 24 ||
        value.length > 300 ||
        seen.has(key) ||
        (!namePrefixes.some(
          (name) => key.startsWith(`${name} `) || key.startsWith(`${name}'s `),
        ) &&
          !(
            meeting.evidence === 'confirmed' &&
            firstNamePrefix &&
            (key.startsWith(`${firstNamePrefix} `) ||
              key.startsWith(`${firstNamePrefix}'s `))
          ))
      )
        continue;
      seen.add(key);
      result.push({
        text: value,
        meetingId: meeting.id,
        meetingTitle: meeting.title,
        occurredAt: meeting.started_at || meeting.created_at,
        evidence: meeting.evidence,
      });
      itemsFromMeeting++;
      if (itemsFromMeeting >= 2) break;
    }
  }
  for (const claim of acceptedFocus) {
    const value = claim.value.trim();
    const key = value.toLocaleLowerCase();
    const meeting = meetings.find((item) =>
      claim.sourceMeetingIds.includes(item.id),
    );
    if (
      !meeting ||
      !value ||
      seen.has(key) ||
      result.some((item) => item.meetingId === meeting.id)
    )
      continue;
    seen.add(key);
    result.push({
      text: value,
      meetingId: meeting.id,
      meetingTitle: meeting.title,
      occurredAt: meeting.started_at || meeting.created_at,
      evidence: meeting.evidence,
      source: 'accepted_focus',
    });
  }
  return result
    .sort(
      (a, b) =>
        (Date.parse(b.occurredAt || '') || 0) -
        (Date.parse(a.occurredAt || '') || 0),
    )
    .slice(0, limit);
};

export interface PersonCommitmentCandidate {
  id: string;
  name: string;
  status: 'active' | 'completed' | 'overdue' | string | null;
  due_date: string | null;
  assigned_to: string | null;
  metadata: string | null;
  updated_at: string;
  sourceMeetingTitle: string | null;
  suggested_owner_name?: string | null;
}

export interface PersonBriefingCommitment {
  id: string;
  text: string;
  status: 'active' | 'completed' | 'overdue';
  dueDate: string | null;
  evidence: string | null;
  sourceMeetingId: string;
  sourceMeetingTitle: string | null;
  updatedAt: string;
}

export interface PersonBriefingCommitmentCandidate
  extends PersonBriefingCommitment {
  suggestedOwnerName: string;
}

const meetingTime = (meeting: PersonMeetingRecord): number =>
  Date.parse(meeting.started_at || meeting.created_at || '') || 0;

export const mergePersonMeetingEvidence = (input: {
  confirmed: PersonMeetingRecord[];
  scheduled: PersonMeetingRecord[];
  mentioned: PersonMeetingRecord[];
}): PersonBriefingMeeting[] => {
  const byId = new Map<string, PersonBriefingMeeting>();
  const add = (
    meetings: PersonMeetingRecord[],
    evidence: PersonMeetingEvidence,
  ) => {
    for (const meeting of meetings)
      byId.set(meeting.id, { ...meeting, evidence });
  };
  add(input.mentioned, 'mentioned');
  add(input.scheduled, 'scheduled');
  add(input.confirmed, 'confirmed');
  return [...byId.values()].sort((a, b) => meetingTime(b) - meetingTime(a));
};

export const selectVerifiedPersonCommitments = (input: {
  personId: string;
  actions: PersonCommitmentCandidate[];
  now?: number;
  deliveryWindowDays?: number;
}): {
  open: PersonBriefingCommitment[];
  delivered: PersonBriefingCommitment[];
} => {
  const now = input.now ?? Date.now();
  const deliveryWindowMs =
    (input.deliveryWindowDays ?? 60) * 24 * 60 * 60 * 1_000;
  const verified = input.actions.flatMap((action) => {
    const metadata = parseActionMetadata(action.metadata);
    if (
      action.assigned_to !== input.personId ||
      metadata.owner_source !== 'user' ||
      getCommitmentState(action.metadata) === 'rejected' ||
      !['active', 'overdue', 'completed'].includes(action.status || '') ||
      typeof metadata.source_meeting_id !== 'string'
    ) {
      return [];
    }
    const text =
      typeof metadata.full_description === 'string'
        ? metadata.full_description
        : action.name;
    return [
      {
        id: action.id,
        text,
        status: action.status as PersonBriefingCommitment['status'],
        dueDate: action.due_date,
        evidence:
          typeof metadata.source_evidence === 'string'
            ? metadata.source_evidence
            : null,
        sourceMeetingId: metadata.source_meeting_id,
        sourceMeetingTitle: action.sourceMeetingTitle,
        updatedAt: action.updated_at,
      },
    ];
  });
  const open = verified
    .filter((item) => item.status === 'active' || item.status === 'overdue')
    .sort(
      (a, b) =>
        Number(b.status === 'overdue') - Number(a.status === 'overdue') ||
        (Date.parse(a.dueDate || '') || Number.MAX_SAFE_INTEGER) -
          (Date.parse(b.dueDate || '') || Number.MAX_SAFE_INTEGER) ||
        Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
    );
  const delivered = verified
    .filter(
      (item) =>
        item.status === 'completed' &&
        Number.isFinite(Date.parse(item.updatedAt)) &&
        now - Date.parse(item.updatedAt) <= deliveryWindowMs,
    )
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  return { open, delivered };
};

export const selectCandidatePersonCommitments = (input: {
  personNames: string[];
  actions: PersonCommitmentCandidate[];
}): PersonBriefingCommitmentCandidate[] => {
  const personNames = new Set(
    input.personNames.map(normalizePersonLabel).filter(Boolean),
  );
  return input.actions
    .flatMap((action) => {
      const metadata = parseActionMetadata(action.metadata);
      const suggestedOwnerName =
        typeof action.suggested_owner_name === 'string' &&
        action.suggested_owner_name.trim()
          ? action.suggested_owner_name.trim()
          : typeof metadata.assignee_name === 'string'
            ? metadata.assignee_name.trim()
            : '';
      if (
        action.assigned_to !== null ||
        metadata.owner_source === 'user' ||
        getCommitmentState(action.metadata) === 'rejected' ||
        !['active', 'overdue'].includes(action.status || '') ||
        typeof metadata.source_meeting_id !== 'string' ||
        !suggestedOwnerName ||
        !personNames.has(normalizePersonLabel(suggestedOwnerName))
      ) {
        return [];
      }
      return [
        {
          id: action.id,
          text:
            typeof metadata.full_description === 'string'
              ? metadata.full_description
              : action.name,
          status: action.status as PersonBriefingCommitment['status'],
          dueDate: action.due_date,
          evidence:
            typeof metadata.source_evidence === 'string'
              ? metadata.source_evidence
              : null,
          sourceMeetingId: metadata.source_meeting_id,
          sourceMeetingTitle: action.sourceMeetingTitle,
          updatedAt: action.updated_at,
          suggestedOwnerName,
        },
      ];
    })
    .sort(
      (a, b) =>
        Number(b.status === 'overdue') - Number(a.status === 'overdue') ||
        (Date.parse(a.dueDate || '') || Number.MAX_SAFE_INTEGER) -
          (Date.parse(b.dueDate || '') || Number.MAX_SAFE_INTEGER) ||
        Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
    );
};

export const selectPersonCommitments = (input: {
  personId: string;
  personNames?: string[];
  actions: PersonCommitmentCandidate[];
  candidateActions?: PersonCommitmentCandidate[];
  isSelf: boolean;
  now?: number;
  deliveryWindowDays?: number;
}): {
  open: PersonBriefingCommitment[];
  delivered: PersonBriefingCommitment[];
  candidates: PersonBriefingCommitmentCandidate[];
} => {
  if (input.isSelf) {
    const { open, delivered } = selectVerifiedPersonCommitments({
      personId: input.personId,
      actions: input.actions,
      now: input.now,
      deliveryWindowDays: input.deliveryWindowDays,
    });
    const candidates = selectCandidatePersonCommitments({
      personNames: input.personNames ?? [],
      actions: input.candidateActions ?? [],
    });
    return { open, delivered, candidates };
  }

  // Non-self individuals: automatically promote candidate commitments from notes into active commitments
  const now = input.now ?? Date.now();
  const deliveryWindowMs =
    (input.deliveryWindowDays ?? 60) * 24 * 60 * 60 * 1_000;
  const personNames = new Set(
    (input.personNames ?? []).map(normalizePersonLabel).filter(Boolean),
  );

  const seenIds = new Set<string>();
  const allCommitments: PersonBriefingCommitment[] = [];

  const toCommitment = (
    action: PersonCommitmentCandidate,
  ): PersonBriefingCommitment | null => {
    if (seenIds.has(action.id)) return null;
    const metadata = parseActionMetadata(action.metadata);
    if (
      getCommitmentState(action.metadata) === 'rejected' ||
      !['active', 'overdue', 'completed'].includes(action.status || '') ||
      typeof metadata.source_meeting_id !== 'string'
    ) {
      return null;
    }
    seenIds.add(action.id);
    const text =
      typeof metadata.full_description === 'string'
        ? metadata.full_description
        : action.name;
    return {
      id: action.id,
      text,
      status: action.status as PersonBriefingCommitment['status'],
      dueDate: action.due_date,
      evidence:
        typeof metadata.source_evidence === 'string'
          ? metadata.source_evidence
          : null,
      sourceMeetingId: metadata.source_meeting_id,
      sourceMeetingTitle: action.sourceMeetingTitle,
      updatedAt: action.updated_at,
    };
  };

  // 1. Process actions explicitly assigned to this person
  for (const action of input.actions) {
    if (action.assigned_to === input.personId) {
      const commitment = toCommitment(action);
      if (commitment) allCommitments.push(commitment);
    }
  }

  // 2. Process candidate actions matching person name or bound speaker
  for (const action of input.candidateActions ?? []) {
    const metadata = parseActionMetadata(action.metadata);
    const suggestedOwnerName =
      typeof action.suggested_owner_name === 'string' &&
      action.suggested_owner_name.trim()
        ? action.suggested_owner_name.trim()
        : typeof metadata.assignee_name === 'string'
          ? metadata.assignee_name.trim()
          : '';
    if (
      suggestedOwnerName &&
      personNames.has(normalizePersonLabel(suggestedOwnerName))
    ) {
      const commitment = toCommitment(action);
      if (commitment) allCommitments.push(commitment);
    }
  }

  const open = allCommitments
    .filter((item) => item.status === 'active' || item.status === 'overdue')
    .sort(
      (a, b) =>
        Number(b.status === 'overdue') - Number(a.status === 'overdue') ||
        (Date.parse(a.dueDate || '') || Number.MAX_SAFE_INTEGER) -
          (Date.parse(b.dueDate || '') || Number.MAX_SAFE_INTEGER) ||
        Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
    );
  const delivered = allCommitments
    .filter(
      (item) =>
        item.status === 'completed' &&
        Number.isFinite(Date.parse(item.updatedAt)) &&
        now - Date.parse(item.updatedAt) <= deliveryWindowMs,
    )
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));

  return { open, delivered, candidates: [] };
};
