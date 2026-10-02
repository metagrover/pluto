// Healthy-frame work only: compare pre-change liveness with current counters.
// No audio IO, production data, provider calls, or retained recordings.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const load = (source) => {
  const exports = {};
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  new Function('exports', code)(exports);
  return exports;
};
const baseline = load(
  execFileSync(
    'rtk',
    ['proxy', 'git', 'show', 'HEAD:src/utils/pcmLiveness.ts'],
    { encoding: 'utf8' },
  ),
).createPcmLivenessMonitor;
const current = load(
  readFileSync('src/utils/pcmLiveness.ts', 'utf8'),
).createPcmLivenessMonitor;
const diagnostics = load(
  readFileSync('electron/captureDiagnostics.ts', 'utf8'),
).createCaptureDiagnostics;
const samples = new Float32Array(480);
const run = (updated) => {
  const monitor = (updated ? current : baseline)(() => {}, 3000);
  const report = updated
    ? diagnostics({ persist: async () => undefined })
    : null;
  const renderer = {
    bytesReceived: 0,
    samplesAccepted: 0,
    samplesPackaged: 0,
    samplesTrimmed: 0,
  };
  const began = performance.now();
  for (let frame = 0; frame < 10000; frame += 1) {
    report?.received(1920);
    report?.forwarded(1920);
    monitor.received(samples);
    if (updated) {
      renderer.bytesReceived += 1920;
      renderer.samplesAccepted += 480;
    }
    if (updated && frame % 500 === 0) {
      renderer.samplesPackaged = renderer.samplesAccepted;
      report.renderer(renderer);
      report.stderr(
        `[AudioCapHealth] {"event":"heartbeat","framesWritten":${frame * 480},"tapGeneration":1,"retries":0}\n`,
      );
    }
  }
  const milliseconds = performance.now() - began;
  monitor.stop();
  return milliseconds;
};
for (let round = 0; round < 4; round += 1) {
  run(false);
  run(true);
}
const before = [];
const after = [];
for (let round = 0; round < 15; round += 1) {
  if (round % 2 === 0) {
    before.push(run(false));
    after.push(run(true));
  } else {
    after.push(run(true));
    before.push(run(false));
  }
}
const median = (values) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
console.log(
  JSON.stringify(
    {
      scope:
        '10000 healthy 480-sample frames; current renderer and main counters plus chunk snapshots; no disk/model workload',
      rounds: 15,
      baselineMedianMs: median(before),
      currentMedianMs: median(after),
      baselineRangeMs: [Math.min(...before), Math.max(...before)],
      currentRangeMs: [Math.min(...after), Math.max(...after)],
    },
    null,
    2,
  ),
);
