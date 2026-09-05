import type {
  IdentityBinding,
  IdentityContext,
  IdentityPerson,
  IdentityProfile,
  IdentityProfileInput,
} from '../types/identity';

export interface IdentityState {
  selfPersonId: string | null;
  people: IdentityPerson[];
  revision: number;
  profile: IdentityProfile;
}

export interface MeetingIdentityState extends IdentityState {
  meetingId: string;
  speakers: string[];
  bindings: IdentityBinding[];
  capture: IdentityContext['capture'];
  job: {
    state: 'pending' | 'running' | 'complete' | 'failed';
    attempts: number;
    error: string | null;
  } | null;
}

export interface MeetingSpeakerSample {
  bytes: Uint8Array;
  mimeType: 'audio/wav';
  durationSeconds: number;
  excerpt: string;
  sampleIndex: number;
  sampleCount: number;
}

export type IdentitySelection =
  | { personId: string | null; newName?: never }
  | { newName: string; personId?: never };

const invoke = <T>(channel: string, payload: object): Promise<T> =>
  window.ipcRenderer.invoke(channel, payload) as Promise<T>;

export const getIdentityState = () =>
  invoke<IdentityState>('GET_IDENTITY_STATE', {});
export const saveIdentityProfile = (
  profile: IdentityProfileInput,
  expectedRevision: number,
) =>
  invoke<IdentityState>('SAVE_IDENTITY_PROFILE', {
    preferredName: profile.preferredName,
    aliases: profile.aliases,
    useCases: profile.useCases,
    role: profile.role,
    industry: profile.industry,
    expectedRevision,
  });
export const dismissIdentityProfile = (expectedRevision: number) =>
  invoke<IdentityState>('DISMISS_IDENTITY_PROFILE', { expectedRevision });
export const setSelfIdentity = (
  selection: IdentitySelection,
  expectedRevision: number,
) =>
  invoke<IdentityState>('SET_SELF_IDENTITY', {
    ...selection,
    expectedRevision,
  });
export const getMeetingIdentity = (meetingId: string) =>
  invoke<MeetingIdentityState>('GET_MEETING_IDENTITY', { meetingId });
export const setMeetingIdentityBinding = (
  meetingId: string,
  speaker: string,
  selection: IdentitySelection,
  expectedRevision: number,
) =>
  invoke<MeetingIdentityState>('SET_MEETING_IDENTITY_BINDING', {
    meetingId,
    speaker,
    ...selection,
    individual: true,
    expectedRevision,
  });
export const clearMeetingIdentityBinding = (
  meetingId: string,
  speaker: string,
  expectedRevision: number,
) =>
  invoke<MeetingIdentityState>('CLEAR_MEETING_IDENTITY_BINDING', {
    meetingId,
    speaker,
    expectedRevision,
  });
export const retryIdentityReconciliation = (meetingId: string) =>
  invoke<MeetingIdentityState>('RETRY_IDENTITY_RECONCILIATION', { meetingId });
export const getMeetingSpeakerSample = (
  meetingId: string,
  speaker: string,
  sampleIndex: number,
) =>
  invoke<MeetingSpeakerSample | null>('GET_MEETING_SPEAKER_SAMPLE', {
    meetingId,
    speaker,
    sampleIndex,
  });

export const identityPersonLabel = (
  person: IdentityPerson,
  people: IdentityPerson[],
) => {
  const sameName = people.filter(
    (candidate) =>
      candidate.name.toLocaleLowerCase() === person.name.toLocaleLowerCase(),
  );
  if (sameName.length < 2) return person.name;
  const suffix = person.id.slice(-8);
  const uniqueSuffix =
    sameName.filter((candidate) => candidate.id.endsWith(suffix)).length === 1;
  return `${person.name} (${uniqueSuffix ? suffix : person.id})`;
};

export const isIdentityRevisionError = (error: unknown) =>
  /revision|conflict|stale/i.test(String(error));
export const identityErrorMessage = (error: unknown) =>
  isIdentityRevisionError(error)
    ? 'Identity information changed elsewhere. Reloaded the latest state; review your choice and try again.'
    : 'Could not confirm the update. Reload to check the saved identity, then try again.';
