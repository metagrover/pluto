// macOS-only diagnostic launcher. No production configuration or model mutation.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import {
  appendOwnerOnlyPrivateLine,
  writeOwnerOnlyPrivateFile,
} from './lib/privateEvaluationFile';

async function main() {
  const loadMode = process.env.NOTES_REPLAY_LOAD_MODE ?? 'mmap';
  assert.ok(['mmap', 'none'].includes(loadMode), 'invalid_replay_load_mode');
  const kvCacheType = process.env.NOTES_REPLAY_KV_CACHE_TYPE ?? 'f16';
  assert.ok(['f16', 'q8_0'].includes(kvCacheType), 'invalid_kv_cache_type');
  assert.equal(process.platform, 'darwin', 'macos_diagnostic_only');
  assert.equal(
    process.argv.length,
    4,
    'usage: run_notes_cache_isolation.ts /absolute/private/sources.json --run',
  );
  assert.equal(process.argv[3], '--run', 'explicit_inference_opt_in_required');
  const source = process.argv[2];
  assert.ok(path.isAbsolute(source), 'absolute_source_export_required');
  const stat = fs.lstatSync(source);
  assert.ok(
    stat.isFile() &&
      (stat.mode & 0o777) === 0o600 &&
      stat.uid === process.getuid?.(),
    'owner_only_source_export_required',
  );
  const resident = await fetch('http://127.0.0.1:11434/api/ps', {
    signal: AbortSignal.timeout(5000),
  });
  assert.ok(resident.ok, 'shared_runtime_status_unavailable');
  assert.deepEqual(
    (await resident.json()).models,
    [],
    'unload_shared_models_before_isolated_run',
  );
  // Refuse port collisions; never attach to or terminate another daemon.
  const probe = net.createServer();
  await new Promise<void>((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(11435, '127.0.0.1', () => probe.close(() => resolve()));
  });
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'pluto-cache-isolation-')),
  );
  fs.chmodSync(root, 0o700);
  const binary = '/Applications/Ollama.app/Contents/Resources/ollama';
  const env = {
    ...process.env,
    OLLAMA_HOST: '127.0.0.1:11435',
    OLLAMA_MODELS: path.join(os.homedir(), '.ollama/models'),
    OLLAMA_NOPRUNE: 'true',
    OLLAMA_NO_CLOUD: 'true',
    OLLAMA_NUM_PARALLEL: '1',
    OLLAMA_MAX_LOADED_MODELS: '1',
    LLAMA_ARG_CACHE_RAM: '0',
    LLAMA_ARG_CTX_CHECKPOINTS: '0',
    OLLAMA_KV_CACHE_TYPE: kvCacheType,
    OLLAMA_FLASH_ATTENTION: '1',
  };
  const log = fs.openSync(path.join(root, 'daemon.log'), 'wx', 0o600);
  const daemon = spawn(binary, ['serve'], {
    env,
    detached: true,
    stdio: ['ignore', log, log],
  });
  let daemonError: Error | undefined;
  daemon.on('error', (error) => {
    daemonError = error;
  });
  let replay: ReturnType<typeof spawn> | undefined;
  let sampling: ReturnType<typeof setInterval> | undefined;
  let sampleFailed = false;
  let cleanupFailed = false;
  const running = () => daemon.exitCode === null && daemon.signalCode === null;
  const signalOwned = (signal: NodeJS.Signals) => {
    if (!daemon.pid) return;
    try {
      process.kill(-daemon.pid, signal);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
        cleanupFailed = true;
        console.error('owned_daemon_cleanup_failed');
        process.exitCode = 1;
      }
    }
  };
  let interrupted = false;
  const stop = () => {
    interrupted = true;
    replay?.kill('SIGTERM');
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  const write = (value: unknown) =>
    writeOwnerOnlyPrivateFile(
      path.join(root, 'isolation.json'),
      JSON.stringify(value, null, 2),
    );
  const configuration = {
    binary,
    daemonPid: daemon.pid,
    endpoint: env.OLLAMA_HOST,
    requestedCacheRamMiB: 0,
    requestedContextCheckpoints: 0,
    requestedKvCacheType: kvCacheType,
    useMmap: loadMode === 'mmap',
    source,
    runtimeSettingsRequireLogVerification: true,
  };
  try {
    write({ ...configuration, status: 'starting' });
    console.log(JSON.stringify({ privateRuntimeEvidence: root }));
    let ready = false;
    for (let attempt = 0; attempt < 50 && !interrupted; attempt++) {
      if (daemonError) throw daemonError;
      assert.equal(daemon.exitCode, null, 'owned_daemon_exited');
      try {
        const response = await fetch('http://127.0.0.1:11435/api/version', {
          signal: AbortSignal.timeout(500),
        });
        if (response.ok) {
          ready = true;
          break;
        }
      } catch {
        /* startup only; no inference is retried */
      }
      await delay(100);
    }
    assert.ok(ready && !interrupted, 'owned_daemon_not_ready');
    assert.equal(
      execFileSync(
        '/usr/sbin/lsof',
        ['-t', '-nP', '-iTCP:11435', '-sTCP:LISTEN'],
        { encoding: 'utf8', timeout: 5000 },
      ).trim(),
      String(daemon.pid),
      'diagnostic_port_not_owned_by_launcher',
    );
    write({ ...configuration, status: 'running' });
    sampling = setInterval(() => {
      const record = (value: unknown) =>
        appendOwnerOnlyPrivateLine(
          path.join(root, 'process-memory.jsonl'),
          value,
        );
      try {
        const listing = execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,comm='], {
          encoding: 'utf8',
          timeout: 5000,
        });
        const worker = listing
          .split('\n')
          .map((line) => line.trim().split(/\s+/))
          .find(
            ([, parent, command]) =>
              parent === String(daemon.pid) &&
              command ===
                '/Applications/Ollama.app/Contents/Resources/llama-server',
          );
        if (!worker) {
          record({ at: Date.now(), event: 'worker_not_present' });
          return;
        }
        const pid = worker[0];
        const ps = execFileSync(
          '/bin/ps',
          ['-p', pid, '-o', 'pid=,ppid=,rss='],
          { encoding: 'utf8', timeout: 5000 },
        );
        const footprint = execFileSync('/usr/bin/footprint', ['-p', pid], {
          encoding: 'utf8',
          timeout: 5000,
        });
        record({ at: Date.now(), pid: Number(pid), ps, footprint });
      } catch {
        sampleFailed = true;
        stop();
      }
    }, 30000);
    const require = createRequire(import.meta.url);
    const repository = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '..',
    );
    replay = spawn(
      process.execPath,
      [
        require.resolve('tsx/cli'),
        'scripts/run_notes_replay.ts',
        source,
        '--run',
      ],
      {
        cwd: repository,
        env: { ...process.env, NOTES_REPLAY_ISOLATED: '1' },
        stdio: 'inherit',
      },
    );
    const code = await new Promise<number>((resolve, reject) => {
      replay!.once('error', reject);
      replay!.once('exit', (code) => resolve(code ?? 1));
    });
    assert.ok(!sampleFailed, 'process_memory_sample_failed');
    const runtimeLog = fs.readFileSync(path.join(root, 'daemon.log'), 'utf8');
    const loaded = runtimeLog.includes('load_tensors: loading model tensors');
    if (loaded && code === 0) {
      assert.ok(
        runtimeLog.includes('prompt cache is disabled'),
        'runtime_cache_configuration_unverified',
      );
      assert.ok(
        runtimeLog.includes(`(load_mode = ${loadMode})`),
        'runtime_mapped_load_unverified',
      );
      assert.ok(
        !runtimeLog.includes('created context checkpoint'),
        'runtime_checkpoint_configuration_mismatch',
      );
      assert.ok(
        runtimeLog.includes(`K (${kvCacheType})`) &&
          runtimeLog.includes(`V (${kvCacheType})`),
        'runtime_kv_cache_configuration_mismatch',
      );
    }
    write({
      ...configuration,
      runtimeConfigurationVerified: loaded && code === 0,
      status: code === 0 ? 'completed' : 'stopped_or_failed',
      exitCode: code,
    });
    process.exitCode = code;
  } catch (error) {
    write({
      ...configuration,
      status: 'failed',
      error: error instanceof Error ? error.message : 'isolation_failed',
    });
    throw error;
  } finally {
    if (sampling) clearInterval(sampling);
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    // The detached process group was created by this launcher, never discovered
    // by name. Terminate only this daemon and its owned model worker.
    if (daemon.pid) {
      signalOwned('SIGTERM');
      for (let attempt = 0; attempt < 50 && running(); attempt++)
        await delay(100);
      if (running()) signalOwned('SIGKILL');
    }
    fs.closeSync(log);
    writeOwnerOnlyPrivateFile(
      path.join(root, 'cleanup.json'),
      JSON.stringify({
        daemonPid: daemon.pid,
        cleanupFailed,
        daemonExited: !running(),
      }),
    );
  }
}
void main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : 'cache_isolation_failed',
  );
  process.exitCode = 1;
});
