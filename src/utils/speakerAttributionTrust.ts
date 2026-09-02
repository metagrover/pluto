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
  return Boolean(
    attribution &&
      attribution.diarizationAttempted === true &&
      attribution.mappingApplied === true &&
      attribution.source !== 'channel_fallback' &&
      Number.isFinite(attribution.confidence) &&
      attribution.confidence > 0,
  );
};
