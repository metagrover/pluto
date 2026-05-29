import type { Meeting } from '../../types';
import { parseTranscriptSegments } from '../../utils/transcript';

const GENERIC_SPEAKER_PATTERN = /^speaker\s*\d+$/i;

export const getMeetingParticipants = (meeting: Meeting): string[] => {
  const seen = new Set<string>();
  const participants: string[] = [];

  for (const segment of parseTranscriptSegments(meeting.transcript_json)) {
    if (typeof segment?.speaker !== 'string') continue;
    const speaker = segment.speaker.trim();
    if (!speaker || GENERIC_SPEAKER_PATTERN.test(speaker)) continue;

    if (!seen.has(speaker)) {
      seen.add(speaker);
      participants.push(speaker);
    }
  }

  return participants;
};
