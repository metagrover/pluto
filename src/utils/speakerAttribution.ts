import { TRANSCRIPTION_TUNING } from './transcriptionConfig.ts';

const TRANSCRIPT_DEBUG_ENABLED: boolean =
  (typeof process !== 'undefined' &&
    typeof process.env !== 'undefined' &&
    process.env.PLUTO_TRANSCRIPT_DEBUG === '1') ||
  Boolean(
    (globalThis as unknown as { __PLUTO_TRANSCRIPT_DEBUG__?: unknown })
      .__PLUTO_TRANSCRIPT_DEBUG__ === true,
  );

export interface WordTimestamp {
  word: string;
  start: number;
  end: number;
}

export interface AttributionSegment {
  startTime: number;
  endTime: number;
  text: string;
  speaker: string;
  words?: WordTimestamp[];
  nearEndEvidence?: boolean;
}

export interface ResolveDuplicateStats {
  candidatePairs: number;
  resolvedPairs: number;
  droppedMe: number;
  droppedThem: number;
}

export interface ResolveDuplicateResult<T extends AttributionSegment> {
  segments: T[];
  stats: ResolveDuplicateStats;
}

export interface MeBleedStripResult<T extends AttributionSegment> {
  segments: T[];
  droppedMe: number;
}

export interface DropShortEchoResult<T extends AttributionSegment> {
  segments: T[];
  dropped: number;
}

export interface SpeakerActivityWindow {
  startTime: number;
  endTime: number;
  speaker: 'Me' | 'Them';
}

export interface CanonicalSpeakerAttributionStats {
  byOverlap: number;
  byActivity: number;
  byFallback: number;
  /** RMS windows contradicted overlap/proximity winner */
  byRmsActivityOverride: number;
}

export interface CanonicalSpeakerAttributionResult<
  T extends AttributionSegment,
> {
  segments: T[];
  stats: CanonicalSpeakerAttributionStats;
}

const normalizeText = (text: string): string => {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

const textCoverage = (query: string, reference: string): number => {
  const qTokens = new Set(normalizeText(query).split(' ').filter(Boolean));
  const rTokens = new Set(normalizeText(reference).split(' ').filter(Boolean));
  if (qTokens.size === 0) return 0;
  let covered = 0;
  for (const w of qTokens) if (rTokens.has(w)) covered++;
  return covered / qTokens.size;
};

const tokenSetSimilarity = (left: string, right: string): number => {
  const leftTokens = new Set(normalizeText(left).split(' ').filter(Boolean));
  const rightTokens = new Set(normalizeText(right).split(' ').filter(Boolean));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;

  let intersection = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) intersection++;
  }
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return union > 0 ? intersection / union : 0;
};

const tokenPrefixSimilarity = (
  left: string,
  right: string,
  maxPrefixTokens = 10,
): number => {
  const leftTokens = normalizeText(left).split(' ').filter(Boolean);
  const rightTokens = normalizeText(right).split(' ').filter(Boolean);
  const shared = Math.min(
    leftTokens.length,
    rightTokens.length,
    maxPrefixTokens,
  );
  if (shared === 0) return 0;
  let matched = 0;
  for (let i = 0; i < shared; i++) {
    if (leftTokens[i] !== rightTokens[i]) break;
    matched++;
  }
  return matched / shared;
};

const overlapSeconds = (
  a: AttributionSegment,
  b: AttributionSegment,
): number => {
  return Math.max(
    0,
    Math.min(a.endTime, b.endTime) - Math.max(a.startTime, b.startTime),
  );
};

const activityCoverage = (
  startTime: number,
  endTime: number,
  speaker: 'Me' | 'Them',
  windows: SpeakerActivityWindow[],
): number => {
  if (endTime <= startTime || windows.length === 0) return 0;
  let total = 0;
  for (const window of windows) {
    if (window.speaker !== speaker) continue;
    const overlap = Math.max(
      0,
      Math.min(endTime, window.endTime) - Math.max(startTime, window.startTime),
    );
    total += overlap;
  }
  return total;
};

export const isCrossChannelDuplicatePair = (
  left: AttributionSegment,
  right: AttributionSegment,
): {
  duplicate: boolean;
  overlapRatio: number;
  tokenSim: number;
  prefixSim: number;
} => {
  const overlap = overlapSeconds(left, right);
  if (overlap <= 0)
    return { duplicate: false, overlapRatio: 0, tokenSim: 0, prefixSim: 0 };

  const leftDur = Math.max(0.01, left.endTime - left.startTime);
  const rightDur = Math.max(0.01, right.endTime - right.startTime);
  const overlapRatio = overlap / Math.min(leftDur, rightDur);
  if (overlapRatio < 0.45) {
    return { duplicate: false, overlapRatio, tokenSim: 0, prefixSim: 0 };
  }

  const leftNorm = normalizeText(left.text);
  const rightNorm = normalizeText(right.text);
  if (!leftNorm || !rightNorm) {
    return { duplicate: false, overlapRatio, tokenSim: 0, prefixSim: 0 };
  }

  if (leftNorm === rightNorm) {
    return { duplicate: true, overlapRatio, tokenSim: 1, prefixSim: 1 };
  }

  const shorter = Math.min(leftNorm.length, rightNorm.length);
  const longer = Math.max(leftNorm.length, rightNorm.length);
  const contains =
    shorter >= 20 &&
    shorter / longer >= 0.75 &&
    (leftNorm.includes(rightNorm) || rightNorm.includes(leftNorm));
  if (contains) {
    return { duplicate: true, overlapRatio, tokenSim: 0.9, prefixSim: 0.9 };
  }

  const tokenSim = tokenSetSimilarity(leftNorm, rightNorm);
  const prefixSim = tokenPrefixSimilarity(leftNorm, rightNorm);
  const duplicate =
    tokenSim >= 0.56 ||
    prefixSim >= 0.6 ||
    (tokenSim >= 0.48 && overlapRatio >= 0.6);
  return { duplicate, overlapRatio, tokenSim, prefixSim };
};

const soundex = (value: string): string => {
  const normalized = normalizeText(value).replaceAll(' ', '');
  if (!normalized) return '';
  const code = (character: string): string => {
    if ('bfpv'.includes(character)) return '1';
    if ('cgjkqsxz'.includes(character)) return '2';
    if ('dt'.includes(character)) return '3';
    if (character === 'l') return '4';
    if ('mn'.includes(character)) return '5';
    if (character === 'r') return '6';
    return '0';
  };
  let result = normalized[0].toUpperCase();
  let previous = code(normalized[0]);
  for (const character of normalized.slice(1)) {
    const next = code(character);
    if (next !== '0' && next !== previous) result += next;
    previous = next;
    if (result.length === 4) break;
  }
  return result.padEnd(4, '0');
};

const boundedTokenMatch = (left: string, right: string): boolean =>
  left === right ||
  (Math.min(left.length, right.length) >= 4 &&
    (left.startsWith(right.slice(0, 4)) ||
      right.startsWith(left.slice(0, 4)))) ||
  (Math.min(left.length, right.length) >= 3 &&
    soundex(left) === soundex(right));

export const isBoundedPhoneticEchoPair = (
  mic: AttributionSegment,
  remote: AttributionSegment,
): boolean => {
  if (mic.nearEndEvidence === true) return false;
  const micTokens = normalizeText(mic.text).split(' ').filter(Boolean);
  const remoteTokens = normalizeText(remote.text).split(' ').filter(Boolean);
  if (
    micTokens.length < 2 ||
    micTokens.length > 4 ||
    remoteTokens.length <= micTokens.length
  ) {
    return false;
  }
  const micDuration = Math.max(0.01, mic.endTime - mic.startTime);
  if (overlapSeconds(mic, remote) / micDuration < 0.8) return false;

  const usedRemote = new Set<number>();
  let matched = 0;
  for (const micToken of micTokens) {
    const matchIndex = remoteTokens.findIndex(
      (remoteToken, index) =>
        !usedRemote.has(index) && boundedTokenMatch(micToken, remoteToken),
    );
    if (matchIndex < 0) continue;
    usedRemote.add(matchIndex);
    matched += 1;
  }
  return matched >= Math.ceil(micTokens.length / 2);
};

const wordCount = (text: string): number =>
  normalizeText(text).split(' ').filter(Boolean).length;

