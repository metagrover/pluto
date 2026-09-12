import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import Database from 'better-sqlite3-multiple-ciphers';

import { EncryptedArtifactStore } from '../electron/crypto/encryptedArtifactStore.ts';
import {
  ENCRYPTED_AUDIO_SAMPLE_RATE,
  ENCRYPTED_AUDIO_SEGMENT_FRAMES,
  migrateCanonicalPlaintextWavToEncryptedBundle,
  openEncryptedAudioReader,
  writeEncryptedAudioBundle,
} from '../electron/crypto/encryptedAudioBundle.ts';

const MIB = 1024 * 1024;
const BUDGETS = {
  cryptoP95Ms: 0.25,
  captureAckRegressionPercent: 5,
  databaseWarmReadRegressionPercent: 10,
  criticalWriteP95Ms: 50,
  startupRegressionMs: 250,
  incrementalAudioRssBytes: 256 * MIB,
  historicalMigrationRssBytes: 64 * MIB,
} as const;

const percentile = (values: number[], fraction: number) => {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[
    Math.min(
      ordered.length - 1,
      Math.max(0, Math.ceil(ordered.length * fraction) - 1),
    )
  ];
};

const measure = <T>(operation: () => T) => {
  const started = performance.now();
  const result = operation();
  return { elapsedMs: performance.now() - started, result };
};

const measureAsync = async <T>(operation: () => Promise<T>) => {
  const started = performance.now();
  const result = await operation();
  return { elapsedMs: performance.now() - started, result };
};

