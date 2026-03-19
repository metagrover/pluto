import { TRANSCRIPTION_TUNING } from './transcriptionConfig';

export interface AttributionSegment {
  startTime: number;
  endTime: number;
  text: string;
  speaker: string;
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

const isDuplicatePair = (
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

const oppositeSpeaker = (speaker: 'Me' | 'Them'): 'Me' | 'Them' =>
  speaker === 'Me' ? 'Them' : 'Me';

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

const isAckLike = (text: string): boolean => {
  const normalized = normalizeText(text);
  if (!normalized) return false;
  const tokens = normalized.split(' ').filter(Boolean);
  if (tokens.length === 0 || tokens.length > 4) return false;
  const first = tokens[0];
  return (
    first === 'yeah' ||
    first === 'yes' ||
    first === 'yup' ||
    first === 'no' ||
    first === 'nope' ||
    first === 'ok' ||
    first === 'okay' ||
    first === 'right' ||
    first === 'sure'
  );
};

const isUncertaintyLike = (text: string): boolean => {
  const normalized = normalizeText(text);
  if (!normalized) return false;
  return (
    normalized.startsWith('not sure') ||
    normalized.startsWith('i m not sure') ||
    normalized.startsWith('i dont know') ||
    normalized.startsWith('i do not know')
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

      const decision = isDuplicatePair(me, them);
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

export const assignSpeakersToCanonicalSegments = <
  T extends AttributionSegment,
>(params: {
  canonicalSegments: T[];
  attributedSegments: AttributionSegment[];
  activityWindows?: SpeakerActivityWindow[];
  tieMargin?: number;
}): CanonicalSpeakerAttributionResult<T> => {
  const { canonicalSegments, attributedSegments } = params;
  const activityWindows = params.activityWindows || [];
  const tieMargin =
    params.tieMargin ?? TRANSCRIPTION_TUNING.attribution.tieMargin;
  const activityGap = TRANSCRIPTION_TUNING.attribution.activityCoverageGap;
  const proximityDeltaThreshold =
    TRANSCRIPTION_TUNING.attribution.proximityDelta;
  const overlapScoreDelta = TRANSCRIPTION_TUNING.attribution.overlapScoreDelta;
  if (canonicalSegments.length === 0) {
    return {
      segments: [],
      stats: { byOverlap: 0, byActivity: 0, byFallback: 0 },
    };
  }

  const sortedCanonical = [...canonicalSegments].sort(
    (a, b) => a.startTime - b.startTime,
  );
  const assigned: T[] = [];
  let byOverlap = 0;
  let byActivity = 0;
  let byFallback = 0;
  let lastSpeaker: 'Me' | 'Them' = 'Me';

  for (const segment of sortedCanonical) {
    const duration = Math.max(0.01, segment.endTime - segment.startTime);
    let meScore = 0;
    let themScore = 0;
    let meProximity = 0;
    let themProximity = 0;
    const segmentMid = (segment.startTime + segment.endTime) / 2;

    for (const candidate of attributedSegments) {
      if (candidate.speaker !== 'Me' && candidate.speaker !== 'Them') continue;
      const overlap = overlapSeconds(segment, candidate);
      const overlapRatio = overlap > 0 ? overlap / duration : 0;
      const tokenSim = tokenSetSimilarity(segment.text, candidate.text);
      const prefixSim = tokenPrefixSimilarity(segment.text, candidate.text);
      if (overlap > 0) {
        const lexicalSupport = Math.max(tokenSim, prefixSim);
        const overlapScore =
          overlapRatio * (0.25 + lexicalSupport * 0.75) +
          tokenSim * 0.6 +
          prefixSim * 0.35;
        if (candidate.speaker === 'Me')
          meScore = Math.max(meScore, overlapScore);
        else themScore = Math.max(themScore, overlapScore);
      }

      const candidateMid = (candidate.startTime + candidate.endTime) / 2;
      const deltaSeconds = Math.abs(segmentMid - candidateMid);
      if (deltaSeconds <= 3.5) {
        const proximityWeight = Math.max(0, 1 - deltaSeconds / 3.5);
        const proximityScore =
          proximityWeight * 0.8 + tokenSim * 0.7 + prefixSim * 0.4;
        if (candidate.speaker === 'Me')
          meProximity = Math.max(meProximity, proximityScore);
        else themProximity = Math.max(themProximity, proximityScore);
      }
    }

    let speaker: 'Me' | 'Them';
    const hasOverlapEvidence = meScore > 0 || themScore > 0;
    const hasProximityEvidence = meProximity > 0 || themProximity > 0;
    if (hasOverlapEvidence && Math.abs(meScore - themScore) >= tieMargin) {
      speaker = meScore > themScore ? 'Me' : 'Them';
      byOverlap++;
    } else {
      const meCoverage = activityCoverage(
        segment.startTime,
        segment.endTime,
        'Me',
        activityWindows,
      );
      const themCoverage = activityCoverage(
        segment.startTime,
        segment.endTime,
        'Them',
        activityWindows,
      );
      if (
        (meCoverage > 0 || themCoverage > 0) &&
        Math.abs(meCoverage - themCoverage) >= activityGap
      ) {
        speaker = meCoverage >= themCoverage ? 'Me' : 'Them';
        byActivity++;
      } else if (hasOverlapEvidence) {
        const scoreDelta = Math.abs(meScore - themScore);
        const proximityDelta = Math.abs(meProximity - themProximity);
        if (proximityDelta >= proximityDeltaThreshold) {
          speaker = meProximity >= themProximity ? 'Me' : 'Them';
        } else if (scoreDelta <= overlapScoreDelta) {
          speaker = oppositeSpeaker(lastSpeaker);
        } else {
          speaker = meScore > themScore ? 'Me' : 'Them';
        }
        byFallback++;
      } else if (
        hasProximityEvidence &&
        Math.abs(meProximity - themProximity) >= proximityDeltaThreshold
      ) {
        speaker = meProximity >= themProximity ? 'Me' : 'Them';
        byFallback++;
      } else {
        speaker = lastSpeaker;
        byFallback++;
      }
    }

    lastSpeaker = speaker;
    assigned.push({
      ...segment,
      speaker,
    });
  }

  return {
    segments: assigned,
    stats: { byOverlap, byActivity, byFallback },
  };
};

export const applyTurnTakingHeuristics = <T extends AttributionSegment>(
  segments: T[],
): T[] => {
  if (segments.length < 2) return [...segments];
  const adjusted = segments.map((segment) => ({ ...segment }));

  for (let i = 0; i < adjusted.length; i++) {
    const current = adjusted[i];
    if (current.speaker !== 'Me' && current.speaker !== 'Them') continue;

    const prev = i > 0 ? adjusted[i - 1] : null;
    const next = i + 1 < adjusted.length ? adjusted[i + 1] : null;
    const currentQuestion = isQuestionLike(current.text);
    const nextAck = next ? isAckLike(next.text) : false;

    if (
      currentQuestion &&
      prev &&
      (prev.speaker === 'Me' || prev.speaker === 'Them') &&
      prev.speaker !== current.speaker &&
      next &&
      nextAck &&
      next.speaker === current.speaker
    ) {
      current.speaker = prev.speaker;
    }

    if (
      next &&
      nextAck &&
      (next.speaker === 'Me' || next.speaker === 'Them') &&
      next.speaker === current.speaker &&
      isQuestionLike(current.text)
    ) {
      next.speaker = oppositeSpeaker(current.speaker);
    }

    if (
      prev &&
      (prev.speaker === 'Me' || prev.speaker === 'Them') &&
      (current.speaker === 'Me' || current.speaker === 'Them') &&
      prev.speaker !== current.speaker &&
      isAckLike(prev.text) &&
      isUncertaintyLike(current.text)
    ) {
      current.speaker = prev.speaker;
    }
  }

  return adjusted;
};

export const reassignShortBoundarySegments = <
  T extends AttributionSegment,
>(params: {
  segments: T[];
  maxWords?: number;
  maxGapSeconds?: number;
}): T[] => {
  const segments = params.segments || [];
  const maxWords = params.maxWords ?? 4;
  const maxGapSeconds = params.maxGapSeconds ?? 1.2;
  if (segments.length < 2) return [...segments];

  const adjusted = segments.map((segment) => ({ ...segment }));
  for (let i = 0; i < adjusted.length; i++) {
    const current = adjusted[i];
    if (current.speaker !== 'Me' && current.speaker !== 'Them') continue;
    const next = i + 1 < adjusted.length ? adjusted[i + 1] : null;
    if (!next || (next.speaker !== 'Me' && next.speaker !== 'Them')) continue;
    if (next.speaker === current.speaker) continue;

    const words = wordCount(current.text);
    if (words === 0 || words > maxWords) continue;

    const gapSeconds = Math.max(0, next.startTime - current.endTime);
    if (gapSeconds > maxGapSeconds) continue;

    const prev = i > 0 ? adjusted[i - 1] : null;
    const prevSameSpeaker = Boolean(prev && prev.speaker === current.speaker);
    const cue = normalizeText(current.text);
    const isBridgeCue =
      cue === 'that s it' ||
      cue === 'thats it' ||
      cue === 'okay' ||
      cue === 'ok' ||
      cue === 'yeah' ||
      cue === 'right' ||
      cue === 'anyway' ||
      cue === 'well' ||
      cue === 'so';

    if (prevSameSpeaker || isBridgeCue) {
      current.speaker = next.speaker;
    }
  }

  return adjusted;
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

const sumSegmentDurations = (segments: AttributionSegment[]): number => {
  return segments.reduce(
    (total, segment) =>
      total + Math.max(0.01, segment.endTime - segment.startTime),
    0,
  );
};

const getTimelineSpanDuration = (segments: AttributionSegment[]): number => {
  if (segments.length === 0) return 0;
  let minStart = Number.POSITIVE_INFINITY;
  let maxEnd = Number.NEGATIVE_INFINITY;
  for (const segment of segments) {
    if (
      !Number.isFinite(segment.startTime) ||
      !Number.isFinite(segment.endTime)
    )
      continue;
    if (segment.startTime < minStart) minStart = segment.startTime;
    if (segment.endTime > maxEnd) maxEnd = segment.endTime;
  }
  if (
    !Number.isFinite(minStart) ||
    !Number.isFinite(maxEnd) ||
    maxEnd <= minStart
  )
    return 0;
  return maxEnd - minStart;
};

export const shouldHydrateCanonicalTranscript = (params: {
  channelSegments: AttributionSegment[];
  canonicalSegments: AttributionSegment[];
  minCoverageRatio?: number;
}): boolean => {
  const channelSegments = params.channelSegments || [];
  const canonicalSegments = params.canonicalSegments || [];
  const minCoverageRatio = params.minCoverageRatio ?? 0.5;

  if (canonicalSegments.length === 0) return false;
  if (channelSegments.length === 0) return true;

  const speakerSet = new Set(
    channelSegments
      .map((segment) => segment.speaker)
      .filter((speaker) => speaker === 'Me' || speaker === 'Them'),
  );
  const hasBothSpeakers = speakerSet.has('Me') && speakerSet.has('Them');

  const channelDuration = sumSegmentDurations(channelSegments);
  const canonicalSpanDuration = getTimelineSpanDuration(canonicalSegments);
  const coverageRatio =
    canonicalSpanDuration > 0 ? channelDuration / canonicalSpanDuration : 0;

  if (
    hasBothSpeakers &&
    channelSegments.length >= 4 &&
    coverageRatio >= minCoverageRatio
  ) {
    return false;
  }

  return true;
};

export const stripLikelyMeBleedSegments = <T extends AttributionSegment>(
  segments: T[],
  activityWindows: SpeakerActivityWindow[] = [],
): MeBleedStripResult<T> => {
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
          shortEcho ||
          mediumEcho)
      ) {
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