const containsTokenSequence = (
  haystack: string[],
  needle: string[],
): boolean => {
  if (needle.length === 0 || haystack.length < needle.length) return false;
  for (let start = 0; start <= haystack.length - needle.length; start++) {
    let matches = true;
    for (let i = 0; i < needle.length; i++) {
      if (haystack[start + i] !== needle[i]) {
        matches = false;
        break;
      }
    }
    if (matches) return true;
  }
  return false;
};

const hasHeavyRepetition = (text: string): boolean => {
  const tokens = normalizeText(text).split(' ').filter(Boolean);
  if (tokens.length < 8) return false;
  const freq = new Map<string, number>();
  let maxTokenFreq = 0;
  for (const token of tokens) {
    const next = (freq.get(token) || 0) + 1;
    freq.set(token, next);
    if (next > maxTokenFreq) maxTokenFreq = next;
  }
  const uniqueRatio = freq.size / tokens.length;
  return uniqueRatio <= 0.58 || maxTokenFreq >= 4;
};

const isQuestionLike = (text: string): boolean => {
  const raw = String(text || '').trim();
  if (!raw) return false;
  const normalized = normalizeText(raw);
  if (!normalized) return false;
  if (raw.includes('?')) return true;
  return /^(do you|did you|are you|can you|could you|would you|will you|what|why|how|when|where|who)\b/.test(
    normalized,
  );
};

const pickDuplicateWinner = (
  me: AttributionSegment,
  them: AttributionSegment,
  overlapRatio: number,
  tokenSim: number,
  prefixSim: number,
): 'Me' | 'Them' => {
  const meWords = wordCount(me.text);
  const themWords = wordCount(them.text);
  const meDur = Math.max(0.01, me.endTime - me.startTime);
  const themDur = Math.max(0.01, them.endTime - them.startTime);
  const meNorm = normalizeText(me.text);
  const themNorm = normalizeText(them.text);
  const meRepetitive = hasHeavyRepetition(me.text);
  const themRepetitive = hasHeavyRepetition(them.text);

  if ((tokenSim >= 0.58 || prefixSim >= 0.6) && overlapRatio >= 0.45) {
    if (themRepetitive && !meRepetitive) return 'Me';
    if (meRepetitive && !themRepetitive) return 'Them';
  }

  // For short high-similarity overlap, bias toward preserving "Them".
  // Long-form overlap is frequently ambiguous bleed and should require stronger evidence.
  if (
    (tokenSim >= 0.72 || prefixSim >= 0.72) &&
    overlapRatio >= 0.55 &&
    Math.min(meDur, themDur) <= 4.5
  ) {
    return 'Them';
  }
  if ((tokenSim >= 0.66 || prefixSim >= 0.68) && overlapRatio >= 0.5) {
    return 'Them';
  }

  if (meNorm.includes(themNorm) && meWords >= themWords + 7) return 'Me';
  if (themNorm.includes(meNorm) && themWords >= meWords + 2) return 'Them';

  if (meWords >= themWords + 8 && meDur >= themDur * 1.45) return 'Me';
  if (themWords >= meWords + 2) return 'Them';
  if (themDur >= meDur * 1.15) return 'Them';

  // Conservative default for unresolved duplicates: prefer system channel.
  return 'Them';
};

export const resolveCrossChannelDuplicates = <T extends AttributionSegment>(
  segments: T[],
): ResolveDuplicateResult<T> => {
  if (segments.length < 2) {
    return {
      segments: [...segments],
      stats: {
        candidatePairs: 0,
        resolvedPairs: 0,
        droppedMe: 0,
        droppedThem: 0,
      },
    };
  }

  type Candidate = {
    meIndex: number;
    themIndex: number;
    score: number;
    overlapRatio: number;
    tokenSim: number;
    prefixSim: number;
  };

  const candidates: Candidate[] = [];
  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      const left = segments[i];
      const right = segments[j];
      const speakers = new Set([left.speaker, right.speaker]);
      if (!speakers.has('Me') || !speakers.has('Them')) continue;

      const meIndex = left.speaker === 'Me' ? i : j;
      const themIndex = left.speaker === 'Them' ? i : j;
      const me = segments[meIndex];
      const them = segments[themIndex];

      const decision = isCrossChannelDuplicatePair(me, them);
      if (!decision.duplicate) continue;

      const score =
        decision.overlapRatio + decision.tokenSim + decision.prefixSim;
      candidates.push({
        meIndex,
        themIndex,
        score,
        overlapRatio: decision.overlapRatio,
        tokenSim: decision.tokenSim,
        prefixSim: decision.prefixSim,
      });
    }
  }

  if (candidates.length === 0) {
    return {
      segments: [...segments],
      stats: {
        candidatePairs: 0,
        resolvedPairs: 0,
        droppedMe: 0,
        droppedThem: 0,
      },
    };
  }

  candidates.sort((a, b) => b.score - a.score);
  const matchedMe = new Set<number>();
  const matchedThem = new Set<number>();
  const dropped = new Set<number>();
  let droppedMe = 0;
  let droppedThem = 0;
  let resolvedPairs = 0;

  for (const candidate of candidates) {
    if (
      matchedMe.has(candidate.meIndex) ||
      matchedThem.has(candidate.themIndex)
    )
      continue;
    if (dropped.has(candidate.meIndex) || dropped.has(candidate.themIndex))
      continue;

    const me = segments[candidate.meIndex];
    const them = segments[candidate.themIndex];
    const winner = pickDuplicateWinner(
      me,
      them,
      candidate.overlapRatio,
      candidate.tokenSim,
      candidate.prefixSim,
    );
    const dropIndex = winner === 'Me' ? candidate.themIndex : candidate.meIndex;
    dropped.add(dropIndex);
    if (dropIndex === candidate.meIndex) droppedMe++;
    else droppedThem++;
    matchedMe.add(candidate.meIndex);
    matchedThem.add(candidate.themIndex);
    resolvedPairs++;
  }

  return {
    segments: segments.filter((_, index) => !dropped.has(index)),
    stats: {
      candidatePairs: candidates.length,
      resolvedPairs,
      droppedMe,
      droppedThem,
    },
  };
};

const isNearDuplicatePair = (
  left: AttributionSegment,
  right: AttributionSegment,
): {
  nearDuplicate: boolean;
  overlapRatio: number;
  tokenSim: number;
  prefixSim: number;
} => {
  const nd = TRANSCRIPTION_TUNING.overlapNearDuplicate;
  const overlap = overlapSeconds(left, right);
  if (overlap <= 0) {
    return { nearDuplicate: false, overlapRatio: 0, tokenSim: 0, prefixSim: 0 };
  }

  const leftDur = Math.max(0.01, left.endTime - left.startTime);
  const rightDur = Math.max(0.01, right.endTime - right.startTime);
  const overlapRatio = overlap / Math.min(leftDur, rightDur);
  if (overlapRatio < nd.minOverlapRatio || overlap < nd.minOverlapSeconds) {
    return { nearDuplicate: false, overlapRatio, tokenSim: 0, prefixSim: 0 };
  }

  const dup = isCrossChannelDuplicatePair(left, right);
  if (dup.duplicate) {
    return {
      nearDuplicate: false,
      overlapRatio,
      tokenSim: dup.tokenSim,
      prefixSim: dup.prefixSim,
    };
  }

  const leftNorm = normalizeText(left.text);
  const rightNorm = normalizeText(right.text);
  if (!leftNorm || !rightNorm) {
    return { nearDuplicate: false, overlapRatio, tokenSim: 0, prefixSim: 0 };
  }

  const tokenSim = tokenSetSimilarity(left.text, right.text);
  const prefixSim = tokenPrefixSimilarity(left.text, right.text);
  const nearDuplicate =
    tokenSim >= nd.minTokenSim ||
    prefixSim >= nd.minPrefixSim ||
    (tokenSim >= nd.minTokenSim - 0.05 && overlapRatio >= 0.42);
  return { nearDuplicate, overlapRatio, tokenSim, prefixSim };
};

/**
 * Greedy one-to-one collapse for cross-channel paraphrases / skewed boundaries
 * that miss strict {@link isCrossChannelDuplicatePair}. Run after {@link resolveCrossChannelDuplicates}.
 */
