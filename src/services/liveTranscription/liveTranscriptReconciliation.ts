import type { LiveTranscriptSegment } from '../../components/features/recordingWorkspaceModel';
import type { SpeakerActivityWindow } from '../../utils/speakerAttribution';

const FILLERS = new Set(['uh', 'um', 'erm', 'hmm']);
const MAX_ALIGNMENT_TOKENS = 256;
const MAX_BOUNDARY_SKEW_MS = 1_250;
const CONTRADICTION_TOKEN =
  /[\p{N}\p{S}%]|^[\p{Pd}]+$|^(?:no|not|never|without|cannot|\w+n't)$/u;

const normalizedTokens = (text: string): string[] =>
  text
    .normalize('NFKC')
    .toLocaleLowerCase('en')
    .replace(/[’‘]/gu, "'")
    .split(/\s+/)
    // Strip sentence endings only. Internal punctuation, signs and currency
    // symbols (including separate tokens) can change the meaning of speech.
    .map((token) => token.replace(/[.,;!?…]+$/gu, ''))
    .filter((token) => token && !FILLERS.has(token));

const endMs = (segment: LiveTranscriptSegment): number =>
  segment.endTimestampMs ?? segment.timestampMs;

const activityCoverage = (
  segment: LiveTranscriptSegment,
  speaker: SpeakerActivityWindow['speaker'],
  windows: SpeakerActivityWindow[],
): number => {
  const start = segment.timestampMs / 1_000;
  const end = endMs(segment) / 1_000;
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

// Every non-filler mic word must survive, in order, in the system version.
// Unlike token-set similarity, this preserves reordered or unmatched local
// words. Extra remote words are bounded and checked for numeric/polarity changes.
const orderedEcho = (mic: string[], system: string[]): boolean => {
  if (
    !mic.length ||
    system.length > MAX_ALIGNMENT_TOKENS ||
    mic.length / system.length < 0.8
  )
    return false;
  if (
    mic.filter((word) => CONTRADICTION_TOKEN.test(word)).join(' ') !==
    system.filter((word) => CONTRADICTION_TOKEN.test(word)).join(' ')
  )
    return false;
  let matched = 0;
  for (const word of system) {
    if (word === mic[matched]) matched += 1;
  }
  return matched === mic.length;
};

const alignedBoundaries = (
  mic: LiveTranscriptSegment,
  first: LiveTranscriptSegment,
  last: LiveTranscriptSegment,
): boolean => {
  const micDuration = endMs(mic) - mic.timestampMs;
  const systemDuration = endMs(last) - first.timestampMs;
  const overlap =
    Math.min(endMs(mic), endMs(last)) -
    Math.max(mic.timestampMs, first.timestampMs);
  return (
    micDuration > 0 &&
    systemDuration > 0 &&
    overlap / Math.max(micDuration, systemDuration) >= 0.8 &&
    Math.abs(mic.timestampMs - first.timestampMs) <= MAX_BOUNDARY_SKEW_MS &&
    Math.abs(endMs(mic) - endMs(last)) <= MAX_BOUNDARY_SKEW_MS
  );
};

export const reconcileLiveTranscriptSegments = (input: {
  segments: LiveTranscriptSegment[];
  activityWindows: SpeakerActivityWindow[];
}): LiveTranscriptSegment[] => {
  // Recompute from raw evidence on every revision: a provisional match can stop
  // being an echo when either recognizer revises its text.
  const segments = input.segments.map((segment) => {
    if (!segment.presentation) return segment;
    const { presentation: _presentation, ...raw } = segment;
    return raw;
  });
  const systemSegments = segments
    .filter((segment) => segment.source === 'system')
    .sort((left, right) => left.timestampMs - right.timestampMs);
  const systemTokens = new Map(
    systemSegments.map((segment) => [
      segment,
      normalizedTokens(segment.rawText ?? segment.text),
    ]),
  );

  return segments.map((segment) => {
    if (segment.source !== 'mic') return segment;
    const tokens = normalizedTokens(segment.rawText ?? segment.text);
    const remotelyDominant =
      activityCoverage(segment, 'Them', input.activityWindows) >
      activityCoverage(segment, 'Me', input.activityWindows);
    // Volume is supporting evidence for shorter exact phrases, never a veto on
    // a long aligned match. Short local repetitions remain visible.
    if (
      tokens.length < (remotelyDominant ? 6 : 12) ||
      tokens.length > MAX_ALIGNMENT_TOKENS
    )
      return segment;

    for (let start = 0; start < systemSegments.length; start += 1) {
      const first = systemSegments[start];
      if (
        Math.abs(first.timestampMs - segment.timestampMs) > MAX_BOUNDARY_SKEW_MS
      )
        continue;
      const combined: string[] = [];
      // EOU boundaries differ between channels. Compare consecutive system
      // utterances too, without joining across a long pause or unbounded history.
      for (
        let end = start;
        end < Math.min(start + 6, systemSegments.length);
        end += 1
      ) {
        const last = systemSegments[end];
        if (
          end > start &&
          last.timestampMs - endMs(systemSegments[end - 1]) >
            MAX_BOUNDARY_SKEW_MS
        )
          break;
        combined.push(...(systemTokens.get(last) ?? []));
        if (
          combined.length > MAX_ALIGNMENT_TOKENS ||
          endMs(last) > endMs(segment) + MAX_BOUNDARY_SKEW_MS
        )
          break;
        if (
          alignedBoundaries(segment, first, last) &&
          orderedEcho(tokens, combined)
        ) {
          return {
            ...segment,
            presentation: {
              visibility: 'suppressed_echo' as const,
              matchedSegmentId: first.id,
              confidence: Number((tokens.length / combined.length).toFixed(3)),
              reason: 'cross_channel_echo' as const,
            },
          };
        }
      }
    }
    // Partial matches do not justify deleting the whole mic segment. Without
    // reliable word-level alignment, keep the unmatched local speech in context.
    return segment;
  });
};
