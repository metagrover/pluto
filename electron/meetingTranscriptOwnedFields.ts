import type { PersistedMeeting } from './db';

export const MEETING_TRANSCRIPT_OWNED_FIELDS = [
  'audio_path',
  'system_audio_path',
  'mixed_audio_path',
  'transcript_json',
  'transcript_status',
  'transcript_integrity_json',
  'transcript_validated_at',
] as const satisfies readonly (keyof PersistedMeeting)[];

export const preserveOmittedTranscriptOwnedFields = (
  current: PersistedMeeting | undefined,
  incoming: PersistedMeeting,
): PersistedMeeting => {
  if (!current) return incoming;

  const effective = { ...incoming };
  for (const field of MEETING_TRANSCRIPT_OWNED_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(incoming, field)) {
      Object.assign(effective, { [field]: current[field] });
    }
  }
  return effective;
};