export const resolveCrossChannelNearDuplicates = <T extends AttributionSegment>(
  segments: T[],
): ResolveDuplicateResult<T> => {
  if (segments.length < 2) {
    return {
      segments: [...segments],
      stats: {
        candidatePairs: 0,
        resolvedPairs: 0,
        droppedMe: 0,
        droppedThem: 0,
      },
    };
  }

  type Candidate = {
    meIndex: number;
    themIndex: number;
    score: number;
    overlapRatio: number;
    tokenSim: number;
    prefixSim: number;
  };

  const candidates: Candidate[] = [];
  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      const left = segments[i];
      const right = segments[j];
      const speakers = new Set([left.speaker, right.speaker]);
      if (!speakers.has('Me') || !speakers.has('Them')) continue;

      const meIndex = left.speaker === 'Me' ? i : j;
      const themIndex = left.speaker === 'Them' ? i : j;
      const me = segments[meIndex];
      const them = segments[themIndex];

      const decision = isNearDuplicatePair(me, them);
      if (!decision.nearDuplicate) continue;

      const score =
        decision.overlapRatio + decision.tokenSim + decision.prefixSim;
      candidates.push({
        meIndex,
        themIndex,
        score,
        overlapRatio: decision.overlapRatio,
        tokenSim: decision.tokenSim,
        prefixSim: decision.prefixSim,
      });
    }
  }

  if (candidates.length === 0) {
    return {
      segments: [...segments],
      stats: {
        candidatePairs: 0,
        resolvedPairs: 0,
        droppedMe: 0,
        droppedThem: 0,
      },
    };
  }

  candidates.sort((a, b) => b.score - a.score);
  const matchedMe = new Set<number>();
  const matchedThem = new Set<number>();
  const dropped = new Set<number>();
  let droppedMe = 0;
  let droppedThem = 0;
  let resolvedPairs = 0;

  for (const candidate of candidates) {
    if (
      matchedMe.has(candidate.meIndex) ||
      matchedThem.has(candidate.themIndex)
    )
      continue;
    if (dropped.has(candidate.meIndex) || dropped.has(candidate.themIndex))
      continue;

    const me = segments[candidate.meIndex];
    const them = segments[candidate.themIndex];
    const winner = pickDuplicateWinner(
      me,
      them,
      candidate.overlapRatio,
      candidate.tokenSim,
      candidate.prefixSim,
    );
    const dropIndex = winner === 'Me' ? candidate.themIndex : candidate.meIndex;
    dropped.add(dropIndex);
    if (dropIndex === candidate.meIndex) droppedMe++;
    else droppedThem++;
    matchedMe.add(candidate.meIndex);
    matchedThem.add(candidate.themIndex);
    resolvedPairs++;
  }

  return {
    segments: segments.filter((_, index) => !dropped.has(index)),
    stats: {
      candidatePairs: candidates.length,
      resolvedPairs,
      droppedMe,
      droppedThem,
    },
  };
};

/**
 * When both Me and Them channels overlap a segment (bleed), use word-level
 * timestamps to determine which words belong to which speaker, then split
 * the segment at speaker boundaries.
 * Returns null if words aren't available or all words map to a single speaker.
 */
const splitSegmentByWordSpeakers = <T extends AttributionSegment>(
  segment: T,
  meSegs: AttributionSegment[],
  themSegs: AttributionSegment[],
): T[] | null => {
  if (!segment.words || segment.words.length === 0) return null;

  const MIN_WORD_OVERLAP_SEC = 0.05;
  const wordSpeakers: (('Me' | 'Them') | null)[] = segment.words.map((w) => {
    const meHit = meSegs.some(
      (m) =>
        Math.min(w.end, m.endTime) - Math.max(w.start, m.startTime) >
        MIN_WORD_OVERLAP_SEC,
    );
    const themHit = themSegs.some(
      (t) =>
        Math.min(w.end, t.endTime) - Math.max(w.start, t.startTime) >
        MIN_WORD_OVERLAP_SEC,
    );
    if (meHit && themHit) return 'Them';
    if (meHit) return 'Me';
    if (themHit) return 'Them';
    return null;
  });

  for (let i = 0; i < wordSpeakers.length; i++) {
    if (!wordSpeakers[i] && i > 0) wordSpeakers[i] = wordSpeakers[i - 1];
  }
  for (let i = wordSpeakers.length - 2; i >= 0; i--) {
    if (!wordSpeakers[i]) wordSpeakers[i] = wordSpeakers[i + 1];
  }
  if (wordSpeakers.every((s) => !s)) return null;

  const groups: T[] = [];
  let groupStart = 0;
  for (let i = 1; i <= wordSpeakers.length; i++) {
    if (
      i === wordSpeakers.length ||
      wordSpeakers[i] !== wordSpeakers[groupStart]
    ) {
      const words = segment.words?.slice(groupStart, i) ?? [];
      groups.push({
        ...segment,
        speaker: wordSpeakers[groupStart] ?? 'Me',
        text: words
          .map((w) => w.word)
          .join(' ')
          .trim(),
        startTime: words[0].start,
        endTime: words[words.length - 1].end,
        words,
      });
      groupStart = i;
    }
  }

  if (groups.length <= 1) return null;
  return groups;
};

/**
 * Assign speakers to canonical segments using channel overlap.
 * Both channels present → word-level split if available, else Them (bleed).
 * Only Me channel → Me. Only Them channel → Them if text matches, else Me
 * (canonical captured something the Them channel didn't say). Neither → last.
 */
export const assignSpeakersToCanonicalSegments = <
  T extends AttributionSegment,
>(params: {
  canonicalSegments: T[];
  attributedSegments: AttributionSegment[];
}): CanonicalSpeakerAttributionResult<T> => {
  const { canonicalSegments, attributedSegments } = params;
  if (canonicalSegments.length === 0) {
    return {
      segments: [],
      stats: {
        byOverlap: 0,
        byActivity: 0,
        byFallback: 0,
        byRmsActivityOverride: 0,
      },
    };
  }

  const MIN_OVERLAP_SEC = 0.2;
  const COVERAGE_THRESHOLD = 0.5;
  const meSegs = attributedSegments.filter(
    (s) => s.speaker === 'Me' && (s.text || '').trim(),
  );
  const themSegs = attributedSegments.filter(
    (s) => s.speaker === 'Them' && (s.text || '').trim(),
  );

  const sorted = [...canonicalSegments].sort(
    (a, b) => a.startTime - b.startTime,
  );

  const assigned: T[] = [];
  let lastSpeaker: 'Me' | 'Them' = 'Me';
  let byOverlap = 0;
  let byFallback = 0;

  for (const segment of sorted) {
    const meOverlapping = meSegs.filter(
      (m) => overlapSeconds(segment, m) > MIN_OVERLAP_SEC,
    );
    const themOverlapping = themSegs.filter(
      (t) => overlapSeconds(segment, t) > MIN_OVERLAP_SEC,
    );

    if (meOverlapping.length > 0 && themOverlapping.length > 0) {
      const wordSplit = splitSegmentByWordSpeakers(
        segment,
        meOverlapping,
        themOverlapping,
      );
      if (wordSplit) {
        for (const sub of wordSplit) {
          lastSpeaker = sub.speaker as 'Me' | 'Them';
          assigned.push(sub);
        }
      } else {
        lastSpeaker = 'Them';
        assigned.push({ ...segment, speaker: 'Them' });
      }
      byOverlap++;
    } else if (meOverlapping.length > 0 && themOverlapping.length === 0) {
      lastSpeaker = 'Me';
      assigned.push({ ...segment, speaker: 'Me' });
      byOverlap++;
    } else {
      const bestOvCov =
        themOverlapping.length > 0
          ? Math.max(
              ...themOverlapping.map((t) => textCoverage(segment.text, t.text)),
            )
          : 0;
      let speaker: 'Me' | 'Them';
      if (bestOvCov >= COVERAGE_THRESHOLD) {
        speaker = 'Them';
        byOverlap++;
      } else {
        const bestMeCov =
          meSegs.length > 0
            ? Math.max(...meSegs.map((m) => textCoverage(segment.text, m.text)))
            : 0;
        const bestThemCov =
          themSegs.length > 0
            ? Math.max(
                ...themSegs.map((t) => textCoverage(segment.text, t.text)),
              )
            : 0;
        if (
          bestMeCov >= COVERAGE_THRESHOLD ||
          bestThemCov >= COVERAGE_THRESHOLD
        ) {
          speaker = bestThemCov > bestMeCov ? 'Them' : 'Me';
        } else {
          const wordCount = normalizeText(segment.text)
            .split(' ')
            .filter(Boolean).length;
          speaker = wordCount < 3 ? lastSpeaker : 'Me';
        }
        byFallback++;
      }
      lastSpeaker = speaker;
      assigned.push({ ...segment, speaker });
    }
  }

  return {
    segments: assigned,
    stats: { byOverlap, byActivity: 0, byFallback, byRmsActivityOverride: 0 },
  };
};

