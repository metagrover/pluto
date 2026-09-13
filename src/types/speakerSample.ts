export type SpeakerSampleScope = 'speaker' | 'remote_channel';

export interface SpeakerSamplePayload {
  bytes: Uint8Array;
  mimeType: 'audio/wav';
  durationSeconds: number;
  excerpt: string;
  sampleIndex: number;
  sampleCount: number;
  scope: SpeakerSampleScope;
}

export type SpeakerSampleUnavailableReason =
  | 'meeting_unavailable'
  | 'source_unavailable'
  | 'no_speaker_excerpt'
  | 'encrypted_audio_unavailable'
  | 'audio_decode_failed'
  | 'audio_empty'
  | 'no_audible_speech'
  | 'audio_too_large'
  | 'cancelled'
  | 'availability_check_failed';

export type SpeakerSampleAvailability =
  | {
      status: 'available';
      sampleCount: number;
      scope: SpeakerSampleScope;
    }
  | { status: 'unavailable'; reason: SpeakerSampleUnavailableReason };

export type SpeakerSampleResult =
  | { status: 'ready'; sample: SpeakerSamplePayload }
  | { status: 'unavailable'; reason: SpeakerSampleUnavailableReason };
