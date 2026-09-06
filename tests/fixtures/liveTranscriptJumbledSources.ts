import type { LiveTranscriptSegment } from '../../src/components/features/recordingWorkspaceModel';
import type { LiveEchoEvidenceWindow } from '../../src/services/liveTranscription/liveEchoEvidence';

type TimedWord = NonNullable<LiveTranscriptSegment['wordTimings']>[number];

const REMOTE_CLAUSES = [
  'Alpha, cedar lanterns guide quiet hikers across the northern valley before sunrise.',
  'Bakers carry warm loaves past the station while morning trains approach slowly.',
  'Copper rivers reflect amber clouds as patient sailors check every compass twice.',
  'Distant gardens shelter bright finches beneath old windows during gentle summer rain.',
  'Engineers review careful sketches beside the workshop before assembling each wooden frame.',
  'Friendly neighbors share fresh peaches around the courtyard when evening shadows arrive.',
] as const;

const LOCAL_REPLIES = [
  'um keep my note',
  'I agree with that',
  'please mark this decision',
] as const;

const words = (text: string): string[] => text.split(/\s+/u);

const timedWords = (text: string, startMs: number, stepMs = 300): TimedWord[] =>
  words(text).map((word, index) => ({
    text: word,
    timestampMs: startMs + index * stepMs,
    endTimestampMs: startMs + (index + 1) * stepMs,
  }));

/**
 * A deterministic replay of the confusing dual-source shape: the microphone
 * hypothesis contains six echoed System spans with three genuine local replies
 * between them. Each System turn contains two clauses separated by enough room
 * for the local reply, so every removable range needs its own evidence.
 */
export const liveTranscriptJumbledSourcesFixture = () => {
  const micWords: TimedWord[] = [];
  const systemSegments: LiveTranscriptSegment[] = [];
  const echoEvidence: LiveEchoEvidenceWindow[] = [];
  const expectedSuppressedWordRanges: Array<{
    startWord: number;
    endWord: number;
    supportingSegmentId: string;
  }> = [];
  const expectedLocalWords: string[] = [];

  for (let turn = 0; turn < 3; turn += 1) {
    const turnStartMs = turn * 12_000;
    const firstClause = REMOTE_CLAUSES[turn * 2];
    const secondClause = REMOTE_CLAUSES[turn * 2 + 1];
    const firstWords = timedWords(firstClause, turnStartMs);
    const localStartMs = firstWords.at(-1)!.endTimestampMs;
    const localWords = timedWords(LOCAL_REPLIES[turn], localStartMs);
    const secondStartMs = localWords.at(-1)!.endTimestampMs;
    const secondWords = timedWords(secondClause, secondStartMs);
    const systemId = `system-${turn + 1}`;

    const firstStartWord = micWords.length;
    micWords.push(...firstWords);
    expectedSuppressedWordRanges.push({
      startWord: firstStartWord,
      endWord: micWords.length,
      supportingSegmentId: systemId,
    });
    micWords.push(...localWords);
    expectedLocalWords.push(...localWords.map((word) => word.text));
    const secondStartWord = micWords.length;
    micWords.push(...secondWords);
    expectedSuppressedWordRanges.push({
      startWord: secondStartWord,
      endWord: micWords.length,
      supportingSegmentId: systemId,
    });

    const systemWordTimings = [...firstWords, ...secondWords];
    systemSegments.push({
      id: systemId,
      source: 'system',
      speaker: 'Them',
      text: `${firstClause} ${secondClause}`,
      rawText: `${firstClause} ${secondClause}`,
      timestampMs: firstWords[0].timestampMs,
      endTimestampMs: secondWords.at(-1)!.endTimestampMs,
      confirmed: true,
      wordTimings: systemWordTimings,
    });
    for (const clauseWords of [firstWords, secondWords]) {
      echoEvidence.push({
        micStartMs: clauseWords[0].timestampMs,
        micEndMs: clauseWords.at(-1)!.endTimestampMs,
        systemStartMs: clauseWords[0].timestampMs,
        systemEndMs: clauseWords.at(-1)!.endTimestampMs,
      });
    }
  }

  const mic: LiveTranscriptSegment = {
    id: 'mic-long-hypothesis',
    source: 'mic',
    speaker: 'Me',
    text: micWords.map((word) => word.text).join(' '),
    rawText: micWords.map((word) => word.text).join(' '),
    timestampMs: micWords[0].timestampMs,
    endTimestampMs: micWords.at(-1)!.endTimestampMs,
    confirmed: true,
    wordTimings: micWords,
  };

  return {
    segments: [mic, ...systemSegments],
    mic,
    systemSegments,
    echoEvidence,
    expectedLocalWords,
    expectedSuppressedWordRanges,
  };
};
