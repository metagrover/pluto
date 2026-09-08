// Real Electron / renderer IPC smoke and process-restart recovery. Never opens
// the production profile or consumes promotion holdout fixtures. Capture requires
// explicit CLI opt-in and uses copied native assets in the disposable profile.
import assert from 'node:assert/strict';
import { execFile, spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const script = fileURLToPath(import.meta.url);
const repository = path.dirname(path.dirname(script));
const runFile = promisify(execFile);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const digest = (text) => createHash('sha256').update(text).digest('hex');
const argument = (key) =>
  process.argv
    .find((value) => value.startsWith(`--${key}=`))
    ?.slice(key.length + 3);
const allowReadinessProbes = process.argv.includes('--allow-readiness-probes');
const captureSeconds = Number(argument('capture-seconds') ?? 0);
const captureWorkload = argument('capture-workload') ?? 'control';
const writePrivate = (file, value) =>
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
    flag: 'wx',
  });

async function launch() {
  assert.equal(
    process.platform,
    'darwin',
    'application harness currently requires macOS',
  );
  assert.ok(
    process.argv
      .slice(2)
      .every(
        (value) =>
          value === '--allow-readiness-probes' ||
          /^--(capture-seconds|capture-workload|native-bin|model-root|audio-fixture|microphone-fixture)=/.test(
            value,
          ),
      ),
    'unsupported argument; external profile arguments are forbidden',
  );
  if (captureSeconds) {
    assert.ok(
      allowReadinessProbes &&
        Number.isInteger(captureSeconds) &&
        captureSeconds >= 30 &&
        captureSeconds <= 1800,
    );
    assert.ok(['control', 'mixed'].includes(captureWorkload));
    for (const key of [
      'native-bin',
      'model-root',
      'audio-fixture',
      'microphone-fixture',
    ]) {
      assert.ok(
        path.isAbsolute(argument(key) ?? ''),
        `${key} absolute path required`,
      );
      assert.ok(fs.existsSync(argument(key)), `${key} unavailable`);
    }
  } else {
    assert.ok(
      !process.argv.some((value) =>
        /^--(capture-|native-bin|model-root|audio-fixture|microphone-fixture)/.test(
          value,
        ),
      ),
      'capture configuration requires a positive duration',
    );
  }
  for (const args of [
    ['exec', 'vite', 'build'],
    ['run', 'ensure:sqlite-abi'],
  ]) {
    const result = spawnSync('pnpm', args, {
      cwd: repository,
      stdio: 'inherit',
    });
    assert.equal(
      result.status,
      0,
      `preparation failed: pnpm ${args.join(' ')}`,
    );
  }
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'pluto-phi-application-')),
  );
  fs.chmodSync(root, 0o700);
  const token = randomUUID();
  writePrivate(path.join(root, '.notes-evaluation.json'), {
    version: 1,
    source: 'synthetic_only',
    token,
    userDataPath: root,
  });
  if (captureSeconds) {
    // Never hand a production model directory to a writable runtime. Copy its
    // contents, including activation metadata, before launching the app.
    fs.cpSync(
      argument('model-root'),
      path.join(root, 'models/transcription/parakeet'),
      { recursive: true, dereference: true, errorOnExist: true, force: false },
    );
    fs.mkdirSync(path.join(root, 'bin'), { mode: 0o700 });
    for (const name of ['audiocap', 'parakeet-runtime']) {
      fs.copyFileSync(
        path.join(argument('native-bin'), name),
        path.join(root, 'bin', name),
        fs.constants.COPYFILE_EXCL,
      );
      fs.chmodSync(path.join(root, 'bin', name), 0o700);
    }
    fs.copyFileSync(
      argument('microphone-fixture'),
      path.join(root, 'input.wav'),
      fs.constants.COPYFILE_EXCL,
    );
    fs.chmodSync(path.join(root, 'input.wav'), 0o600);
    fs.copyFileSync(
      argument('audio-fixture'),
      path.join(root, 'system-input.wav'),
      fs.constants.COPYFILE_EXCL,
    );
    fs.chmodSync(path.join(root, 'system-input.wav'), 0o600);
    writePrivate(path.join(root, 'capture-input.json'), {
      durationSeconds: captureSeconds,
      workload: captureWorkload,
      microphoneSha256: digest(fs.readFileSync(path.join(root, 'input.wav'))),
      systemAudioSha256: digest(
        fs.readFileSync(path.join(root, 'system-input.wav')),
      ),
      microphone:
        'Chromium fake microphone replay; not hardware microphone acceptance',
      systemAudio: 'real native tap; keep unrelated system audio off',
      nativeHashes: Object.fromEntries(
        ['audiocap', 'parakeet-runtime'].map((name) => [
          name,
          digest(fs.readFileSync(path.join(root, 'bin', name))),
        ]),
      ),
    });
  }
  const electron = (await import('electron')).default;
  const require = createRequire(import.meta.url);
  const binding = path.join(
    path.dirname(path.dirname(require.resolve('better-sqlite3'))),
    'build',
    'Release',
    'better_sqlite3.node',
  );
  const isolatedBinding = path.join(root, 'better_sqlite3.node');
  fs.copyFileSync(binding, isolatedBinding, fs.constants.COPYFILE_EXCL);
  fs.chmodSync(isolatedBinding, 0o600);
  const probe = spawnSync(
    electron,
    [
      '-e',
      `const D=require('better-sqlite3');const d=new D(':memory:',{nativeBinding:${JSON.stringify(isolatedBinding)}});d.close()`,
    ],
    {
      cwd: repository,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: 'pipe',
    },
  );
  assert.equal(
    probe.status,
    0,
    'isolated SQLite binding failed Electron verification',
  );
  writePrivate(path.join(root, 'environment.json'), {
    platform: process.platform,
    arch: process.arch,
    totalMemoryBytes: os.totalmem(),
    revision: spawnSync('git', ['rev-parse', 'HEAD'], {
      cwd: repository,
      encoding: 'utf8',
    }).stdout.trim(),
    diagnosticSourceHashes: Object.fromEntries(
      [
        'scripts/run_phi_notes_application.mjs',
        'scripts/lib/phi_notes_capture.mjs',
        'native/parakeet-runtime/Sources/ParakeetRuntimeEngine/ParakeetService.swift',
        'electron/bootstrap.ts',
        'electron/main.ts',
        'electron/notesEvaluationActivation.ts',
        'electron/llm/meetingNotesGuidance.ts',
      ].map((file) => [
        file,
        digest(fs.readFileSync(path.join(repository, file))),
      ]),
    ),
    sqliteBindingSha256: digest(fs.readFileSync(isolatedBinding)),
    allowReadinessProbes,
  });
  const phases = [];
  console.log(`Private application evidence: ${root}`);
  try {
    for (const phase of captureSeconds
      ? ['capture']
      : ['publish', 'crash', 'recover', 'interruptions', 'renderer']) {
      const code = await new Promise((resolve, reject) => {
        const log = fs.openSync(path.join(root, `${phase}.log`), 'wx', 0o600);
        const child = spawn(
          electron,
          [
            script,
            `--phase=${phase}`,
            `--user-data-dir=${root}`,
            `--phi-notes-evaluation=${token}`,
            ...(allowReadinessProbes ? ['--allow-readiness-probes'] : []),
            ...(captureSeconds
              ? [
                  `--capture-seconds=${captureSeconds}`,
                  `--capture-workload=${captureWorkload}`,
                  '--use-fake-device-for-media-stream',
                  '--use-fake-ui-for-media-stream',
                  '--disable-features=AudioServiceSandbox',
                  `--use-file-for-fake-audio-capture=${path.join(root, 'input.wav')}`,
                ]
              : []),
          ],
          {
            cwd: repository,
            // Do not forward another development server or profile selection.
            env: {
              ...process.env,
              VITE_DEV_SERVER_URL: '',
              PLUTO_USER_DATA_DIR: root,
            },
            stdio: ['ignore', log, log],
          },
        );
        fs.closeSync(log);
        const timeout = setTimeout(
          () => child.kill('SIGKILL'),
          captureSeconds ? (captureSeconds + 1200) * 1000 : 12 * 60_000,
        );
        child.once('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
        child.once('exit', (status, signal) => {
          clearTimeout(timeout);
          resolve({ status, signal });
        });
      });
      phases.push({ phase, ...code });
      if (phase === 'crash') {
        assert.equal(
          code.signal,
          'SIGKILL',
          'expected an actual abrupt application process kill',
        );
        assert.ok(
          fs.existsSync(path.join(root, 'crash-armed.json')),
          'kill must follow an observed persisted running attempt',
        );
      } else if (phase !== 'interruptions' && phase !== 'renderer')
        assert.equal(
          code.status,
          0,
          `${phase} failed; inspect owner-only application log`,
        );
      console.log(
        `Application phase ${phase}: ${code.status === 0 || phase === 'crash' ? 'verified' : 'failed; evidence preserved'}`,
      );
    }
    writePrivate(path.join(root, 'result.json'), {
      schema: captureSeconds
        ? 'phi-application-capture-diagnostic-v1'
        : 'phi-application-smoke-v1',
      status: phases.every(
        (result) => result.status === 0 || result.phase === 'crash',
      )
        ? 'passed'
        : 'failed',
      phases,
      evidence: captureSeconds
        ? 'real Electron capture lifecycle, fake microphone input, native system tap, private SQLite; diagnostic only'
        : 'real Electron renderer IPC, real Ollama, real SQLite, abrupt process kill and relaunch',
      promotion: 'not_evaluated',
      excluded: [
        ...(captureSeconds
          ? ['paired_capture_acceptance_unscored']
          : ['recording', '30_minute_mixed_workload']),
        'sleep_wake',
        'human_quality',
      ],
    });
    if (
      phases.some((result) => result.status !== 0 && result.phase !== 'crash')
    )
      process.exitCode = 1;
  } catch (error) {
    writePrivate(path.join(root, 'result.json'), {
      schema: 'phi-application-smoke-v1',
      status: 'failed',
      phases,
      error: String(error),
    });
    throw error;
  }
}

