// Private real-time audio -> live transcript evidence, without notes inference,
// database initialization, publication, or production transcript mutation.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  notesReplayResourceStop,
  readNotesReplayResources,
  watchNotesReplayResources,
} from './lib/notesReplayResources';
import {
  appendOwnerOnlyPrivateLine,
  writeOwnerOnlyPrivateFile,
} from './lib/privateEvaluationFile';
import { runPrivateParakeetEouReplay } from './run_private_parakeet_eou_replay';
import { readPrivateParakeetEouManifest } from './validate_private_parakeet_eou_manifest';

async function main() {
  assert.equal(process.argv.length, 4);
  const manifestPath = process.argv[2];
  assert.equal(process.argv[3], '--run');
  assert.ok(path.isAbsolute(manifestPath));
  const root = path.dirname(manifestPath);
  const directory = fs.lstatSync(root);
  assert.ok(
    directory.isDirectory() &&
      directory.uid === process.getuid?.() &&
      (directory.mode & 0o777) === 0o700,
  );
  assert.ok(
    !fs.existsSync(path.join(root, 'audio-replay.jsonl')),
    'fresh_output_required',
  );
  const manifest = readPrivateParakeetEouManifest(manifestPath);
  assert.ok(
    manifest.expectedDurationSeconds <= 1800,
    'bounded_audio_replay_required',
  );
  const record = (value: unknown) =>
    appendOwnerOnlyPrivateLine(path.join(root, 'audio-replay.jsonl'), value);
  const controller = new AbortController();
  const stop = (reason: string) => {
    if (controller.signal.aborted) return;
    record({ event: 'stop', reason, at: Date.now() });
    controller.abort(new Error('audio_replay_stopped'));
  };
  const operatorStop = () => stop('operator_signal');
  process.on('SIGINT', operatorStop);
  process.on('SIGTERM', operatorStop);
  const timer = setTimeout(
    () => stop('deadline'),
    (manifest.expectedDurationSeconds + 300) * 1000,
  );
  let dispose = async () => {};
  let snapshots = 0;
  let latest: unknown = [];
  let lastSnapshot = 0;
  const save = () => {
    record({ event: 'transcript_snapshot', at: Date.now(), segments: latest });
    snapshots++;
    lastSnapshot = Date.now();
  };
  record({
    event: 'started',
    at: Date.now(),
    sourceManifestSha256: createHash('sha256')
      .update(fs.readFileSync(manifestPath))
      .digest('hex'),
    realTime: true,
    notesGenerationRequests: 0,
    productionWrites: false,
  });
  try {
    const baseline = await readNotesReplayResources();
    record({ event: 'resource_baseline', ...baseline });
    const reason = notesReplayResourceStop(baseline, baseline);
    if (reason) stop(reason);
    controller.signal.throwIfAborted();
    dispose = watchNotesReplayResources({ baseline, record, stop });
    const metrics = await runPrivateParakeetEouReplay(manifestPath, {
      signal: controller.signal,
      onTranscript: (segments) => {
        latest = segments;
        if (Date.now() - lastSnapshot >= 30000) save();
      },
    });
    controller.signal.throwIfAborted();
    save();
    const result = {
      status: 'completed',
      snapshots,
      notesGenerationRequests: 0,
      productionWrites: false,
      metrics,
    };
    writeOwnerOnlyPrivateFile(
      path.join(root, 'audio-replay-result.json'),
      JSON.stringify(result, null, 2),
    );
    console.log(JSON.stringify(result));
  } catch {
    const result = {
      status: 'failed_or_stopped',
      snapshots,
      notesGenerationRequests: 0,
      productionWrites: false,
    };
    writeOwnerOnlyPrivateFile(
      path.join(root, 'audio-replay-result.json'),
      JSON.stringify(result, null, 2),
    );
    console.log(JSON.stringify(result));
    process.exitCode = 1;
  } finally {
    clearTimeout(timer);
    await dispose();
    process.removeListener('SIGINT', operatorStop);
    process.removeListener('SIGTERM', operatorStop);
  }
}
void main().catch(() => {
  console.error('private_audio_replay_preflight_failed');
  process.exitCode = 1;
});
