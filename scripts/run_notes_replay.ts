// Read-only source export -> real production Gemma provider -> private evidence.
// No DB import, app initialization, publication, or experimental model routing.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analysisDocumentV3ToMarkdown } from '../electron/llm/analysisDocumentV3';
import { createNotesSource } from '../electron/llm/meetingNotesSource';
import {
  MeetingNotesError,
  NOTES_OLLAMA_MODEL,
} from '../electron/llm/meetingNotesTypes';
import { UnifiedLLMProvider } from '../electron/llm/unifiedProvider';
import {
  MEETING_NOTES_ABSOLUTE_DEADLINE_MS,
  createMeetingNotesOptionalReviewBudget,
} from '../electron/meetingAnalysisRuns';
import {
  MARKDOWN_NOTES_VERSION,
  generateMarkdownNotes,
} from './lib/notesReplayMarkdown';
import { triageNotesReplay } from './lib/notesReplayQuality';
import {
  NOTES_REPLAY_NORMAL_PRESSURE_SWAP_BUDGET_BYTES,
  notesReplayResourceStop,
  readNotesReplayResources,
  watchNotesReplayResources,
} from './lib/notesReplayResources';
import { createNotesReplayTransport } from './lib/notesReplayTransport';
import type { ReadonlyMeetingSource } from './lib/notes_readonly_sources.mjs';
import {
  appendOwnerOnlyPrivateLine,
  writeOwnerOnlyPrivateFile,
} from './lib/privateEvaluationFile';

const sha = (value: string | Buffer) =>
  createHash('sha256').update(value).digest('hex');
