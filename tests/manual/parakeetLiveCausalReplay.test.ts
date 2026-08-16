import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { expect, it } from 'vitest';

import {
  type NativeEvent,
  NativeJsonLineProcess,
  type NativeProcessSpawn,
} from '../../electron/transcription/nativeJsonLineProcess';
import {
  ParakeetLiveClient,
  type ParakeetLiveIdentity,
} from '../../electron/transcription/parakeetLiveClient';
import { requirePreparedPrivateLiveReplayModel } from '../../scripts/validate_private_parakeet_live_manifest.ts';

const ENABLED = process.env.RUN_PARAKEET_LIVE_CAUSAL_REPLAY === '1';
const SAMPLE_RATE = 16_000;
const REQUEST_TIMEOUT_MS = 10 * 60_000;
const TEMP_PREFIX = 'pluto-parakeet-live-runtime-';

type RuntimeEnvironment = {
  executablePath: string;
  modelRoot: string;
};

const canonicalPathWithoutSymlinks = (
  candidate: string,
  kind: 'file' | 'directory',
): string | null => {
  if (!path.isAbsolute(candidate) || candidate.includes('\0')) return null;
  try {
    const normalized = path.normalize(candidate);
    const parsed = path.parse(normalized);
    let ancestor = parsed.root;
    for (const part of path
      .relative(parsed.root, normalized)
      .split(path.sep)
      .filter(Boolean)) {
      ancestor = path.join(ancestor, part);
      if (fs.lstatSync(ancestor).isSymbolicLink()) return null;
    }
    const stat = fs.lstatSync(normalized);
    if (kind === 'file' ? !stat.isFile() : !stat.isDirectory()) return null;
    return fs.realpathSync(normalized) === normalized ? normalized : null;
  } catch {
    return null;
  }
};

const runtimeEnvironment = (): RuntimeEnvironment | null => {
  const executablePath = process.env.PLUTO_E2E_PARAKEET_RUNTIME;
  const modelRoot = process.env.PLUTO_E2E_PARAKEET_MODEL_ROOT;
  if (!executablePath || !modelRoot) return null;
  const approvedExecutable = canonicalPathWithoutSymlinks(
    executablePath,
    'file',
  );
  const approvedModelRoot = canonicalPathWithoutSymlinks(
    modelRoot,
    'directory',
  );
  if (!approvedExecutable || !approvedModelRoot) return null;
  try {
    fs.accessSync(approvedExecutable, fs.constants.X_OK);
    requirePreparedPrivateLiveReplayModel(approvedModelRoot);
  } catch {
    return null;
  }
  return {
    executablePath: approvedExecutable,
    modelRoot: approvedModelRoot,
  };
};

const writeSyntheticWave = (
  filePath: string,
  durationSeconds: number,
  frequencyHz: number,
): void => {
  const sampleCount = Math.round(durationSeconds * SAMPLE_RATE);
  const dataBytes = sampleCount * 2;
  const wave = Buffer.alloc(44 + dataBytes);
  wave.write('RIFF', 0);
  wave.writeUInt32LE(36 + dataBytes, 4);
  wave.write('WAVE', 8);
  wave.write('fmt ', 12);
  wave.writeUInt32LE(16, 16);
  wave.writeUInt16LE(1, 20);
  wave.writeUInt16LE(1, 22);
  wave.writeUInt32LE(SAMPLE_RATE, 24);
  wave.writeUInt32LE(SAMPLE_RATE * 2, 28);
  wave.writeUInt16LE(2, 32);
  wave.writeUInt16LE(16, 34);
  wave.write('data', 36);
  wave.writeUInt32LE(dataBytes, 40);
  for (let index = 0; index < sampleCount; index += 1) {
    const envelope = Math.min(1, index / 400, (sampleCount - index) / 400);
    const sample =
      Math.sin((2 * Math.PI * frequencyHz * index) / SAMPLE_RATE) *
      0.08 *
      Math.max(0, envelope);
    wave.writeInt16LE(Math.round(sample * 32_767), 44 + index * 2);
  }
  fs.writeFileSync(filePath, wave, { flag: 'wx', mode: 0o600 });
};