async function application() {
  const { app, BrowserWindow, powerMonitor } = await import('electron');
  app.setAppPath(repository);
  const root = argument('user-data-dir');
  const phase = argument('phase');
  assert.ok(
    [
      'publish',
      'crash',
      'recover',
      'interruptions',
      'renderer',
      'capture',
    ].includes(phase),
  );
  assert.equal(fs.realpathSync(root), root);
  assert.equal(path.dirname(root), fs.realpathSync(os.tmpdir()));
  assert.ok(path.basename(root).startsWith('pluto-phi-application-'));
  // Pin the verified binary, not a mock database. Other worktrees can rebuild
  // their shared node_modules for Node without changing this run's Electron ABI.
  const dlopen = process.dlopen;
  process.dlopen = function (module, filename, ...args) {
    return dlopen.call(
      this,
      module,
      path.basename(filename) === 'better_sqlite3.node'
        ? path.join(root, 'better_sqlite3.node')
        : filename,
      ...args,
    );
  };
  // Observe, without replacing, the app's localhost HTTP transport. Persist
  // starts and chunks immediately so a killed request is not a missing attempt.
  const wire = fs.openSync(path.join(root, `${phase}-wire.jsonl`), 'wx', 0o600);
  const appendWire = (event) => {
    fs.writeSync(wire, `${JSON.stringify({ at: Date.now(), ...event })}\n`);
    fs.fsyncSync(wire);
  };
  const originalRequest = http.request;
  http.request = function (...args) {
    const url = args[0];
    if (!(url instanceof URL) || url.origin !== 'http://127.0.0.1:11434')
      return originalRequest.apply(this, args);
    const physicalId = randomUUID();
    appendWire({ physicalId, event: 'start', path: url.pathname });
    const request = originalRequest.apply(this, args);
    const originalWrite = request.write;
    request.write = function (...writeArgs) {
      appendWire({
        physicalId,
        event: 'request_body',
        body: String(writeArgs[0]),
      });
      return originalWrite.apply(this, writeArgs);
    };
    request.on('response', (response) => {
      appendWire({
        physicalId,
        event: 'response',
        status: response.statusCode,
      });
      response.on('data', (chunk) =>
        appendWire({
          physicalId,
          event: 'chunk',
          base64: Buffer.from(chunk).toString('base64'),
        }),
      );
      response.on('end', () =>
        appendWire({ physicalId, event: 'end', complete: response.complete }),
      );
      response.on('aborted', () =>
        appendWire({ physicalId, event: 'aborted' }),
      );
    });
    request.on('error', (error) =>
      appendWire({ physicalId, event: 'error', error: String(error) }),
    );
    return request;
  };
  syncBuiltinESMExports();
  // bootstrap performs the capability/profile validation before enabling Phi.
  await import('../dist-electron/bootstrap.js');
  await app.whenReady();
  assert.equal(app.getPath('userData'), root);
  assert.ok(fs.existsSync(path.join(root, 'pluto.db')));
  let window;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    window = BrowserWindow.getAllWindows().find(
      (candidate) => !candidate.isDestroyed(),
    );
    if (
      window &&
      !window.webContents.isLoading() &&
      (await window.webContents
        .executeJavaScript(
          'Boolean(window.ipcRenderer && document.querySelector("#root")?.children.length)',
        )
        .catch(() => false))
    )
      break;
    await wait(100);
  }
  assert.ok(window && Date.now() < deadline, 'renderer did not become ready');
  const invoke = (channel, ...args) =>
    window.webContents.executeJavaScript(
      `window.ipcRenderer.invoke(${JSON.stringify(channel)}, ...${JSON.stringify(args)})`,
    );
  const id = 'phi-application-synthetic';
  const get = async () => {
    let timer;
    try {
      return await Promise.race([
        invoke('GET_MEETING', id),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('renderer_state_timeout')),
            2000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
  let currentRequestId;
  const generate = (requestId) => {
    if (telemetryError) throw telemetryError;
    currentRequestId = requestId;
    return invoke('GENERATE_MEETING_NOTES', {
      meetingId: id,
      requestId,
      template: 'auto',
      reason: 'manual',
    });
  };
  const ledger = fs.openSync(
    path.join(root, `${phase}-telemetry.jsonl`),
    'wx',
    0o600,
  );
  let stopping = false;
  let telemetryError;
  let firstSampleReady;
  const firstSample = new Promise((resolve) => {
    firstSampleReady = resolve;
  });
  let seriousSince = null;
  const sampler = (async () => {
    while (!stopping) {
      const started = Date.now();
      try {
        const [pressure, swap, paging, resident, processTable] =
          await Promise.all([
            runFile(
              '/usr/sbin/sysctl',
              ['-n', 'kern.memorystatus_vm_pressure_level'],
              { timeout: 2000 },
            ),
            runFile('/usr/sbin/sysctl', ['vm.swapusage'], { timeout: 2000 }),
            runFile('/usr/bin/vm_stat', [], { timeout: 2000 }),
            fetch('http://127.0.0.1:11434/api/ps', {
              signal: AbortSignal.timeout(2000),
            }).then((response) => {
              assert.ok(response.ok);
              return response.json();
            }),
            runFile('/bin/ps', ['-axo', 'pid,ppid,rss,comm'], {
              timeout: 2000,
            }),
          ]);
        const table = processTable.stdout
          .trim()
          .split('\n')
          .slice(1)
          .map((line) => {
            const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/.exec(line);
            assert.ok(match, 'process RSS telemetry invalid');
            return {
              pid: Number(match[1]),
              parentPid: Number(match[2]),
              rssBytes: Number(match[3]) * 1024,
              name: path.basename(match[4]),
            };
          });
        assert.ok(
          table.some((row) => row.pid === process.pid),
          'application RSS unavailable',
        );
        const descendants = new Set([process.pid]);
        for (let size = 0; size !== descendants.size; ) {
          size = descendants.size;
          for (const row of table)
            if (descendants.has(row.parentPid)) descendants.add(row.pid);
        }
        const nativeAndProcessRss = table.filter(
          (row) => descendants.has(row.pid) || row.name === 'ollama',
        );
        const memoryPressure = Number(pressure.stdout.trim());
        assert.ok(
          [1, 2, 4].includes(memoryPressure),
          'memory pressure unavailable',
        );
        const swapUsed = /used = ([\d.]+)M/.exec(swap.stdout);
        assert.ok(swapUsed, 'swap occupancy unavailable');
        const thermalState = powerMonitor.getCurrentThermalState();
        assert.ok(
          Array.isArray(resident.models),
          'Ollama residency unavailable',
        );
        assert.ok(
          resident.models.every(
            (model) =>
              typeof model.digest === 'string' &&
              typeof model.name === 'string' &&
              Number.isFinite(model.size),
          ),
          'Ollama residency identity unavailable',
        );
        assert.match(paging.stdout, /page size of \d+ bytes/);
        assert.match(paging.stdout, /Swapins:\s+\d+\./);
        assert.match(paging.stdout, /Swapouts:\s+\d+\./);
        const processes = app
          .getAppMetrics()
          .map(({ pid, type, memory }) => ({ pid, type, memory }));
        assert.ok(
          processes.length > 0 &&
            processes.every(
              (process) =>
                Number.isFinite(process.memory?.workingSetSize) &&
                process.memory.workingSetSize >= 0,
            ),
          'Electron process memory unavailable',
        );
        assert.ok(
          ['nominal', 'fair', 'serious', 'critical'].includes(thermalState),
          'thermal telemetry unavailable',
        );
        seriousSince =
          thermalState === 'serious' || thermalState === 'critical'
            ? (seriousSince ?? started)
            : null;
        const sample = {
          started,
          completed: Date.now(),
          memoryPressure,
          thermalState,
          swapUsedBytes: Number(swapUsed[1]) * 1024 * 1024,
          paging: paging.stdout,
          processes,
          nativeAndProcessRss,
          ollama: resident.models,
          notesRun: JSON.parse((await get())?.analysis_run_json ?? 'null'),
        };
        fs.writeSync(ledger, `${JSON.stringify(sample)}\n`);
        if (
          memoryPressure === 4 ||
          (seriousSince !== null && started - seriousSince >= 30_000)
        )
          throw new Error('application_resource_safety_stop');
        firstSampleReady();
      } catch (error) {
        telemetryError = error;
        fs.writeSync(
          ledger,
          `${JSON.stringify({ started, error: String(error) })}\n`,
        );
        // No missing telemetry is silently filled with zero or counted as pass.
        stopping = true;
        firstSampleReady();
        fs.fsyncSync(ledger);
        await Promise.race([
          invoke('CANCEL_MEETING_NOTES', {
            meetingId: id,
            requestId: currentRequestId ?? '',
          }).catch(() => {}),
          wait(1000),
        ]);
        // Abrupt safety termination is never a successful capture. Preserve the
        // journal for recovery and stop admitting work even if the UI is blocked.
        app.exit(2);
      }
      if (!stopping) await wait(Math.max(0, 1000 - (Date.now() - started)));
    }
  })();
  try {
    await firstSample;
    if (telemetryError) throw telemetryError;
    for (const [key, value] of Object.entries({
      llm_provider: 'ollama',
      ollama_model: 'gemma4:12b',
      ollama_fast_model: 'gemma4:12b',
      ollama_seed: '41',
      ollama_structured_thinking: 'false',
      // Entering the full UI can run boot-time mic/system probes. It requires
      // separate operator opt-in, even though this driver never starts a meeting.
      setup_complete: allowReadinessProbes ? 'true' : 'false',
    })) {
      await invoke('SET_SETTING', { key, value });
    }
    if (phase === 'publish') {
      assert.deepEqual(
        await invoke('GET_MEETINGS'),
        [],
        'profile must start empty',
      );
      await invoke('SAVE_MEETING', {
        id,
        title: 'Synthetic Phi application fixture',
        transcript_status: 'validated',
        finalization_status: 'finalized',
        transcript_integrity_json: JSON.stringify({ trust: 'eligible' }),
        transcript_json: JSON.stringify({
          segments: [
            {
              speaker: 7,
              text: 'The synthetic project remains in planning. No task has been assigned.',
            },
          ],
        }),
        user_notes: '',
      });
      await generate('application-initial');
      const meeting = await get();
      const analysis = JSON.parse(meeting.analysis_json);
      assert.equal(
        JSON.parse(meeting.analysis_run_json).notes_status,
        'published',
      );
      assert.equal(analysis.generation_metadata.model, 'phi4-mini:3.8b');
      assert.equal(
        analysis.generation_metadata.pipeline_version,
        'notes-v30-source-first',
      );
      assert.ok(analysis.generation_metadata.source_provenance.source_revision);
      assert.equal(
        analysis.generation_metadata.source_provenance.source_revision,
        JSON.parse(meeting.analysis_run_json).source_revision,
      );
      assert.equal(await invoke('GET_SETTING', 'ollama_model'), 'gemma4:12b');
      writePrivate(path.join(root, 'published.json'), {
        analysisHash: digest(meeting.analysis_json),
        sourceRevision:
          analysis.generation_metadata.source_provenance.source_revision,
      });
    } else if (phase === 'crash') {
      const meeting = await get();
      const prior = JSON.parse(
        fs.readFileSync(path.join(root, 'published.json'), 'utf8'),
      );
      assert.equal(digest(meeting.analysis_json), prior.analysisHash);
      await invoke('SAVE_MEETING', {
        ...meeting,
        user_notes: 'Synthetic restart recovery exercise.',
      });
      const result = generate('application-crash').then(
        () => 'finished',
        () => 'failed',
      );
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const current = await get();
        const run = JSON.parse(current.analysis_run_json);
        if (run?.notes_status === 'running') {
          assert.equal(digest(current.analysis_json), prior.analysisHash);
          writePrivate(path.join(root, 'crash-armed.json'), {
            runId: run.run_id,
            priorAnalysisHash: prior.analysisHash,
          });
          fs.fsyncSync(ledger);
          process.kill(process.pid, 'SIGKILL');
        }
        if (
          (await Promise.race([result, Promise.resolve('pending')])) !==
          'pending'
        )
          break;
        await wait(10);
      }
      throw new Error('running attempt not observed; no crash injected');
    } else if (phase === 'recover') {
      const prior = JSON.parse(
        fs.readFileSync(path.join(root, 'published.json'), 'utf8'),
      );
      const meeting = await get();
      assert.equal(digest(meeting.analysis_json), prior.analysisHash);
      const run = JSON.parse(meeting.analysis_run_json);
      assert.equal(run.notes_status, 'failed');
      assert.equal(run.error_code, 'notes_interrupted');
      await generate('application-retry');
      assert.equal(
        JSON.parse((await get()).analysis_run_json).notes_status,
        'published',
      );
    } else if (phase === 'interruptions') {
      const outcomes = [];
      const originalTranscript = (await get()).transcript_json;
      for (const fault of [
        'cancellation',
        'source_edit',
        'cancellation',
        'cancellation',
      ]) {
        const meeting = await get();
        const priorHash = digest(meeting.analysis_json);
        const requestId = `application-${fault}-${outcomes.length}`;
        await invoke('SAVE_MEETING', {
          ...meeting,
          transcript_json: originalTranscript,
          user_notes: `Synthetic interruption trial ${outcomes.length}.`,
        });
        let terminal = false;
        const result = generate(requestId).then(
          () => {
            terminal = true;
            return { completed: true };
          },
          (error) => {
            terminal = true;
            return { completed: false, error: String(error) };
          },
        );
        let observedRun;
        for (let i = 0; i < 200 && !terminal; i += 1) {
          const run = JSON.parse((await get()).analysis_run_json);
          if (run?.notes_status === 'running') {
            observedRun = run;
            break;
          }
          await wait(10);
        }
        assert.ok(
          observedRun,
          'fault must target an actual persisted running attempt',
        );
        const started = Date.now();
        if (fault === 'source_edit') {
          const current = await get();
          await invoke('SAVE_MEETING', {
            ...current,
            transcript_json: JSON.stringify({
              segments: [
                {
                  speaker: 7,
                  text: 'The synthetic project has been cancelled. No work is authorized.',
                },
              ],
            }),
          });
        } else {
          assert.equal(
            (await invoke('CANCEL_MEETING_NOTES', { meetingId: id, requestId }))
              .cancelled,
            true,
          );
        }
        const outcome = await result;
        assert.equal(
          outcome.completed,
          false,
          'interrupted output must not publish',
        );
        assert.equal(digest((await get()).analysis_json), priorHash);
        const interrupted = JSON.parse((await get()).analysis_run_json);
        assert.equal(
          interrupted.notes_status,
          fault === 'source_edit' ? 'failed' : 'cancelled',
        );
        const interruptedOutcome = {
          fault,
          observedRunId: observedRun.run_id,
          errorCode: interrupted.error_code,
          terminalMs: Date.now() - started,
        };
        const retry = await generate(`${requestId}-retry`).then(
          () => ({ completed: true }),
          (error) => ({ completed: false, error: String(error) }),
        );
        outcomes.push({ ...interruptedOutcome, retry });
        const published = await get();
        if (!retry.completed) {
          assert.equal(digest(published.analysis_json), priorHash);
          continue;
        }
        assert.equal(
          JSON.parse(published.analysis_run_json).notes_status,
          'published',
        );
        assert.equal(
          JSON.parse(published.analysis_json).generation_metadata.model,
          'phi4-mini:3.8b',
        );
        assert.equal(
          JSON.parse(published.analysis_json).generation_metadata
            .source_provenance.source_revision,
          JSON.parse(published.analysis_run_json).source_revision,
        );
      }
      writePrivate(path.join(root, 'interruptions.json'), {
        outcomes,
        repeatedCancellationIsNotSchedulerPreemption: true,
      });
      assert.ok(
        outcomes.every((result) => result.retry.completed),
        'model rejected a post-interruption retry; see recorded outcomes',
      );
    } else if (phase === 'capture') {
      const { runControlledCapture } = await import(
        './lib/phi_notes_capture.mjs'
      );
      await runControlledCapture({
        window,
        invoke,
        root,
        seconds: captureSeconds,
        workload: captureWorkload,
      });
    } else {
      const navigate = (label, readySelector) =>
        window.webContents.executeJavaScript(`(async () => {
        const button = [...document.querySelectorAll('button')].find(node => node.textContent.trim() === ${JSON.stringify(label)});
        if (!button) throw new Error('navigation_button_missing');
        const started = performance.now();
        button.click();
        while (performance.now() - started < 10000) {
          await new Promise(resolve => requestAnimationFrame(resolve));
          const ready = document.querySelector(${JSON.stringify(readySelector)});
          if (ready && ready.getBoundingClientRect().height > 0 && !ready.disabled) return performance.now() - started;
        }
        throw new Error('actionable_navigation_timeout');
      })()`);
      const navigation = [];
      for (let trial = 0; allowReadinessProbes && trial < 21; trial += 1) {
        for (const [label, selector] of [
          ['All meetings', '[aria-label="Search meetings"]'],
          ['Dashboard', '[aria-label="Add a commitment"]'],
        ]) {
          const elapsedMs = await navigate(label, selector);
          if (trial > 0) navigation.push({ label, elapsedMs });
        }
      }
      const current = await get();
      await invoke('SAVE_MEETING', {
        ...current,
        user_notes: 'Synthetic foreground Ask trial.',
      });
      const notes = generate('application-foreground').then(
        () => ({ completed: true }),
        (error) => ({ completed: false, error: String(error) }),
      );
      const ask = await window.webContents.executeJavaScript(`(async () => {
        const requestId = 'application-ask';
        const started = performance.now();
        let firstContentMs = null;
        const off = window.ipcRenderer.on('intelligence:query:delta', (_event, update) => {
          if (update.requestId === requestId && update.delta?.trim() && firstContentMs === null) firstContentMs = performance.now() - started;
        });
        try {
          const result = await window.ipcRenderer.invoke('intelligence:query', { requestId, query: 'In my latest meeting, what is the current project status?', modeOverride: 'fast' });
          return { firstContentMs, elapsedMs: performance.now() - started, result };
        } finally { off(); }
      })()`);
      assert.ok(ask.result.answer?.trim(), 'Ask returned no answer');
      assert.notEqual(ask.result.status, 'unavailable');
      assert.notEqual(ask.result.status, 'cancelled');
      const notesOutcome = await notes;
      if (!notesOutcome.completed)
        await generate('application-foreground-retry');
      assert.equal(
        JSON.parse((await get()).analysis_run_json).notes_status,
        'published',
      );
      const requests = fs
        .readFileSync(path.join(root, `${phase}-wire.jsonl`), 'utf8')
        .trim()
        .split('\n')
        .map(JSON.parse)
        .filter((row) => row.event === 'request_body')
        .map((row) => JSON.parse(row.body))
        .filter((body) => body.messages || body.prompt);
      assert.ok(requests.some((body) => body.model === 'phi4-mini:3.8b'));
      assert.ok(requests.some((body) => body.model === 'gemma4:12b'));
      assert.ok(
        requests.every((body) =>
          ['phi4-mini:3.8b', 'gemma4:12b'].includes(body.model),
        ),
      );
      writePrivate(path.join(root, 'renderer.json'), {
        navigation,
        navigationGate: allowReadinessProbes
          ? 'diagnostic_only'
          : 'not_run_native_readiness_not_authorized',
        ask,
        notesOutcome,
        p95AskGate: 'incomplete_one_sample',
        mixedRecordingGate: 'not_run',
      });
    }
    if (telemetryError) throw telemetryError;
  } catch (error) {
    if (!window.isDestroyed()) {
      writePrivate(path.join(root, `${phase}-failure-ui.json`), {
        text: await window.webContents
          .executeJavaScript('document.body.innerText')
          .catch(() => 'renderer_unavailable'),
        error: String(error),
      });
    }
    throw error;
  } finally {
    stopping = true;
    await sampler;
    fs.closeSync(ledger);
  }
  if (telemetryError) throw telemetryError;
  app.quit();
}

if (process.versions.electron) {
  application().catch(async (error) => {
    console.error(error);
    (await import('electron')).app.exit(1);
  });
} else {
  launch().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
