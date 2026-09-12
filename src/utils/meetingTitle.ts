const GENERIC_MEETING_TITLES = [
  '',
  'meeting',
  'new meeting',
  'meeting (mic only)',
  'recovered recording',
  'untitled meeting',
  'untitled session',
] as const;

const genericMeetingTitles = new Set<string>(GENERIC_MEETING_TITLES);

export const meetingTitleNeedsGeneration = (
  title: string | null | undefined,
): boolean => genericMeetingTitles.has((title || '').trim().toLowerCase());
