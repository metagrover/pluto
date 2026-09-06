import type { LiveTranscriptSegment } from '../../components/features/recordingWorkspaceModel';
import type { SpeakerActivityWindow } from '../../utils/speakerAttribution';
import type { LiveEchoEvidenceWindow } from './liveEchoEvidence';
import {
  findExactEchoSubsequence,
  findSupportedExactEchoSpans,
} from './liveEchoSubsequenceAlignment';
import { alignEchoTokens } from './liveEchoTokenAlignment';

const FILLERS = new Set(['uh', 'um', 'erm', 'hmm']);
const MAX_ALIGNMENT_TOKENS = 256;
const MAX_BOUNDARY_SKEW_MS = 1_250;

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

const createEchoEvidenceLookup = (rawEvidence: LiveEchoEvidenceWindow[]) => {
  const echoEvidence = [...rawEvidence].sort(
    (left, right) => left.micStartMs - right.micStartMs,
  );
  const latestEvidenceEnd: number[] = [];
  for (const window of echoEvidence)
    latestEvidenceEnd.push(
      Math.max(
        latestEvidenceEnd.at(-1) ?? Number.NEGATIVE_INFINITY,
        window.micEndMs,
      ),
    );
  const firstOverlappingEvidence = (start: number) => {
    let low = 0;
    let high = echoEvidence.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (latestEvidenceEnd[middle] <= start) low = middle + 1;
      else high = middle;
    }
    return low;
  };
  const evidenceInRange = (start: number, end: number) => {
    const windows: LiveEchoEvidenceWindow[] = [];
    for (
      let index = firstOverlappingEvidence(start);
      index < echoEvidence.length;
      index += 1
    ) {
      const window = echoEvidence[index];
      if (window.micStartMs >= end) break;
      if (window.micEndMs > start) windows.push(window);
    }
    return windows;
  };
  const acousticCoverage = (
    micStart: number,
    micEnd: number,
    systemStart: number,
    systemEnd: number,
  ): boolean => {
    if (micEnd <= micStart || systemEnd <= systemStart) return false;
    const micRanges: Array<[number, number]> = [];
    const systemRanges: Array<[number, number]> = [];
    for (
      let index = firstOverlappingEvidence(micStart);
      index < echoEvidence.length;
      index += 1
    ) {
      const window = echoEvidence[index];
      if (window.micStartMs >= micEnd) break;
      if (
        window.micEndMs <= micStart ||
        window.systemEndMs <= systemStart ||
        window.systemStartMs >= systemEnd
      )
        continue;
      const lag = window.micStartMs - window.systemStartMs;
      // ASR word boundaries are quantized independently on each channel.
      // Require the same paired PCM evidence and nearby mapped boundaries,
      // rather than identical word durations. The acoustic proof is unchanged.
      if (
        Math.abs(micStart - systemStart - lag) > 250 ||
        Math.abs(micEnd - systemEnd - lag) > 250 ||
        Math.min(micEnd, systemEnd + lag) <=
          Math.max(micStart, systemStart + lag)
      )
        continue;
      micRanges.push([
        Math.max(micStart, window.micStartMs),
        Math.min(micEnd, window.micEndMs),
      ]);
      systemRanges.push([
        Math.max(systemStart, window.systemStartMs),
        Math.min(systemEnd, window.systemEndMs),
      ]);
    }
    const covered = (ranges: Array<[number, number]>) => {
      ranges.sort((left, right) => left[0] - right[0]);
      let end = Number.NEGATIVE_INFINITY;
      let duration = 0;
      for (const [start, finish] of ranges) {
        duration += Math.max(0, finish - Math.max(start, end));
        end = Math.max(end, finish);
      }
      return duration;
    };
    return (
      covered(micRanges) / (micEnd - micStart) >= 0.8 &&
      covered(systemRanges) / (systemEnd - systemStart) >= 0.8
    );
  };
  return { acousticCoverage, echoEvidence, evidenceInRange };
};

