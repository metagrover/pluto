import type { LiveTranscriptSegment } from '../../components/features/recordingWorkspaceModel';
import {
  type SpeakerActivityWindow,
  isCrossChannelDuplicatePair,
} from '../../utils/speakerAttribution';

const normalizedTokens = (text: string): string[] =>
  text
    .normalize('NFKC')
    .toLocaleLowerCase('en')
    .split(/\s+/)
    .map((token) => token.replace(/[^\p{L}\p{N}']/gu, ''))
    .filter(Boolean);

const activityCoverage = (
  segment: LiveTranscriptSegment,
  speaker: SpeakerActivityWindow['speaker'],
  windows: SpeakerActivityWindow[],
): number => {
  const start = segment.timestampMs / 1_000;
  const end = (segment.endTimestampMs ?? segment.timestampMs + 10) / 1_000;
  return windows.reduce((total, window) => {
    if (window.speaker !== speaker) return total;
    return (
      total +
      Math.max(
        0,
        Math.min(end, window.endTime) - Math.max(start, window.startTime),
      )
    );
  }, 0);
};

const asAttributionSegment = (segment: LiveTranscriptSegment) => ({
  startTime: segment.timestampMs / 1_000,
  endTime: (segment.endTimestampMs ?? segment.timestampMs + 10) / 1_000,
  text: segment.rawText ?? segment.text,
  speaker: segment.source === 'mic' ? 'Me' : 'Them',
});

export const reconcileLiveTranscriptSegments = (input: {
  segments: LiveTranscriptSegment[];
  activityWindows: SpeakerActivityWindow[];
}): LiveTranscriptSegment[] => {
  const systemSegments = input.segments.filter(
    (segment) => segment.source === 'system',
  );

  return input.segments.map((segment) => {
    if (
      segment.source !== 'mic' ||
      normalizedTokens(segment.rawText ?? segment.text).length < 5
    ) {
      return segment;
    }
    const meCoverage = activityCoverage(segment, 'Me', input.activityWindows);
    const themCoverage = activityCoverage(
      segment,
      'Them',
      input.activityWindows,
    );
    if (meCoverage >= themCoverage) return segment;

    for (const system of systemSegments) {
      const minimumTokenCount = Math.min(
        normalizedTokens(segment.rawText ?? segment.text).length,
        normalizedTokens(system.rawText ?? system.text).length,
      );
      const match = isCrossChannelDuplicatePair(
        asAttributionSegment(segment),
        asAttributionSegment(system),
      );
      const confidence = Math.max(match.tokenSim, match.prefixSim);
      const minimumConfidence = minimumTokenCount >= 6 ? 0.75 : 0.9;
      if (
        match.duplicate &&
        match.overlapRatio >= 0.6 &&
        confidence >= minimumConfidence
      ) {
        return {
          ...segment,
          presentation: {
            visibility: 'suppressed_echo',
            matchedSegmentId: system.id,
            confidence: Number(confidence.toFixed(3)),
            reason: 'cross_channel_echo',
          },
        };
      }
    }
    return segment;
  });
};
