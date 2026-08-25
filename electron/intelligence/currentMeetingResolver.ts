export interface CurrentMeetingCandidate {
  id: string | number;
  started_at?: string | null;
  created_at?: string | null;
}

export type ResolvedCurrentMeeting =
  | { kind: 'active_recording'; meetingId: string }
  | { kind: 'persisted'; meetingId: string }
  | { kind: 'none'; meetingId: null };

export const queryReferencesCurrentMeeting = (query: string): boolean =>
  /\b(current|latest|this)\s+meeting\b|\bcurrent recording\b|\blatest one\b/i.test(
    query,
  );

const meetingTime = (meeting: CurrentMeetingCandidate): number => {
  const value = meeting.started_at || meeting.created_at;
  if (!value) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
};

export const resolveCurrentMeeting = ({
  activeRecordingMeetingId,
  meetings,
}: {
  activeRecordingMeetingId?: string | null;
  meetings: CurrentMeetingCandidate[];
}): ResolvedCurrentMeeting => {
  const activeId = activeRecordingMeetingId?.trim();
  if (activeId) {
    return { kind: 'active_recording', meetingId: activeId };
  }

  const latest = [...meetings].sort((left, right) => {
    const timeDifference = meetingTime(right) - meetingTime(left);
    if (timeDifference !== 0) return timeDifference;
    return String(right.id).localeCompare(String(left.id));
  })[0];

  return latest
    ? { kind: 'persisted', meetingId: String(latest.id) }
    : { kind: 'none', meetingId: null };
};
