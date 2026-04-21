export type SessionFallbackDecisionInput = {
  meetingDurationSeconds: number;
  totalSpeakerWindowSeconds: number;
  segmentCount: number;
  meSegmentCount: number;
  themSegmentCount: number;
  totalWords: number;
  micChunkConversionFailures: number;
  micTranscriptionDisabled: boolean;
  systemChunkDecodeDropCount: number;
};

export type SessionFallbackDecision = {
  shouldRun: boolean;
  reasons: string[];
};

const countPresentSpeakers = (params: {
  meSegmentCount: number;
  themSegmentCount: number;
}): number => {
  let present = 0;
  if (params.meSegmentCount > 0) present += 1;
  if (params.themSegmentCount > 0) present += 1;
  return present;
};

export const getSessionFallbackDecision = (
  input: SessionFallbackDecisionInput,
): SessionFallbackDecision => {
  const reasons: string[] = [];
  const speechWindowSeconds = Math.max(0, input.totalSpeakerWindowSeconds);
  const wordsPerActiveMinute =
    speechWindowSeconds > 0 ? (input.totalWords / speechWindowSeconds) * 60 : 0;
  const presentSpeakers = countPresentSpeakers(input);

  if (input.segmentCount === 0) {
    reasons.push('no_chunk_segments');
  }

  if (input.micTranscriptionDisabled || input.micChunkConversionFailures >= 2) {
    reasons.push('mic_chunk_failures');
  }

  if (
    input.meetingDurationSeconds >= 60 &&
    speechWindowSeconds >= 20 &&
    input.totalWords < 12
  ) {
    reasons.push('very_low_word_count');
  }

  if (
    speechWindowSeconds >= 30 &&
    input.totalWords >= 1 &&
    wordsPerActiveMinute < 25
  ) {
    reasons.push('low_words_per_active_minute');
  }

  if (
    input.meetingDurationSeconds >= 120 &&
    speechWindowSeconds >= 30 &&
    presentSpeakers <= 1
  ) {
    reasons.push('missing_speaker');
  }

  if (
    input.meetingDurationSeconds >= 120 &&
    input.themSegmentCount === 0 &&
    input.systemChunkDecodeDropCount >= 10
  ) {
    reasons.push('system_channel_degraded');
  }

  return {
    shouldRun: reasons.length > 0,
    reasons,
  };
};