const textWithoutExactSpan = (
  text: string,
  span: string[],
  startToken: number,
): string | null => {
  const words: Array<{ token: string; start: number; end: number }> = [];
  for (const word of text.matchAll(/\S+/gu)) {
    const normalized = normalizedTokens(word[0]);
    if (!normalized.length) continue;
    words.push({
      token: normalized[0],
      start: word.index ?? 0,
      end: (word.index ?? 0) + word[0].length,
    });
  }
  if (!span.every((token, index) => words[startToken + index]?.token === token))
    return null;
  const first = words[startToken];
  const last = words[startToken + span.length - 1];
  if (!first || !last) return null;
  return [text.slice(0, first.start).trim(), text.slice(last.end).trim()]
    .filter(Boolean)
    .join(' ');
};

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
  echoEvidence?: LiveEchoEvidenceWindow[];
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

  // The prefix maximum permits bounded interval lookup even after adjacent
  // acoustic windows merge. Historical evidence is indexed once per update.
  const { acousticCoverage, echoEvidence, evidenceInRange } =
    createEchoEvidenceLookup(input.echoEvidence ?? []);

  function* systemGroups(segment: LiveTranscriptSegment, contained = false) {
    let low = 0;
    let high = systemSegments.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (
        systemSegments[middle].timestampMs <
        segment.timestampMs - MAX_BOUNDARY_SKEW_MS
      )
        low = middle + 1;
      else high = middle;
    }
    for (let start = low; start < systemSegments.length; start += 1) {
      const first = systemSegments[start];
      if (
        first.timestampMs >
        (contained ? endMs(segment) : segment.timestampMs) +
          MAX_BOUNDARY_SKEW_MS
      )
        break;
      const combined: string[] = [];
      const members: LiveTranscriptSegment[] = [];
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
        members.push(last);
        if (
          combined.length > MAX_ALIGNMENT_TOKENS ||
          endMs(last) > endMs(segment) + MAX_BOUNDARY_SKEW_MS
        )
          break;
        yield { first, last, combined, members };
      }
    }
  }

  const findEcho = (segment: LiveTranscriptSegment, tokens: string[]) => {
    const remotelyDominant =
      activityCoverage(segment, 'Them', input.activityWindows) >
      activityCoverage(segment, 'Me', input.activityWindows);
    if (
      tokens.length < (remotelyDominant ? 6 : 12) ||
      tokens.length > MAX_ALIGNMENT_TOKENS
    )
      return undefined;
    for (const { first, last, combined } of systemGroups(segment)) {
      if (
        alignedBoundaries(segment, first, last) &&
        tokens.length === combined.length &&
        tokens.every((token, index) => token === combined[index])
      ) {
        return {
          visibility: 'suppressed_echo' as const,
          matchedSegmentId: first.id,
          confidence: 1,
          reason: 'cross_channel_echo' as const,
        };
      }
    }
    return undefined;
  };

  const alignedPaddedWordEnd = (
    segment: LiveTranscriptSegment,
    words: NonNullable<LiveTranscriptSegment['wordTimings']>,
    startToken: number,
    tokenCount: number,
    first: LiveTranscriptSegment,
    last: LiveTranscriptSegment,
  ): boolean => {
    const lastIndex = startToken + tokenCount - 1;
    const tail = words[lastIndex];
    const previous = words[lastIndex - 1];
    const next = words[lastIndex + 1];
    const systemWords = last.wordTimings?.flatMap((word) =>
      normalizedTokens(word.text).map((text) => ({ ...word, text })),
    );
    const rawSystemWords = systemTokens.get(last) ?? [];
    const systemTail = systemWords?.at(-1);
    if (
      !tail ||
      !previous ||
      !next ||
      !systemWords ||
      !systemTail ||
      systemWords.length !== rawSystemWords.length ||
      !systemWords.every(
        (word, index) => word.text === rawSystemWords[index],
      ) ||
      tail.text !== systemTail.text ||
      Math.abs(tail.timestampMs - systemTail.timestampMs) > 250 ||
      tail.timestampMs > systemTail.endTimestampMs ||
      systemTail.endTimestampMs - systemTail.timestampMs <= 0 ||
      systemTail.endTimestampMs - systemTail.timestampMs > 750 ||
      tail.endTimestampMs - tail.timestampMs <= MAX_BOUNDARY_SKEW_MS ||
      (tail.endTimestampMs - systemTail.endTimestampMs > 2_000 &&
        !acousticCoverage(
          tail.timestampMs,
          tail.timestampMs + systemTail.endTimestampMs - systemTail.timestampMs,
          systemTail.timestampMs,
          systemTail.endTimestampMs,
        )) ||
      Math.abs(tail.endTimestampMs - next.timestampMs) > 1 ||
      Math.abs(systemTail.endTimestampMs - endMs(last)) > 1
    )
      return false;
    // Native EOU can extend the final word through silence until the next local
    // token. Long pauses require paired proof of the short word at its onset;
    // the padded end and the later local word never count as acoustic support.
    // Keep the existing bounded timing-only case and preceding long-span check.
    // Only presentation ignores the padding, leaving all source timing raw.
    return alignedBoundaries(
      {
        ...segment,
        timestampMs: words[startToken].timestampMs,
        endTimestampMs: previous.endTimestampMs,
      },
      first,
      { ...last, endTimestampMs: systemTail.timestampMs },
    );
  };

  const findEchoSpan = (segment: LiveTranscriptSegment) => {
    const tokens = normalizedTokens(segment.rawText ?? segment.text);
    if (tokens.length < 12 || tokens.length > MAX_ALIGNMENT_TOKENS)
      return undefined;
    const timedTokens = segment.wordTimings?.flatMap((word) =>
      normalizedTokens(word.text).map((text) => ({ ...word, text })),
    );
    const verifiedTiming =
      timedTokens?.length === tokens.length &&
      timedTokens.every((word, index) => word.text === tokens[index]);
    let result:
      | {
          matchedSegmentId: string;
          tokenCount: number;
          startToken: number;
          confidence: number;
        }
      | undefined;
    let longestSpan = 0;
    for (const { first, last, combined, members } of systemGroups(
      segment,
      true,
    )) {
      const duration = endMs(last) - first.timestampMs;
      const overlap =
        Math.min(endMs(segment), endMs(last)) -
        Math.max(segment.timestampMs, first.timestampMs);
      if (
        combined.length < 12 ||
        combined.length <= longestSpan ||
        combined.length > tokens.length + 1 ||
        duration <= 0 ||
        overlap / duration < 0.8
      )
        continue;
      for (
        let startToken = 0;
        startToken <= tokens.length - combined.length + 1;
        startToken += 1
      ) {
        for (const alignment of alignEchoTokens(
          tokens.slice(startToken),
          combined,
        )) {
          const { tokenCount, confidence, disputed } = alignment;
          if (confidence < 1 && !verifiedTiming) continue;
          const micSpan = tokens.slice(startToken, startToken + tokenCount);
          if (disputed) {
            if (!timedTokens || !verifiedTiming) continue;
            const systemTimes = members.flatMap(
              (member) =>
                member.wordTimings?.flatMap((word) =>
                  normalizedTokens(word.text).map((text) => ({
                    ...word,
                    text,
                  })),
                ) ?? [],
            );
            if (
              systemTimes.length !== combined.length ||
              !systemTimes.every((word, index) => word.text === combined[index])
            )
              continue;
            const micFirst = timedTokens[startToken + disputed.start];
            const micLast =
              timedTokens[startToken + disputed.start + disputed.micCount - 1];
            const systemFirst = systemTimes[disputed.start];
            const systemLast =
              systemTimes[disputed.start + disputed.systemCount - 1];
            if (
              !acousticCoverage(
                micFirst.timestampMs,
                micLast.endTimestampMs,
                systemFirst.timestampMs,
                systemLast.endTimestampMs,
              )
            )
              continue;
          }
          // Interior matches need actual word timing; row containment alone cannot
          // distinguish a local repetition before or after the remote utterance.
          const aligned =
            verifiedTiming && timedTokens
              ? alignedBoundaries(
                  {
                    ...segment,
                    timestampMs: timedTokens[startToken].timestampMs,
                    endTimestampMs:
                      timedTokens[startToken + tokenCount - 1].endTimestampMs,
                  },
                  first,
                  last,
                ) ||
                alignedPaddedWordEnd(
                  segment,
                  timedTokens,
                  startToken,
                  tokenCount,
                  first,
                  last,
                )
              : startToken === 0 &&
                Math.abs(segment.timestampMs - first.timestampMs) <=
                  MAX_BOUNDARY_SKEW_MS;
          if (
            !aligned ||
            textWithoutExactSpan(segment.text, micSpan, startToken) === null
          )
            continue;
          longestSpan = combined.length;
          result = {
            matchedSegmentId: first.id,
            tokenCount,
            startToken,
            confidence,
          };
          break;
        }
      }
    }
    if (result || !verifiedTiming || !timedTokens || !echoEvidence.length)
      return result;
    const validTiming = (words: typeof timedTokens) =>
      words.every(
        (word, index) =>
          Number.isFinite(word.timestampMs) &&
          Number.isFinite(word.endTimestampMs) &&
          word.timestampMs >= 0 &&
          word.endTimestampMs >= word.timestampMs &&
          (index === 0 || word.timestampMs >= words[index - 1].timestampMs),
      );
    if (!validTiming(timedTokens)) return undefined;
    for (const { first, combined, members } of systemGroups(segment, true)) {
      const systemTimes = members.flatMap(
        (member) =>
          member.wordTimings?.flatMap((word) =>
            normalizedTokens(word.text).map((text) => ({ ...word, text })),
          ) ?? [],
      );
      if (
        systemTimes.length !== combined.length ||
        !systemTimes.every((word, index) => word.text === combined[index]) ||
        !validTiming(systemTimes)
      )
        continue;
      const span = findExactEchoSubsequence(
        timedTokens,
        systemTimes,
        evidenceInRange,
      );
      if (span && span.tokenCount > (result?.tokenCount ?? 0))
        result = { ...span, matchedSegmentId: first.id, confidence: 1 };
    }
    return result;
  };

  const micSegments = segments
    .filter((segment) => segment.source === 'mic')
    .sort((left, right) => left.timestampMs - right.timestampMs);
  const presentations = new Map<
    LiveTranscriptSegment,
    NonNullable<LiveTranscriptSegment['presentation']>
  >();
  for (let start = 0; start < micSegments.length; start += 1) {
    const first = micSegments[start];
    const tokens: string[] = [];
    const members: LiveTranscriptSegment[] = [];
    for (
      let end = start;
      end < Math.min(start + 6, micSegments.length);
      end += 1
    ) {
      const last = micSegments[end];
      if (
        end > start &&
        (last.timestampMs - endMs(micSegments[end - 1]) >
          MAX_BOUNDARY_SKEW_MS ||
          last.timestampMs < endMs(micSegments[end - 1]))
      )
        break;
      const memberTokens = normalizedTokens(last.rawText ?? last.text);
      if (!memberTokens.length) break;
      tokens.push(...memberTokens);
      members.push(last);
      if (tokens.length > MAX_ALIGNMENT_TOKENS) break;
      // Joining microphone rows must account for every word in every member.
      // Aggregate fuzzy coverage could otherwise swallow a short local addition.
      const presentation = findEcho(
        { ...first, endTimestampMs: endMs(last) },
        tokens,
      );
      if (presentation) {
        for (let index = start; index <= end; index += 1) {
          if (
            presentation.confidence === 1 ||
            presentations.get(micSegments[index])?.visibility !==
              'echo_span_removed'
          ) {
            presentations.set(micSegments[index], presentation);
          }
        }
      }
      if (presentation?.confidence === 1) continue;
      const span = findEchoSpan({
        ...first,
        endTimestampMs: endMs(last),
        text: members.map((member) => member.text).join(' '),
        rawText: members
          .map((member) => member.rawText ?? member.text)
          .join(' '),
        wordTimings: members.every((member) => member.wordTimings)
          ? members.flatMap((member) => member.wordTimings ?? [])
          : undefined,
      });
      if (!span) continue;
      let memberStart = 0;
      for (const member of members) {
        const words = normalizedTokens(member.rawText ?? member.text);
        const startToken = Math.max(0, span.startToken - memberStart);
        const endToken = Math.min(
          words.length,
          span.startToken + span.tokenCount - memberStart,
        );
        memberStart += words.length;
        if (startToken >= endToken) continue;
        const metadata = {
          matchedSegmentId: span.matchedSegmentId,
          confidence: Number(span.confidence.toFixed(3)),
          reason: 'cross_channel_echo' as const,
        };
        if (startToken === 0 && endToken === words.length) {
          presentations.set(member, {
            ...metadata,
            visibility: 'suppressed_echo',
          });
        } else {
          const text = textWithoutExactSpan(
            member.text,
            words.slice(startToken, endToken),
            startToken,
          );
          if (text) {
            const timings = member.wordTimings?.flatMap((word) =>
              normalizedTokens(word.text).map((text) => ({ ...word, text })),
            );
            const verifiedTimings =
              timings?.length === words.length &&
              timings.every(
                (word, index) =>
                  word.text === words[index] &&
                  Number.isFinite(word.timestampMs) &&
                  Number.isFinite(word.endTimestampMs) &&
                  word.timestampMs >= 0 &&
                  word.endTimestampMs >= word.timestampMs &&
                  (index === 0 ||
                    word.timestampMs >= timings[index - 1].timestampMs),
              );
            const retainedFirst = startToken === 0 ? endToken : 0;
            const retainedLast =
              endToken === words.length ? startToken - 1 : words.length - 1;
            presentations.set(member, {
              ...metadata,
              visibility: 'echo_span_removed',
              text,
              ...(verifiedTimings && timings
                ? {
                    timestampMs: timings[retainedFirst].timestampMs,
                    endTimestampMs: timings[retainedLast].endTimestampMs,
                  }
                : {}),
            });
          }
        }
      }
    }
  }
  // Keep raw evidence and order intact; a later revision recomputes all matches.
  return segments.map((segment) => {
    const presentation = presentations.get(segment);
    return presentation ? { ...segment, presentation } : segment;
  });
};