/** Remote participant hedging / planning — often mis-tagged as Me after a question. */
const isRemoteStyleUncertaintyAnswer = (text: string): boolean => {
  const n = normalizeText(text);
  if (!n) return false;
  return (
    n.startsWith('i don t know') ||
    n.startsWith('i dont know') ||
    n.startsWith('not sure') ||
    n.startsWith('i m not sure') ||
    n.startsWith('i am not sure') ||
    n.startsWith('hmm') ||
    n.startsWith('uh ') ||
    (n.startsWith('well') &&
      (n.includes('don t know') || n.includes('dont know')))
  );
};

const isLocalAffirmOrCorrection = (text: string): boolean => {
  const n = normalizeText(text);
  if (!n) return false;
  if (n.includes('correction')) return true;
  return (
    n.startsWith('oh yeah') ||
    n.startsWith('oh ok') ||
    n.startsWith('oh okay') ||
    n.startsWith('yeah yeah') ||
    (n.startsWith('yeah') && n.includes('correction'))
  );
};

const isVeryShortConfirmation = (text: string): boolean => {
  const n = normalizeText(text);
  return (
    n === 'yes' ||
    n === 'no' ||
    n === 'yeah' ||
    n === 'yep' ||
    n === 'nope' ||
    n === 'sure' ||
    n === 'right'
  );
};

const SHORT_ANSWER_PREFIXES = [
  'not bad',
  'pretty good',
  'good',
  'fine',
  'busy',
  'just',
  'trying to',
  'working on',
  'doing okay',
  'all good',
];

const isGreetingLike = (text: string): boolean => {
  const n = normalizeText(text);
  if (!n) return false;
  return (
    n.startsWith('hey ') ||
    n === 'hey' ||
    n.startsWith('hi ') ||
    n === 'hi' ||
    n.startsWith('hello ') ||
    n === 'hello'
  );
};

const isLikelyShortAnswer = (text: string): boolean => {
  const n = normalizeText(text);
  if (!n) return false;
  const words = n.split(' ').filter(Boolean);
  if (words.length === 0 || words.length > 8) return false;
  const matchesPrefix = SHORT_ANSWER_PREFIXES.some(
    (prefix) => n === prefix || n.startsWith(`${prefix} `),
  );
  if (matchesPrefix) return true;
  if (isQuestionLike(text)) return false;
  return false;
};

