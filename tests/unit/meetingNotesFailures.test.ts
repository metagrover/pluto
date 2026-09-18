import { expect, it } from 'vitest';
import {
  classifyMeetingNotesFailure,
  isTransientMeetingNotesLeafFailure,
} from '../../electron/llm/meetingNotesFailures';
import { MeetingNotesError } from '../../electron/llm/meetingNotesTypes';

it.each([
  new MeetingNotesError('notes_provider_error'),
  new MeetingNotesError('notes_provider_rate_limited'),
  new MeetingNotesError('notes_output_incomplete'),
  new SyntaxError('malformed provider stream'),
  new DOMException('provider timeout', 'TimeoutError'),
  new TypeError('fetch failed'),
])('recognizes a retryable leaf transport failure: %s', (error) => {
  expect(isTransientMeetingNotesLeafFailure(error)).toBe(true);
});

it.each([
  new MeetingNotesError('notes_writer_invalid'),
  new MeetingNotesError('notes_cancelled'),
  new Error('application failure'),
])('does not retry a semantic, cancelled, or unknown failure: %s', (error) => {
  expect(isTransientMeetingNotesLeafFailure(error)).toBe(false);
});

it('never includes an error message in its stable classification', () => {
  expect(classifyMeetingNotesFailure(new Error('PRIVATE_MARKER'))).toBe(
    'meeting_notes_latency_run_failed',
  );
});
