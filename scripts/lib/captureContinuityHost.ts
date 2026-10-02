import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { BrowserWindow, app, ipcMain } from 'electron';
import { createCaptureDiagnostics } from '../../electron/captureDiagnostics';
import {
  authorizeCaptureJournalInterval,
  completeCaptureJournalCapturedChunk,
  createCaptureJournal,
  persistCaptureJournalRawChunk,
  readCaptureJournalManifest,
  sealCaptureJournal,
  stopCaptureJournal,
  updateCaptureJournalActivityEvidence,
} from '../../electron/captureJournal';
import { buildCaptureActivityEvidence } from '../../src/utils/transcriptActivityEvidence';

const root = process.env.PLUTO_CAPTURE_TEST_ROOT!;
app.setPath('userData', path.join(root, 'profile'));
app.disableHardwareAcceleration();
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const wait = (channel: string) =>
  new Promise<any>((resolve) =>
    ipcMain.once(channel, (_, result) => resolve(result)),
  );
let manifest: any;
let diagnostics: ReturnType<typeof createCaptureDiagnostics> | null;
let writeTimes: number[] = [];
let failedWrites = 0;
let mode = '';
const sources = ['mic', 'system'] as const;
ipcMain.handle('test-write', async (_, request) => {
  diagnostics?.renderer(request.diagnostics);
  manifest = await authorizeCaptureJournalInterval(root, {
    meetingId: mode,
    generation: manifest.generation,
    expectedRevision: manifest.revision,
    sequence: request.sequence,
    chunkStartSec: request.startSec,
    chunkEndSec: request.endSec,
  });
  for (const source of sources) {
    const started = performance.now();
    const data = Buffer.from(request.wav);
    diagnostics?.writeStarted(source);
    try {
      if (
        mode === 'disk_failure' &&
        request.sequence === 2 &&
        source === 'system'
      )
        throw new Error('injected_write_failure');
      manifest = await persistCaptureJournalRawChunk(root, {
        meetingId: mode,
        generation: manifest.generation,
        expectedRevision: manifest.revision,
        source,
        sequence: request.sequence,
        format: 'wav',
        data,
      });
      diagnostics?.written(
        source,
        'raw',
        data.length,
        performance.now() - started,
      );
      const checksum = createHash('sha256').update(data).digest('hex');
      diagnostics?.writeStarted(source);
      const completed = await completeCaptureJournalCapturedChunk(root, {
        meetingId: mode,
        generation: manifest.generation,
        expectedRevision: manifest.revision,
        source,
        sequence: request.sequence,
        rawChecksumSha256: checksum,
        repairData: data,
      });
      manifest = completed.manifest;
      diagnostics?.written(source, 'complete', 0, performance.now() - started);
      // Verify actual saved raw and repair bytes, not just successful promises.
      const interval = manifest.intervals.find(
        (value: any) => value.sequence === request.sequence,
      );
      for (const relative of [
        interval.sources[source].rawRelativePath,
        interval.sources[source].repairRelativePath,
      ]) {
        assert.equal(
          createHash('sha256')
            .update(await readFile(path.join(root, relative)))
            .digest('hex'),
          checksum,
        );
      }
    } catch (error) {
      diagnostics?.writeFailed(source, 'raw');
      if (mode !== 'disk_failure') throw error;
      failedWrites += 1;
    }
    writeTimes.push(performance.now() - started);
  }
});

