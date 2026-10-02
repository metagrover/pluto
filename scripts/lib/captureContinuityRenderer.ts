import { ipcRenderer } from 'electron';
import { createWavBlob, decodeFloat32PcmChunk } from '../../src/utils/audio';
import { createPcmLivenessMonitor } from '../../src/utils/pcmLiveness';

let counters = {
  bytesReceived: 0,
  samplesAccepted: 0,
  samplesPackaged: 0,
  samplesTrimmed: 0,
};
let pending: Float32Array[] = [];
let queue = Promise.resolve();
let sequence = 0;
let expectedSample = 0;
let mismatches = 0;
let carryover = new Uint8Array(0);
let liveness: ReturnType<typeof createPcmLivenessMonitor>;
let receivedAt: number[] = [];
let packaged = 0;
let warnings = 0;
let recovery = 0;
let mode = '';

const save = () => {
  if (!pending.length) return;
  const samples = new Float32Array(
    pending.reduce((total, chunk) => total + chunk.length, 0),
  );
  let offset = 0;
  for (const chunk of pending) {
    samples.set(chunk, offset);
    offset += chunk.length;
  }
  pending = [];
  counters.samplesPackaged += samples.length;
  const index = sequence++;
  const startSec = packaged / 48000;
  packaged += samples.length;
  const endSec = packaged / 48000;
  const snapshot = { ...counters };
  queue = queue.then(async () => {
    const wav = await createWavBlob(samples, 48000, 1).arrayBuffer();
    await ipcRenderer.invoke('test-write', {
      sequence: index,
      startSec,
      endSec,
      diagnostics: snapshot,
      wav,
    });
  });
};
ipcRenderer.on('test-start', (_, nextMode: string) => {
  mode = nextMode;
  counters = {
    bytesReceived: 0,
    samplesAccepted: 0,
    samplesPackaged: 0,
    samplesTrimmed: 0,
  };
  pending = [];
  queue = Promise.resolve();
  sequence = 0;
  expectedSample = 0;
  mismatches = 0;
  carryover = new Uint8Array(0);
  receivedAt = [];
  packaged = 0;
  warnings = 0;
  recovery = 0;
  liveness = createPcmLivenessMonitor(
    () => {
      warnings += 1;
    },
    150,
    () => {
      recovery += 1;
    },
  );
  ipcRenderer.send('test-ready');
});
ipcRenderer.on('test-pcm', (_, bytes: Uint8Array) => {
  counters.bytesReceived += bytes.length;
  const decoded = decodeFloat32PcmChunk(bytes, carryover);
  carryover = decoded.carryoverBytes;
  if (!liveness.received(decoded.samples)) return;
  counters.samplesAccepted += decoded.samples.length;
  receivedAt.push(performance.now());
  for (const value of decoded.samples) {
    if (value !== Math.fround((expectedSample % 2048) / 2048 - 0.5))
      mismatches += 1;
    expectedSample += 1;
  }
  pending.push(decoded.samples);
  if (counters.samplesAccepted - packaged >= 48000) save();
});
ipcRenderer.on('test-finish', async () => {
  liveness.stop();
  save();
  await queue;
  const gaps = receivedAt
    .slice(1)
    .map((time, index) => time - receivedAt[index]);
  ipcRenderer.send('test-result', {
    mode,
    counters,
    mismatches,
    warnings,
    recovery,
    maxDeliveryGapMs: Math.max(0, ...gaps),
    chunks: sequence,
  });
});
ipcRenderer.send('renderer-ready');
