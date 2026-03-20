interface TranscriptSegmentLike {
  text?: unknown;
  speaker?: unknown;
}

/** Parse legacy array or v2 `{ segments }` wrapper. */
export const parseTranscriptSegments = (
  transcriptJson?: string | null,
): TranscriptSegmentLike[] => {
  if (!transcriptJson || !transcriptJson.trim()) {
    return [];
  }

  try {
    const parsed = JSON.parse(transcriptJson) as unknown;
    if (Array.isArray(parsed)) {
      return parsed as TranscriptSegmentLike[];
    }
    if (parsed && typeof parsed === 'object') {
      const segments = (parsed as { segments?: unknown }).segments;
      if (Array.isArray(segments)) {
        return segments as TranscriptSegmentLike[];
      }
    }
    return [];
  } catch {
    return [];
  }
};

export const isTranscriptJsonEffectivelyEmpty = (
  transcriptJson?: string | null,
): boolean => {
  return parseTranscriptSegments(transcriptJson).length === 0;
};

export const buildAnalysisTranscriptFromJson = (
  transcriptJson?: string | null,
): string => {
  const segments = parseTranscriptSegments(transcriptJson);
  return segments
    .map((segment) => {
      const text = typeof segment?.text === 'string' ? segment.text.trim() : '';
      if (!text) {
        return '';
      }
      const speaker =
        typeof segment?.speaker === 'string' ||
        typeof segment?.speaker === 'number'
          ? String(segment.speaker).trim()
          : '';
      return speaker ? `${speaker}: ${text}` : text;
    })
    .filter(Boolean)
    .join('\n');
};