const run = async () => {
  await app.whenReady();
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      backgroundThrottling: false,
    },
  });
  const ready = wait('renderer-ready');
  await window.loadURL(
    `data:text/html,<script>require(${JSON.stringify(path.join(root, 'renderer.cjs'))})</script>`,
  );
  await ready;
  const results = [];
  for (const nextMode of [
    'warmup',
    'baseline_0',
    'diagnostics_0',
    'diagnostics_1',
    'baseline_1',
    'baseline_2',
    'diagnostics_2',
    'native_stall',
    'delivery_stall',
    'disk_failure',
  ]) {
    mode = nextMode;
    writeTimes = [];
    failedWrites = 0;
    manifest = await createCaptureJournal(root, {
      meetingId: mode,
      startedAtMs: Date.now(),
      schemaVersion: 3,
    });
    diagnostics =
      mode.startsWith('baseline') || mode === 'warmup'
        ? null
        : createCaptureDiagnostics({
            persist: (report) =>
              writeFile(
                path.join(root, mode, 'capture-journal', 'diagnostics.json'),
                JSON.stringify(report),
              ),
          });
    diagnostics?.nativeStarted();
    const rendererReady = wait('test-ready');
    window.webContents.send('test-start', mode);
    await rendererReady;
    const cpu = process.cpuUsage();
    const memory = process.memoryUsage().rss;
    const loop = monitorEventLoopDelay({ resolution: 10 });
    loop.enable();
    const begin = performance.now();
    let frames = 0;
    for (let index = 0; index < 600; index += 1) {
      if (index === 200 && mode === 'native_stall') {
        diagnostics?.stderr(
          `[AudioCapHealth] ${JSON.stringify({ event: 'stalled', framesWritten: frames, tapGeneration: 1, retries: 0 })}\n`,
        );
        await delay(400);
      }
      const pcm = Buffer.allocUnsafe(480 * 4);
      for (let sample = 0; sample < 480; sample += 1)
        pcm.writeFloatLE(((frames + sample) % 2048) / 2048 - 0.5, sample * 4);
      frames += 480;
      diagnostics?.received(pcm.length);
      if (index % 100 === 0)
        diagnostics?.stderr(
          `[AudioCapHealth] ${JSON.stringify({ event: 'heartbeat', framesWritten: frames, tapGeneration: 1, retries: 0 })}\n`,
        );
      if (mode === 'delivery_stall' && index >= 200 && index < 240) {
        // The main process received audio; the renderer never receives these frames.
        diagnostics?.forwarded(pcm.length);
      } else {
        window.webContents.send('test-pcm', pcm);
        diagnostics?.forwarded(pcm.length);
      }
      await delay(10);
    }
    const done = wait('test-result');
    window.webContents.send('test-finish');
    const result = await done;
    await updateCaptureJournalActivityEvidence(root, {
      meetingId: mode,
      activityEvidence: await buildCaptureActivityEvidence([], {
        clock: { kind: 'meeting_relative_seconds', origin: 'recording_start' },
        thresholds: {
          rms: 0.01,
          dominanceRatio: 1.5,
          minimumSwitchIntervalMs: 250,
        },
        algorithmVersion: 'speaker_activity_v1',
      }),
    });
    manifest = await readCaptureJournalManifest(root, mode);
    manifest = await stopCaptureJournal(root, {
      meetingId: mode,
      generation: manifest.generation,
      expectedRevision: manifest.revision,
    });
    await sealCaptureJournal(root, { meetingId: mode, endedAtMs: Date.now() });
    await diagnostics?.stop();
    loop.disable();
    const cpuUsed = process.cpuUsage(cpu);
    const elapsedMs = performance.now() - begin;
    if (mode === 'delivery_stall')
      assert.equal(result.counters.samplesAccepted, frames - 40 * 480);
    else {
      assert.equal(result.counters.samplesAccepted, frames);
      assert.equal(result.mismatches, 0);
    }
    if (mode === 'native_stall' || mode === 'delivery_stall') {
      assert.equal(result.warnings, 1);
      assert.equal(result.recovery, 1);
    } else {
      assert.equal(result.warnings, 0);
      assert.equal(result.recovery, 0);
    }
    if (mode === 'disk_failure') {
      assert.equal(failedWrites, 1);
      assert.equal(manifest.intervals[2].sources.system.disposition, 'missing');
    } else
      assert.ok(
        manifest.intervals.every((entry: any) =>
          sources.every(
            (source) => entry.sources[source].disposition === 'captured',
          ),
        ),
      );
    if (mode !== 'warmup')
      results.push({
        ...result,
        elapsedMs,
        mainCpuPercent: (cpuUsed.user + cpuUsed.system) / elapsedMs / 10,
        rssChangeBytes: process.memoryUsage().rss - memory,
        eventLoopP99Ms: loop.percentile(99) / 1e6,
        maxWriteMs: Math.max(...writeTimes),
        failedWrites,
      });
    console.log(JSON.stringify({ completed: mode }));
  }
  await writeFile(
    path.join(root, 'result.json'),
    JSON.stringify(
      {
        isolation:
          'temporary_profile_synthetic_pcm_real_electron_ipc_and_capture_journal',
        results,
      },
      null,
      2,
    ),
  );
  window.destroy();
  app.quit();
};
void run().catch((error) => {
  console.error(error);
  app.exit(1);
});
