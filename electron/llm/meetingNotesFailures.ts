import { MeetingNotesError } from './meetingNotesTypes';

export const classifyMeetingNotesFailure = (error: unknown): string => {
  if (error instanceof MeetingNotesError) return error.code;
  if (error instanceof SyntaxError) return 'notes_provider_response_invalid';
  if (error instanceof DOMException && error.name === 'TimeoutError') {
    return 'notes_provider_timeout';
  }
  if (error instanceof TypeError) return 'notes_provider_transport_failed';
  if (
    error instanceof Error &&
    /^(notes_|meeting_notes_)[a-z_]+$/.test(error.message)
  ) {
    return error.message;
  }
  return 'meeting_notes_latency_run_failed';
};

export const isTransientMeetingNotesLeafFailure = (error: unknown): boolean =>
  (error instanceof MeetingNotesError &&
    ['notes_provider_error', 'notes_output_incomplete'].includes(error.code)) ||
  error instanceof SyntaxError ||
  error instanceof TypeError ||
  (error instanceof DOMException && error.name === 'TimeoutError');