const parseArgs = () => {
  let audioMinutes = 60;
  let out = path.resolve('artifacts/encryption-performance/latest.json');
  for (const argument of process.argv.slice(2)) {
    if (argument.startsWith('--audio-minutes=')) {
      audioMinutes = Number(argument.slice('--audio-minutes='.length));
    } else if (argument.startsWith('--out=')) {
      out = path.resolve(argument.slice('--out='.length));
    } else if (argument !== '--') {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (
    !Number.isInteger(audioMinutes) ||
    audioMinutes <= 0 ||
    audioMinutes > 60
  ) {
    throw new Error('--audio-minutes must be an integer from 1 through 60');
  }
  return { audioMinutes, out };
};

const syncDirectory = async (directory: string) => {
  const descriptor = await fs.promises.open(directory, 'r');
  try {
    await descriptor.sync();
  } finally {
    await descriptor.close();
  }
};

const writePlainDurably = async (filePath: string, plaintext: Buffer) => {
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  const descriptor = await fs.promises.open(temporaryPath, 'w', 0o600);
  try {
    await descriptor.writeFile(plaintext);
    await descriptor.sync();
  } finally {
    await descriptor.close();
  }
  await fs.promises.rename(temporaryPath, filePath);
  await syncDirectory(path.dirname(filePath));
};

const benchmarkCrypto = () => {
  const iterations = 2_000;
  const warmups = 200;
  const key = randomBytes(32);
  const plaintext = randomBytes(32 * 1024);
  const sealTimes: number[] = [];
  const openTimes: number[] = [];
  for (let index = 0; index < iterations + warmups; index += 1) {
    const header = {
      artifactKind: 'raw' as const,
      generation: 'benchmark-generation',
      keyId: 'benchmark-key',
      meetingId: 'benchmark-meeting',
      sequence: index,
      source: 'mic' as const,
    };
    const sealed = measure(() =>
      EncryptedArtifactStore.seal(plaintext, key, header),
    );
    const opened = measure(() =>
      EncryptedArtifactStore.open(sealed.result.fullBuffer, key, header),
    );
    if (!opened.result.plaintext.equals(plaintext)) {
      throw new Error('Crypto benchmark plaintext mismatch');
    }
    if (index >= warmups) {
      sealTimes.push(sealed.elapsedMs);
      openTimes.push(opened.elapsedMs);
    }
  }
  const sealP95Ms = percentile(sealTimes, 0.95);
  const openP95Ms = percentile(openTimes, 0.95);
  return {
    iterations,
    sealP95Ms,
    openP95Ms,
    budgetMs: BUDGETS.cryptoP95Ms,
    passed:
      sealP95Ms <= BUDGETS.cryptoP95Ms && openP95Ms <= BUDGETS.cryptoP95Ms,
  };
};

const benchmarkDurableCapture = async (root: string) => {
  const trials = 9;
  const iterationsPerTrial = 100;
  const warmupsPerTrial = 10;
  const plaintext = randomBytes(32 * 1024);
  const key = randomBytes(32);
  const plainTrialP95Ms: number[] = [];
  const encryptedTrialP95Ms: number[] = [];
  let verifiedArtifacts = 0;
  for (let trial = 0; trial < trials; trial += 1) {
    const plainRoot = path.join(root, `plain-capture-${trial}`);
    const encryptedRoot = path.join(root, `encrypted-capture-${trial}`);
    fs.mkdirSync(plainRoot);
    fs.mkdirSync(encryptedRoot);
    const plainTimes: number[] = [];
    const encryptedTimes: number[] = [];
    const encryptedPaths: Array<{ filePath: string; sequence: number }> = [];
    for (
      let index = 0;
      index < iterationsPerTrial + warmupsPerTrial;
      index += 1
    ) {
      const sequence = trial * 1_000 + index;
      const plainPath = path.join(plainRoot, `${index}.pcm`);
      const encryptedPath = path.join(encryptedRoot, `${index}.enc`);
      const runPlain = () =>
        measureAsync(() => writePlainDurably(plainPath, plaintext));
      const runEncrypted = () =>
        measureAsync(() =>
          EncryptedArtifactStore.writeEncryptedFile(
            encryptedPath,
            plaintext,
            key,
            {
              artifactKind: 'raw',
              generation: 'benchmark-generation',
              keyId: 'benchmark-key',
              meetingId: 'benchmark-meeting',
              sequence,
              source: 'mic',
            },
            { directoryReady: true },
          ),
        );
      const [plain, encrypted] =
        index % 2 === 0
          ? [await runPlain(), await runEncrypted()]
          : [await runEncrypted(), await runPlain()].reverse();
      encryptedPaths.push({ filePath: encryptedPath, sequence });
      if (index >= warmupsPerTrial) {
        plainTimes.push(plain.elapsedMs);
        encryptedTimes.push(encrypted.elapsedMs);
      }
    }
    plainTrialP95Ms.push(percentile(plainTimes, 0.95));
    encryptedTrialP95Ms.push(percentile(encryptedTimes, 0.95));
    for (const artifact of encryptedPaths) {
      const opened = await EncryptedArtifactStore.readEncryptedFile(
        artifact.filePath,
        key,
        { meetingId: 'benchmark-meeting', sequence: artifact.sequence },
      );
      if (!opened.plaintext.equals(plaintext)) {
        throw new Error('Durable capture benchmark plaintext mismatch');
      }
      verifiedArtifacts += 1;
    }
  }
  const plainP95Ms = percentile(plainTrialP95Ms, 0.5);
  const encryptedP95Ms = percentile(encryptedTrialP95Ms, 0.5);
  const regressionPercent = ((encryptedP95Ms - plainP95Ms) / plainP95Ms) * 100;
  return {
    trials,
    iterationsPerTrial,
    aggregation: 'median of trial p95 values',
    plainTrialP95Ms,
    encryptedTrialP95Ms,
    plainP95Ms,
    encryptedP95Ms,
    regressionPercent,
    budgetPercent: BUDGETS.captureAckRegressionPercent,
    verifiedArtifacts,
    droppedOrReordered:
      verifiedArtifacts === trials * (iterationsPerTrial + warmupsPerTrial)
        ? 0
        : 1,
    passed:
      regressionPercent <= BUDGETS.captureAckRegressionPercent &&
      verifiedArtifacts === trials * (iterationsPerTrial + warmupsPerTrial),
  };
};

const configureDatabase = (
  database: InstanceType<typeof Database>,
  key?: Buffer,
) => {
  if (key) {
    database.pragma("cipher = 'sqlcipher'");
    database.pragma(`key = "x'${key.toString('hex')}'"`);
  }
  database.pragma('journal_mode = WAL');
  database.pragma('synchronous = FULL');
};

const createBenchmarkDatabase = (filePath: string, key?: Buffer) => {
  const database = new Database(filePath);
  configureDatabase(database, key);
  database.exec(`
    CREATE TABLE meetings (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      notes TEXT NOT NULL
    );
    CREATE TABLE transcript_segments (
      id INTEGER PRIMARY KEY,
      meeting_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      speaker TEXT NOT NULL,
      text TEXT NOT NULL,
      start_ms INTEGER NOT NULL,
      end_ms INTEGER NOT NULL
    );
    CREATE INDEX transcript_segments_meeting_sequence
      ON transcript_segments(meeting_id, sequence);
  `);
  const insertMeeting = database.prepare(
    'INSERT INTO meetings VALUES (?, ?, ?, ?)',
  );
  const insertSegment = database.prepare(
    'INSERT INTO transcript_segments (meeting_id, sequence, speaker, text, start_ms, end_ms) VALUES (?, ?, ?, ?, ?, ?)',
  );
  database.transaction(() => {
    for (let meeting = 0; meeting < 200; meeting += 1) {
      const meetingId = `meeting-${meeting}`;
      insertMeeting.run(
        meetingId,
        `Representative meeting ${meeting}`,
        1_700_000_000_000 + meeting,
        JSON.stringify({ summary: 'A representative local meeting note.' }),
      );
      for (let sequence = 0; sequence < 100; sequence += 1) {
        insertSegment.run(
          meetingId,
          sequence,
          sequence % 2 === 0 ? 'Me' : 'Remote Speaker 1',
          `Representative transcript segment ${sequence}`,
          sequence * 5_000,
          (sequence + 1) * 5_000,
        );
      }
    }
  })();
  database.pragma('wal_checkpoint(TRUNCATE)');
  database.close();
};

const benchmarkDatabase = (root: string) => {
  const plainPath = path.join(root, 'plain.db');
  const encryptedPath = path.join(root, 'encrypted.db');
  const key = randomBytes(32);
  createBenchmarkDatabase(plainPath);
  createBenchmarkDatabase(encryptedPath, key);

  const measureWorkload = (filePath: string, encryptionKey?: Buffer) => {
    const database = new Database(filePath);
    configureDatabase(database, encryptionKey);
    const read = database.prepare(
      'SELECT speaker, text, start_ms, end_ms FROM transcript_segments WHERE meeting_id = ? ORDER BY sequence',
    );
    for (let index = 0; index < 200; index += 1) read.all(`meeting-${index}`);
    const readTimes: number[] = [];
    for (let sample = 0; sample < 50; sample += 1) {
      readTimes.push(
        measure(() => {
          for (let index = 0; index < 200; index += 1) {
            read.all(`meeting-${index}`);
          }
        }).elapsedMs,
      );
    }
    const insertMeeting = database.prepare(
      'INSERT INTO meetings VALUES (?, ?, ?, ?)',
    );
    const insertSegment = database.prepare(
      'INSERT INTO transcript_segments (meeting_id, sequence, speaker, text, start_ms, end_ms) VALUES (?, ?, ?, ?, ?, ?)',
    );
    const writeTransaction = database.transaction((meetingId: string) => {
      insertMeeting.run(meetingId, 'New recorded meeting', Date.now(), '{}');
      for (let sequence = 0; sequence < 100; sequence += 1) {
        insertSegment.run(
          meetingId,
          sequence,
          sequence % 2 === 0 ? 'Me' : 'Remote Speaker 1',
          `Durable final transcript segment ${sequence}`,
          sequence * 5_000,
          (sequence + 1) * 5_000,
        );
      }
    });
    const writeTimes: number[] = [];
    for (let index = 0; index < 30; index += 1) {
      writeTimes.push(
        measure(() => writeTransaction(`new-meeting-${index}`)).elapsedMs,
      );
    }
    database.close();
    return {
      readP95Ms: percentile(readTimes, 0.95),
      writeP95Ms: percentile(writeTimes, 0.95),
    };
  };

  const plain = measureWorkload(plainPath);
  const encrypted = measureWorkload(encryptedPath, key);
  const readRegressionPercent =
    ((encrypted.readP95Ms - plain.readP95Ms) / plain.readP95Ms) * 100;

  const startupTimes = (filePath: string, encryptionKey?: Buffer) => {
    const times: number[] = [];
    for (let index = 0; index < 40; index += 1) {
      const started = performance.now();
      const database = new Database(filePath, { readonly: true });
      if (encryptionKey) {
        database.pragma("cipher = 'sqlcipher'");
        database.pragma(`key = "x'${encryptionKey.toString('hex')}'"`);
      }
      database.prepare('SELECT count(*) AS count FROM meetings').get();
      database.close();
      times.push(performance.now() - started);
    }
    return percentile(times.slice(5), 0.95);
  };
  const plainStartupP95Ms = startupTimes(plainPath);
  const encryptedStartupP95Ms = startupTimes(encryptedPath, key);
  const startupRegressionMs = encryptedStartupP95Ms - plainStartupP95Ms;

  return {
    representativeRows: 20_000,
    warmRead: {
      plainP95Ms: plain.readP95Ms,
      encryptedP95Ms: encrypted.readP95Ms,
      regressionPercent: readRegressionPercent,
      budgetPercent: BUDGETS.databaseWarmReadRegressionPercent,
      passed:
        readRegressionPercent <= BUDGETS.databaseWarmReadRegressionPercent,
    },
    criticalWrite: {
      transaction:
        'one meeting plus 100 final transcript segments, synchronous FULL',
      encryptedP95Ms: encrypted.writeP95Ms,
      budgetMs: BUDGETS.criticalWriteP95Ms,
      passed: encrypted.writeP95Ms <= BUDGETS.criticalWriteP95Ms,
    },
    startup: {
      plainP95Ms: plainStartupP95Ms,
      encryptedP95Ms: encryptedStartupP95Ms,
      regressionMs: startupRegressionMs,
      budgetMs: BUDGETS.startupRegressionMs,
      passed: startupRegressionMs <= BUDGETS.startupRegressionMs,
    },
  };
};

const benchmarkAudioMemory = async (root: string, audioMinutes: number) => {
  globalThis.gc?.();
  const baselineRssBytes = process.memoryUsage().rss;
  let peakRssBytes = baselineRssBytes;
  const sampler = setInterval(() => {
    peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
  }, 2);
  const context = {
    meetingId: 'benchmark-meeting',
    generation: 'benchmark-generation',
    keyId: 'benchmark-key',
    meetingKey: randomBytes(32),
  };
  const totalFrames = audioMinutes * 60 * ENCRYPTED_AUDIO_SAMPLE_RATE;
  let sequence = 0;
  try {
    const bundlePath = await writeEncryptedAudioBundle({
      rootDir: root,
      totalFrames,
      source: 'mic',
      context,
      produceWindow: async (_startFrame, frameCount) => {
        const samples = new Float32Array(frameCount);
        samples.fill(sequence % 2 === 0 ? 0.125 : -0.25);
        sequence += 1;
        return samples;
      },
    });
    const reader = await openEncryptedAudioReader({
      filePath: bundlePath,
      context,
      source: 'mic',
    });
    if (reader.totalFrames !== totalFrames) {
      throw new Error('Audio benchmark duration mismatch');
    }
    for (
      let startFrame = 0, segment = 0;
      startFrame < totalFrames;
      startFrame += ENCRYPTED_AUDIO_SEGMENT_FRAMES, segment += 1
    ) {
      const frameCount = Math.min(
        ENCRYPTED_AUDIO_SEGMENT_FRAMES,
        totalFrames - startFrame,
      );
      const samples = await reader.readWindow(startFrame, frameCount);
      const expected = segment % 2 === 0 ? 0.125 : -0.25;
      for (const offset of [
        0,
        Math.floor(samples.length / 2),
        samples.length - 1,
      ]) {
        if (Math.abs(samples[offset] - expected) > 1 / 32_768) {
          throw new Error('Audio benchmark decrypted sample mismatch');
        }
      }
    }
  } finally {
    clearInterval(sampler);
    peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
  }
  const incrementalRssBytes = Math.max(0, peakRssBytes - baselineRssBytes);
  return {
    fixtureMinutes: audioMinutes,
    totalFrames,
    segmentSeconds: 60,
    baselineRssBytes,
    peakRssBytes,
    incrementalRssBytes,
    budgetBytes: BUDGETS.incrementalAudioRssBytes,
    passed: incrementalRssBytes < BUDGETS.incrementalAudioRssBytes,
  };
};

const benchmarkNativeAudioMemory = (audioMinutes: number) => {
  if (audioMinutes !== 60) {
    return {
      status: 'not_run' as const,
      reason: 'native RSS acceptance requires --audio-minutes=60',
      passed: true,
    };
  }
  const run = spawnSync(
    'swift',
    [
      'test',
      '--package-path',
      'native/parakeet-runtime',
      '--filter',
      'EncryptedAudioLoaderTests/testOneHourSegmentedReaderStaysWithinResidentMemoryBudget',
    ],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...process.env,
        PLUTO_RUN_ENCRYPTED_AUDIO_MEMORY_BENCHMARK: '1',
      },
      maxBuffer: 10 * MIB,
    },
  );
  const output = `${run.stdout}\n${run.stderr}`;
  const match = output.match(
    /NATIVE_ENCRYPTED_AUDIO_RSS baseline_bytes=(\d+) peak_bytes=(\d+) incremental_bytes=(\d+)/,
  );
  if (run.status !== 0 || !match) {
    return {
      status: 'failed' as const,
      reason:
        run.status === 0
          ? 'native RSS marker missing'
          : `swift test exited ${String(run.status)}`,
      outputTail: output.slice(-4_000),
      passed: false,
    };
  }
  const incrementalRssBytes = Number(match[3]);
  return {
    status: 'measured' as const,
    fixtureMinutes: 60,
    baselineRssBytes: Number(match[1]),
    peakRssBytes: Number(match[2]),
    incrementalRssBytes,
    budgetBytes: BUDGETS.incrementalAudioRssBytes,
    passed: incrementalRssBytes < BUDGETS.incrementalAudioRssBytes,
  };
};

