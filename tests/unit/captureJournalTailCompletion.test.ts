import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';
import { createCaptureSessionLeaseRegistry } from '../../electron/captureSessionLease';
import { encodeCanonicalPcm16Wav } from '../../electron/crypto/encryptedAudioBundle';

const main = readFileSync('electron/main.ts', 'utf8');
const start = main.indexOf("'AUDIO_CAPTURE_JOURNAL_CAPTURE_COMPLETE'");
const end = main.indexOf('\n  ipcMain.handle(', start);
const block = main.slice(start, end);
const callback = block.slice(
  block.indexOf('async (event'),
  block.lastIndexOf('\n    },') + 6,
);
const dependencies = [
  'diagnosticsFor',
  'captureSessionLease',
  'getMeetingArtifactsRootDir',
  'readCaptureJournalManifest',
  'readCaptureJournalChunk',
  'getAudioKeyStore',
  'repairEncryptedJournalRawChunk',
  'getAbortSignalForMeeting',
  'convertAudioToMonoWav',
  'probeAudioDuration',
  'fs',
  'path',
  'app',
  'randomUUID',
  'parseCanonicalPcm16Wav',
  'completeCaptureJournalCapturedChunk',
  'appendParakeetLiveReceipt',
];
const create = new Function(
  ...dependencies,
  `${
    ts.transpileModule(`const handler = ${callback};`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText
  };return handler;`,
);
const decodedWav = encodeCanonicalPcm16Wav(new Float32Array(960));
const setup = () => {
  const lease = createCaptureSessionLeaseRegistry();
  lease.acquire('tail', 7);
  lease.beginCaptureStop('tail', 7);
  const raw = {
    disposition: 'raw_durable',
    rawChecksumSha256: 'checksum',
    rawRelativePath: 'tail/chunks/mic.webm',
  };
  const manifest = {
    schemaVersion: 3,
    lifecycleState: 'recording',
    generation: 'generation',
    revision: 4,
    intervals: [{ sequence: 2, sources: { mic: raw } }],
  };
  const complete = vi.fn(async () => ({ manifest: {}, receipt: {} }));
  const convert = vi.fn(async () => true);
  const read = vi.fn(async () => decodedWav);
  const remove = vi.fn(async () => {});
  const verify = vi.fn(async () => Buffer.from('raw'));
  const controller = new AbortController();
  const encrypted = vi.fn(async () => decodedWav);
  const canonical = vi.fn(() => new Int16Array([1]));
  const handler = create(
    () => undefined,
    lease,
    () => '/storage',
    async () => manifest,
    verify,
    () => ({
      getMeetingAudioKey: () => ({
        keyId: 'key',
        meetingKey: Buffer.alloc(32),
      }),
    }),
    encrypted,
    () => controller.signal,
    convert,
    async () => 0.06,
    { promises: { readFile: read, rm: remove } },
    path,
    { getPath: () => '/tmp' },
    () => 'unique',
    canonical,
    complete,
    async () => {},
  );
  const request = {
    meetingId: 'tail',
    generation: 'generation',
    expectedRevision: 4,
    source: 'mic',
    sequence: 2,
    rawChecksumSha256: 'checksum',
  };
  return {
    handler,
    request,
    manifest,
    complete,
    convert,
    read,
    remove,
    verify,
    controller,
    lease,
    encrypted,
    canonical,
  };
};
it('completes a non-WAV final tail through existing conversion before journal stop', async () => {
  const f = setup();
  await f.handler({ sender: { id: 7 } }, f.request);
  expect(f.verify).toHaveBeenCalledWith(
    '/storage',
    'tail',
    'tail/chunks/mic.webm',
  );
  expect(f.convert).toHaveBeenCalledOnce();
  expect(f.remove).toHaveBeenCalledOnce();
  expect(f.complete).toHaveBeenCalledWith(
    '/storage',
    expect.objectContaining({
      ...f.request,
      repairData: decodedWav,
    }),
  );
  expect(f.manifest.intervals[0].sources.mic.rawRelativePath).toBe(
    'tail/chunks/mic.webm',
  );
});
it('renderer requests completion for MediaRecorder fallback without supplying encoded bytes as WAV', () => {
  const source = readFileSync('src/components/AudioManager.tsx', 'utf8');
  const a = source.slice(
    source.indexOf('  const appendCaptureJournalBlob'),
    source.indexOf('  const abortUnstartedCapture'),
  );
  expect(a).not.toContain("if (format !== 'wav') return null");
  expect(a).toContain("...(format === 'wav' ? { repairData: data } : {})");
});
it('keeps provided PCM completion on the existing path without conversion', async () => {
  const f = setup();
  await f.handler(
    { sender: { id: 7 } },
    { ...f.request, repairData: Buffer.from('pcm') },
  );
  expect(f.convert).not.toHaveBeenCalled();
  expect(f.complete).toHaveBeenCalledOnce();
});
it.each(['decode', 'checksum', 'aborted', 'owner', 'revision'])(
  'fails closed for %s and never completes the raw tuple',
  async (reason) => {
    const f = setup();
    if (reason === 'decode') f.convert.mockResolvedValue(false);
    if (reason === 'checksum')
      f.verify.mockRejectedValue(new Error('checksum'));
    if (reason === 'aborted')
      f.convert.mockImplementation(async () => {
        f.controller.abort();
        return true;
      });
    if (reason === 'owner') f.lease.release('tail', 7);
    if (reason === 'revision') f.request.expectedRevision = 3;
    await expect(f.handler({ sender: { id: 7 } }, f.request)).rejects.toThrow();
    expect(f.complete).not.toHaveBeenCalled();
  },
);
it('uses encrypted raw repair in memory and never writes a plaintext conversion', async () => {
  const f = setup();
  Object.assign(f.manifest, { schemaVersion: 4, keyId: 'key' });
  await f.handler({ sender: { id: 7 } }, f.request);
  expect(f.encrypted).toHaveBeenCalledOnce();
  expect(f.canonical).toHaveBeenCalledOnce();
  expect(f.convert).not.toHaveBeenCalled();
  expect(f.read).not.toHaveBeenCalled();
  expect(f.complete).toHaveBeenCalledOnce();
});

it('refuses undecodable/empty output and cleans the temporary file', async () => {
  const f = setup();
  f.read.mockResolvedValue(Buffer.alloc(0));
  await expect(f.handler({ sender: { id: 7 } }, f.request)).rejects.toThrow(
    'capture_journal_raw_decode_invalid',
  );
  expect(f.remove).toHaveBeenCalledOnce();
  expect(f.complete).not.toHaveBeenCalled();
});

it('rechecks the recording owner after asynchronous conversion', async () => {
  const f = setup();
  f.convert.mockImplementation(async () => {
    f.lease.release('tail', 7);
    return true;
  });
  await expect(f.handler({ sender: { id: 7 } }, f.request)).rejects.toThrow(
    'capture_session_not_owned',
  );
  expect(f.complete).not.toHaveBeenCalled();
});

it('propagates the existing completion CAS refusal after a concurrent revision change', async () => {
  const f = setup();
  f.complete.mockRejectedValue(new Error('Capture journal revision conflict'));
  await expect(f.handler({ sender: { id: 7 } }, f.request)).rejects.toThrow(
    'revision conflict',
  );
  expect(f.complete).toHaveBeenCalledOnce();
  expect(f.remove).toHaveBeenCalledOnce();
});
