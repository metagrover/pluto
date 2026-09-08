// Operator-authorized real renderer/capture diagnostic, not a promotion gate.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function runControlledCapture({
  window,
  invoke,
  root,
  seconds,
  workload,
  playAudio = () =>
    spawn('/usr/bin/afplay', [path.join(root, 'system-input.wav')], {
      stdio: 'ignore',
    }),
}) {
  const file = fs.openSync(
    path.join(root, 'capture-events.jsonl'),
    'wx',
    0o600,
  );
  let closed = false;
  const activeRequests = new Set();
  const record = (event) => {
    if (closed) return; // Outstanding requests are durably censored at shutdown.
    if (event.event === 'notes_requested') activeRequests.add(event.meetingId);
    if (event.event === 'ask_requested') activeRequests.add(event.requestId);
    if (event.event === 'notes_terminal')
      activeRequests.delete(event.meetingId);
    if (event.event === 'ask_terminal') activeRequests.delete(event.requestId);
    fs.writeSync(file, `${JSON.stringify({ at: Date.now(), ...event })}\n`);
    fs.fsyncSync(file);
  };
  const evaluate = (code) => window.webContents.executeJavaScript(code);
  const until = async (code, timeout, reason) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await evaluate(code).catch(() => false)) return;
      await wait(250);
    }
    throw new Error(reason);
  };
  const pending = [];
  let recording = false;
  let player;
  let playing = false;
  let playbackError;
  const stopPlayback = () => {
    playing = false;
    player?.kill('SIGTERM');
  };
  process.once('exit', stopPlayback);
  const play = () => {
    player = playAudio();
    player.once('error', (error) => {
      playbackError = error;
    });
    player.once('exit', (code, signal) => {
      if (!playing) return;
      if (code !== 0 || signal)
        playbackError = new Error('synthetic_playback_failed');
      else play();
    });
  };
  try {
    record({ event: 'readiness_start' });
    const readiness = await invoke('RECORDING_READINESS_PREPARE');
    record({ event: 'readiness_result', readiness });
    assert.equal(readiness.ready, true, 'recording_readiness_failed');
    // setup_complete was written through real IPC by the caller. Reload so the
    // application mounts AudioManager and performs its normal readiness checks.
    window.webContents.reload();
    await until(
      "Boolean(window.ipcRenderer && [...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'All meetings'))",
      120_000,
      'full_workspace_not_ready',
    );
    if (workload === 'mixed') {
      for (let index = 0; index < 4; index += 1) {
        await invoke('SAVE_MEETING', {
          id: `capture-notes-${index}`,
          title: `Synthetic capture workload ${index}`,
          transcript_status: 'validated',
          finalization_status: 'finalized',
          transcript_integrity_json: JSON.stringify({ trust: 'eligible' }),
          transcript_json: JSON.stringify({
            segments: [
              {
                speaker: 7,
                text: `The synthetic project remains in planning. No task has been assigned. This is review number ${index + 1}.`,
              },
            ],
          }),
          user_notes: '',
        });
      }
    }
    // Use the real application's start/stop event handlers, never the capture
    // journal or provider in isolation. No production user-data is mounted.
    record({ event: 'recording_requested' });
    playing = true;
    play();
    recording = true;
    await evaluate("window.dispatchEvent(new Event('START_RECORDING'))");
    await until(
      "Boolean(document.querySelector('.recording-dot--recording'))",
      120_000,
      'recording_did_not_start',
    );
    const started = Date.now();
    record({ event: 'recording_started', seconds, workload });
    let nextAsk = started;
    let askIndex = 0;
    let nextNotes = started + 30_000;
    let notesIndex = 0;
    while (Date.now() - started < seconds * 1000) {
      const sampleAt = Date.now();
      const state = await evaluate(`({
        active: Boolean(document.querySelector('.recording-dot--recording')),
        transcript: document.querySelector('[data-live-transcript]')?.innerText ?? null,
        health: [...document.querySelectorAll('.recording-health')].map(n => n.innerText),
        elapsed: document.querySelector('.recording-status time')?.textContent ?? null
      })`);
      record({ event: 'capture_sample', sampleAt, state });
      assert.ok(state.active, 'recording_became_inactive');
      if (playbackError) throw playbackError;
      assert.ok(
        !state.health.some((value) => /unavailable/.test(value)),
        'capture_source_unavailable',
      );
      if (workload === 'mixed' && notesIndex < 4 && sampleAt >= nextNotes) {
        const meetingId = `capture-notes-${notesIndex++}`;
        nextNotes += 60_000;
        record({ event: 'notes_requested', meetingId });
        pending.push(
          invoke('GENERATE_MEETING_NOTES', {
            meetingId,
            requestId: meetingId,
            template: 'auto',
            reason: 'manual',
          }).then(
            () =>
              record({
                event: 'notes_terminal',
                meetingId,
                status: 'completed',
              }),
            (error) =>
              record({
                event: 'notes_terminal',
                meetingId,
                status: 'failed',
                error: String(error),
              }),
          ),
        );
      }
      if (workload === 'mixed' && askIndex < 8 && sampleAt >= nextAsk) {
        const requestId = `capture-ask-${askIndex++}`;
        nextAsk += 15_000;
        record({ event: 'ask_requested', requestId });
        pending.push(
          evaluate(`(async () => {
          const requestId = ${JSON.stringify(requestId)};
          const started = performance.now();
          let firstContentMs = null;
          const off = window.ipcRenderer.on('intelligence:query:delta', (_event, update) => {
            if (update.requestId === requestId && update.delta?.trim() && firstContentMs === null) firstContentMs = performance.now() - started;
          });
          try {
            const result = await window.ipcRenderer.invoke('intelligence:query', { requestId, query: 'What is the current synthetic project status?', modeOverride: 'fast' });
            return { firstContentMs, elapsedMs: performance.now() - started, status: result.status, outcome: result.outcome };
          } finally { off(); }
        })()`).then(
            (result) => record({ event: 'ask_terminal', requestId, result }),
            (error) =>
              record({
                event: 'ask_terminal',
                requestId,
                error: String(error),
              }),
          ),
        );
      }
      await wait(Math.max(0, 1000 - (Date.now() - sampleAt)));
    }
    record({ event: 'stop_requested' });
    await evaluate("window.dispatchEvent(new Event('STOP_RECORDING'))");
    await until(
      "!document.querySelector('.recording-dot--recording')",
      60_000,
      'recording_did_not_stop',
    );
    recording = false;
    playing = false;
    player?.kill('SIGTERM');
    record({ event: 'recording_stopped' });
    const convergenceDeadline = Date.now() + 600_000;
    let completed = false;
    void Promise.all(pending).then(() => {
      completed = true;
    });
    while (!completed && Date.now() < convergenceDeadline) await wait(1000);
    assert.ok(completed, 'notes_or_ask_convergence_timeout');
    let captured = [];
    while (Date.now() < convergenceDeadline) {
      captured = (await invoke('GET_MEETINGS')).filter(
        (meeting) => !meeting.id.startsWith('capture-notes-'),
      );
      if (captured.length) break;
      await wait(1000);
    }
    assert.equal(captured.length, 1, 'expected_one_persisted_capture');
    let meeting = await invoke('GET_MEETING', captured[0].id);
    const finalizationDeadline = Date.now() + 900_000;
    while (
      meeting.finalization_status === 'processing' ||
      meeting.transcript_status === 'validating'
    ) {
      assert.ok(
        Date.now() < finalizationDeadline,
        'capture_finalization_timeout',
      );
      await wait(1000);
      meeting = await invoke('GET_MEETING', captured[0].id);
    }
    record({ event: 'persisted_capture', meeting });
    assert.equal(
      meeting.finalization_status,
      'finalized',
      'capture_finalization_not_finalized',
    );
    assert.equal(
      meeting.transcript_status,
      'validated',
      'capture_transcript_not_validated',
    );
    record({
      event: 'diagnostic_completed',
      acceptance:
        'incomplete_marker_alignment_chunk_integrity_navigation_and_p95_not_scored',
    });
  } catch (error) {
    record({ event: 'failed', error: String(error) });
    throw error;
  } finally {
    stopPlayback();
    process.removeListener('exit', stopPlayback);
    if (recording) {
      record({ event: 'cleanup_stop_requested' });
      await evaluate("window.dispatchEvent(new Event('STOP_RECORDING'))").catch(
        () => {},
      );
      await until(
        "!document.querySelector('.recording-dot--recording')",
        30_000,
        'cleanup_stop_timeout',
      ).catch((error) =>
        record({ event: 'cleanup_stop_failed', error: String(error) }),
      );
    }
    for (const requestId of activeRequests)
      record({ event: 'censored_at_shutdown', requestId });
    closed = true;
    fs.closeSync(file);
  }
}
