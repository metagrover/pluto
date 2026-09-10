export type MeetingAudioSource = 'mic' | 'system';

export const resolveMeetingSpeakerLabel = (input: {
  speaker?: unknown;
  source?: unknown;
}): string => {
  if (input.source === 'mic') return 'Me';
  if (input.source === 'system') return 'Call audio';
  return typeof input.speaker === 'string' && input.speaker.trim()
    ? input.speaker.trim()
    : 'Unknown speaker';
};
