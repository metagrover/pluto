import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

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

type TeardownChild = Pick<ChildProcess, 'pid' | 'kill'>;

const waitForChildExit = async (
  child: ChildProcess,
  timeoutMs = 10_000,
): Promise<boolean> => {
  if (child.exitCode !== null || child.signalCode !== null) return true;
  return await new Promise<boolean>((resolve) => {
    const onExit = () => {
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      child.removeListener('exit', onExit);
      resolve(false);
    }, timeoutMs);
    child.once('exit', onExit);
  });
};

const teardownReplay = async (options: {
  close: () => void;
  child: TeardownChild | null;
  root: string;
  waitForChildExit: (child: TeardownChild) => Promise<boolean>;
  readRssKiB: (pid: number) => number | null;
  removeRoot: (root: string) => void;
}): Promise<void> => {
  const failures: string[] = [];
  let exited = options.child === null;
  try {
    try {
      options.close();
    } catch {
      failures.push('close');
    }
    if (options.child) {
      try {
        options.child.kill('SIGTERM');
      } catch {
        failures.push('sigterm');
      }
      try {
        exited = await options.waitForChildExit(options.child);
      } catch {
        failures.push('wait');
      }
      if (!exited) {
        try {
          options.child.kill('SIGKILL');
        } catch {
          failures.push('sigkill');
        }
        try {
          exited = await options.waitForChildExit(options.child);
        } catch {
          failures.push('wait');
        }
      }
      if (!exited) failures.push('exit');
      try {
        if (
          options.child.pid !== undefined &&
          options.readRssKiB(options.child.pid) !== null
        ) {
          failures.push('rss');
        }
      } catch {
        failures.push('rss');
      }
    }
  } finally {
    try {
      options.removeRoot(options.root);
    } catch {
      failures.push('root');
    }
  }
  if (failures.length > 0) {
    throw new Error('parakeet_replay_cleanup_failed');
  }
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

type ProcessedReceipt = { sequence: number; audioEndSeconds: number };

const requireStreamEvidence = (input: {
  events: NativeEvent[];
  identity: ParakeetLiveIdentity;
  processedReceipts: ProcessedReceipt[];
  expectedAudioEndSeconds: number;
}): void => {
  const streamEvents = input.events.filter(
    (event) => event.streamId === input.identity.streamId,
  );
  const updates = streamEvents.filter(
    (event) => event.event === 'stream_update',
  );
  if (updates.length === 0) throw new Error('parakeet_live_update_missing');
  if (
    streamEvents.some(
      (event) =>
        event.source !== input.identity.source ||
        event.generation !== input.identity.generation,
    )
  ) {
    throw new Error('parakeet_live_identity_isolation_failed');
  }
  if (streamEvents.some((event, index) => event.revision !== index + 1)) {
    throw new Error('parakeet_live_revision_restart_missing');
  }
  const finalWatermark = Math.max(
    ...updates.map((event) => event.audioEndSeconds),
  );
  const finalReceiptProcessed = input.processedReceipts.some(
    (receipt) => receipt.audioEndSeconds >= input.expectedAudioEndSeconds,
  );
  if (
    finalWatermark < input.expectedAudioEndSeconds &&
    !finalReceiptProcessed
  ) {
    throw new Error('parakeet_live_tail_evidence_missing');
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

      const processedReceipts = {
        mic: [] as ProcessedReceipt[],
        system: [] as ProcessedReceipt[],
      };
      let chunkStartSeconds = 0;
      for (const [index, duration] of chunkDurations.entries()) {
        const chunkEndSeconds = chunkStartSeconds + duration;
        const appends = (['mic', 'system'] as const).map(async (source) => {
          await client.append({
            ...identities[source],
            sequence: index + 1,
            audioPath: chunkPaths[source][index],
            chunkStartSeconds,
            chunkEndSeconds,
          });
          processedReceipts[source].push({
            sequence: index + 1,
            audioEndSeconds: chunkEndSeconds,
          });
        });
        expect(rssKiB((child as ChildProcess).pid as number)).not.toBeNull();
        await Promise.all(appends);
        chunkStartSeconds = chunkEndSeconds;
      }

      const flushes = await Promise.all([
        client.flush(identities.mic),
        client.flush(identities.system),
      ]);
      for (const [index, source] of ['mic', 'system'].entries()) {
        const typedSource = source as 'mic' | 'system';
        const flush = flushes[index];
        expect(typeof flush.finalPreview).toBe('string');
        expect(Array.isArray(flush.degradations)).toBe(true);
        expect(processedReceipts[typedSource]).toContainEqual({
          sequence: 4,
          audioEndSeconds: 13,
        });
        requireStreamEvidence({
          events,
          identity: identities[typedSource],
          processedReceipts: processedReceipts[typedSource],
          expectedAudioEndSeconds: 13,
        });
      }
      for (const event of events) {
        const expected = identities[event.source];
        expect(event.streamId).toBe(expected.streamId);
        expect(event.generation).toBe(expected.generation);
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
      const resetReceipts: ProcessedReceipt[] = [];
      chunkStartSeconds = 0;
      for (const [index, duration] of chunkDurations.entries()) {
        const chunkEndSeconds = chunkStartSeconds + duration;
        await client.append({
          ...nextGeneration,
          sequence: index + 1,
          audioPath: chunkPaths.mic[index],
          chunkStartSeconds,
          chunkEndSeconds,
        });
        resetReceipts.push({
          sequence: index + 1,
          audioEndSeconds: chunkEndSeconds,
        });
        chunkStartSeconds = chunkEndSeconds;
      }
      requireStreamEvidence({
        events,
        identity: nextGeneration,
        processedReceipts: resetReceipts,
        expectedAudioEndSeconds: 13,
      });
      const nextGenerationUpdates = events.filter(
        (event) =>
          event.event === 'stream_update' &&
          event.streamId === nextGeneration.streamId &&
          event.generation === nextGeneration.generation,
      );
      expect(nextGenerationUpdates).not.toHaveLength(0);
      const nextGenerationEvents = events.filter(
        (event) =>
          event.streamId === nextGeneration.streamId &&
          event.generation === nextGeneration.generation,
      );
      expect(nextGenerationEvents).not.toHaveLength(0);
      expect(nextGenerationEvents[0].revision).toBe(1);

      const appendAfterReset = client.append({
        ...nextGeneration,
        sequence: 5,
        audioPath: chunkPaths.mic[0],
        chunkStartSeconds: 13,
        chunkEndSeconds: 17,
      });
      const cancelledAppend =
        expect(appendAfterReset).rejects.toThrowError('parakeet_cancelled');
      await client.cancel(nextGeneration);
      await cancelledAppend;
      const eventCountAfterCancel = events.length;
      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(events).toHaveLength(eventCountAfterCancel);
      const resetStreamEvents = events.filter(
        (event) => event.streamId === resetIdentity.streamId,
      );
      expect(resetStreamEvents).not.toHaveLength(0);
      expect(
        resetStreamEvents.every(
          (event) => event.generation === 2 && event.source === 'mic',
        ),
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
      const spawnedChild = child as ChildProcess | null;
      await teardownReplay({
        close: () => {
          unsubscribeEvent();
          unsubscribeProtocolError();
          client.close();
        },
        child: spawnedChild,
        root: audioRoot,
        waitForChildExit: (candidate) =>
          waitForChildExit(candidate as ChildProcess),
        readRssKiB: rssKiB,
        removeRoot: removeOwnedRoot,
      });
    }
  },
  15 * 60_000,
);

describe('guarded Parakeet replay teardown', () => {
  it('escalates a hung SIGTERM and still removes the owned root', async () => {
    const close = vi.fn();
    const kill = vi.fn(() => true);
    const removeRoot = vi.fn();
    const waitForChildExit = vi
      .fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    await teardownReplay({
      close,
      child: { pid: 91, kill },
      root: '/owned/test-root',
      waitForChildExit,
      readRssKiB: () => null,
      removeRoot,
    });

    expect(close).toHaveBeenCalledOnce();
    expect(kill.mock.calls).toEqual([['SIGTERM'], ['SIGKILL']]);
    expect(waitForChildExit).toHaveBeenCalledTimes(2);
    expect(removeRoot).toHaveBeenCalledWith('/owned/test-root');
  });

  it('removes the owned root before reporting residual RSS', async () => {
    const calls: string[] = [];

    await expect(
      teardownReplay({
        close: () => calls.push('close'),
        child: { pid: 92, kill: () => true },
        root: '/owned/test-root',
        waitForChildExit: async () => true,
        readRssKiB: () => 1,
        removeRoot: () => calls.push('remove'),
      }),
    ).rejects.toThrowError('parakeet_replay_cleanup_failed');

    expect(calls).toContain('remove');
    expect(calls.indexOf('remove')).toBeGreaterThan(calls.indexOf('close'));
  });
});

describe('guarded Parakeet replay evidence', () => {
  const identity: ParakeetLiveIdentity = {
    streamId: 'evidence-mic',
    source: 'mic',
    generation: 2,
  };

  it('rejects vacuous source evidence', () => {
    expect(() =>
      requireStreamEvidence({
        events: [],
        identity,
        processedReceipts: [{ sequence: 4, audioEndSeconds: 13 }],
        expectedAudioEndSeconds: 13,
      }),
    ).toThrowError('parakeet_live_update_missing');
  });

  it('requires the next generation to restart at revision one', () => {
    const event: NativeEvent = {
      schemaVersion: 1,
      kind: 'event',
      event: 'stream_update',
      streamId: identity.streamId,
      source: identity.source,
      generation: identity.generation,
      revision: 2,
      qualifiesPriorTentative: false,
      text: 'synthetic',
      confidence: 0.8,
      audioEndSeconds: 13,
    };

    expect(() =>
      requireStreamEvidence({
        events: [event],
        identity,
        processedReceipts: [],
        expectedAudioEndSeconds: 13,
      }),
    ).toThrowError('parakeet_live_revision_restart_missing');
  });
});
