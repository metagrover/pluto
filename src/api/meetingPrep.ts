import type { CalendarEvent } from '../../electron/calendar/types';
import type {
  MeetingPrep,
  PrepMeetingOption,
} from '../../electron/meetingPrep';
const invoke = <T>(channel: string, ...args: unknown[]) =>
  window.ipcRenderer.invoke(channel, ...args) as Promise<T>;
export const openMeetingPrep = (event: CalendarEvent) =>
  invoke<MeetingPrep>('MEETING_PREP_OPEN', event);
export const getMeetingPrep = (key: string) =>
  invoke<MeetingPrep | null>('MEETING_PREP_GET', key);
export const getPrepForMeeting = (id: string) =>
  invoke<MeetingPrep | null>('MEETING_PREP_FOR_MEETING', id);
export const listPrepTopics = () =>
  invoke<Array<{ id: string; name: string }>>('MEETING_PREP_TOPICS');
export const listPrepMeetings = (query = '', occurrenceKey?: string) =>
  invoke<PrepMeetingOption[]>('MEETING_PREP_MEETINGS', {
    query,
    occurrenceKey,
  });
export const saveMeetingPrep = (
  prep: MeetingPrep,
  patch:
    | { notes: string }
    | { addTopicId: string }
    | { removeTopicId: string }
    | { refreshTopicId: string }
    | { meetingIds: string[] }
    | { addMeetingId: string }
    | { removeMeetingId: string }
    | { refreshMeetingId: string },
) =>
  invoke<MeetingPrep>('MEETING_PREP_SAVE', {
    occurrenceKey: prep.occurrenceKey,
    revision: prep.revision,
    patch,
  });

export const buildPrepBrief = (key: string) =>
  invoke<import('../../electron/preMeetingBrief').PreMeetingBrief>(
    'MEETING_PREP_BRIEF_BUILD',
    key,
  );
export const synthesizePrepBrief = (key: string) =>
  invoke<import('../../electron/preMeetingBrief').PreMeetingBrief>(
    'MEETING_PREP_BRIEF_SYNTHESIZE',
    key,
  );
