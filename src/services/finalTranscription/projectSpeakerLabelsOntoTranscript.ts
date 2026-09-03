import type { AttributionSegment } from '../../utils/speakerAttribution.ts';

type ResolvedSpeaker = 'Me' | 'Them';

type TimedSpeakerWord = {
  token: string;
  at: number;
  speaker: ResolvedSpeaker;
};

const normalizeToken = (value: string): string =>
  value
    .toLocaleLowerCase('en')
    .replace(/[^\p{L}\p{N}']/gu, '')
    .trim();

const resolvedSpeaker = (value: string): ResolvedSpeaker | null =>
  value === 'Me' || value === 'Them' ? value : null;

export const projectSpeakerLabelsOntoTranscript = <
  T extends AttributionSegment,
>(input: {
  segments: T[];
  evidenceSegments: AttributionSegment[];
  timingToleranceSeconds?: number;
}): {
  segments: T[];
  matchedWordCount: number;
  relabelledSegmentCount: number;
} => {
  const timingToleranceSeconds = input.timingToleranceSeconds ?? 0.5;
  const evidenceByToken = new Map<string, TimedSpeakerWord[]>();
  for (const segment of input.evidenceSegments) {
    const speaker = resolvedSpeaker(segment.speaker);
    if (!speaker) continue;
    for (const word of segment.words || []) {
      const token = normalizeToken(word.word);
      if (!token) continue;
      const entries = evidenceByToken.get(token) || [];
      entries.push({
        token,
        at: (word.start + word.end) / 2,
        speaker,
      });
      evidenceByToken.set(token, entries);
    }
  }

  let matchedWordCount = 0;
  let relabelledSegmentCount = 0;
  const segments = input.segments.map((segment) => {
    const words = segment.words || [];
    if (words.length === 0) return { ...segment } as T;
    const votes: Record<ResolvedSpeaker, number> = { Me: 0, Them: 0 };
    let segmentMatchedWords = 0;
    for (const word of words) {
      const token = normalizeToken(word.word);
      if (!token) continue;
      const at = (word.start + word.end) / 2;
      const match = (evidenceByToken.get(token) || []).reduce<
        { entry: TimedSpeakerWord; distance: number } | undefined
      >((best, entry) => {
        const distance = Math.abs(entry.at - at);
        if (distance > timingToleranceSeconds) return best;
        return !best || distance < best.distance ? { entry, distance } : best;
      }, undefined);
      if (!match) continue;
      votes[match.entry.speaker] += 1;
      segmentMatchedWords += 1;
    }
    matchedWordCount += segmentMatchedWords;
    const dominantSpeaker = votes.Me > votes.Them ? 'Me' : 'Them';
    const dominantVotes = votes[dominantSpeaker];
    const requiredMatches = Math.max(1, Math.ceil(words.length * 0.6));
    const decisive =
      segmentMatchedWords >= requiredMatches &&
      dominantVotes / segmentMatchedWords >= 0.8;
    if (!decisive || dominantSpeaker === segment.speaker) {
      return { ...segment } as T;
    }
    relabelledSegmentCount += 1;
    return { ...segment, speaker: dominantSpeaker } as T;
  });

  return { segments, matchedWordCount, relabelledSegmentCount };
};