const assertOwnedFile = (filePath: string, root: string): void => {
  const approved = canonicalPathWithoutSymlinks(filePath, 'file');
  expect(approved).not.toBeNull();
  expect(path.dirname(approved as string)).toBe(root);
};

const rssKiB = (pid: number): number | null => {
  const result = spawnSync('/bin/ps', ['-o', 'rss=', '-p', String(pid)], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  if (result.status !== 0) return null;
  const value = Number(result.stdout.trim());
  return Number.isFinite(value) && value > 0 ? value : null;
};

const waitForExit = async (child: ChildProcess): Promise<void> => {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('parakeet_process_cleanup_failed')),
      10_000,
    );
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
};

const removeOwnedRoot = (root: string): void => {
  const canonicalRoot = canonicalPathWithoutSymlinks(root, 'directory');
  const canonicalTemporaryDirectory = fs.realpathSync(os.tmpdir());
  if (
    !canonicalRoot ||
    path.dirname(canonicalRoot) !== canonicalTemporaryDirectory ||
    !path.basename(canonicalRoot).startsWith(TEMP_PREFIX)
  ) {
    throw new Error('parakeet_test_cleanup_refused');
  }
  for (const entry of fs.readdirSync(canonicalRoot)) {
    const entryPath = path.join(canonicalRoot, entry);
    if (canonicalPathWithoutSymlinks(entryPath, 'file') !== entryPath) {
      throw new Error('parakeet_test_cleanup_refused');
    }
  }
  fs.rmSync(canonicalRoot, { recursive: true });
};

const createSyntheticFixture = () => {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), TEMP_PREFIX)),
  );
  const chunkDurations = [4, 4, 4, 1] as const;
  const sourceFrequency = { mic: 440, system: 660 } as const;
  const chunkPaths = { mic: [] as string[], system: [] as string[] };
  try {
    for (const source of ['mic', 'system'] as const) {
      for (const [index, duration] of chunkDurations.entries()) {
        const filePath = path.join(root, `${source}-${index + 1}.wav`);
        writeSyntheticWave(
          filePath,
          duration,
          sourceFrequency[source] + index * 7,
        );
        assertOwnedFile(filePath, root);
        chunkPaths[source].push(filePath);
      }
    }
    return { root, chunkDurations, chunkPaths };
  } catch (error) {
    removeOwnedRoot(root);
    throw error;
  }
};

const guardedTest = ENABLED ? it : it.skip;

