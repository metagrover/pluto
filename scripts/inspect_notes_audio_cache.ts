// Sampled live-audio replay -> production offer/planning policy. No model or DB.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { precomputeNextMeetingNotesLeaf } from '../electron/llm/meetingNotesPipeline';
import { createNotesSource } from '../electron/llm/meetingNotesSource';
import { NotesStageCache } from '../electron/llm/meetingNotesStageCache';
import { shouldOfferIncrementalMeetingNotes } from '../src/services/incrementalMeetingNotesOffer';
import { toStoredLiveTranscriptCandidate } from '../src/utils/transcriptReadingProjection';

async function main() {
  assert.equal(process.argv.length, 3);
  const root = process.argv[2];
  assert.ok(path.isAbsolute(root));
  const directory = fs.lstatSync(root);
  assert.ok(
    directory.isDirectory() &&
      directory.uid === process.getuid?.() &&
      (directory.mode & 0o777) === 0o700,
  );
  const read = (name: string) => {
    const stat = fs.lstatSync(path.join(root, name));
    assert.ok(
      stat.isFile() &&
        stat.uid === process.getuid?.() &&
        (stat.mode & 0o777) === 0o600,
    );
    return fs.readFileSync(path.join(root, name), 'utf8');
  };
  assert.equal(
    JSON.parse(read('audio-replay-result.json')).status,
    'completed',
  );
  const events = read('audio-replay.jsonl')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  const snapshots = events.filter((e) => e.event === 'transcript_snapshot');
  let lastOffered = 0;
  let offers = 0;
  let wouldGenerate = 0;
  let largestSourceCharacters = 0;
  const stageCache = new NotesStageCache();
  const outcomes: string[] = [];
  for (const snapshot of snapshots) {
    // Mirror AudioManager's pure offer normalization: raw wording, time sort,
    // adjacent equal-speaker merge. No identity inference or fuzzy cache keys.
    const ordered = snapshot.segments
      .map(toStoredLiveTranscriptCandidate)
      .sort(
        (a: { startTime: number }, b: { startTime: number }) =>
          a.startTime - b.startTime,
      );
    const segments: Array<{ speaker: string; text: string }> = [];
    for (const segment of ordered) {
      const prior = segments.at(-1);
      if (prior && prior.speaker === segment.speaker)
        prior.text = `${prior.text.trim()} ${segment.text.trim()}`.trim();
      else segments.push({ speaker: segment.speaker, text: segment.text });
    }
    const sourceCharacterCount = segments.reduce(
      (n, s) => n + s.text.length,
      0,
    );
    largestSourceCharacters = Math.max(
      largestSourceCharacters,
      sourceCharacterCount,
    );
    if (
      !shouldOfferIncrementalMeetingNotes({
        sourceCharacterCount,
        lastOfferedCharacterCount: lastOffered,
      })
    )
      continue;
    offers++;
    lastOffered = sourceCharacterCount;
    const before = wouldGenerate;
    try {
      outcomes.push(
        await precomputeNextMeetingNotesLeaf({
          source: createNotesSource(JSON.stringify(segments)),
          context: {
            userNotes: '',
            template: 'auto',
            trustedUserTerms: [],
            entityHints: [],
          },
          provider: 'ollama',
          model: 'gemma4:12b',
          contextTokens: 16384,
          compactWriterContract: true,
          reviewProtocol: 'editor',
          stageCache,
          cacheKey: 'private-audio-policy-probe',
          generate: async () => {
            wouldGenerate++;
            throw new Error('diagnostic_generation_disabled');
          },
        }),
      );
    } catch {
      assert.ok(wouldGenerate > before, 'unexpected_planner_failure');
      outcomes.push('would_request_generation');
    }
  }
  console.log(
    JSON.stringify(
      {
        snapshots: snapshots.length,
        largestSourceCharacters,
        offers,
        wouldGenerate,
        physicalRequests: 0,
        outcomes,
        caveat:
          'Sampled live-source policy replay, no model warm-up, cache contents, app admission lease or final publication replay.',
      },
      null,
      2,
    ),
  );
}
void main().catch(() => {
  console.error('private_audio_cache_inspection_failed');
  process.exitCode = 1;
});
