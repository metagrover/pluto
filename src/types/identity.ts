export interface IdentityPerson {
  id: string;
  name: string;
  aliases?: string[];
}
export type IdentityUseCase = 'work' | 'study' | 'personal';
export interface IdentityProfileInput {
  preferredName: string;
  aliases: string[];
  useCases: IdentityUseCase[];
  role: string;
  industry: string;
}
export interface IdentityProfile extends IdentityProfileInput {
  disposition: 'pending' | 'completed' | 'dismissed';
}
export const emptyIdentityProfile = (): IdentityProfile => ({
  preferredName: '',
  aliases: [],
  useCases: [],
  role: '',
  industry: '',
  disposition: 'pending',
});
export interface IdentityTurn {
  id: string;
  speaker: string;
  text: string;
}
export interface IdentityEvidence {
  turnId: string;
  quote: string;
}
export interface IdentityCaptureEvidence {
  origin: 'local';
  selfPersonId: string;
  attributionSource:
    | 'local_diarization_acoustic'
    | 'offline_diarization_acoustic_v1';
  confidence: number;
  mappingApplied: true;
  sourceRevision: string;
}
export interface IdentityBinding {
  speaker: string;
  personId: string | null;
  individual: boolean;
  source: 'user' | 'source' | 'capture';
  sourceRevision: string;
  evidence: IdentityEvidence[];
  captureEvidence?: IdentityCaptureEvidence;
  assignment?: {
    kind:
      | 'manual_participant_singleton_v1'
      | 'voice_match_strong_v1'
      | 'live_voice_confirmed_v1';
  };
}
export interface IdentityContext {
  meetingId: string;
  sourceRevision: string;
  turns: IdentityTurn[];
  people: IdentityPerson[];
  bindings: IdentityBinding[];
  capture: {
    origin: 'local' | 'imported' | 'unknown';
    selfPersonId: string | null;
  };
}
export interface OwnerResolution {
  status: 'resolved' | 'unresolved' | 'conflicting';
  ownerKey: string | null;
  personId: string | null;
  source: 'user' | 'binding' | 'inference' | 'unresolved';
  evidence: IdentityEvidence[];
  reason: string;
  identityProvenance?: {
    source: IdentityBinding['source'];
    captureEvidence?: IdentityCaptureEvidence;
  };
}