type OriginalWord = {
  text: string;
  start: number;
  end: number;
  normalized: string | null;
};

export type LiveTranscriptReadingRange = {
  id: string;
  sourceSegmentId: string;
  source: 'mic' | 'system';
  startWord: number;
  endWord: number;
  startCharacter: number;
  endCharacter: number;
  text: string;
  timestampMs: number;
  endTimestampMs: number;
  visibility: 'visible' | 'suppressed_echo';
  supportingSegmentIds: string[];
  confidence?: number;
};

export type LiveTranscriptReading = {
  /** Raw source rows with any earlier presentation annotation removed. */
  segments: LiveTranscriptSegment[];
  /** A lossless, ordered partition of every source row's original words. */
  ranges: LiveTranscriptReadingRange[];
};

type SuppressionCandidate = {
  sourceSegmentId: string;
  startWord: number;
  endWord: number;
  supportingSegmentIds: string[];
  confidence: number;
};

const originalWords = (text: string): OriginalWord[] =>
  [...text.matchAll(/\S+/gu)].map((match) => {
    const start = match.index ?? 0;
    const normalized = normalizedTokens(match[0]);
    return {
      text: match[0],
      start,
      end: start + match[0].length,
      normalized: normalized.length === 1 ? normalized[0] : null,
    };
  });

