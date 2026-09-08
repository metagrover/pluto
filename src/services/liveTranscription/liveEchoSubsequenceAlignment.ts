import type { LiveEchoEvidenceWindow } from './liveEchoEvidence';
import { isProtectedEchoWord } from './liveEchoTokenAlignment';

type TimedToken = { text: string; timestampMs: number; endTimestampMs: number };
type EvidenceLookup = (start: number, end: number) => LiveEchoEvidenceWindow[];
const MIN_ANCHOR_WORDS = 12;
const MAX_CHAIN_MS = 30_000;

const supportsOnset = (mic: TimedToken, system: TimedToken, lag: number) => {
  const onset = mic.timestampMs - lag;
  // EOU starts are independently quantized. A padded System word cannot lend
  // its silent tail to an unrelated later repetition of the same word.
  return (
    onset >= system.timestampMs - 250 &&
    onset <=
      (system.endTimestampMs - system.timestampMs <= 750
        ? system.endTimestampMs + 80
        : system.timestampMs + 250)
  );
};

const anchorLag = (
  mic: TimedToken[],
  system: TimedToken[],
  evidence: EvidenceLookup,
) => {
  const first = mic[0];
  const last = mic.at(-1)!;
  const systemLast = system.at(-1)!;
  const end =
    last.timestampMs + Math.min(750, last.endTimestampMs - last.timestampMs);
  const systemEnd =
    systemLast.timestampMs +
    Math.min(750, systemLast.endTimestampMs - systemLast.timestampMs);
  let covered = 0;
  let coveredEnd = Number.NEGATIVE_INFINITY;
  let weightedLag = 0;
  let minLag = Number.POSITIVE_INFINITY;
  let maxLag = Number.NEGATIVE_INFINITY;
  for (const window of evidence(first.timestampMs, end)) {
    const lag = window.micStartMs - window.systemStartMs;
    const start = Math.max(
      first.timestampMs,
      window.micStartMs,
      system[0].timestampMs + lag,
    );
    const finish = Math.min(
      end,
      window.micEndMs,
      window.systemEndMs + lag,
      systemEnd + lag,
    );
    const duration = Math.max(0, finish - Math.max(start, coveredEnd));
    if (!duration) continue;
    minLag = Math.min(minLag, lag);
    maxLag = Math.max(maxLag, lag);
    covered += duration;
    weightedLag += duration * lag;
    coveredEnd = Math.max(coveredEnd, finish);
  }
  return covered >= 1_000 && maxLag - minLag <= 30
    ? weightedLag / covered
    : undefined;
};

/** Enumerates independently supported exact spans without joining across a
 * local microphone insertion. Candidate conflict resolution stays with the
 * caller because ranges can be supported by several System rows. */
export const findSupportedExactEchoSpans = (
  mic: TimedToken[],
  system: TimedToken[],
  evidence: EvidenceLookup,
): Array<{
  micStartToken: number;
  systemStartToken: number;
  tokenCount: number;
}> => {
  const spans: Array<{
    micStartToken: number;
    systemStartToken: number;
    tokenCount: number;
  }> = [];
  for (
    let micStart = 0;
    micStart <= mic.length - MIN_ANCHOR_WORDS;
    micStart++
  ) {
    for (
      let systemStart = 0;
      systemStart <= system.length - MIN_ANCHOR_WORDS;
      systemStart++
    ) {
      if (
        mic[micStart].text !== system[systemStart].text ||
        Math.abs(mic[micStart].timestampMs - system[systemStart].timestampMs) >
          1_250 ||
        (micStart > 0 &&
          systemStart > 0 &&
          mic[micStart - 1].text === system[systemStart - 1].text)
      )
        continue;
      let tokenCount = 0;
      while (
        micStart + tokenCount < mic.length &&
        systemStart + tokenCount < system.length &&
        mic[micStart + tokenCount].text ===
          system[systemStart + tokenCount].text &&
        mic[micStart + tokenCount].timestampMs - mic[micStart].timestampMs <=
          MAX_CHAIN_MS
      )
        tokenCount++;
      if (tokenCount < MIN_ANCHOR_WORDS) continue;
      const lag = anchorLag(
        mic.slice(micStart, micStart + tokenCount),
        system.slice(systemStart, systemStart + tokenCount),
        evidence,
      );
      if (
        lag === undefined ||
        !mic
          .slice(micStart, micStart + tokenCount)
          .every((word, index) =>
            supportsOnset(word, system[systemStart + index], lag),
          )
      )
        continue;
      spans.push({
        micStartToken: micStart,
        systemStartToken: systemStart,
        tokenCount,
      });
    }
  }
  return spans;
};

/** Directional exact alignment: System words may be absent from microphone ASR.
 * Every removed microphone word must still match its own System word and onset.
 * Only the long anchor has PCM corroboration; short exact continuations use the
 * measured lag and source word timing, not invented per-word acoustic proof. */
