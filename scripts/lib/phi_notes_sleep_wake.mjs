import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const hash = (value) => createHash('sha256').update(value).digest('hex');
const verifyPublication = (meeting) => {
  const state = JSON.parse(meeting.analysis_run_json);
  const analysis = JSON.parse(meeting.analysis_json);
  assert.equal(state.notes_status, 'published');
  assert.equal(typeof state.source_revision, 'string');
  assert.ok(state.source_revision.length > 0);
  assert.equal(analysis.generation_metadata.model, 'phi4-mini:3.8b');
  assert.equal(
    analysis.generation_metadata.pipeline_version,
    'notes-v30-source-first',
  );
  assert.equal(
    analysis.generation_metadata.source_provenance.source_revision,
    state.source_revision,
  );
  return state;
};

export async function runSleepWake({
  root,
  invoke,
  get,
  generate,
  powerMonitor,
  pauseTelemetry,
  sleepNow = () =>
    promisify(execFile)('/usr/bin/pmset', ['sleepnow'], { timeout: 30_000 }),
}) {
  const ledger = fs.openSync(
    path.join(root, 'sleep-wake-events.jsonl'),
    'wx',
    0o600,
  );
  const record = (event) => {
    fs.writeSync(ledger, `${JSON.stringify({ at: Date.now(), ...event })}\n`);
    fs.fsyncSync(ledger);
  };
  let suspendAt;
  let resumeAt;
  const onSuspend = () => {
    suspendAt = Date.now();
    record({ event: 'os_suspend' });
  };
  const onResume = () => {
    resumeAt = Date.now();
    record({ event: 'os_resume' });
  };
  powerMonitor.on('suspend', onSuspend);
  powerMonitor.on('resume', onResume);
  try {
    const before = await get();
    const priorHash = hash(before.analysis_json);
    record({ event: 'ready_for_operator_cue', priorHash });
    const cueDeadline = Date.now() + 300_000;
    while (!fs.existsSync(path.join(root, 'sleep-cue'))) {
      assert.ok(Date.now() < cueDeadline, 'sleep_operator_cue_timeout');
      await wait(100);
    }
    await invoke('SAVE_MEETING', {
      ...before,
      user_notes: 'Synthetic OS sleep and wake recovery trial.',
    });
    let terminal;
    const pending = generate('application-sleep-wake').then(
      () => {
        terminal = { completed: true };
      },
      (error) => {
        terminal = { completed: false, error: String(error) };
      },
    );
    let running;
    const startDeadline = Date.now() + 30_000;
    while (Date.now() < startDeadline) {
      const meeting = await get();
      const state = JSON.parse(meeting.analysis_run_json);
      if (state.notes_status === 'running') {
        running = state;
        break;
      }
      assert.ok(!terminal, 'notes_finished_before_sleep');
      await wait(25);
    }
    assert.ok(running, 'notes_did_not_start_before_sleep');
    assert.equal(hash((await get()).analysis_json), priorHash);
    await pauseTelemetry(true);
    record({
      event: 'sleep_requested_after_persisted_start',
      runId: running.run_id,
      telemetry: 'explicitly_paused_for_OS_sleep_not_zero_filled',
    });
    await sleepNow();
    const resumeDeadline = Date.now() + 120_000;
    while (!resumeAt) {
      assert.ok(Date.now() < resumeDeadline, 'OS_resume_not_observed');
      await wait(100);
    }
    assert.ok(
      suspendAt && resumeAt > suspendAt,
      'OS_suspend_resume_pair_required',
    );
    await pauseTelemetry(false);
    record({ event: 'telemetry_resumed', suspendedMs: resumeAt - suspendAt });
    const terminalDeadline = Date.now() + 600_000;
    while (!terminal && Date.now() < terminalDeadline) await wait(100);
    assert.ok(terminal, 'notes_post_wake_terminal_timeout');
    await pending;
    const after = await get();
    const state = JSON.parse(after.analysis_run_json);
    if (!terminal.completed) {
      assert.ok(['failed', 'cancelled'].includes(state.notes_status));
      assert.equal(
        hash(after.analysis_json),
        priorHash,
        'interrupted_notes_replaced_prior_publication',
      );
    } else verifyPublication(after);
    record({ event: 'post_wake_terminal', outcome: terminal, state });
    await generate('application-sleep-wake-explicit-retry');
    const retried = await get();
    const retryState = verifyPublication(retried);
    record({
      event: 'sleep_wake_verified',
      suspendedMs: resumeAt - suspendAt,
      retryRunId: retryState.run_id,
    });
  } catch (error) {
    record({ event: 'failed', error: String(error) });
    throw error;
  } finally {
    await pauseTelemetry(false);
    powerMonitor.removeListener('suspend', onSuspend);
    powerMonitor.removeListener('resume', onResume);
    fs.closeSync(ledger);
  }
}
