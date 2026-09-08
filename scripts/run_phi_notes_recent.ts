// Explicit read-only production-source development replay; never publishes notes.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createNotesSource } from '../electron/llm/meetingNotesSource';
import {
  MeetingNotesError,
  PHI_NOTES_EXPERIMENT_DIGEST,
  PHI_NOTES_EXPERIMENT_MODEL,
} from '../electron/llm/meetingNotesTypes';
import { UnifiedLLMProvider } from '../electron/llm/unifiedProvider';
import { readReadonlyMeetingSources } from './lib/phi_notes_readonly_sources.mjs';

async function main() {
  assert.equal(process.argv.length, 3, 'one_absolute_database_path_required');
  const source = readReadonlyMeetingSources(process.argv[2], undefined, {
    latestTen: true,
  });
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'pluto-phi-recent-ten-')),
  );
  fs.chmodSync(root, 0o700);
  const write = (name: string, value: unknown) =>
    fs.writeFileSync(path.join(root, name), JSON.stringify(value, null, 2), {
      mode: 0o600,
      flag: 'wx',
    });
  write('sources.json', source);
  const ledger = fs.openSync(path.join(root, 'events.jsonl'), 'wx', 0o600);
  const record = (value: unknown) => {
    fs.writeSync(ledger, `${JSON.stringify({ at: Date.now(), value })}\n`);
    fs.fsyncSync(ledger);
  };
  const print = console.log.bind(console);
  print(
    JSON.stringify({ privateEvidence: root, selected: source.rows.length }),
  );
  const originalConsole = {
    log: console.log,
    warn: console.warn,
    error: console.error,
  };
  console.log = (...args) => record({ event: 'provider_log', args });
  console.warn = console.log;
  console.error = console.log;
  const originalFetch = globalThis.fetch;
  let current = 0;
  let requests = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, 'http://127.0.0.1:11434', 'local_only_transport');
    let attempt: number | undefined;
    if (init?.body && typeof init.body === 'string') {
      const body = JSON.parse(init.body);
      if (body.messages || body.prompt) {
        assert.equal(body.model, PHI_NOTES_EXPERIMENT_MODEL);
        attempt = ++requests;
        record({
          event: 'physical_started',
          current,
          attempt,
          endpoint: url.pathname,
          body,
        });
      }
    }
    try {
      const response = await originalFetch(input, init);
      if (attempt)
        record({
          event: 'physical_headers',
          current,
          attempt,
          status: response.status,
        });
      return response;
    } catch {
      if (attempt)
        record({ event: 'physical_transport_failed', current, attempt });
      throw new Error('local_transport_failed');
    }
  };
  const results: Array<Record<string, unknown>> = [];
  try {
    const inventory = await (
      await fetch('http://127.0.0.1:11434/api/tags')
    ).json();
    assert.ok(
      inventory.models.some(
        (model: { name: string; digest: string }) =>
          model.name === PHI_NOTES_EXPERIMENT_MODEL &&
          model.digest === PHI_NOTES_EXPERIMENT_DIGEST,
      ),
      'phi_identity_mismatch',
    );
    const provider = new UnifiedLLMProvider('ollama', {
      ollama_model: PHI_NOTES_EXPERIMENT_MODEL,
      ollama_fast_model: PHI_NOTES_EXPERIMENT_MODEL,
      ollama_seed: 41,
      ollama_structured_thinking: false,
    });
    for (const row of source.rows) {
      current += 1;
      const started = Date.now();
      const before = requests;
      const result: Record<string, unknown> = {
        index: current,
        sourceIdSha256: createHash('sha256').update(row.id).digest('hex'),
        durationSeconds: row.duration_seconds,
      };
      record({ event: 'meeting_started', ...result });
      try {
        if (
          row.transcript_status !== 'validated' ||
          row.finalization_status !== 'finalized'
        )
          throw new MeetingNotesError('source_ineligible');
        if (typeof row.transcript_json !== 'string')
          throw new MeetingNotesError('invalid_notes_source');
        const notesSource = createNotesSource(row.transcript_json);
        result.sourceCharacters = notesSource.segments.reduce(
          (sum, segment) => sum + segment.text.length,
          0,
        );
        result.sourceSegments = notesSource.segments.length;
        const analysis = await provider.generateStructuredAnalysis(
          '',
          '',
          'auto',
          {
            source: notesSource,
            contextTokens: 16_384,
            compactWriterContract: true,
            sourceFirstReconciliation: true,
            signal: AbortSignal.timeout(10 * 60_000),
            onStageEvent: (event) =>
              record({ event: 'stage_event', current, detail: event }),
            onPlan: (plan) => {
              result.plannedLeafCount = plan.plannedLeafCount;
            },
          },
        );
        write(`meeting-${current}-analysis.json`, analysis);
        result.outcome = 'accepted_in_replay';
        result.quality = 'pending_source_grounded_review';
      } catch (error) {
        result.outcome =
          error instanceof MeetingNotesError ? error.code : 'replay_error';
        record({ event: 'private_error', current, error: String(error) });
      }
      result.elapsedMs = Date.now() - started;
      result.physicalRequests = requests - before;
      results.push(result);
      record({ event: 'meeting_terminal', ...result });
      print(JSON.stringify(result));
    }
    write('results.json', {
      schema: 'phi-recent-ten-development-v1',
      partition: 'development_not_held_out',
      contextTokens: 16_384,
      model: PHI_NOTES_EXPERIMENT_MODEL,
      digest: PHI_NOTES_EXPERIMENT_DIGEST,
      sourceDatabaseSha256: source.databaseSha256,
      physicalRequests: requests,
      results,
      limitations: [
        'No production publication',
        'No human quality gold',
        'No full application or sustained resource acceptance',
        'Physical headers are not stream completion; stage events retain terminal outcomes',
      ],
    });
  } finally {
    globalThis.fetch = originalFetch;
    Object.assign(console, originalConsole);
    fs.closeSync(ledger);
  }
}
void main().catch(() => {
  console.error('private_recent_ten_replay_failed');
  process.exitCode = 1;
});
