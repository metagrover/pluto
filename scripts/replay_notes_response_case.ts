// Deterministic validation replay of captured complete attempts; no provider I/O.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateMeetingNotes } from '../electron/llm/meetingNotesPipeline';
import { buildNotesResponseSchema } from '../electron/llm/meetingNotesSchema';
import { createNotesSource } from '../electron/llm/meetingNotesSource';
import { MeetingNotesError } from '../electron/llm/meetingNotesTypes';
import { createNotesWireRequest } from '../electron/llm/meetingNotesWire';
import { createMeetingNotesOptionalReviewBudget } from '../electron/meetingAnalysisRuns';
import { createNotesReplayClock } from './lib/notesReplayClock';
import { notesReplayOutcomeLabel } from './lib/notesReplaySummary';
import {
  appendOwnerOnlyPrivateLine,
  writeOwnerOnlyPrivateFile,
} from './lib/privateEvaluationFile';

let failureRoot: string | undefined;
async function main() {
  assert.equal(process.argv.length, 4);
  const root = process.argv[2];
  const caseIndex = Number(process.argv[3]);
  assert.ok(
    path.isAbsolute(root) &&
      Number.isInteger(caseIndex) &&
      caseIndex >= 1 &&
      caseIndex <= 10,
  );
  const directory = fs.lstatSync(root);
  assert.ok(
    directory.isDirectory() &&
      directory.uid === process.getuid?.() &&
      (directory.mode & 0o777) === 0o700,
  );
  const read = (name: string) => {
    const file = path.join(root, name);
    const stat = fs.lstatSync(file);
    assert.ok(
      stat.isFile() &&
        stat.uid === process.getuid?.() &&
        (stat.mode & 0o777) === 0o600,
    );
    return fs.readFileSync(file, 'utf8');
  };
  const manifest = JSON.parse(read('manifest.json'));
  assert.equal(manifest.schema, 'notes-production-replay-v1');
  failureRoot = root;
  const repository = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
  );
  for (const file of [
    'electron/llm/meetingNotesPipeline.ts',
    'electron/llm/meetingNotesAudit.ts',
  ]) {
    assert.equal(
      createHash('sha256')
        .update(fs.readFileSync(path.join(repository, file)))
        .digest('hex'),
      manifest.codeHashes[file],
      'pipeline_changed_requires_new_replay_identity',
    );
  }
  const source = createNotesSource(
    JSON.parse(read('sources.json')).rows[caseIndex - 1].transcript_json,
  );
  const events = read('events.jsonl')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  const attempts = events.filter(
    (event) =>
      event.event === 'physical_started' && event.caseIndex === caseIndex,
  );
  let consumed = 0;
  let outcome = 'accepted_in_replay';
  let replayedError: string | undefined;
  let analysis: Awaited<ReturnType<typeof generateMeetingNotes>> | undefined;
  const clock = createNotesReplayClock(
    events.find(
      (event) => event.event === 'meeting_started' && event.index === caseIndex,
    )?.at,
  );
  const originalNow = Date.now;
  Date.now = clock.now;
  try {
    analysis = await generateMeetingNotes({
      source,
      context: {
        userNotes: '',
        template: 'auto',
        trustedUserTerms: [],
        entityHints: [],
      },
      reviewProtocol: 'editor',
      compactWriterContract: true,
      provider: 'ollama',
      model: manifest.model,
      contextTokens: manifest.contextTokens,
      ...createMeetingNotesOptionalReviewBudget(Date.now()),
      generate: async (request) => {
        const attempt = attempts[consumed++];
        assert.ok(attempt, 'recorded_responses_exhausted');
        assert.equal(
          attempt.prefix,
          `case-${caseIndex}-attempt-${attempt.attempt}`,
          'unsafe_attempt_path',
        );
        const captured = JSON.parse(read(`${attempt.prefix}-request.json`));
        const physicalTerminal = events.find(
          (event) =>
            event.event === 'physical_terminal' &&
            event.attempt === attempt.attempt &&
            event.caseIndex === caseIndex,
        );
        assert.ok(physicalTerminal, 'recorded_physical_terminal_missing');
        clock.advance(physicalTerminal.at);
        const wire = createNotesWireRequest(
          request.prompt,
          request.sourceSpans ?? [],
        );
        assert.equal(captured.model, manifest.model);
        assert.equal(captured.options.num_ctx, manifest.contextTokens);
        assert.equal(
          captured.messages?.length,
          1,
          'recorded_message_shape_mismatch',
        );
        assert.equal(
          captured.messages?.[0]?.content,
          wire.prompt,
          'recorded_prompt_mismatch',
        );
        assert.equal(
          captured.options.num_predict,
          request.outputTokens,
          'recorded_output_budget_mismatch',
        );
        assert.deepEqual(
          captured.format,
          buildNotesResponseSchema(request.responseContract, wire.sourceLabels),
          'recorded_schema_mismatch',
        );
        const packets = read(`${attempt.prefix}-response.ndjson`)
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line));
        assert.ok(
          packets.some((packet) => packet.done === true),
          'incomplete_attempt_not_replayable',
        );
        assert.ok(
          packets.every(
            (packet) =>
              !packet.error &&
              (!packet.model || packet.model === manifest.model),
          ),
          'invalid_attempt_not_replayable',
        );
        if (packets.some((packet) => packet.done_reason === 'length'))
          throw new MeetingNotesError('notes_output_truncated');
        return wire.decode(
          packets
            .map((packet) => packet.message?.content ?? packet.response ?? '')
            .join(''),
        );
      },
    });
  } catch (error) {
    if (!(error instanceof MeetingNotesError)) throw error;
    outcome = notesReplayOutcomeLabel(error.code);
    replayedError = String(error);
  } finally {
    Date.now = originalNow;
  }
  assert.equal(consumed, attempts.length, 'unconsumed_physical_attempts');
  const terminal = events.find(
    (event) => event.event === 'meeting_terminal' && event.index === caseIndex,
  );
  assert.equal(
    outcome,
    typeof terminal?.outcome === 'string'
      ? notesReplayOutcomeLabel(terminal.outcome)
      : undefined,
    'replayed_outcome_mismatch',
  );
  const recordedError = events.find(
    (event) => event.event === 'private_error' && event.caseIndex === caseIndex,
  );
  if (recordedError)
    assert.equal(
      replayedError,
      recordedError.error,
      'replayed_error_details_mismatch',
    );
  if (analysis) {
    const expected = JSON.parse(read(`case-${caseIndex}-analysis.json`));
    if (analysis.generation_metadata)
      analysis.generation_metadata.generated_at =
        expected.generation_metadata.generated_at;
    assert.deepEqual(
      JSON.parse(JSON.stringify(analysis)),
      expected,
      'replayed_analysis_mismatch',
    );
  }
  const result = {
    caseIndex,
    physicalRequests: 0,
    capturedAttemptsConsumed: consumed,
    outcome,
    exactResultReproduced: true,
    clockSemantics: 'recorded_physical_boundaries',
    caveat:
      'Recorded-boundary validation replay only; no OS timer, scheduler, or publication replay.',
  };
  writeOwnerOnlyPrivateFile(
    path.join(root, `case-${caseIndex}-offline-replay.json`),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
}
void main().catch((error) => {
  if (failureRoot)
    appendOwnerOnlyPrivateLine(
      path.join(failureRoot, 'offline-replay-errors.jsonl'),
      {
        at: Date.now(),
        caseIndex: Number(process.argv[3]),
        error: String(error),
        stack: error instanceof Error ? error.stack : null,
      },
    );
  console.error('private_response_replay_failed');
  process.exitCode = 1;
});