const verifiedTimedWords = (
  segment: LiveTranscriptSegment,
  words: OriginalWord[],
) => {
  const timings = segment.wordTimings;
  if (
    !timings ||
    timings.length !== words.length ||
    !timings.every((timing, index) => {
      const normalized = normalizedTokens(timing.text);
      return (
        normalized.length <= 1 &&
        (normalized[0] ?? null) === words[index].normalized &&
        Number.isFinite(timing.timestampMs) &&
        Number.isFinite(timing.endTimestampMs) &&
        timing.timestampMs >= 0 &&
        timing.endTimestampMs >= timing.timestampMs &&
        (index === 0 || timing.timestampMs >= timings[index - 1].timestampMs)
      );
    })
  )
    return undefined;
  return timings;
};

const legacyPresentationCandidate = (
  segment: LiveTranscriptSegment,
  presentation: NonNullable<LiveTranscriptSegment['presentation']>,
  words: OriginalWord[],
): SuppressionCandidate | undefined => {
  if (presentation.visibility === 'suppressed_echo')
    return {
      sourceSegmentId: segment.id,
      startWord: 0,
      endWord: words.length,
      supportingSegmentIds: [presentation.matchedSegmentId],
      confidence: presentation.confidence,
    };
  const retained = normalizedTokens(presentation.text);
  const original = words.flatMap((word) =>
    word.normalized ? [word.normalized] : [],
  );
  let result: SuppressionCandidate | undefined;
  for (let startWord = 0; startWord < words.length; startWord += 1) {
    for (let endWord = startWord + 1; endWord <= words.length; endWord += 1) {
      const projected = words
        .slice(0, startWord)
        .concat(words.slice(endWord))
        .flatMap((word) => (word.normalized ? [word.normalized] : []));
      if (
        projected.length !== retained.length ||
        !projected.every((token, index) => token === retained[index])
      )
        continue;
      if (!result || endWord - startWord > result.endWord - result.startWord)
        result = {
          sourceSegmentId: segment.id,
          startWord,
          endWord,
          supportingSegmentIds: [presentation.matchedSegmentId],
          confidence: presentation.confidence,
        };
    }
  }
  return original.length ? result : undefined;
};