const benchmarkHistoricalMigrationMemory = async (
  root: string,
  audioMinutes: number,
) => {
  const migrationRoot = path.join(root, 'historical-migration');
  fs.mkdirSync(migrationRoot, { recursive: true });
  const plaintextPath = path.join(migrationRoot, 'legacy.wav');
  const totalFrames = audioMinutes * 60 * ENCRYPTED_AUDIO_SAMPLE_RATE;
  const totalBytes = 44 + totalFrames * 2;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(totalBytes - 8, 4);
  header.write('WAVEfmt ', 8, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(ENCRYPTED_AUDIO_SAMPLE_RATE, 24);
  header.writeUInt32LE(ENCRYPTED_AUDIO_SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(totalFrames * 2, 40);
  const descriptor = fs.openSync(plaintextPath, 'w', 0o600);
  try {
    fs.writeSync(descriptor, header);
    const segment = Buffer.alloc(ENCRYPTED_AUDIO_SEGMENT_FRAMES * 2);
    for (let offset = 0; offset < segment.length; offset += 2) {
      segment.writeInt16LE(offset % 4 === 0 ? 4096 : -8192, offset);
    }
    for (
      let startFrame = 0;
      startFrame < totalFrames;
      startFrame += ENCRYPTED_AUDIO_SEGMENT_FRAMES
    ) {
      fs.writeSync(
        descriptor,
        segment,
        0,
        Math.min(ENCRYPTED_AUDIO_SEGMENT_FRAMES, totalFrames - startFrame) * 2,
      );
    }
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  globalThis.gc?.();
  const baselineRssBytes = process.memoryUsage().rss;
  let peakRssBytes = baselineRssBytes;
  const sampler = setInterval(() => {
    peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
  }, 2);
  const started = performance.now();
  try {
    await migrateCanonicalPlaintextWavToEncryptedBundle({
      filePath: plaintextPath,
      rootDir: migrationRoot,
      source: 'mic',
      context: {
        meetingId: 'historical-benchmark',
        generation: 'historical-benchmark-generation',
        keyId: 'historical-benchmark-key',
        meetingKey: randomBytes(32),
      },
    });
  } finally {
    clearInterval(sampler);
    peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
  }
  const incrementalRssBytes = Math.max(0, peakRssBytes - baselineRssBytes);
  return {
    fixtureMinutes: audioMinutes,
    sourceBytes: totalBytes,
    elapsedMs: performance.now() - started,
    baselineRssBytes,
    peakRssBytes,
    incrementalRssBytes,
    budgetBytes: BUDGETS.historicalMigrationRssBytes,
    passed: incrementalRssBytes < BUDGETS.historicalMigrationRssBytes,
  };
};

const main = async () => {
  const options = parseArgs();
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'pluto-encryption-benchmark-'),
  );
  try {
    const crypto = benchmarkCrypto();
    const capture = await benchmarkDurableCapture(root);
    const database = benchmarkDatabase(root);
    const electronAudioMemory = await benchmarkAudioMemory(
      root,
      options.audioMinutes,
    );
    const nativeAudioMemory = benchmarkNativeAudioMemory(options.audioMinutes);
    const historicalMigrationMemory = await benchmarkHistoricalMigrationMemory(
      root,
      options.audioMinutes,
    );
    const checks = [
      crypto.passed,
      capture.passed,
      database.warmRead.passed,
      database.criticalWrite.passed,
      database.startup.passed,
      electronAudioMemory.passed,
      nativeAudioMemory.passed,
      historicalMigrationMemory.passed,
    ];
    const report = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      environment: {
        platform: process.platform,
        arch: process.arch,
        nodeVersion: process.version,
      },
      budgets: BUDGETS,
      results: {
        crypto,
        capture,
        database,
        electronAudioMemory,
        nativeAudioMemory,
        historicalMigrationMemory,
      },
      passed: checks.every(Boolean),
      limitations: [
        'Synthetic benchmark; frozen real-meeting ASR and attribution parity remains a rollout acceptance gate.',
        'This run covers only the current architecture and is not the slowest-supported-Mac Gate 4 result by itself.',
      ],
    };
    fs.mkdirSync(path.dirname(options.out), { recursive: true });
    fs.writeFileSync(options.out, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report, null, 2));
    if (!report.passed) process.exitCode = 1;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};

await main();
