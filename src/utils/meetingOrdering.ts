import type { Meeting } from '../types';

export const meetingTimestamp = (
  meeting: Pick<Meeting, 'started_at' | 'created_at'>,
) => {
  const timestamp = Date.parse(meeting.started_at || meeting.created_at);
  return Number.isFinite(timestamp) ? timestamp : 0;
};

export const sortMeetingsByStartTime = <
  T extends Pick<Meeting, 'started_at' | 'created_at'>,
>(
  meetings: readonly T[],
): T[] =>
  [...meetings].sort((a, b) => meetingTimestamp(b) - meetingTimestamp(a));