/**
 * Builds reversible display ranges from raw rows. Newly generalized interior
 * suppression is exact, time-aligned and acoustically corroborated; uncertain
 * wording therefore remains visible.
 */
export const reconcileLiveTranscriptReading = (input: {
  segments: LiveTranscriptSegment[];
  activityWindows: SpeakerActivityWindow[];
  echoEvidence?: LiveEchoEvidenceWindow[];
}): LiveTranscriptReading => {
  const segments = input.segments.map((segment) => {
    if (!segment.presentation) return segment;
    const { presentation: _presentation, ...raw } = segment;
    return raw;
  });
  const legacy = reconcileLiveTranscriptSegments({ ...input, segments });
  const { evidenceInRange } = createEchoEvidenceLookup(
    input.echoEvidence ?? [],
  );
  const systemRows = segments
    .filter((segment) => segment.source === 'system')
    .sort((left, right) => left.timestampMs - right.timestampMs);
  const candidates: SuppressionCandidate[] = [];

  for (const mic of segments.filter((segment) => segment.source === 'mic')) {
    const micWords = originalWords(mic.text);
    const micTimes = verifiedTimedWords(mic, micWords);
    if (
      micTimes &&
      micWords.length <= MAX_ALIGNMENT_TOKENS &&
      input.echoEvidence?.length
    ) {
      for (const system of systemRows) {
        if (endMs(system) < mic.timestampMs - MAX_BOUNDARY_SKEW_MS) continue;
        if (system.timestampMs > endMs(mic) + MAX_BOUNDARY_SKEW_MS) break;
        const systemWords = originalWords(system.text);
        if (systemWords.length > MAX_ALIGNMENT_TOKENS) continue;
        const systemTimes = verifiedTimedWords(system, systemWords);
        if (!systemTimes) continue;
        const micTimedTokens = micWords.map((word, index) => ({
          ...micTimes[index],
          text: word.normalized ?? `__unmatchable_mic_${index}`,
        }));
        const systemTimedTokens = systemWords.map((word, index) => ({
          ...systemTimes[index],
          text: word.normalized ?? `__unmatchable_system_${index}`,
        }));
        for (const {
          micStartToken: micStart,
          tokenCount,
        } of findSupportedExactEchoSpans(
          micTimedTokens,
          systemTimedTokens,
          evidenceInRange,
        )) {
          const micEnd = micStart + tokenCount;
          candidates.push({
            sourceSegmentId: mic.id,
            startWord: micStart,
            endWord: micEnd,
            supportingSegmentIds: [system.id],
            confidence: 1,
          });
        }
      }
    }
    const legacyRow = legacy.find((segment) => segment.id === mic.id);
    if (legacyRow?.presentation) {
      const candidate = legacyPresentationCandidate(
        mic,
        legacyRow.presentation,
        micWords,
      );
      if (candidate) candidates.push(candidate);
    }
  }

  const selected = new Map<string, SuppressionCandidate[]>();
  for (const candidate of candidates.sort(
    (left, right) =>
      right.confidence - left.confidence ||
      right.endWord - right.startWord - (left.endWord - left.startWord) ||
      left.startWord - right.startWord ||
      left.sourceSegmentId.localeCompare(right.sourceSegmentId) ||
      left.supportingSegmentIds[0].localeCompare(right.supportingSegmentIds[0]),
  )) {
    const ranges = selected.get(candidate.sourceSegmentId) ?? [];
    if (
      ranges.some(
        (range) =>
          range.startWord < candidate.endWord &&
          candidate.startWord < range.endWord,
      )
    )
      continue;
    ranges.push(candidate);
    selected.set(candidate.sourceSegmentId, ranges);
  }

  const ranges: LiveTranscriptReadingRange[] = [];
  for (const segment of segments) {
    const source = segment.source;
    if (source !== 'mic' && source !== 'system') continue;
    const words = originalWords(segment.text);
    if (!words.length) continue;
    const timings = verifiedTimedWords(segment, words);
    const suppressed = [...(selected.get(segment.id) ?? [])].sort(
      (left, right) => left.startWord - right.startWord,
    );
    let cursor = 0;
    const append = (
      startWord: number,
      endWord: number,
      candidate?: SuppressionCandidate,
    ) => {
      if (startWord >= endWord) return;
      const startCharacter = words[startWord].start;
      const endCharacter = words[endWord - 1].end;
      const visibility = candidate ? 'suppressed_echo' : 'visible';
      ranges.push({
        id: `${segment.id}:${startWord}:${endWord}:${visibility}`,
        sourceSegmentId: segment.id,
        source,
        startWord,
        endWord,
        startCharacter,
        endCharacter,
        text: segment.text.slice(startCharacter, endCharacter),
        timestampMs: timings?.[startWord]?.timestampMs ?? segment.timestampMs,
        endTimestampMs:
          timings?.[endWord - 1]?.endTimestampMs ?? endMs(segment),
        visibility,
        supportingSegmentIds: candidate?.supportingSegmentIds ?? [],
        ...(candidate ? { confidence: candidate.confidence } : {}),
      });
    };
    for (const candidate of suppressed) {
      append(cursor, candidate.startWord);
      append(candidate.startWord, candidate.endWord, candidate);
      cursor = candidate.endWord;
    }
    append(cursor, words.length);
  }
  return { segments, ranges };
};
