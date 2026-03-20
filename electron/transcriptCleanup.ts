export interface TranscriptSegmentLike {
  id?: string;
  startTime?: number;
  endTime?: number;
  text: string;
  speaker?: string | number;
  [key: string]: unknown;
}

export interface TranscriptCleanupStats {
  input: number;
  after_dedupe: number;
  output: number;
  dropped_duplicates: number;
  merged_pairs: number;
}

export interface TranscriptCleanupResult {
  segments: TranscriptSegmentLike[];
  stats: TranscriptCleanupStats;
}

const normalizeTranscriptText = (text: string): string => {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

const tokenSimilarity = (left: string, right: string): number => {
  const leftTokens = new Set(
    normalizeTranscriptText(left).split(' ').filter(Boolean),
  );
  const rightTokens = new Set(
    normalizeTranscriptText(right).split(' ').filter(Boolean),
  );
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
  maxPrefixTokens = 8,
): number => {
  const leftTokens = normalizeTranscriptText(left).split(' ').filter(Boolean);
  const rightTokens = normalizeTranscriptText(right).split(' ').filter(Boolean);
  const sharedLength = Math.min(
    leftTokens.length,
    rightTokens.length,
    maxPrefixTokens,
  );
  if (sharedLength === 0) return 0;
  let matched = 0;
  for (let i = 0; i < sharedLength; i++) {
    if (leftTokens[i] !== rightTokens[i]) break;
    matched++;
  }
  return matched / sharedLength;
};

const normalizeSpeaker = (speaker: unknown): string => {
  if (typeof speaker === 'string') return speaker.trim().toLowerCase();
  if (typeof speaker === 'number') return String(speaker).toLowerCase();
  return '';
};

const mergeSegmentText = (
  baseText: string,
  incomingText: string,
  speaker: string,
): string => {
  const base = baseText.trim();
  const incoming = incomingText.trim();
  if (!base) return incoming;
  if (!incoming) return base;

  const baseNorm = normalizeTranscriptText(base);
  const incomingNorm = normalizeTranscriptText(incoming);

  if (speaker.toLowerCase() === 'them' || speaker.toLowerCase() === 'me') {
    if (incomingNorm === baseNorm) return base;
  }

  return `${base} ${incoming}`;
};

const filterDuplicateSpeakerSegments = (
  segments: TranscriptSegmentLike[],
  speaker: 'Me' | 'Them',
): { segments: TranscriptSegmentLike[]; dropped: number } => {
  const filtered: TranscriptSegmentLike[] = [];
  const recentForSpeaker: TranscriptSegmentLike[] = [];
  let dropped = 0;
  const target = speaker.toLowerCase();

  for (const segment of segments) {
    if (normalizeSpeaker(segment.speaker) !== target) {
      filtered.push(segment);
      continue;
    }

    const segNorm = normalizeTranscriptText(segment.text || '');
    const segStart =
      typeof segment.startTime === 'number' ? segment.startTime : 0;
    const isDuplicate = recentForSpeaker.some((prev) => {
      const prevStart = typeof prev.startTime === 'number' ? prev.startTime : 0;
      const prevEnd =
        typeof prev.endTime === 'number' ? prev.endTime : prevStart;
      const gap = segStart - prevEnd;
      if (gap > 2.5) return false;

      const prevNorm = normalizeTranscriptText(prev.text || '');
      if (!segNorm || !prevNorm) return false;
      if (segNorm === prevNorm) return true;

      const shorter = Math.min(segNorm.length, prevNorm.length);
      const longer = Math.max(segNorm.length, prevNorm.length);

      // If the new segment is a strict extension of the previous one,
      // keep it so we don't lose continuation detail.
      const lengthRatio = longer / Math.max(1, shorter);
      if (lengthRatio >= 1.25) return false;

      if (tokenSimilarity(segment.text || '', prev.text || '') >= 0.64)
        return true;
      if (tokenPrefixSimilarity(segment.text || '', prev.text || '') >= 0.84)
        return true;

      if (
        shorter >= 30 &&
        shorter / longer >= 0.9 &&
        (segNorm.includes(prevNorm) || prevNorm.includes(segNorm))
      ) {
        return true;
      }

      return false;
    });

    if (isDuplicate) {
      dropped++;
      continue;
    }

    filtered.push(segment);
    recentForSpeaker.push(segment);
    if (recentForSpeaker.length > 6) {
      recentForSpeaker.shift();
    }
  }

  return { segments: filtered, dropped };
};

const sanitizeSegments = (
  segments: TranscriptSegmentLike[],
): TranscriptSegmentLike[] => {
  return segments
    .filter((segment) => segment && typeof segment.text === 'string')
    .map((segment, index) => {
      const startTime =
        typeof segment.startTime === 'number' &&
        Number.isFinite(segment.startTime)
          ? segment.startTime
          : index;
      const endTime =
        typeof segment.endTime === 'number' && Number.isFinite(segment.endTime)
          ? segment.endTime
          : startTime + 0.01;

      return {
        ...segment,
        text: segment.text.trim(),
        startTime,
        endTime: endTime < startTime ? startTime : endTime,
      };
    })
    .filter((segment) => segment.text.length > 0)
    .sort((a, b) => {
      const aStart = typeof a.startTime === 'number' ? a.startTime : 0;
      const bStart = typeof b.startTime === 'number' ? b.startTime : 0;
      return aStart - bStart;
    });
};

const mergeConsecutiveSegments = (
  segments: TranscriptSegmentLike[],
  gapSeconds = 3,
): { segments: TranscriptSegmentLike[]; mergedPairs: number } => {
  const output: TranscriptSegmentLike[] = [];
  let mergedPairs = 0;

  for (const segment of segments) {
    const last = output[output.length - 1];
    const sameSpeaker =
      last && String(last.speaker ?? '') === String(segment.speaker ?? '');
    const lastEnd = last && typeof last.endTime === 'number' ? last.endTime : 0;
    const currentStart =
      typeof segment.startTime === 'number' ? segment.startTime : 0;
    const withinGap = sameSpeaker && currentStart - lastEnd <= gapSeconds;

    if (sameSpeaker && withinGap && last) {
      const mergedText = mergeSegmentText(
        last.text || '',
        segment.text || '',
        String(segment.speaker || ''),
      );
      if (mergedText !== last.text) {
        last.text = mergedText;
      }
      const segEnd =
        typeof segment.endTime === 'number' ? segment.endTime : currentStart;
      last.endTime = Math.max(lastEnd, segEnd);
      mergedPairs++;
      continue;
    }

    output.push({ ...segment });
  }

  return { segments: output, mergedPairs };
};

export const cleanTranscriptSegments = (
  rawSegments: TranscriptSegmentLike[],
): TranscriptCleanupResult => {
  const sanitized = sanitizeSegments(rawSegments);
  const dedupedThem = filterDuplicateSpeakerSegments(sanitized, 'Them');
  const dedupedMe = filterDuplicateSpeakerSegments(dedupedThem.segments, 'Me');
  const merged = mergeConsecutiveSegments(dedupedMe.segments, 3);

  return {
    segments: merged.segments,
    stats: {
      input: rawSegments.length,
      after_dedupe: dedupedMe.segments.length,
      output: merged.segments.length,
      dropped_duplicates: dedupedThem.dropped + dedupedMe.dropped,
      merged_pairs: merged.mergedPairs,
    },
  };
};