const isLikelySplitFragment = (text: string): boolean => {
  const raw = String(text || '').trim();
  const n = normalizeText(raw);
  if (!n || isQuestionLike(raw)) return false;
  const words = n.split(' ').filter(Boolean);
  if (words.length === 0 || words.length > 16) return false;
  const hasTerminalPunctuation = /[.!?]["']?$/.test(raw);
  const looksLikeResponse =
    isLikelyShortAnswer(raw) || isVeryShortConfirmation(raw);

  if (looksLikeResponse) return false;
  return !hasTerminalPunctuation;
};

const startsWithLowercaseContinuation = (text: string): boolean => {
  const raw = String(text || '').trim();
  if (!raw) return false;
  const first = raw[0];
  return first === first.toLowerCase() && first !== first.toUpperCase();
};

const isShortFragmentLike = (text: string, maxWords = 6): boolean => {
  const raw = String(text || '').trim();
  if (!raw || isQuestionLike(raw)) return false;
  const words = wordCount(raw);
  if (words === 0 || words > maxWords) return false;
  return !/[.!?]["']?$/.test(raw);
};

const CONTINUATION_START_TOKENS = new Set([
  'and',
  'but',
  'or',
  'so',
  'because',
  'if',
  'then',
  'to',
  'would',
  'could',
  'should',
  'might',
  'it',
  'that',
  'which',
  'there',
  'also',
  'just',
]);

const CONTINUATION_END_TOKENS = new Set([
  'and',
  'but',
  'or',
  'so',
  'because',
  'if',
  'then',
  'to',
  'for',
  'of',
  'with',
  'on',
  'in',
  'at',
  'from',
  'that',
  'which',
  'who',
  'what',
  'when',
  'where',
  'why',
  'how',
  'it',
  'this',
  'these',
  'those',
  'you',
  'we',
  'they',
  'he',
  'she',
  'there',
  'here',
  'my',
  'our',
  'your',
  'the',
  'a',
  'an',
]);

const startsWithContinuationCue = (text: string): boolean => {
  const raw = String(text || '').trim();
  if (!raw || isQuestionLike(raw)) return false;
  if (startsWithLowercaseContinuation(raw)) return true;
  const firstToken = normalizeText(raw).split(' ').filter(Boolean)[0];
  if (!firstToken) return false;
  return CONTINUATION_START_TOKENS.has(firstToken);
};

const endsWithContinuationCue = (text: string): boolean => {
  const raw = String(text || '').trim();
  if (!raw) return false;
  if (!/[.!?]["']?$/.test(raw)) return true;
  const tokens = normalizeText(raw).split(' ').filter(Boolean);
  const lastToken = tokens[tokens.length - 1];
  if (!lastToken) return false;
  return CONTINUATION_END_TOKENS.has(lastToken);
};

const continuationSignalScore = (
  prevText: string,
  curText: string,
  nextText: string,
): number => {
  let score = 0;
  if (isLikelySplitFragment(curText)) score += 2;
  if (startsWithContinuationCue(curText)) score += 2;
  if (endsWithContinuationCue(prevText)) score += 1;
  if (isShortFragmentLike(prevText)) score += 1;
  if (isShortFragmentLike(nextText)) score += 1;
  return score;
};

/**
 * Repairs systematic mis-attributions when ASR / overlap favors the wrong side:
 * - Me question → mis-tagged Them answer opening with uncertainty
 * - Them turn → short local back-channel ("oh yeah", "correction …") still on Them
 * - Me question → one-word reply that belongs to remote ("yes"/"sure")
 */
export const reassignThemLikelyAnswersAfterMeQuestion = <
  T extends AttributionSegment,
>(
  segments: T[],
  params?: { maxGapSec?: number },
): T[] => {
  const maxGap = params?.maxGapSec ?? 1.25;
  const out = segments.map((s) => ({ ...s }));
  for (let i = 1; i < out.length; i++) {
    const prev = out[i - 1];
    const cur = out[i];
    if (prev.speaker !== 'Me' || cur.speaker !== 'Me') continue;
    if (!isQuestionLike(prev.text)) continue;
    if (!isRemoteStyleUncertaintyAnswer(cur.text)) continue;
    const gap = Math.max(0, cur.startTime - prev.endTime);
    if (gap > maxGap) continue;
    cur.speaker = 'Them';
  }
  return out;
};

export const reassignMeLocalBackchannelAfterRemoteThem = <
  T extends AttributionSegment,
>(
  segments: T[],
  params?: { maxWords?: number; maxGapSec?: number },
): T[] => {
  const maxWords = params?.maxWords ?? 14;
  const maxGap = params?.maxGapSec ?? 1.5;
  const out = segments.map((s) => ({ ...s }));
  for (let i = 1; i < out.length; i++) {
    const prev = out[i - 1];
    const cur = out[i];
    if (prev.speaker !== 'Them' || cur.speaker !== 'Them') continue;
    if (wordCount(cur.text) > maxWords) continue;
    if (!isLocalAffirmOrCorrection(cur.text)) continue;
    const gap = Math.max(0, cur.startTime - prev.endTime);
    if (gap > maxGap) continue;
    cur.speaker = 'Me';
  }
  return out;
};

export const reassignThemShortConfirmationAfterMeQuestion = <
  T extends AttributionSegment,
>(
  segments: T[],
  params?: { maxGapSec?: number; maxWords?: number },
): T[] => {
  const maxGap = params?.maxGapSec ?? 1.5;
  const maxWords = params?.maxWords ?? 3;
  const out = segments.map((s) => ({ ...s }));
  for (let i = 1; i < out.length; i++) {
    const prev = out[i - 1];
    const cur = out[i];
    if (prev.speaker !== 'Me' || cur.speaker !== 'Me') continue;
    if (!isQuestionLike(prev.text)) continue;
    if (wordCount(cur.text) > maxWords) continue;
    if (!isVeryShortConfirmation(cur.text)) continue;
    const gap = Math.max(0, cur.startTime - prev.endTime);
    if (gap > maxGap) continue;
    cur.speaker = 'Them';
  }
  return out;
};

export const reassignThemShortAnswerAfterMeQuestion = <
  T extends AttributionSegment,
>(
  segments: T[],
  params?: { maxGapSec?: number; maxWords?: number },
): T[] => {
  const maxGap = params?.maxGapSec ?? 3;
  const maxWords = params?.maxWords ?? 8;
  const out = segments.map((s) => ({ ...s }));
  for (let i = 1; i < out.length; i++) {
    const prev = out[i - 1];
    const cur = out[i];
    if (prev.speaker !== 'Me' || cur.speaker !== 'Me') continue;
    if (!isQuestionLike(prev.text)) continue;
    if (wordCount(cur.text) > maxWords) continue;
    if (!isLikelyShortAnswer(cur.text)) continue;
    const gap = Math.max(0, cur.startTime - prev.endTime);
    if (gap > maxGap) continue;
    cur.speaker = 'Them';
  }
  return out;
};

export const reassignOpeningSameSpeakerGreetings = <
  T extends AttributionSegment,
>(
  segments: T[],
  params?: { openingWindowSec?: number; maxGapSec?: number },
): T[] => {
  const openingWindowSec = params?.openingWindowSec ?? 45;
  const maxGapSec = params?.maxGapSec ?? 12;
  const out = segments.map((s) => ({ ...s }));
  for (let i = 1; i < out.length; i++) {
    const prev = out[i - 1];
    const cur = out[i];
    if (prev.speaker !== cur.speaker) continue;
    if (cur.startTime > openingWindowSec) continue;
    if (!isGreetingLike(prev.text) || !isGreetingLike(cur.text)) continue;
    const gap = Math.max(0, cur.startTime - prev.endTime);
    if (gap > maxGapSec) continue;
    cur.speaker = prev.speaker === 'Me' ? 'Them' : 'Me';
  }
  return out;
};

export const reassignSandwichedContinuationTurns = <
  T extends AttributionSegment,
>(
  segments: T[],
  params?: {
    maxGapSec?: number;
    maxWords?: number;
    minSignalScore?: number;
  },
): T[] => {
  const maxGapSec = params?.maxGapSec ?? 1.25;
  const maxWords = params?.maxWords ?? 24;
  const minSignalScore = params?.minSignalScore ?? 3;
  const out = segments.map((s) => ({ ...s }));
  for (let i = 1; i < out.length - 1; i++) {
    const prev = out[i - 1];
    const cur = out[i];
    const next = out[i + 1];
    if (prev.speaker !== next.speaker || cur.speaker === prev.speaker) continue;
    if (wordCount(cur.text) > maxWords) continue;
    if (isQuestionLike(cur.text)) continue;
    const gapBefore = Math.max(0, cur.startTime - prev.endTime);
    const gapAfter = Math.max(0, next.startTime - cur.endTime);
    if (gapBefore > maxGapSec || gapAfter > maxGapSec) continue;
    const score = continuationSignalScore(prev.text, cur.text, next.text);
    if (score < minSignalScore) continue;
    cur.speaker = prev.speaker;
  }
  return out;
};

export const reassignThemContinuationAfterThemTurn = <
  T extends AttributionSegment,
>(
  segments: T[],
  params?: { maxGapSec?: number; maxWords?: number; maxPrevWords?: number },
): T[] => {
  const maxGapSec = params?.maxGapSec ?? 2.5;
  const maxWords = params?.maxWords ?? 16;
  const maxPrevWords = params?.maxPrevWords ?? 16;
  const out = segments.map((s) => ({ ...s }));
  for (let i = 1; i < out.length; i++) {
    const prev = out[i - 1];
    const cur = out[i];
    if (prev.speaker !== 'Them' || cur.speaker !== 'Me') continue;
    if (wordCount(prev.text) > maxPrevWords) continue;
    if (wordCount(cur.text) > maxWords) continue;
    if (
      !isLikelySplitFragment(cur.text) &&
      !isLikelyShortAnswer(cur.text) &&
      !(wordCount(prev.text) <= 4 && !isQuestionLike(cur.text))
    ) {
      continue;
    }
    const gap = Math.max(0, cur.startTime - prev.endTime);
    if (gap > maxGapSec) continue;
    cur.speaker = 'Them';
  }
  return out;
};

export const applyCrossTurnAttributionRepairs = <T extends AttributionSegment>(
  segments: T[],
): T[] => {
  let s = segments.map((seg) => ({ ...seg }));
  s = reassignOpeningSameSpeakerGreetings(s);
  s = reassignThemShortConfirmationAfterMeQuestion(s);
  s = reassignThemShortAnswerAfterMeQuestion(s);
  s = reassignThemLikelyAnswersAfterMeQuestion(s);
  s = reassignThemContinuationAfterThemTurn(s);
  s = reassignMeLocalBackchannelAfterRemoteThem(s);
  s = reassignSandwichedContinuationTurns(s);
  return s;
};

export const decideNextSpeaker = (params: {
  micRms: number;
  systemRms: number;
  threshold: number;
  ratio: number;
}): 'Me' | 'Them' | null => {
  const { micRms, systemRms, threshold, ratio } = params;
  const micActive = micRms >= threshold;
  const systemActive = systemRms >= threshold;

  if (micActive && !systemActive) return 'Me';
  if (!micActive && systemActive) return 'Them';
  if (!micActive && !systemActive) return null;
  if (micRms >= systemRms * ratio) return 'Me';
  if (systemRms >= micRms * ratio) return 'Them';
  return null;
};

export const shouldDropBySpeakerActivity = (params: {
  targetSpeaker: 'Me' | 'Them';
  overlapRatio: number;
  meCoverage: number;
  themCoverage: number;
}): boolean => {
  const { targetSpeaker, overlapRatio, meCoverage, themCoverage } = params;
  if (targetSpeaker === 'Me') {
    return (
      overlapRatio >= TRANSCRIPTION_TUNING.activityPrune.meOverlapRatio &&
      themCoverage >= TRANSCRIPTION_TUNING.activityPrune.meMinCoverage &&
      themCoverage >=
        Math.max(
          TRANSCRIPTION_TUNING.activityPrune.meMinCoverageFloor,
          meCoverage * TRANSCRIPTION_TUNING.activityPrune.meCoverageRatio,
        )
    );
  }

  // Keep "Them" unless "Me" clearly dominates both overlap and activity.
  return (
    overlapRatio >= TRANSCRIPTION_TUNING.activityPrune.themOverlapRatio &&
    meCoverage >= TRANSCRIPTION_TUNING.activityPrune.themMinCoverage &&
    meCoverage >=
      Math.max(
        TRANSCRIPTION_TUNING.activityPrune.themMinCoverageFloor,
        themCoverage * TRANSCRIPTION_TUNING.activityPrune.themCoverageRatio,
      )
  );
};

export const shouldApplyFullSessionMeRecovery = (params: {
  hasChunkMeSegments: boolean;
  recoveredMeCount: number;
  bleedLikely: boolean;
}): boolean => {
  const { hasChunkMeSegments, recoveredMeCount, bleedLikely } = params;
  return !hasChunkMeSegments && recoveredMeCount > 0 && !bleedLikely;
};

/** Approximate character cut in original text at normalized word boundary. */
const splitOriginalTextAtWordIndex = (
  original: string,
  wordIndex: number,
  totalNormWords: number,
): { left: string; right: string } | null => {
  const t = original.trim();
  if (
    !t ||
    wordIndex <= 0 ||
    totalNormWords <= 0 ||
    wordIndex >= totalNormWords
  ) {
    return null;
  }
  const ratio = wordIndex / totalNormWords;
  let cut = Math.min(t.length - 1, Math.max(1, Math.floor(t.length * ratio)));
  while (cut > 0 && !/\s/.test(t[cut] ?? '')) cut--;
  if (cut <= 0) return null;
  const left = t.slice(0, cut).trim();
  const right = t.slice(cut).trim();
  if (!left || !right) return null;
  return { left, right };
};

/**
 * Find where a Them channel token sequence starts inside the canonical.
 * Tries exact match first (fast), then allows up to `maxMismatches` skips
 * to handle minor Whisper transcription differences.
 */
const findFuzzyAnchor = (
  canonicalWords: string[],
  themWords: string[],
  startFrom: number,
  minAnchor: number,
  maxMismatches = 1,
): number => {
  for (let i = startFrom; i <= canonicalWords.length - minAnchor; i++) {
    let k = 0;
    let mismatches = 0;
    while (k < themWords.length && i + k + mismatches < canonicalWords.length) {
      if (canonicalWords[i + k + mismatches] === themWords[k]) {
        k++;
      } else {
        mismatches++;
        if (mismatches > maxMismatches) break;
      }
    }
    if (k >= minAnchor) return i;
  }
  return -1;
};

const trySplitCanonicalSegmentAtThemAnchor = <T extends AttributionSegment>(
  segment: T,
  themChannel: AttributionSegment[],
): T[] => {
  const cfg = TRANSCRIPTION_TUNING.canonicalChannelSplit;
  const text = (segment.text || '').trim();
  if (!text || themChannel.length === 0) return [segment];

  const canonicalWords = normalizeText(text).split(' ').filter(Boolean);
  if (canonicalWords.length < cfg.minMePrefixWords + cfg.minThemAnchorWords) {
    return [segment];
  }

  const overlapping = themChannel
    .map((th) => ({ th, ov: overlapSeconds(segment, th) }))
    .filter((x) => x.ov >= cfg.minThemOverlapSeconds)
    .sort((a, b) => b.ov - a.ov);

  for (const { th: themSeg } of overlapping) {
    const themWords = normalizeText(themSeg.text).split(' ').filter(Boolean);
    if (themWords.length < cfg.minThemChannelWords) continue;

    const minAnchor = Math.min(cfg.minThemAnchorWords, themWords.length);
    const anchorStart = findFuzzyAnchor(
      canonicalWords,
      themWords,
      cfg.minMePrefixWords,
      minAnchor,
    );
    if (anchorStart < 0) continue;

    const split = splitOriginalTextAtWordIndex(
      text,
      anchorStart,
      canonicalWords.length,
    );
    if (!split) continue;

    const dur = Math.max(0.01, segment.endTime - segment.startTime);
    const wL = Math.max(1, split.left.length);
    const wR = Math.max(1, split.right.length);
    const totalW = wL + wR;
    const tCut = segment.startTime + dur * (wL / totalW);

    const left = {
      ...segment,
      endTime: Math.min(segment.endTime, tCut),
      text: split.left,
    } as T;
    const right = {
      ...segment,
      startTime: Math.max(segment.startTime, tCut),
      endTime: segment.endTime,
      text: split.right,
    } as T;
    return [left, right];
  }

  return [segment];
};

/**
 * Split mix/session canonical segments when overlapping Them-channel ASR appears inside text.
 * Runs before punctuation splitting and speaker assignment.
 */
export const splitCanonicalSegmentsAtChannelBoundaries = <
  T extends AttributionSegment,
>(
  canonicalSegments: T[],
  channelSegments: AttributionSegment[],
): { segments: T[]; splitsApplied: number } => {
  const themChannel = channelSegments.filter((s) => s.speaker === 'Them');
  if (themChannel.length === 0 || canonicalSegments.length === 0) {
    return { segments: [...canonicalSegments], splitsApplied: 0 };
  }

  let splitsApplied = 0;
  const out: T[] = [];
  for (const segment of canonicalSegments) {
    const pieces = trySplitCanonicalSegmentAtThemAnchor(segment, themChannel);
    if (pieces.length > 1) splitsApplied++;
    out.push(...pieces);
  }
  return { segments: out, splitsApplied };
};

export const splitSegmentsAtDiarizationBoundaries = <
  T extends AttributionSegment,
>(
  segments: T[],
  diarizationSegments: AttributionSegment[],
  mapping: Record<string, 'Me' | 'Them'>,
): { segments: T[]; splitsApplied: number } => {
  const cfg = TRANSCRIPTION_TUNING.diarizationBoundarySplit;
  if (segments.length === 0 || diarizationSegments.length === 0) {
    return { segments: [...segments], splitsApplied: 0 };
  }

  const mappedDiar = diarizationSegments.filter((d) => {
    const k = String(d.speaker || '');
    return Boolean(k && mapping[k]);
  });
  if (mappedDiar.length === 0) {
    return { segments: [...segments], splitsApplied: 0 };
  }

  let splitsApplied = 0;
  const sortedInput = [...segments].sort((a, b) => a.startTime - b.startTime);
  const out: T[] = [];

  for (const seg of sortedInput) {
    const dur = Math.max(0.01, seg.endTime - seg.startTime);
    const words = (seg.text || '').trim().split(/\s+/).filter(Boolean);
    if (words.length < cfg.minSegmentWords) {
      out.push(seg);
      continue;
    }

    type Clip = { start: number; end: number; speaker: 'Me' | 'Them' };
    const clips: Clip[] = [];
    for (const d of mappedDiar) {
      const k = String(d.speaker || '');
      const sp = mapping[k];
      if (!sp) continue;
      const s = Math.max(seg.startTime, d.startTime);
      const e = Math.min(seg.endTime, d.endTime);
      if (e - s < cfg.minClipDurationSec) continue;
      clips.push({ start: s, end: e, speaker: sp });
    }
    clips.sort((a, b) => a.start - b.start);

    const merged: Clip[] = [];
    for (const c of clips) {
      const last = merged[merged.length - 1];
      if (last && last.speaker === c.speaker && c.start <= last.end + 0.05) {
        last.end = Math.max(last.end, c.end);
      } else {
        merged.push({ ...c });
      }
    }

    const speakers = new Set(merged.map((m) => m.speaker));
    if (speakers.size < 2) {
      out.push(seg);
      continue;
    }

    const secondClips = merged.filter((m) => {
      const cd = m.end - m.start;
      return cd >= cfg.minSecondSpeakerClipSec;
    });
    const secondSpeakers = new Set(secondClips.map((m) => m.speaker));
    if (secondSpeakers.size < 2) {
      out.push(seg);
      continue;
    }

    const useClips = merged.filter((m) => m.end > m.start);
    const totalClipDur = useClips.reduce((a, c) => a + (c.end - c.start), 0);
    if (totalClipDur < dur * 0.35) {
      out.push(seg);
      continue;
    }

    splitsApplied++;
    let wordOffset = 0;
    for (let i = 0; i < useClips.length; i++) {
      const c = useClips[i];
      if (!c) continue;
      const cd = c.end - c.start;
      const frac = cd / totalClipDur;
      let nWords = Math.max(1, Math.round(words.length * frac));
      if (i === useClips.length - 1) {
        nWords = Math.max(1, words.length - wordOffset);
      } else {
        nWords = Math.min(nWords, words.length - wordOffset);
      }
      const chunk = words
        .slice(wordOffset, wordOffset + nWords)
        .join(' ')
        .trim();
      wordOffset += nWords;
      if (!chunk) continue;
      out.push({
        ...seg,
        startTime: c.start,
        endTime: c.end,
        text: chunk,
        speaker: c.speaker,
      } as T);
    }
  }

  return {
    segments: out.sort((a, b) => a.startTime - b.startTime),
    splitsApplied,
  };
};

export const stripLikelyMeBleedSegments = <T extends AttributionSegment>(
  segments: T[],
  activityWindows: SpeakerActivityWindow[] = [],
): MeBleedStripResult<T> => {
  let debugDropCount = 0;
  const meSegments: Array<{ index: number; segment: T }> = [];
  const themSegments: T[] = [];
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (segment.speaker === 'Me') meSegments.push({ index: i, segment });
    else if (segment.speaker === 'Them') themSegments.push(segment);
  }

  if (meSegments.length === 0 || themSegments.length === 0) {
    return { segments: [...segments], droppedMe: 0 };
  }

  const dropIndices = new Set<number>();

  const maxGapSeconds = TRANSCRIPTION_TUNING.sourceEchoPrune.maxGapSeconds;
  const minSimilarity = TRANSCRIPTION_TUNING.sourceEchoPrune.minSimilarity;
  const minThemCoverage = TRANSCRIPTION_TUNING.sourceEchoPrune.minThemCoverage;
  const maxMeCoverageForEcho =
    TRANSCRIPTION_TUNING.sourceEchoPrune.maxMeCoverageForEcho;
  const themCoverageRatio =
    TRANSCRIPTION_TUNING.sourceEchoPrune.themCoverageRatio;

  for (const { index, segment: me } of meSegments) {
    const meNorm = normalizeText(me.text);
    if (!meNorm) continue;

    const meDur = Math.max(0.01, me.endTime - me.startTime);
    const meWords = wordCount(me.text);

    let dropForMe = false;
    for (const them of themSegments) {
      const overlap = overlapSeconds(me, them);
      const meThemGap = Math.max(
        0,
        Math.max(me.startTime, them.startTime) -
          Math.min(me.endTime, them.endTime),
      );
      if (overlap <= 0 && meThemGap > maxGapSeconds) continue;

      const overlapRatio = overlap > 0 ? overlap / meDur : 0;

      const themNorm = normalizeText(them.text);
      if (!themNorm) continue;
      const themWords = wordCount(them.text);
      const themDur = Math.max(0.01, them.endTime - them.startTime);
      const overlapRatioToMin =
        overlap > 0 ? overlap / Math.min(meDur, themDur) : 0;

      const tokenSim = tokenSetSimilarity(meNorm, themNorm);
      const prefixSim = tokenPrefixSimilarity(meNorm, themNorm);
      const shorter = Math.min(meNorm.length, themNorm.length);
      const longer = Math.max(meNorm.length, themNorm.length);
      const contains =
        shorter >= 12 &&
        shorter / Math.max(1, longer) >= 0.72 &&
        (meNorm.includes(themNorm) || themNorm.includes(meNorm));

      const highSimilarity =
        contains ||
        tokenSim >= minSimilarity ||
        prefixSim >= minSimilarity + 0.08;
      const themStronglyDominant =
        themDur >= meDur * 1.2 || themWords >= meWords + 5;
      const shortEcho = meWords <= 4 && (tokenSim >= 0.36 || prefixSim >= 0.45);
      const mediumEcho =
        meWords <= 8 &&
        highSimilarity &&
        overlapRatio >= 0.5 &&
        (themDur >= meDur * 0.95 || themWords >= meWords + 1);

      // Loudspeaker bleed case: the participant utterance can be fully embedded
      // inside a longer "Me" commentary span. Coverage-based gating can fail
      // when RMS activity windows are polluted, so we prioritize overlap+lexical
      // evidence without relying on activity windows.
      const overlapLexicalBleed =
        overlap > 0 && overlapRatioToMin >= 0.75 && highSimilarity;

      // Additional guard: only treat it as "Me bleed" when Them is short enough
      // to plausibly be embedded inside a longer Me utterance.
      // This avoids dropping Me in cases where both sides are similarly long
      // and activity windows (even if skewed) indicate local speech.
      const overlapLexicalEmbeddedThem =
        overlapLexicalBleed && themDur <= meDur * 0.9;

      if (overlapLexicalEmbeddedThem) {
        if (TRANSCRIPT_DEBUG_ENABLED && debugDropCount < 5) {
          debugDropCount++;
          console.log(
            '[Pluto][TranscriptDebug] stripLikelyMeBleedSegments DROP',
            {
              reason: 'lexicalEmbeddedThem',
              me: `${me.startTime.toFixed(1)}-${me.endTime.toFixed(1)}`,
              them: `${them.startTime.toFixed(1)}-${them.endTime.toFixed(1)}`,
              overlapRatioToMin: Number(overlapRatioToMin.toFixed(2)),
              tokenSim: Number(tokenSetSimilarity(meNorm, themNorm).toFixed(2)),
            },
          );
        }
        dropForMe = true;
        break;
      }

      const evidenceStart =
        overlap > 0
          ? Math.max(me.startTime, them.startTime)
          : Math.min(me.startTime, them.startTime);
      const evidenceEnd =
        overlap > 0
          ? Math.min(me.endTime, them.endTime)
          : Math.max(me.endTime, them.endTime);
      const meCoverage = activityCoverage(
        evidenceStart,
        evidenceEnd,
        'Me',
        activityWindows,
      );
      const themCoverage = activityCoverage(
        evidenceStart,
        evidenceEnd,
        'Them',
        activityWindows,
      );
      const activityIndicatesEcho =
        highSimilarity &&
        themCoverage >= minThemCoverage &&
        themCoverage >=
          Math.max(meCoverage * themCoverageRatio, meCoverage + 0.08) &&
        meCoverage <= maxMeCoverageForEcho;
      const meClearlyDominant =
        meCoverage >= minThemCoverage &&
        meCoverage >=
          Math.max(themCoverage * themCoverageRatio, themCoverage + 0.08);

      if (
        !meClearlyDominant &&
        ((highSimilarity && themStronglyDominant && overlapRatio >= 0.45) ||
          activityIndicatesEcho ||
          overlapLexicalBleed ||
          shortEcho ||
          mediumEcho)
      ) {
        if (TRANSCRIPT_DEBUG_ENABLED && debugDropCount < 5) {
          const reasons: string[] = [];
          if (highSimilarity && themStronglyDominant && overlapRatio >= 0.45) {
            reasons.push('themStronglyDominant');
          }
          if (activityIndicatesEcho) reasons.push('activityIndicatesEcho');
          if (overlapLexicalBleed) reasons.push('lexicalBleed');
          if (shortEcho) reasons.push('shortEcho');
          if (mediumEcho) reasons.push('mediumEcho');
          debugDropCount++;
          console.log(
            '[Pluto][TranscriptDebug] stripLikelyMeBleedSegments DROP',
            {
              reason: reasons.join(',') || 'combinedCondition',
              me: `${me.startTime.toFixed(1)}-${me.endTime.toFixed(1)}`,
              them: `${them.startTime.toFixed(1)}-${them.endTime.toFixed(1)}`,
              overlapRatioToMin: Number(overlapRatioToMin.toFixed(2)),
              overlapRatio: Number(overlapRatio.toFixed(2)),
              tokenSim: Number(tokenSetSimilarity(meNorm, themNorm).toFixed(2)),
              meClearlyDominant,
              meCoverage: Number(meCoverage.toFixed(2)),
              themCoverage: Number(themCoverage.toFixed(2)),
            },
          );
        }
        dropForMe = true;
        break;
      }
    }

    if (dropForMe) {
      dropIndices.add(index);
    }
  }

  return {
    segments: segments.filter((_, index) => !dropIndices.has(index)),
    droppedMe: dropIndices.size,
  };
};

export const dropShortCrossSpeakerEchoes = <
  T extends AttributionSegment,
>(params: {
  segments: T[];
  maxShortWords?: number;
  maxGapSec?: number;
}): DropShortEchoResult<T> => {
  const segments = params.segments || [];
  const maxShortWords = params.maxShortWords ?? 4;
  const maxGapSec = params.maxGapSec ?? 2;
  if (segments.length < 2) {
    return { segments: [...segments], dropped: 0 };
  }

  const kept: T[] = [];
  let dropped = 0;

  for (const segment of segments) {
    if (kept.length === 0) {
      kept.push({ ...segment });
      continue;
    }

    const prev = kept[kept.length - 1];
    if (prev.speaker === segment.speaker) {
      kept.push({ ...segment });
      continue;
    }

    const gapSec = segment.startTime - prev.endTime;
    if (gapSec > maxGapSec) {
      kept.push({ ...segment });
      continue;
    }

    const prevTokens = normalizeText(prev.text).split(' ').filter(Boolean);
    const currTokens = normalizeText(segment.text).split(' ').filter(Boolean);
    if (prevTokens.length === 0 || currTokens.length === 0) {
      kept.push({ ...segment });
      continue;
    }

    const prevIsShort = prevTokens.length <= maxShortWords;
    const currIsShort = currTokens.length <= maxShortWords;

    if (
      currIsShort &&
      prevTokens.length >= currTokens.length + 4 &&
      containsTokenSequence(prevTokens, currTokens)
    ) {
      dropped++;
      continue;
    }

    if (
      prevIsShort &&
      currTokens.length >= prevTokens.length + 4 &&
      containsTokenSequence(currTokens, prevTokens)
    ) {
      kept.pop();
      dropped++;
      kept.push({ ...segment });
      continue;
    }

    kept.push({ ...segment });
  }

  return {
    segments: kept,
    dropped,
  };
};

export interface DiarizationMappingResult {
  mapping: Record<string, 'Me' | 'Them'>;
  confidence: number;
  reason?: string;
}

export const mapDiarizationSpeakers = (params: {
  diarizationSegments: AttributionSegment[];
  referenceSegments: AttributionSegment[];
  activityWindows?: SpeakerActivityWindow[];
}): DiarizationMappingResult => {
  const diarizationSegments = params.diarizationSegments || [];
  const referenceSegments = params.referenceSegments || [];
  const activityWindows = params.activityWindows || [];

  if (diarizationSegments.length === 0) {
    return { mapping: {}, confidence: 0, reason: 'no diarization segments' };
  }

  const grouped = new Map<string, AttributionSegment[]>();
  for (const segment of diarizationSegments) {
    const speakerId = String(segment.speaker || '').trim();
    if (!speakerId) continue;
    const existing = grouped.get(speakerId) ?? [];
    existing.push(segment);
    grouped.set(speakerId, existing);
  }

  if (grouped.size < 2) {
    return { mapping: {}, confidence: 0, reason: 'not enough speakers' };
  }

  const referenceMe = referenceSegments.filter(
    (segment) => segment.speaker === 'Me',
  );
  const referenceThem = referenceSegments.filter(
    (segment) => segment.speaker === 'Them',
  );
  const activityMe: AttributionSegment[] = activityWindows
    .filter((window) => window.speaker === 'Me')
    .map((window) => ({
      startTime: window.startTime,
      endTime: window.endTime,
      text: '',
      speaker: 'Me',
    }));
  const activityThem: AttributionSegment[] = activityWindows
    .filter((window) => window.speaker === 'Them')
    .map((window) => ({
      startTime: window.startTime,
      endTime: window.endTime,
      text: '',
      speaker: 'Them',
    }));

  const sumOverlap = (
    left: AttributionSegment[],
    right: AttributionSegment[],
  ): number => {
    let total = 0;
    for (const a of left) {
      for (const b of right) {
        const overlap = overlapSeconds(a, b);
        if (overlap > 0) total += overlap;
      }
    }
    return total;
  };

  const activityWeight = TRANSCRIPTION_TUNING.diarization.activityWeight;
  const minOverlapSeconds =
    TRANSCRIPTION_TUNING.diarization.minSpeakerOverlapSeconds;
  const minScoreRatio = TRANSCRIPTION_TUNING.diarization.minSpeakerScoreRatio;

  type Candidate = {
    speakerId: string;
    meScore: number;
    themScore: number;
    confidence: number;
  };

  const candidates: Candidate[] = [];
  for (const [speakerId, segments] of grouped.entries()) {
    const meOverlap = sumOverlap(segments, referenceMe);
    const themOverlap = sumOverlap(segments, referenceThem);
    const meActivity = sumOverlap(segments, activityMe);
    const themActivity = sumOverlap(segments, activityThem);
    const meScore = meOverlap + meActivity * activityWeight;
    const themScore = themOverlap + themActivity * activityWeight;
    const total = meScore + themScore;
    const confidence = total > 0 ? Math.abs(meScore - themScore) / total : 0;
    candidates.push({ speakerId, meScore, themScore, confidence });
  }

  const preferMe = candidates.filter((candidate) => {
    return candidate.meScore >= candidate.themScore;
  });
  const preferThem = candidates.filter((candidate) => {
    return candidate.themScore >= candidate.meScore;
  });

  const byMeScore = [...(preferMe.length > 0 ? preferMe : candidates)].sort(
    (a, b) => b.meScore - a.meScore,
  );
  const byThemScore = [
    ...(preferThem.length > 0 ? preferThem : candidates),
  ].sort((a, b) => b.themScore - a.themScore);

  const topMe = byMeScore[0];
  const topThem = byThemScore[0];
  if (!topMe || !topThem) {
    return { mapping: {}, confidence: 0, reason: 'no candidates' };
  }

  let meCandidate = topMe;
  let themCandidate = topThem;

  if (meCandidate.meScore < minOverlapSeconds) {
    return { mapping: {}, confidence: 0, reason: 'low Me overlap' };
  }
  if (themCandidate.themScore < minOverlapSeconds) {
    return { mapping: {}, confidence: 0, reason: 'low Them overlap' };
  }

  if (meCandidate.speakerId === themCandidate.speakerId) {
    const alternateThem = byThemScore.find(
      (candidate) =>
        candidate.speakerId !== meCandidate.speakerId &&
        candidate.themScore >= minOverlapSeconds,
    );
    const alternateMe = byMeScore.find(
      (candidate) =>
        candidate.speakerId !== themCandidate.speakerId &&
        candidate.meScore >= minOverlapSeconds,
    );
    if (alternateThem && alternateMe) {
      themCandidate =
        alternateThem.themScore >= alternateMe.meScore
          ? alternateThem
          : themCandidate;
      if (themCandidate.speakerId === meCandidate.speakerId) {
        meCandidate = alternateMe;
      }
    } else if (alternateThem) {
      themCandidate = alternateThem;
    } else if (alternateMe) {
      meCandidate = alternateMe;
    } else {
      return { mapping: {}, confidence: 0, reason: 'ambiguous speaker' };
    }
  }

  if (meCandidate.speakerId === themCandidate.speakerId) {
    return { mapping: {}, confidence: 0, reason: 'ambiguous speaker' };
  }

  if (
    meCandidate.confidence < minScoreRatio ||
    themCandidate.confidence < minScoreRatio
  ) {
    return { mapping: {}, confidence: 0, reason: 'low confidence' };
  }

  const confidence = Math.min(meCandidate.confidence, themCandidate.confidence);

  return {
    mapping: {
      [meCandidate.speakerId]: 'Me',
      [themCandidate.speakerId]: 'Them',
    },
    confidence,
  };
};

export const applyDiarizationRefinement = <
  T extends AttributionSegment,
>(params: {
  segments: T[];
  diarizationSegments: AttributionSegment[];
  mapping: Record<string, 'Me' | 'Them'>;
  minSegmentOverlapSeconds?: number;
  minSegmentCoverageRatio?: number;
}): { segments: T[]; relabeled: number } => {
  const inputSegments = params.segments || [];
  const mapping = params.mapping || {};
  const diarizationSegments = params.diarizationSegments || [];
  const minOverlapSeconds =
    params.minSegmentOverlapSeconds ??
    TRANSCRIPTION_TUNING.diarization.minSegmentOverlapSeconds;
  const minCoverageRatio =
    params.minSegmentCoverageRatio ??
    TRANSCRIPTION_TUNING.diarization.minSegmentCoverageRatio;

  if (inputSegments.length === 0 || diarizationSegments.length === 0) {
    return { segments: [...inputSegments], relabeled: 0 };
  }

  const usableDiarization = diarizationSegments.filter((segment) => {
    const key = String(segment.speaker || '');
    return Boolean(mapping[key]);
  });

  if (usableDiarization.length === 0) {
    return { segments: [...inputSegments], relabeled: 0 };
  }

  const updated: T[] = inputSegments.map((segment) => ({ ...segment }));
  let relabeled = 0;

  for (const segment of updated) {
    const duration = Math.max(0.01, segment.endTime - segment.startTime);
    let bestSpeaker = '';
    let bestOverlap = 0;

    for (const diarSegment of usableDiarization) {
      const overlap = overlapSeconds(segment, diarSegment);
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestSpeaker = String(diarSegment.speaker || '');
      }
    }

    if (!bestSpeaker || bestOverlap < minOverlapSeconds) continue;
    const coverage = bestOverlap / duration;
    if (coverage < minCoverageRatio) continue;

    const mapped = mapping[bestSpeaker];
    if (mapped && segment.speaker !== mapped) {
      segment.speaker = mapped;
      relabeled++;
    }
  }

  return { segments: updated, relabeled };
};
