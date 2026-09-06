import type { VoiceMatchSuggestion } from '../services/speakerVoiceMatcher';
import type { MeetingSpeakerSample } from './identity';

export type { VoiceMatchSuggestion };

export interface ClientVoiceProfile {
  canonicalPersonId: string;
  personName: string;
  sampleCount: number;
  cleanDurationSeconds: number;
  isActive: boolean;
  referenceInterval?: {
    startTime: number;
    endTime: number;
    excerpt: string;
    sourceMeetingId: string;
  };
}

export interface ClientCandidateMetadata {
  candidateDigest: string;
  sourceRevision: string;
  isEligibleForEnrollment: boolean;
  cleanDurationSeconds: number;
}

const invoke = <T>(channel: string, payload: object): Promise<T> =>
  window.ipcRenderer.invoke(channel, payload) as Promise<T>;

export async function getSpeakerVoiceSuggestions(
  meetingId: string,
  calendarAttendeePersonIds?: string[],
): Promise<{
  suggestions: Record<string, VoiceMatchSuggestion>;
  candidates: Record<string, ClientCandidateMetadata>;
  enrollmentAvailability: Record<string, boolean>;
}> {
  const result = await invoke<{
    suggestions: Record<string, VoiceMatchSuggestion>;
    candidates?: Record<string, ClientCandidateMetadata>;
    enrollmentAvailability?: Record<string, boolean>;
  }>('SPEAKER_VOICE_GET_SUGGESTIONS', {
    meetingId,
    calendarAttendeePersonIds,
  });
  return {
    suggestions: result?.suggestions ?? {},
    candidates: result?.candidates ?? {},
    enrollmentAvailability: result?.enrollmentAvailability ?? {},
  };
}

export function enrollSpeakerVoice(params: {
  personId: string;
  sourceMeetingId: string;
  sourceRevision?: string;
  speaker: string;
  candidateDigest?: string;
  expectedRevision: number;
}): Promise<{ success: boolean; enrollmentId: string }> {
  return invoke('SPEAKER_VOICE_ENROLL', params);
}

export function rejectSpeakerVoiceSuggestion(params: {
  meetingId: string;
  speaker: string;
  sourceRevision: string;
  candidateDigest: string;
  personId: string;
}): Promise<{ success: boolean }> {
  return invoke('SPEAKER_VOICE_REJECT', params);
}

export async function getSpeakerVoiceProfiles(): Promise<ClientVoiceProfile[]> {
  const result = await invoke<{ profiles: ClientVoiceProfile[] }>(
    'SPEAKER_VOICE_GET_PROFILES',
    {},
  );
  return result?.profiles ?? [];
}

export function setSpeakerVoiceProfileStatus(
  personId: string,
  isActive: boolean,
): Promise<{ success: boolean }> {
  return invoke('SPEAKER_VOICE_SET_STATUS', { personId, isActive });
}

export function deleteSpeakerVoiceProfile(
  personId: string,
): Promise<{ success: boolean }> {
  return invoke('SPEAKER_VOICE_DELETE', { personId });
}

export function getVoiceReferenceSample(
  sourceMeetingId: string,
  startTime: number,
  endTime: number,
): Promise<MeetingSpeakerSample | null> {
  return invoke('SPEAKER_VOICE_GET_REFERENCE_SAMPLE', {
    sourceMeetingId,
    startTime,
    endTime,
  });
}
