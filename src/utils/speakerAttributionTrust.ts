import type { StoredTranscriptSpeakerAttribution } from './transcriptSchema.ts';

export const readStoredSpeakerAttribution = (
  transcriptJson: string | null | undefined,
): StoredTranscriptSpeakerAttribution | null => {
  try {
    const parsed = JSON.parse(transcriptJson || '{}') as {
      speakerAttribution?: unknown;
    };
    const attribution = parsed.speakerAttribution;
    return attribution && typeof attribution === 'object'
      ? (attribution as StoredTranscriptSpeakerAttribution)
      : null;
  } catch {
    return null;
  }
};

export const hasVerifiedSpeakerAttribution = (
  transcriptJson: string | null | undefined,
): boolean => {
  const attribution = readStoredSpeakerAttribution(transcriptJson);
  return isVerifiedSpeakerAttribution(attribution);
};

export const isVerifiedSpeakerAttribution = (
  attribution: StoredTranscriptSpeakerAttribution | null | undefined,
): boolean =>
  Boolean(
    attribution &&
      attribution.mappingApplied === true &&
      Number.isFinite(attribution.confidence) &&
      attribution.confidence > 0 &&
      (attribution.source === 'recovered_channel_acoustic_v1' ||
        attribution.source === 'recovered_channel_acoustic_v2' ||
        (attribution.diarizationAttempted === true &&
          (attribution.source === 'diarization' ||
            attribution.source === 'local_diarization_acoustic' ||
            attribution.source === 'offline_diarization_acoustic_v1'))),
  );

export const isSpeakerSeparatedAttribution = (
  attribution: StoredTranscriptSpeakerAttribution | null | undefined,
): boolean =>
  isVerifiedSpeakerAttribution(attribution) ||
  Boolean(
    attribution &&
      attribution.source === 'recovered_channel_acoustic_v3' &&
      attribution.speakerSeparation === 'verified' &&
      Number.isFinite(attribution.confidence) &&
      attribution.confidence >= 0.8,
  );