export const findExactEchoSubsequence = (
  mic: TimedToken[],
  system: TimedToken[],
  evidence: EvidenceLookup,
): { startToken: number; tokenCount: number } | undefined => {
  let best: { startToken: number; tokenCount: number } | undefined;
  for (let start = 0; start <= mic.length - MIN_ANCHOR_WORDS; start++) {
    for (let remote = 0; remote <= system.length - MIN_ANCHOR_WORDS; remote++) {
      if (
        mic[start].text !== system[remote].text ||
        Math.abs(mic[start].timestampMs - system[remote].timestampMs) > 1_250
      )
        continue;
      let anchor = 0;
      while (
        start + anchor < mic.length &&
        remote + anchor < system.length &&
        mic[start + anchor].text === system[remote + anchor].text
      )
        anchor++;
      if (anchor < MIN_ANCHOR_WORDS) continue;
      const lag = anchorLag(
        mic.slice(start, start + anchor),
        system.slice(remote, remote + anchor),
        evidence,
      );
      if (
        lag === undefined ||
        !mic
          .slice(start, start + anchor)
          .every((word, index) =>
            supportsOnset(word, system[remote + index], lag),
          )
      )
        continue;
      let count = anchor;
      let nextSystem = remote + anchor;
      let skipped =
        remote > 0 &&
        (start === 0 || mic[start - 1].text !== system[remote - 1].text)
          ? remote
          : 0;
      let blocked = false;
      while (start + count < mic.length && nextSystem < system.length) {
        const word = mic[start + count];
        if (word.timestampMs - mic[start].timestampMs > MAX_CHAIN_MS) break;
        let matched = -1;
        for (let index = nextSystem; index < system.length; index++) {
          if (system[index].timestampMs > word.timestampMs - lag + 250) break;
          if (
            word.text === system[index].text &&
            supportsOnset(word, system[index], lag)
          ) {
            matched = index;
            break;
          }
          if (isProtectedEchoWord(system[index].text)) {
            blocked = true;
            break;
          }
        }
        if (matched < 0 || blocked) break;
        skipped += matched - nextSystem;
        count++;
        nextSystem = matched + 1;
      }
      const omittedSystemWords =
        skipped > 0 ||
        (start + count === mic.length && nextSystem < system.length);
      if (
        omittedSystemWords &&
        !blocked &&
        !system
          .slice(0, remote)
          .some((word) => isProtectedEchoWord(word.text)) &&
        !(
          start + count === mic.length &&
          system
            .slice(nextSystem)
            .some((word) => isProtectedEchoWord(word.text))
        ) &&
        count > (best?.tokenCount ?? 0) &&
        mic[start + count - 1].timestampMs - mic[start].timestampMs <=
          MAX_CHAIN_MS
      )
        best = { startToken: start, tokenCount: count };
    }
  }
  return best;
};

/** Match only source-owned words, across independent checkpoint boundaries.
 * Unmatched words are never consumed, including local additions and corrections. */
export const findSupportedEchoWordMatches = (
  mic: TimedToken[],
  system: TimedToken[],
  evidence: EvidenceLookup,
): Array<{ micIndex: number; systemIndex: number }> => {
  const matches: Array<{ micIndex: number; systemIndex: number }> = [];
  let cursor = 0;
  for (let index = 0; index < mic.length; index++) {
    const word = mic[index];
    let best = -1;
    let distance = 1_251;
    for (let remote = cursor; remote < system.length; remote++) {
      const candidate = system[remote];
      if (candidate.timestampMs > word.timestampMs + 1_250) break;
      const delta = Math.abs(candidate.timestampMs - word.timestampMs);
      if (candidate.text === word.text && delta < distance) {
        best = remote;
        distance = delta;
      }
    }
    if (best < 0) continue;
    matches.push({ micIndex: index, systemIndex: best });
    cursor = best + 1;
  }
  const supported = new Map<
    number,
    { micIndex: number; systemIndex: number }
  >();
  // Short overlapping anchors tolerate slow changes in acoustic lag without
  // allowing an unsupported word to borrow evidence from distant speech.
  for (let start = 0; start <= matches.length - MIN_ANCHOR_WORDS; start += 8) {
    const chunk = matches.slice(start, start + 24);
    const first = chunk[0];
    const last = chunk.at(-1)!;
    if (
      chunk.length /
        Math.max(
          last.micIndex - first.micIndex + 1,
          last.systemIndex - first.systemIndex + 1,
        ) <
        0.8 ||
      mic[last.micIndex].timestampMs - mic[first.micIndex].timestampMs >
        MAX_CHAIN_MS
    )
      continue;
    const lag = anchorLag(
      chunk.map(({ micIndex }) => mic[micIndex]),
      chunk.map(({ systemIndex }) => system[systemIndex]),
      evidence,
    );
    if (lag === undefined) continue;
    const aligned = chunk.filter(({ micIndex, systemIndex }) =>
      supportsOnset(mic[micIndex], system[systemIndex], lag),
    );
    if (aligned.length < MIN_ANCHOR_WORDS) continue;
    for (const match of aligned) supported.set(match.micIndex, match);
  }
  return [...supported.values()].sort((a, b) => a.micIndex - b.micIndex);
};