guardedTest(
  'keeps real Parakeet live sources and generations isolated through flush and cancellation',
  async (context) => {
    const environment = runtimeEnvironment();
    if (!environment) {
      context.skip();
      return;
    }

    const {
      root: audioRoot,
      chunkDurations,
      chunkPaths,
    } = createSyntheticFixture();

    let child: ChildProcess | null = null;
    const nativeSpawn: NativeProcessSpawn = (executablePath, args, options) => {
      child = spawn(executablePath, args, {
        ...options,
        env: {
          ...process.env,
          HF_HUB_OFFLINE: '1',
          TRANSFORMERS_OFFLINE: '1',
          HTTP_PROXY: 'http://127.0.0.1:9',
          HTTPS_PROXY: 'http://127.0.0.1:9',
        },
      });
      return child as ReturnType<NativeProcessSpawn>;
    };
    const diagnosticCodes: string[] = [];
    const transport = new NativeJsonLineProcess({
      executablePath: environment.executablePath,
      args: [
        '--model-root',
        environment.modelRoot,
        '--audio-root',
        audioRoot,
        '--live-config',
        'pinned-default',
      ],
      spawn: nativeSpawn,
      requestTimeoutMs: REQUEST_TIMEOUT_MS,
      diagnostic: (code) => diagnosticCodes.push(code),
    });
    const client = new ParakeetLiveClient({
      process: transport,
      maxQueuedAppends: 2,
    });
    const events: NativeEvent[] = [];
    const protocolErrors: string[] = [];
    const unsubscribeEvent = client.onEvent((event) => events.push(event));
    const unsubscribeProtocolError = client.onProtocolError((code) =>
      protocolErrors.push(code),
    );

    try {
      const prepare = await transport.request({
        schemaVersion: 1,
        id: 'manual-prepare',
        method: 'prepare',
        modelRoot: environment.modelRoot,
      });
      expect(prepare.ok).toBe(true);
      expect(prepare.result?.liveConfigId).toBe('pinned-default');
      expect(child?.pid).toBeTypeOf('number');
      expect(rssKiB((child as ChildProcess).pid as number)).not.toBeNull();

      const identities = {
        mic: { streamId: 'manual-mic', source: 'mic', generation: 1 },
        system: {
          streamId: 'manual-system',
          source: 'system',
          generation: 1,
        },
      } as const satisfies Record<string, ParakeetLiveIdentity>;
      await Promise.all([
        client.open(identities.mic),
        client.open(identities.system),
      ]);

      let chunkStartSeconds = 0;
      for (const [index, duration] of chunkDurations.entries()) {
        const chunkEndSeconds = chunkStartSeconds + duration;
        const appends = (['mic', 'system'] as const).map((source) =>
          client.append({
            ...identities[source],
            sequence: index + 1,
            audioPath: chunkPaths[source][index],
            chunkStartSeconds,
            chunkEndSeconds,
          }),
        );
        expect(rssKiB((child as ChildProcess).pid as number)).not.toBeNull();
        await Promise.all(appends);
        chunkStartSeconds = chunkEndSeconds;
      }

      const flushes = await Promise.all([
        client.flush(identities.mic),
        client.flush(identities.system),
      ]);
      for (const flush of flushes) {
        expect(typeof flush.finalPreview).toBe('string');
        expect(
          flush.degradations.every(
            (entry) =>
              Number.isSafeInteger(entry.revision) && entry.revision > 0,
          ),
        ).toBe(true);
      }

      const sourceEvents = events.map((event) => ({
        streamId: event.streamId,
        source: event.source,
        generation: event.generation,
        revision: event.revision,
      }));
      for (const source of ['mic', 'system'] as const) {
        const observed = sourceEvents.filter(
          (event) => event.source === source,
        );
        expect(
          observed.every(
            (event) =>
              event.streamId === identities[source].streamId &&
              event.generation === identities[source].generation,
          ),
        ).toBe(true);
        expect(observed.map((event) => event.revision)).toEqual(
          observed.map((_, index) => index + 1),
        );
      }
      expect(protocolErrors).toEqual([]);

      const resetIdentity: ParakeetLiveIdentity = {
        streamId: 'manual-reset',
        source: 'mic',
        generation: 1,
      };
      await client.open(resetIdentity);
      await client.reset(resetIdentity, 2);
      const nextGeneration = { ...resetIdentity, generation: 2 };
      const appendAfterReset = client.append({
        ...nextGeneration,
        sequence: 1,
        audioPath: chunkPaths.mic[0],
        chunkStartSeconds: 0,
        chunkEndSeconds: chunkDurations[0],
      });
      await client.cancel(nextGeneration);
      await Promise.allSettled([appendAfterReset]);
      const eventCountAfterCancel = events.length;
      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(events).toHaveLength(eventCountAfterCancel);
      expect(
        events
          .filter((event) => event.streamId === resetIdentity.streamId)
          .every((event) => event.generation === 2 && event.source === 'mic'),
      ).toBe(true);
      expect(protocolErrors).toEqual([]);

      const shutdown = await transport.request({
        schemaVersion: 1,
        id: 'manual-shutdown',
        method: 'shutdown',
      });
      expect(shutdown.ok).toBe(true);
      expect(diagnosticCodes).toEqual([]);
    } finally {
      unsubscribeEvent();
      unsubscribeProtocolError();
      const spawnedChild = child as ChildProcess | null;
      const pid = spawnedChild?.pid;
      client.close();
      if (spawnedChild) await waitForExit(spawnedChild);
      if (pid !== undefined) expect(rssKiB(pid)).toBeNull();
      removeOwnedRoot(audioRoot);
    }
  },
  15 * 60_000,
);
