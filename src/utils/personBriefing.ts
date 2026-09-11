import { getCommitmentState, parseActionMetadata } from './actionCommitment';
import { isGenericSpeakerLabel } from './speakerReview';

export type PersonMeetingEvidence = 'confirmed' | 'scheduled' | 'mentioned';

export interface PersonBriefingSummary {
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
  candidateCommitmentCount: number;
  briefHeadline: string | null;
  briefStatus: string | null;
  briefUpdatedAt: string | null;
  possibleDuplicateCount: number;
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
    return role &&
      !['undefined', 'null', 'n/a', 'none', 'nobody', 'unknown'].includes(
        role.toLowerCase(),
      )
      ? role
      : 'Known from conversations';
  } catch {
    return 'Known from conversations';
  }
};

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