async function main() {
  const mode = process.env.NOTES_REPLAY_MODE ?? 'production';
  assert.equal(
    process.env.NOTES_REPLAY_COMPACT_EDITOR,
    undefined,
    'compact_editor_experiment_retired_use_archived_source',
  );
  const contextTokens = Number(process.env.NOTES_REPLAY_CONTEXT ?? '16384');
  assert.ok(
    [16384, 24576, 32768].includes(contextTokens),
    'invalid_replay_context',
  );
  assert.ok(
    mode !== 'markdown' || contextTokens === 16384,
    'markdown_context_is_fixed',
  );
  assert.ok(['production', 'markdown'].includes(mode), 'invalid_replay_mode');
  const replayModel = process.env.NOTES_REPLAY_MODEL ?? NOTES_OLLAMA_MODEL;
  assert.ok(
    [NOTES_OLLAMA_MODEL, 'qwen3.5:4b'].includes(replayModel),
    'invalid_replay_model',
  );
  const loadMode = process.env.NOTES_REPLAY_LOAD_MODE ?? 'mmap';
  assert.ok(
    loadMode === 'mmap' || loadMode === 'none',
    'invalid_replay_load_mode',
  );
  const selection = process.env.NOTES_REPLAY_CASES;
  assert.ok(
    selection === undefined ||
      /^(?:10|[1-9])(?:,(?:10|[1-9]))*$/.test(selection),
    'invalid_case_selection',
  );
  const selectedCases =
    selection?.split(',').map(Number) ??
    Array.from({ length: 10 }, (_, i) => i + 1);
  assert.equal(
    new Set(selectedCases).size,
    selectedCases.length,
    'duplicate_case_selection',
  );
  const isolated = process.env.NOTES_REPLAY_ISOLATED === '1';
  assert.ok(
    process.env.NOTES_REPLAY_ISOLATED === undefined || isolated,
    'invalid_isolated_opt_in',
  );
  assert.equal(
    process.argv.length,
    4,
    'usage: run_notes_replay.ts /absolute/private/sources.json --run',
  );
  assert.equal(process.argv[3], '--run', 'explicit_inference_opt_in_required');
  const inputPath = process.argv[2];
  assert.ok(path.isAbsolute(inputPath), 'absolute_source_export_required');
  const stat = fs.lstatSync(inputPath);
  assert.ok(
    stat.isFile() &&
      (stat.mode & 0o777) === 0o600 &&
      stat.uid === process.getuid?.(),
    'owner_only_source_export_required',
  );
  const bytes = fs.readFileSync(inputPath);
  const input = JSON.parse(bytes.toString()) as {
    source: string;
    databaseSha256: string;
    rows: ReadonlyMeetingSource[];
  };
  assert.equal(input.source, 'readonly_production_sources');
  assert.ok(
    Array.isArray(input.rows) && input.rows.length === 10,
    'frozen_ten_source_rows_required',
  );
  assert.equal(
    new Set(input.rows.map((row) => row.id)).size,
    input.rows.length,
    'duplicate_source_rows',
  );
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'pluto-notes-replay-')),
  );
  fs.chmodSync(root, 0o700);
  const write = (name: string, value: unknown) =>
    writeOwnerOnlyPrivateFile(
      path.join(root, name),
      JSON.stringify(value, null, 2),
    );
  const record = (event: Record<string, unknown>) =>
    appendOwnerOnlyPrivateLine(path.join(root, 'events.jsonl'), {
      at: Date.now(),
      ...event,
    });
  write('sources.json', input);
  const originalConsole = {
    log: console.log,
    warn: console.warn,
    error: console.error,
  };
  const print = console.log.bind(console);
  print(
    JSON.stringify({
      privateEvidence: root,
      scheduled: input.rows.length,
      selected: selectedCases.length,
      model: replayModel,
      mode,
    }),
  );
  console.log = (...args) => record({ event: 'provider_log', args });
  console.warn = console.log;
  console.error = console.log;
  const originalFetch = globalThis.fetch;
  let current = 0;
  const wire = createNotesReplayTransport({
    contextReuse: process.env.NOTES_REPLAY_CONTEXT_REUSE === '1',
    isolated,
    loadMode: loadMode as 'mmap' | 'none',
    root,
    model: replayModel,
    contextTokens,
    fetch: originalFetch,
    record,
    currentCase: () => current,
  });
  globalThis.fetch = wire.fetch;
  const results: Array<Record<string, unknown>> = [];
  const safetyController = new AbortController();
  let stopReason: string | null = null;
  let disposeGuard = async () => {};
  const stop = (reason: string) => {
    if (safetyController.signal.aborted) return;
    stopReason = reason;
    record({ event: 'safety_stop', reason, caseIndex: current });
    safetyController.abort(new MeetingNotesError('replay_safety_stop'));
  };
  const operatorStop = () => stop('operator_signal');
  process.on('SIGINT', operatorStop);
  process.on('SIGTERM', operatorStop);
  const snapshot = async () => ({
    at: Date.now(),
    swap: execFileSync('/usr/sbin/sysctl', ['vm.swapusage'], {
      encoding: 'utf8',
      timeout: 5000,
    }),
    thermal: execFileSync('/usr/bin/pmset', ['-g', 'therm'], {
      encoding: 'utf8',
      timeout: 5000,
    }),
    residentModels: await (
      await fetch('http://127.0.0.1:11434/api/ps', {
        signal: AbortSignal.timeout(5000),
      })
    ).json(),
  });
  try {
    const inventoryResponse = await fetch('http://127.0.0.1:11434/api/tags', {
      signal: AbortSignal.timeout(5000),
    });
    assert.ok(inventoryResponse.ok, 'model_inventory_failed');
    const inventory = await inventoryResponse.json();
    const model = inventory.models.find(
      (entry: { name: string }) => entry.name === replayModel,
    );
    assert.ok(
      model && /^[a-f0-9]{64}$/.test(model.digest),
      'model_identity_unavailable',
    );
    const repository = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '..',
    );
    const codePaths = [
      ...new Set([
        ...fs
          .readdirSync(path.join(repository, 'electron/llm'))
          .filter((file) => /^meetingNotes.*\.ts$/.test(file))
          .map((file) => `electron/llm/${file}`),
        'electron/llm/unifiedProvider.ts',
        'electron/llm/meetingNotesPipeline.ts',
        'electron/llm/meetingNotesAudit.ts',
        'electron/llm/meetingNotesWire.ts',
        'electron/llm/meetingNotesEditor.ts',
        'electron/llm/meetingNotesSchema.ts',
        'electron/llm/meetingNotesPrompts.ts',
        'electron/llm/meetingNotesTypes.ts',
        'electron/llm/meetingNotesBudget.ts',
        'electron/meetingAnalysisRuns.ts',
        'electron/llm/analysisGrounding.ts',
        'src/utils/actionCommitment.ts',
        'scripts/run_notes_replay.ts',
        'scripts/lib/notesReplayTransport.ts',
        'scripts/lib/notesReplayContinuation.ts',
        'scripts/lib/notesReplayQuality.ts',
        'scripts/lib/notesReplayResources.ts',
        'scripts/lib/notesReplayMarkdown.ts',
      ]),
    ];
    write('manifest.json', {
      schema: 'notes-production-replay-v1',
      partition: 'development_not_held_out',
      mode,
      candidateVersion: mode === 'markdown' ? MARKDOWN_NOTES_VERSION : null,
      selectedCases,
      runtimeEndpoint: isolated
        ? 'http://127.0.0.1:11435'
        : 'http://127.0.0.1:11434',
      runtimeConfiguration:
        'verify against daemon startup evidence; not inferred from endpoint',
      requestedKvCacheType: isolated
        ? (process.env.NOTES_REPLAY_KV_CACHE_TYPE ?? 'f16')
        : null,
      useMmapOverride: isolated ? loadMode === 'mmap' : null,
      inputSha256: sha(bytes),
      sourceDatabaseSha256: input.databaseSha256,
      model: model.name,
      digest: model.digest,
      contextTokens,
      compactWriterContract: mode === 'production',
      contextReuse: process.env.NOTES_REPLAY_CONTEXT_REUSE === '1',
      sourceFirstReconciliation: false,
      deadlineMs: MEETING_NOTES_ABSOLUTE_DEADLINE_MS,
      safetyPolicy: {
        sampleIntervalMs: 5000,
        maxSampleGapMs: 30000,
        minMemoryFreePercent: 10,
        version: 'os-pressure-bounded-swap-v2',
        maxSwapGrowthBytes: NOTES_REPLAY_NORMAL_PRESSURE_SWAP_BUDGET_BYTES,
        requiredMemoryPressure: 'normal',
        legacyWithoutPressureMaxSwapGrowthBytes: 512 * 1024 * 1024,
        thermalWarningsAllowed: false,
      },
      codeHashes: Object.fromEntries(
        codePaths.map((file) => [
          file,
          sha(fs.readFileSync(path.join(repository, file))),
        ]),
      ),
      scheduled: input.rows.map((row, index) => ({
        index: index + 1,
        sourceIdSha256: sha(row.id),
      })),
      omissions: [
        'user notes and entity hints intentionally empty',
        'no app publication or DB stage cache',
        'no process isolation or sustained resource acceptance',
        'not a blinded model comparison',
      ],
    });
    record({ event: 'resource_snapshot', snapshot: await snapshot() });
    const baseline = await readNotesReplayResources();
    record({ event: 'resource_baseline', ...baseline });
    const admissionStop = notesReplayResourceStop(baseline, baseline);
    if (admissionStop) stop(admissionStop);
    else disposeGuard = watchNotesReplayResources({ baseline, record, stop });
    const provider = new UnifiedLLMProvider('ollama', {
      ollama_model: replayModel,
    });
    for (const row of input.rows) {
      if (safetyController.signal.aborted) break;
      current += 1;
      const started = Date.now();
      const before = wire.count();
      const result: Record<string, unknown> = {
        index: current,
        sourceIdSha256: sha(row.id),
        durationSeconds: row.duration_seconds,
      };
      record({ event: 'meeting_started', ...result });
      const controller = new AbortController();
      const timer = setTimeout(
        () =>
          controller.abort(new MeetingNotesError('notes_deadline_exceeded')),
        MEETING_NOTES_ABSOLUTE_DEADLINE_MS,
      );
      try {
        if (!selectedCases.includes(current))
          throw new MeetingNotesError('not_selected');
        if (
          row.transcript_status !== 'validated' ||
          row.finalization_status !== 'finalized'
        )
          throw new MeetingNotesError('source_ineligible');
        if (typeof row.transcript_json !== 'string')
          throw new MeetingNotesError('invalid_notes_source');
        const source = createNotesSource(row.transcript_json);
        result.sourceCharacters = source.segments.reduce(
          (sum, segment) => sum + segment.text.length,
          0,
        );
        if (mode === 'markdown') {
          const candidate = await generateMarkdownNotes({
            source,
            model: replayModel,
            signal: AbortSignal.any([
              controller.signal,
              safetyController.signal,
            ]),
            onText: (text) =>
              record({ event: 'provisional_text', caseIndex: current, text }),
          });
          write(`case-${current}-candidate.json`, candidate);
          writeOwnerOnlyPrivateFile(
            path.join(root, `case-${current}-review.md`),
            `# Case ${current}: provisional Markdown, not quality-approved\n\n${candidate.markdown}\n\n## Canonical source\n\n${source.segments.map((s) => `[S${s.index}] ${s.speaker ?? 'Unknown'}: ${s.text}`).join('\n\n')}`,
          );
          result.outcome = 'candidate_generated_not_approved';
          result.firstTextMs = candidate.firstTextMs;
          result.metrics = candidate.metrics;
          result.triage = {
            status: candidate.triage.status,
            qualityApproved: false,
            invalidLines: candidate.triage.invalidLines,
            claimCount: candidate.triage.claims.length,
          };
        } else {
          const analysis = await provider.generateStructuredAnalysis(
            '',
            '',
            'auto',
            {
              source,
              contextTokens,
              compactWriterContract: true,
              onDraft: (draft, phase) => {
                if (!draft.sections.some((s) => s.items.length)) return;
                result.firstCompleteBulletMs ??= Date.now() - started;
                if (phase !== 'streaming')
                  result.firstDraftMs ??= Date.now() - started;
                record({
                  event:
                    phase === 'streaming'
                      ? 'streaming_bullet_ready'
                      : 'draft_preview_ready',
                  caseIndex: current,
                  elapsedMs: Date.now() - started,
                  sectionCount: draft.sections.length,
                  publication: false,
                });
              },
              signal: AbortSignal.any([
                controller.signal,
                safetyController.signal,
              ]),
              ...createMeetingNotesOptionalReviewBudget(started),
              workClass: 'manual_notes',
              onStageEvent: (detail) =>
                record({ event: 'stage_event', caseIndex: current, detail }),
              onPlan: (plan) => {
                result.plannedLeafCount = plan.plannedLeafCount;
              },
              onRepair: (task) =>
                record({ event: 'repair', caseIndex: current, task }),
              onRepartition: () =>
                record({ event: 'repartition', caseIndex: current }),
            },
          );
          write(`case-${current}-analysis.json`, analysis);
          assert.equal(
            analysis.generation_metadata?.model,
            replayModel,
            'result_model_mismatch',
          );
          assert.equal(
            analysis.generation_metadata?.source_provenance?.source_revision,
            source.revision,
            'result_source_revision_mismatch',
          );
          result.outcome = 'accepted_in_replay';
          result.triage = triageNotesReplay(analysis, source);
          result.pipelineVersion =
            analysis.generation_metadata?.pipeline_version;
          result.auditStatus = analysis.generation_metadata?.audit_status;
          writeOwnerOnlyPrivateFile(
            path.join(root, `case-${current}-review.md`),
            `# Case ${current}: private review\n\nNot quality-approved. Assess factual support, critical omissions, commitments and usefulness against the source. Record evidence for each verdict; do not infer truth from model fluency.\n\n## Generated notes\n\n${analysisDocumentV3ToMarkdown(analysis)}\n\n## Canonical source\n\n${source.segments.map((segment) => `[${segment.index}] ${segment.speaker ?? 'Unknown'}: ${segment.text}`).join('\n\n')}\n`,
          );
        }
      } catch (error) {
        result.outcome = safetyController.signal.aborted
          ? 'replay_safety_stop'
          : error instanceof MeetingNotesError
            ? error.code.split(':')[0]
            : 'replay_error';
        result.validationCategory =
          error instanceof MeetingNotesError
            ? (error.validationCategory ?? null)
            : null;
        record({
          event: 'private_error',
          caseIndex: current,
          error: String(error),
        });
      } finally {
        clearTimeout(timer);
      }
      result.elapsedMs = Date.now() - started;
      result.physicalRequests = wire.count() - before;
      results.push(result);
      record({ event: 'meeting_terminal', ...result });
      write('results.json', {
        schema: 'notes-production-replay-v1',
        status: current === input.rows.length ? 'completed' : 'running',
        scheduled: input.rows.length,
        physicalRequests: wire.count(),
        results,
        qualityApproved: false,
      });
      print(JSON.stringify(result));
      if (safetyController.signal.aborted) break;
      record({ event: 'resource_snapshot', snapshot: await snapshot() });
    }
    assert.equal(
      sha(fs.readFileSync(inputPath)),
      sha(bytes),
      'source_export_changed',
    );
    await disposeGuard();
    write('results.json', {
      schema: 'notes-production-replay-v1',
      status: stopReason ? 'stopped' : 'completed',
      stopReason,
      scheduled: input.rows.length,
      physicalRequests: wire.count(),
      results,
      qualityApproved: false,
    });
    record({
      event: 'run_terminal',
      status: stopReason ? 'stopped' : 'completed',
      stopReason,
      activeAttempts: wire.active(),
    });
    if (stopReason) process.exitCode = 2;
  } catch (error) {
    record({
      event: 'run_terminal',
      status: 'failed',
      error: String(error),
      activeAttempts: wire.active(),
    });
    throw error;
  } finally {
    await disposeGuard();
    process.removeListener('SIGINT', operatorStop);
    process.removeListener('SIGTERM', operatorStop);
    globalThis.fetch = originalFetch;
    Object.assign(console, originalConsole);
  }
}
void main().catch(() => {
  console.error('private_notes_replay_failed');
  process.exitCode = 1;
});
