// Opt-in benchmark for costs that grow with meeting history.
//
//   PLUTO_SCALING_MEETINGS=600 pnpm exec vitest run \
//     --config vitest.manual.config.ts tests/manual/meetingHistoryScaling.benchmark.test.ts
//
// It builds a synthetic profile (large transcripts, notes and analysis), copies
// it into an SQLCipher database, then times the startup database open and the
// meeting reads Ask Pluto and background services make. No real meeting data.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { afterAll, expect, it, vi } from 'vitest';

const bench = vi.hoisted(() => ({
  directory:
    process.env.PLUTO_SCALING_DIR ||
    `${process.env.TMPDIR || '/tmp'}/pluto-scaling-${process.pid}`,
}));

vi.mock('electron', () => ({
  app: { getPath: () => bench.directory },
}));

import { createDatabaseRuntime } from '../../electron/database/runtime';
import * as database from '../../electron/db';

const MEETINGS = Number(process.env.PLUTO_SCALING_MEETINGS || 600);
const SEGMENTS = Number(process.env.PLUTO_SCALING_SEGMENTS || 1800);
const RUNS = Number(process.env.PLUTO_SCALING_RUNS || 5);
const KEY = 'a'.repeat(64);
const words =
  'launch budget roadmap hiring review latency migration customer pricing contract design research security onboarding analytics retention'.split(
    ' ',
  );
const people = ['Avery', 'Sam', 'Riley', 'Morgan', 'Jordan', 'Casey'];

const sentence = (seed: number, length: number) =>
  Array.from({ length }, (_, i) => words[(seed * 7 + i * 13) % words.length])
    .join(' ')
    .replace(/^./, (c) => c.toUpperCase());

const buildMeeting = (index: number): database.PersistedMeeting => {
  const started = new Date(Date.UTC(2025, 0, 1) + index * 36e5 * 13);
  const segments = Array.from({ length: SEGMENTS }, (_, s) => ({
    speaker: people[(index + s) % people.length],
    start: s * 2,
    end: s * 2 + 1.8,
    text: `${sentence(index + s, 14)}.`,
  }));
  const topic = words[index % words.length];
  return {
    id: `scaling-${index}`,
    title: `${topic} sync ${index}`,
    started_at: started.toISOString(),
    ended_at: new Date(started.getTime() + 36e5).toISOString(),
    duration_seconds: 3600,
    transcript_json: JSON.stringify({ segments }),
    user_notes: `${sentence(index, 60)}.`,
    enhanced_notes: Array.from(
      { length: 30 },
      (_, n) => `- ${people[n % people.length]}: ${sentence(index + n, 24)}.`,
    ).join('\n'),
    analysis_json: JSON.stringify({
      analysis_schema_version: 3,
      overview: `${sentence(index, 40)}.`,
      topics: Array.from({ length: 8 }, (_, t) => ({
        title: `${words[(index + t) % words.length]} topic`,
        summary: `${sentence(index + t, 30)}.`,
        key_points: Array.from({ length: 5 }, (_, k) => ({
          text: `${sentence(index + t + k, 20)}.`,
        })),
        action_items: [
          {
            text: `${sentence(index + t, 12)}.`,
            assignee: people[t % people.length],
          },
        ],
      })),
    }),
    transcript_status: 'validated',
    finalization_status: 'complete',
  } as database.PersistedMeeting;
};

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};
const time = (run: () => unknown, runs = RUNS) => {
  const samples: number[] = [];
  for (let i = 0; i < runs; i += 1) {
    const started = performance.now();
    run();
    samples.push(performance.now() - started);
  }
  return Number(median(samples).toFixed(1));
};

afterAll(() => {
  if (!process.env.PLUTO_SCALING_DIR)
    fs.rmSync(bench.directory, { recursive: true, force: true });
});

it(
  'measures startup database open and history-wide meeting reads',
  async () => {
    const existing = Number(
      (
        database.db.prepare('SELECT COUNT(*) AS n FROM meetings').get() as {
          n: number;
        }
      ).n,
    );
    for (let index = existing; index < MEETINGS; index += 1)
      database.saveMeeting(buildMeeting(index));
    database.db.pragma('wal_checkpoint(TRUNCATE)');
    const plainPath = path.join(bench.directory, 'pluto.db');

    // Encrypted copy: the runtime migrates a plaintext file when given a key.
    const encryptedDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'pluto-scaling-encrypted-'),
    );
    const encryptedPath = path.join(encryptedDir, 'pluto.db');
    fs.copyFileSync(plainPath, encryptedPath);
    const migrationsFolder = path.join(process.cwd(), 'drizzle');
    createDatabaseRuntime({
      databasePath: encryptedPath,
      migrationsFolder,
      encryptionKeyHex: KEY,
    })
      .initialize()
      .close();

    const openEncrypted = () => {
      const runtime = createDatabaseRuntime({
        databasePath: encryptedPath,
        migrationsFolder,
        encryptionKeyHex: KEY,
        integrityCheck: 'deferred',
      } as Parameters<typeof createDatabaseRuntime>[0]);
      runtime.initialize();
      runtime.close();
    };
    const openEncryptedFull = () => {
      const runtime = createDatabaseRuntime({
        databasePath: encryptedPath,
        migrationsFolder,
        encryptionKeyHex: KEY,
        integrityCheck: 'full',
      } as Parameters<typeof createDatabaseRuntime>[0]);
      runtime.initialize();
      runtime.close();
    };

    const reads = database as unknown as Record<
      string,
      (...args: unknown[]) => unknown
    >;
    const optional = (name: string, ...args: unknown[]) =>
      typeof reads[name] === 'function'
        ? time(() => reads[name](...args))
        : null;
    const result = {
      meetings: MEETINGS,
      plaintextMegabytes: Number(
        (fs.statSync(plainPath).size / 1024 / 1024).toFixed(1),
      ),
      encryptedMegabytes: Number(
        (fs.statSync(encryptedPath).size / 1024 / 1024).toFixed(1),
      ),
      startup: {
        encryptedOpenFullCheckMs: time(openEncryptedFull),
        encryptedOpenDefaultMs: time(openEncrypted),
      },
      reads: {
        getMeetingsMs: time(() => database.getMeetings()),
        getAskPlutoMeetingsMs: time(() => database.getAskPlutoMeetings()),
        getAskPlutoMeetingHeadersMs: time(() =>
          database.getAskPlutoMeetingHeaders(),
        ),
        searchMeetingNotesFtsMs: time(() =>
          database.searchMeetingNotesFts('roadmap pricing', { limit: 12 }),
        ),
        askPlutoMeetingsByIds24Ms: optional(
          'getAskPlutoMeetingsByIds',
          Array.from({ length: 24 }, (_, i) => `scaling-${i * 7}`),
        ),
        projectSynthesisSourcesMs: optional('getProjectSynthesisMeetings'),
        audioRetentionMs: optional('getAudioLifecycleMeetings'),
        suggestedQueryMeetingsMs: optional('getSuggestedQueryMeetings'),
      },
    };
    fs.rmSync(encryptedDir, { recursive: true, force: true });
    const report = JSON.stringify(result, null, 2);
    if (process.env.PLUTO_SCALING_OUT)
      fs.writeFileSync(process.env.PLUTO_SCALING_OUT, `${report}\n`);
    console.log(`[scaling] ${report}`);
    expect(result.meetings).toBe(MEETINGS);
  },
  30 * 60_000,
);
