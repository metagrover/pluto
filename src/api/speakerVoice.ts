import type {
  MatchOutcomeCategory,
  VoiceMatchSuggestion,
} from '../services/speakerVoiceMatcher';
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
  candidateDigest?: string;
  sourceRevision: string;
  isEligibleForEnrollment: boolean;
  cleanDurationSeconds: number;
  analysisStatus?: 'eligible' | 'queued' | 'abstained' | 'retryable_failure';
  analysisReason?:
    | 'insufficient_clean_speech'
    | 'evidence_unavailable'
    | 'timed_out'
    | 'native_runtime_failed';
  retryAfter?: number;
}

export interface ClientVoiceMatchOutcome {
  category: MatchOutcomeCategory;
}

const invoke = <T>(channel: string, payload: object): Promise<T> =>
  window.ipcRenderer.invoke(channel, payload) as Promise<T>;

export async function getSpeakerVoiceSuggestions(
  meetingId: string,
  calendarAttendeePersonIds?: string[],
): Promise<{
  suggestions: Record<string, VoiceMatchSuggestion>;
  candidates: Record<string, ClientCandidateMetadata>;
  outcomes: Record<string, ClientVoiceMatchOutcome>;
  enrollmentAvailability: Record<string, boolean>;
}> {
  const result = await invoke<{
    suggestions: Record<string, VoiceMatchSuggestion>;
    candidates?: Record<string, ClientCandidateMetadata>;
    outcomes?: Record<string, ClientVoiceMatchOutcome>;
    enrollmentAvailability?: Record<string, boolean>;
  }>('SPEAKER_VOICE_GET_SUGGESTIONS', {
    meetingId,
    calendarAttendeePersonIds,
  });
  return {
    suggestions: result?.suggestions ?? {},
    candidates: result?.candidates ?? {},
    outcomes: result?.outcomes ?? {},
    enrollmentAvailability: result?.enrollmentAvailability ?? {},
  };
}

export interface SpeakerVoiceEnrollmentResult {
  success: boolean;
  enrollmentId?: string;
  queued?: boolean;
  timings?: {
    candidateConstructionMs?: number;
    initialInferenceMs?: number;
    representativeInferencesMs?: number[];
  };
}

export function enrollSpeakerVoice(params: {
  personId: string;
  sourceMeetingId: string;
  sourceRevision?: string;
  speaker: string;
  candidateDigest?: string;
  expectedRevision: number;
  timeoutMs?: number;
}): Promise<SpeakerVoiceEnrollmentResult> {
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
  return (await getSpeakerVoiceProfileOverview()).profiles;
}

export type VoiceProfileReconciliationStatus =
  | 'enrolled'
  | 'already_enrolled'
  | 'queued'
  | 'evidence_unavailable'
  | 'failed'
  | 'opted_out'
  | 'self';

export async function getSpeakerVoiceProfileOverview(
  personId?: string,
): Promise<{
  profiles: ClientVoiceProfile[];
  optedOutPersonIds: string[];
  reconciliationStatus?: VoiceProfileReconciliationStatus;
}> {
  const result = await invoke<{
    profiles: ClientVoiceProfile[];
    optedOutPersonIds?: unknown;
    reconciliation?: unknown;
  }>('SPEAKER_VOICE_GET_PROFILES', personId ? { personId } : {});
  const reconciliation =
    result?.reconciliation && typeof result.reconciliation === 'object'
      ? (result.reconciliation as Record<string, unknown>)
      : {};
  const status = personId ? reconciliation[personId] : undefined;
  return {
    profiles: result?.profiles ?? [],
    optedOutPersonIds:
      result && Array.isArray(result.optedOutPersonIds)
        ? result.optedOutPersonIds.filter(
            (personId): personId is string => typeof personId === 'string',
          )
        : [],
    reconciliationStatus:
      status === 'enrolled' ||
      status === 'already_enrolled' ||
      status === 'queued' ||
      status === 'evidence_unavailable' ||
      status === 'failed' ||
      status === 'opted_out' ||
      status === 'self'
        ? status
        : undefined,
  };
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
