import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createHash } from 'node:crypto';
import {
  appendCaptureJournalChunk,
  appendCaptureTranscriptAcceptanceFrame,
  appendCaptureTranscriptCheckpoint,
  authorizeCaptureJournalInterval,
  completeCaptureJournalCapturedChunk,
  createCaptureJournal,
  deleteCaptureJournal,
  persistCaptureJournalRawChunk,
  readCaptureJournalManifest,
  readCaptureJournalSidecar,
  sealCaptureJournal,
  stopCaptureJournal,
  updateCaptureJournalActivityEvidence,
} from '../../electron/captureJournal';
import { buildCaptureActivityEvidence } from '../../src/utils/transcriptActivityEvidence';

describe('capture journal', () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempRoots
        .splice(0)
        .map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  const makeRoot = async () => {
    const root = await mkdtemp(join(tmpdir(), 'pluto-capture-journal-'));
    tempRoots.push(root);
    return root;
  };

  const mutateManifest = async (
    root: string,
    mutate: (manifest: Record<string, unknown>) => void,
  ) => {
    const manifest = await createCaptureJournal(root, {
      meetingId: 'meeting-123',
      startedAtMs: 1_000,
    });
    const manifestPath = join(root, manifest.manifestRelativePath);
    const parsed = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<
      string,
      unknown
    >;
    mutate(parsed);
    await writeFile(manifestPath, JSON.stringify(parsed));
  };

  const buildEvidence = (endTime = 5) =>
    buildCaptureActivityEvidence([{ startTime: 0, endTime, speaker: 'Me' }], {
      clock: {
        kind: 'meeting_relative_seconds',
        origin: 'recording_start',
      },
      thresholds: {
        rms: 0.01,
        dominanceRatio: 1.5,
        minimumSwitchIntervalMs: 250,
      },
      algorithmVersion: 'speaker_activity_v1',
    });

  it('creates a versioned per-meeting manifest', async () => {
    const root = await makeRoot();

    const manifest = await createCaptureJournal(root, {
      meetingId: 'meeting-123',
      startedAtMs: 1_000,
      schemaVersion: 3,
    });

    expect(manifest.schemaVersion).toBe(3);
    expect(manifest.meetingId).toBe('meeting-123');
    expect(manifest.lifecycleState).toBe('recording');
    expect(manifest.entries).toEqual([]);
    expect(manifest.artifactRootRelativePath).toBe(
      'meeting-123/capture-journal',
    );
    expect(manifest.activityEvidence).toBeUndefined();
    expect(manifest).toMatchObject({
      revision: 0,
      expectedSources: ['mic', 'system'],
      intervals: [],
      transcriptCheckpoints: [],
      acceptanceFrames: [],
    });
    expect('generation' in manifest ? manifest.generation : '').toMatch(
      /^[0-9a-f-]{16,}$/,
    );
  });

  it('enforces the v3 interval CAS and raw_durable to captured transition', async () => {
    const root = await makeRoot();
    const created = await createCaptureJournal(root, {
      meetingId: 'meeting-123',
      startedAtMs: 1_000,
      schemaVersion: 3,
    });
    if (created.schemaVersion !== 3) throw new Error('expected v3');
    const authorized = await authorizeCaptureJournalInterval(root, {
      meetingId: created.meetingId,
      generation: created.generation,
      expectedRevision: created.revision,
      sequence: 0,
      chunkStartSec: 0,
      chunkEndSec: 5,
    });
    expect(authorized.intervals[0].sources).toEqual({
      mic: { disposition: 'pending' },
      system: { disposition: 'pending' },
    });
    await expect(
      authorizeCaptureJournalInterval(root, {
        meetingId: created.meetingId,
        generation: created.generation,
        expectedRevision: created.revision,
        sequence: 1,
        chunkStartSec: 5,
        chunkEndSec: 10,
      }),
    ).rejects.toThrow(/revision conflict/i);

    const raw = await persistCaptureJournalRawChunk(root, {
      meetingId: created.meetingId,
      generation: created.generation,
      expectedRevision: authorized.revision,
      source: 'mic',
      sequence: 0,
      format: 'webm',
      data: Buffer.from('raw-webm'),
    });
    expect(raw.intervals[0].sources.mic.disposition).toBe('raw_durable');
    const rawDisposition = raw.intervals[0].sources.mic;
    if (rawDisposition.disposition !== 'raw_durable') throw new Error();
    const completed = await completeCaptureJournalCapturedChunk(root, {
      meetingId: created.meetingId,
      generation: created.generation,
      expectedRevision: raw.revision,
      source: 'mic',
      sequence: 0,
      rawChecksumSha256: rawDisposition.rawChecksumSha256,
      repairData: Buffer.from('repair-wav'),
    });
    expect(completed.manifest.intervals[0].sources.mic.disposition).toBe(
      'captured',
    );
    expect(completed.receipt).toMatchObject({
      generation: created.generation,
      manifestRevision: completed.manifest.revision,
      repairAudioRelativePath:
        'meeting-123/capture-journal/repair/mic-000000.wav',
    });
  });

  it('atomically appends and verifies transcript and acceptance sidecars', async () => {
    const root = await makeRoot();
    const created = await createCaptureJournal(root, {
      meetingId: 'meeting-123',
      startedAtMs: 1_000,
      schemaVersion: 3,
    });
    if (created.schemaVersion !== 3) throw new Error('expected v3');
    const authorized = await authorizeCaptureJournalInterval(root, {
      meetingId: created.meetingId,
      generation: created.generation,
      expectedRevision: created.revision,
      sequence: 0,
      chunkStartSec: 0,
      chunkEndSec: 5,
    });
    const raw = await persistCaptureJournalRawChunk(root, {
      meetingId: created.meetingId,
      generation: created.generation,
      expectedRevision: authorized.revision,
      source: 'mic',
      sequence: 0,
      format: 'wav',
      data: Buffer.from('raw'),
    });
    const rawDisposition = raw.intervals[0].sources.mic;
    if (rawDisposition.disposition !== 'raw_durable') throw new Error();
    const completed = await completeCaptureJournalCapturedChunk(root, {
      meetingId: created.meetingId,
      generation: created.generation,
      expectedRevision: raw.revision,
      source: 'mic',
      sequence: 0,
      rawChecksumSha256: rawDisposition.rawChecksumSha256,
      repairData: Buffer.from('wav'),
    });
    const configKey = createHash('sha256').update('config').digest('hex');
    const sidecar = {
      schemaVersion: 1 as const,
      meetingId: created.meetingId,
      source: 'mic' as const,
      sequence: 0,
      chunkChecksumSha256: completed.receipt.checksumSha256,
      chunkStartSec: 0,
      chunkEndSec: 5,
      transcriptionConfig: {
        backend: 'whisperx',
        preset: 'balanced',
        model: 'small',
        device: 'cpu',
        computeType: 'int8',
        languageMode: 'detected' as const,
        requestedLanguage: null,
        pipelineVersion: 'live_chunk_v1' as const,
      },
      backendResult: { detectedLanguage: 'en', providerLabel: 'local' },
      segments: [],
    };
    const checkpoint = await appendCaptureTranscriptCheckpoint(root, {
      receipt: completed.receipt,
      expectedManifestRevision: completed.manifest.revision,
      transcriptionConfigKey: configKey,
      sidecar,
    });
    const checkpointBytes = await readCaptureJournalSidecar(
      root,
      created.meetingId,
      checkpoint.checkpoint.relativePath,
      checkpoint.checkpoint.transcriptChecksumSha256,
    );
    expect(JSON.parse(checkpointBytes.toString())).toEqual(sidecar);

    const digest = createHash('sha256').update('activity').digest('hex');
    const frame = await appendCaptureTranscriptAcceptanceFrame(root, {
      meetingId: created.meetingId,
      generation: created.generation,
      expectedRevision: checkpoint.manifest.revision,
      sequence: 0,
      micCheckpointChecksumSha256:
        checkpoint.checkpoint.transcriptChecksumSha256,
      systemCheckpointChecksumSha256: null,
      activityEvidenceDigestSha256: digest,
      sidecar: { schemaVersion: 1, sequence: 0, acceptedSegments: [] },
    });
    expect(frame.manifest.acceptanceFrames).toEqual([frame.frame]);
  });

  it('resolves pending tuples at stopping and removes all artifacts on deletion', async () => {
    const root = await makeRoot();
    const created = await createCaptureJournal(root, {
      meetingId: 'meeting-123',
      startedAtMs: 1_000,
      schemaVersion: 3,
      sourceAvailability: { system: 'unavailable_at_start' },
    });
    if (created.schemaVersion !== 3) throw new Error('expected v3');
    const authorized = await authorizeCaptureJournalInterval(root, {
      meetingId: created.meetingId,
      generation: created.generation,
      expectedRevision: created.revision,
      sequence: 0,
      chunkStartSec: 0,
      chunkEndSec: 5,
    });
    const stopped = await stopCaptureJournal(root, {
      meetingId: created.meetingId,
      generation: created.generation,
      expectedRevision: authorized.revision,
    });
    expect(stopped.intervals[0].sources).toEqual({
      mic: { disposition: 'missing', reason: 'pending_at_stop' },
      system: {
        disposition: 'source_unavailable',
        reason: 'unavailable_at_start',
      },
    });
    await deleteCaptureJournal(root, created.meetingId);
    await expect(
      stat(join(root, 'meeting-123', 'capture-journal')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('reads a legacy v1 manifest as uncertain evidence', async () => {
    const root = await makeRoot();
    const artifactRoot = join(root, 'meeting-123', 'capture-journal');
    await mkdir(artifactRoot, { recursive: true });
    const legacy = {
      schemaVersion: 1,
      meetingId: 'meeting-123',
      artifactRootRelativePath: 'meeting-123/capture-journal',
      manifestRelativePath: 'meeting-123/capture-journal/manifest.json',
      lifecycleState: 'recording',
      startedAtMs: 1_000,
      endedAtMs: null,
      entries: [],
    };
    await writeFile(
      join(artifactRoot, 'manifest.json'),
      JSON.stringify(legacy),
    );

    expect(await readCaptureJournalManifest(root, 'meeting-123')).toEqual(
      legacy,
    );
  });

  it('rejects appending to a legacy v1 journal without changing disk state', async () => {
    const root = await makeRoot();
    const artifactRoot = join(root, 'meeting-123', 'capture-journal');
    await mkdir(artifactRoot, { recursive: true });
    const manifestPath = join(artifactRoot, 'manifest.json');
    await writeFile(
      manifestPath,
      JSON.stringify({
        schemaVersion: 1,
        meetingId: 'meeting-123',
        artifactRootRelativePath: 'meeting-123/capture-journal',
        manifestRelativePath: 'meeting-123/capture-journal/manifest.json',
        lifecycleState: 'recording',
        startedAtMs: 1_000,
        endedAtMs: null,
        entries: [],
      }),
    );
    const before = await readFile(manifestPath, 'utf8');

    await expect(
      appendCaptureJournalChunk(root, {
        meetingId: 'meeting-123',
        source: 'mic',
        sequence: 0,
        chunkStartSec: 0,
        chunkEndSec: 5,
        format: 'wav',
        data: Buffer.from('mic-bytes'),
      }),
    ).rejects.toThrow(/legacy capture journal/i);

    expect(await readFile(manifestPath, 'utf8')).toBe(before);
    expect(await readdir(artifactRoot)).toEqual(['manifest.json']);
  });

  it('rejects activity evidence updates to v1 without changing disk state', async () => {
    const root = await makeRoot();
    const artifactRoot = join(root, 'meeting-123', 'capture-journal');
    await mkdir(artifactRoot, { recursive: true });
    const manifestPath = join(artifactRoot, 'manifest.json');
    await writeFile(
      manifestPath,
      JSON.stringify({
        schemaVersion: 1,
        meetingId: 'meeting-123',
        artifactRootRelativePath: 'meeting-123/capture-journal',
        manifestRelativePath: 'meeting-123/capture-journal/manifest.json',
        lifecycleState: 'recording',
        startedAtMs: 1_000,
        endedAtMs: null,
        entries: [],
      }),
    );
    const before = await readFile(manifestPath, 'utf8');

    await expect(
      updateCaptureJournalActivityEvidence(root, {
        meetingId: 'meeting-123',
        activityEvidence: await buildEvidence(),
      }),
    ).rejects.toThrow(/legacy capture journal/i);

    expect(await readFile(manifestPath, 'utf8')).toBe(before);
    expect(await readdir(artifactRoot)).toEqual(['manifest.json']);
  });

  it('durably persists canonical activity evidence', async () => {
    const root = await makeRoot();
    await createCaptureJournal(root, {
      meetingId: 'meeting-123',
      startedAtMs: 1_000,
    });
    const activityEvidence = await buildEvidence();
    const events: string[] = [];
    const durability = {
      syncFile: vi.fn(async (path: string) => events.push(`file:${path}`)),
      syncDirectory: vi.fn(async (path: string) =>
        events.push(`directory:${path}`),
      ),
    };

    const updated = await updateCaptureJournalActivityEvidence(
      root,
      { meetingId: 'meeting-123', activityEvidence },
      durability,
    );

    expect(updated.activityEvidence).toEqual(activityEvidence);
    expect(
      (await readCaptureJournalManifest(root, 'meeting-123')).activityEvidence,
    ).toEqual(activityEvidence);
    expect(events.map((event) => event.split(':')[0])).toEqual([
      'file',
      'directory',
    ]);
  });

  it('preserves both chunk and activity evidence across overlapping updates', async () => {
    const root = await makeRoot();
    await createCaptureJournal(root, {
      meetingId: 'meeting-123',
      startedAtMs: 1_000,
    });
    let releaseChunkSync = () => undefined;
    const chunkSyncBlocked = new Promise<void>((resolve) => {
      releaseChunkSync = resolve;
    });
    let markChunkSyncStarted = () => undefined;
    const chunkSyncStarted = new Promise<void>((resolve) => {
      markChunkSyncStarted = resolve;
    });
    let markEvidenceWritten = () => undefined;
    const evidenceWritten = new Promise<void>((resolve) => {
      markEvidenceWritten = resolve;
    });
    const appendDurability = {
      syncFile: vi.fn(async (path: string) => {
        if (path.endsWith('mic-000000.wav.tmp')) {
          markChunkSyncStarted();
          await chunkSyncBlocked;
        }
      }),
      syncDirectory: vi.fn(async () => undefined),
    };
    const updateDurability = {
      syncFile: vi.fn(async () => undefined),
      syncDirectory: vi.fn(async () => markEvidenceWritten()),
    };

    const append = appendCaptureJournalChunk(
      root,
      {
        meetingId: 'meeting-123',
        source: 'mic',
        sequence: 0,
        chunkStartSec: 0,
        chunkEndSec: 5,
        format: 'wav',
        data: Buffer.from('mic-bytes'),
      },
      appendDurability,
    );
    await chunkSyncStarted;
    const activityEvidence = await buildEvidence();
    const update = updateCaptureJournalActivityEvidence(
      root,
      { meetingId: 'meeting-123', activityEvidence },
      updateDurability,
    );

    await Promise.race([
      evidenceWritten,
      new Promise<void>((resolve) => setTimeout(resolve, 25)),
    ]);
    releaseChunkSync();
    await Promise.all([append, update]);

    const manifest = await readCaptureJournalManifest(root, 'meeting-123');
    expect(manifest.entries).toHaveLength(1);
    expect(manifest.schemaVersion).toBe(2);
    expect(manifest.activityEvidence).toEqual(activityEvidence);
  });

  it('treats identical activity evidence snapshots as idempotent', async () => {
    const root = await makeRoot();
    const activityEvidence = await buildEvidence();
    await updateCaptureJournalActivityEvidence(root, {
      meetingId: 'meeting-123',
      activityEvidence,
    });
    const durability = {
      syncFile: vi.fn(async () => undefined),
      syncDirectory: vi.fn(async () => undefined),
    };

    const duplicate = await updateCaptureJournalActivityEvidence(
      root,
      { meetingId: 'meeting-123', activityEvidence },
      durability,
    );

    expect(duplicate.activityEvidence).toEqual(activityEvidence);
    expect(durability.syncFile).not.toHaveBeenCalled();
  });

  it('rejects activity evidence snapshots older than the persisted final window', async () => {
    const root = await makeRoot();
    await updateCaptureJournalActivityEvidence(root, {
      meetingId: 'meeting-123',
      activityEvidence: await buildEvidence(10),
    });

    await expect(
      updateCaptureJournalActivityEvidence(root, {
        meetingId: 'meeting-123',
        activityEvidence: await buildEvidence(5),
      }),
    ).rejects.toThrow(/older activity evidence snapshot/i);
  });

  it('rejects conflicting activity evidence with the same window count', async () => {
    const root = await makeRoot();
    await updateCaptureJournalActivityEvidence(root, {
      meetingId: 'meeting-123',
      activityEvidence: await buildEvidence(5),
    });

    await expect(
      updateCaptureJournalActivityEvidence(root, {
        meetingId: 'meeting-123',
        activityEvidence: await buildEvidence(6),
      }),
    ).rejects.toThrow(/conflicting activity evidence snapshot/i);
  });

  it('rejects a longer snapshot that rewrites persisted windows', async () => {
    const root = await makeRoot();
    const stored = await buildEvidence(5);
    await updateCaptureJournalActivityEvidence(root, {
      meetingId: 'meeting-123',
      activityEvidence: stored,
    });

    await expect(
      updateCaptureJournalActivityEvidence(root, {
        meetingId: 'meeting-123',
        activityEvidence: await buildCaptureActivityEvidence(
          [
            { startTime: 0, endTime: 4, speaker: 'Them' },
            { startTime: 4, endTime: 8, speaker: 'Me' },
          ],
          {
            clock: stored.clock,
            thresholds: stored.thresholds,
            algorithmVersion: stored.algorithmVersion,
          },
        ),
      }),
    ).rejects.toThrow(/conflicting activity evidence snapshot/i);
  });

  it('rejects a longer snapshot that changes producer metadata', async () => {
    const root = await makeRoot();
    const stored = await buildEvidence(5);
    await updateCaptureJournalActivityEvidence(root, {
      meetingId: 'meeting-123',
      activityEvidence: stored,
    });

    await expect(
      updateCaptureJournalActivityEvidence(root, {
        meetingId: 'meeting-123',
        activityEvidence: await buildCaptureActivityEvidence(
          [...stored.windows, { startTime: 5, endTime: 8, speaker: 'Them' }],
          {
            clock: stored.clock,
            thresholds: {
              ...stored.thresholds,
              rms: stored.thresholds.rms + 1,
            },
            algorithmVersion: stored.algorithmVersion,
          },
        ),
      }),
    ).rejects.toThrow(/conflicting activity evidence snapshot/i);
  });

  it('rejects activity evidence snapshots with fewer windows even when they end later', async () => {
    const root = await makeRoot();
    const producer = {
      clock: {
        kind: 'meeting_relative_seconds' as const,
        origin: 'recording_start' as const,
      },
      thresholds: {
        rms: 0.01,
        dominanceRatio: 1.5,
        minimumSwitchIntervalMs: 250,
      },
      algorithmVersion: 'speaker_activity_v1' as const,
    };
    await updateCaptureJournalActivityEvidence(root, {
      meetingId: 'meeting-123',
      activityEvidence: await buildCaptureActivityEvidence(
        [
          { startTime: 0, endTime: 5, speaker: 'Me' },
          { startTime: 5, endTime: 10, speaker: 'Me' },
        ],
        producer,
      ),
    });

    await expect(
      updateCaptureJournalActivityEvidence(root, {
        meetingId: 'meeting-123',
        activityEvidence: await buildCaptureActivityEvidence(
          [{ startTime: 0, endTime: 12, speaker: 'Me' }],
          producer,
        ),
      }),
    ).rejects.toThrow(/older activity evidence snapshot/i);
  });

  it.each([
    '..',
    '.',
    '../escaped',
    'nested/meeting',
    'nested\\meeting',
    'bad\0id',
  ])(
    'rejects unsafe meeting ID %j before filesystem mutation',
    async (meetingId) => {
      const root = await makeRoot();

      await expect(
        createCaptureJournal(root, { meetingId, startedAtMs: 1_000 }),
      ).rejects.toThrow(/invalid capture journal meeting id/i);

      expect(await readdir(root)).toEqual([]);
    },
  );

  it.each<[string, (manifest: Record<string, unknown>) => void]>([
    [
      'meeting identity',
      (manifest) => {
        manifest.meetingId = 'meeting-other';
      },
    ],
    [
      'artifact root',
      (manifest) => {
        manifest.artifactRootRelativePath = '../outside';
      },
    ],
    [
      'manifest path',
      (manifest) => {
        manifest.manifestRelativePath = '../manifest.json';
      },
    ],
  ])('rejects a non-canonical manifest %s', async (_label, mutate) => {
    const root = await makeRoot();
    await mutateManifest(root, mutate);

    await expect(
      readCaptureJournalManifest(root, 'meeting-123'),
    ).rejects.toThrow(/invalid capture journal manifest/i);
  });

  it('rejects a chunk entry whose path is not canonical for its metadata', async () => {
    const root = await makeRoot();
    const manifest = await appendCaptureJournalChunk(root, {
      meetingId: 'meeting-123',
      source: 'mic',
      sequence: 2,
      chunkStartSec: 0,
      chunkEndSec: 1,
      format: 'audio/wav',
      data: Buffer.from('mic'),
    });
    const manifestPath = join(root, manifest.manifestRelativePath);
    const parsed = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      entries: Array<{ relativePath: string }>;
    };
    parsed.entries[0].relativePath = '../sentinel.wav';
    await writeFile(manifestPath, JSON.stringify(parsed));

    await expect(
      readCaptureJournalManifest(root, 'meeting-123'),
    ).rejects.toThrow(/invalid capture journal manifest entry path/i);
  });

  it('appends chunks with stable relative paths and checksum metadata', async () => {
    const root = await makeRoot();
    await createCaptureJournal(root, {
      meetingId: 'meeting-123',
      startedAtMs: 1_000,
    });

    const manifest = await appendCaptureJournalChunk(root, {
      meetingId: 'meeting-123',
      source: 'mic',
      sequence: 0,
      chunkStartSec: 0,
      chunkEndSec: 5,
      format: 'wav',
      data: Buffer.from('mic-bytes'),
    });

    expect(manifest.entries).toHaveLength(1);
    expect(manifest.entries[0]).toMatchObject({
      source: 'mic',
      sequence: 0,
      chunkStartSec: 0,
      chunkEndSec: 5,
      format: 'wav',
      byteCount: 9,
      relativePath: 'meeting-123/capture-journal/chunks/mic-000000.wav',
    });
    expect(manifest.entries[0].checksumSha256).toMatch(/^[a-f0-9]{64}$/);

    const fileStats = await stat(join(root, manifest.entries[0].relativePath));
    expect(fileStats.size).toBe(9);
  });

  it('syncs chunk and manifest files plus their directories before acknowledging append', async () => {
    const root = await makeRoot();
    const events: string[] = [];
    const durability = {
      syncFile: vi.fn(async (path: string) => {
        events.push(`file:${path.slice(root.length + 1)}`);
      }),
      syncDirectory: vi.fn(async (path: string) => {
        events.push(`directory:${path.slice(root.length + 1)}`);
      }),
    };
    await createCaptureJournal(
      root,
      { meetingId: 'meeting-123', startedAtMs: 1_000 },
      durability,
    );
    events.length = 0;

    await appendCaptureJournalChunk(
      root,
      {
        meetingId: 'meeting-123',
        source: 'mic',
        sequence: 0,
        chunkStartSec: 0,
        chunkEndSec: 5,
        format: 'wav',
        data: Buffer.from('mic-bytes'),
      },
      durability,
    );

    expect(events).toEqual([
      'file:meeting-123/capture-journal/chunks/mic-000000.wav.tmp',
      'directory:meeting-123/capture-journal/chunks',
      'file:meeting-123/capture-journal/manifest.json.tmp',
      'directory:meeting-123/capture-journal',
    ]);
  });

  it('rejects append when stable-storage sync fails', async () => {
    const root = await makeRoot();
    await createCaptureJournal(root, {
      meetingId: 'meeting-123',
      startedAtMs: 1_000,
    });
    const durability = {
      syncFile: vi.fn(async () => {
        throw new Error('synthetic sync failure');
      }),
      syncDirectory: vi.fn(async () => undefined),
    };

    await expect(
      appendCaptureJournalChunk(
        root,
        {
          meetingId: 'meeting-123',
          source: 'mic',
          sequence: 0,
          chunkStartSec: 0,
          chunkEndSec: 5,
          format: 'wav',
          data: Buffer.from('mic-bytes'),
        },
        durability,
      ),
    ).rejects.toThrow('synthetic sync failure');

    const manifest = await readCaptureJournalManifest(root, 'meeting-123');
    expect(manifest.entries).toEqual([]);
    expect(durability.syncDirectory).not.toHaveBeenCalled();
  });

  it('treats duplicate appends as idempotent', async () => {
    const root = await makeRoot();
    await createCaptureJournal(root, {
      meetingId: 'meeting-123',
      startedAtMs: 1_000,
    });

    await appendCaptureJournalChunk(root, {
      meetingId: 'meeting-123',
      source: 'system',
      sequence: 2,
      chunkStartSec: 10,
      chunkEndSec: 15,
      format: 'wav',
      data: Buffer.from('system-bytes'),
    });
    const manifest = await appendCaptureJournalChunk(root, {
      meetingId: 'meeting-123',
      source: 'system',
      sequence: 2,
      chunkStartSec: 10,
      chunkEndSec: 15,
      format: 'wav',
      data: Buffer.from('system-bytes'),
    });

    expect(manifest.entries).toHaveLength(1);
  });

  it('rejects duplicate delivery when the stored chunk checksum changed', async () => {
    const root = await makeRoot();
    await createCaptureJournal(root, {
      meetingId: 'meeting-123',
      startedAtMs: 1_000,
    });
    const original = Buffer.from('mic-bytes');
    const appended = await appendCaptureJournalChunk(root, {
      meetingId: 'meeting-123',
      source: 'mic',
      sequence: 0,
      chunkStartSec: 0,
      chunkEndSec: 5,
      format: 'wav',
      data: original,
    });
    await writeFile(
      join(root, appended.entries[0].relativePath),
      Buffer.from('bad-bytes'),
    );

    await expect(
      appendCaptureJournalChunk(root, {
        meetingId: 'meeting-123',
        source: 'mic',
        sequence: 0,
        chunkStartSec: 0,
        chunkEndSec: 5,
        format: 'wav',
        data: original,
      }),
    ).rejects.toThrow(/artifact checksum mismatch/i);

    const manifest = await readCaptureJournalManifest(root, 'meeting-123');
    expect(manifest.entries).toHaveLength(1);
  });

  it('seals the journal and blocks later mutation', async () => {
    const root = await makeRoot();
    await createCaptureJournal(root, {
      meetingId: 'meeting-123',
      startedAtMs: 1_000,
    });
    await appendCaptureJournalChunk(root, {
      meetingId: 'meeting-123',
      source: 'mic',
      sequence: 0,
      chunkStartSec: 0,
      chunkEndSec: 5,
      format: 'wav',
      data: Buffer.from('mic-bytes'),
    });
    const activityEvidence = await buildEvidence();
    await updateCaptureJournalActivityEvidence(root, {
      meetingId: 'meeting-123',
      activityEvidence,
    });

    const sealed = await sealCaptureJournal(root, {
      meetingId: 'meeting-123',
      endedAtMs: 6_000,
    });

    expect(sealed.lifecycleState).toBe('sealed');
    expect(sealed.endedAtMs).toBe(6_000);
    expect(sealed.schemaVersion).toBe(2);
    expect(sealed.activityEvidence).toEqual(activityEvidence);
    expect(await readCaptureJournalManifest(root, 'meeting-123')).toEqual(
      sealed,
    );

    await expect(
      appendCaptureJournalChunk(root, {
        meetingId: 'meeting-123',
        source: 'mic',
        sequence: 1,
        chunkStartSec: 5,
        chunkEndSec: 10,
        format: 'wav',
        data: Buffer.from('later-bytes'),
      }),
    ).rejects.toThrow(/sealed/i);
  });

  it('rejects sealing a legacy v1 journal', async () => {
    const root = await makeRoot();
    const artifactRoot = join(root, 'meeting-123', 'capture-journal');
    await mkdir(artifactRoot, { recursive: true });
    await writeFile(
      join(artifactRoot, 'manifest.json'),
      JSON.stringify({
        schemaVersion: 1,
        meetingId: 'meeting-123',
        artifactRootRelativePath: 'meeting-123/capture-journal',
        manifestRelativePath: 'meeting-123/capture-journal/manifest.json',
        lifecycleState: 'recording',
        startedAtMs: 1_000,
        endedAtMs: null,
        entries: [],
      }),
    );

    await expect(
      sealCaptureJournal(root, {
        meetingId: 'meeting-123',
        endedAtMs: 6_000,
      }),
    ).rejects.toThrow(/legacy capture journal/i);
  });

  it('rejects a sealed v2 manifest without activity evidence', async () => {
    const root = await makeRoot();
    await mutateManifest(root, (manifest) => {
      manifest.lifecycleState = 'sealed';
      manifest.endedAtMs = 6_000;
    });

    await expect(
      readCaptureJournalManifest(root, 'meeting-123'),
    ).rejects.toThrow('capture_activity_missing');
  });

  it('rejects sealing a recording v3 journal before stopping', async () => {
    const root = await makeRoot();
    await createCaptureJournal(root, {
      meetingId: 'meeting-123',
      startedAtMs: 1_000,
      schemaVersion: 3,
    });

    await expect(
      sealCaptureJournal(root, {
        meetingId: 'meeting-123',
        endedAtMs: 6_000,
      }),
    ).rejects.toThrow(/must enter stopping/i);
  });

  it.each([
    [
      'malformed',
      (evidence: Record<string, unknown>) => {
        evidence.clock = undefined;
      },
    ],
    [
      'unsupported',
      (evidence: Record<string, unknown>) => {
        evidence.schemaVersion = 999;
      },
    ],
    [
      'digest_mismatch',
      (evidence: Record<string, unknown>) => {
        evidence.digestSha256 = '0'.repeat(64);
      },
    ],
  ])('rejects v2 activity evidence with %s reason', async (reason, mutate) => {
    const root = await makeRoot();
    const evidence = (await buildEvidence()) as unknown as Record<
      string,
      unknown
    >;
    mutate(evidence);
    await mutateManifest(root, (manifest) => {
      manifest.activityEvidence = evidence;
    });

    await expect(
      readCaptureJournalManifest(root, 'meeting-123'),
    ).rejects.toThrow(String(reason));
  });

  it('persists the manifest as JSON for later recovery work', async () => {
    const root = await makeRoot();
    await createCaptureJournal(root, {
      meetingId: 'meeting-123',
      startedAtMs: 1_000,
    });
    await appendCaptureJournalChunk(root, {
      meetingId: 'meeting-123',
      source: 'mic',
      sequence: 0,
      chunkStartSec: 0,
      chunkEndSec: 5,
      format: 'wav',
      data: Buffer.from('mic-bytes'),
    });

    const manifest = await readCaptureJournalManifest(root, 'meeting-123');
    const manifestJson = JSON.parse(
      await readFile(
        join(root, manifest.artifactRootRelativePath, 'manifest.json'),
        'utf8',
      ),
    );

    expect(manifestJson).toEqual(manifest);
  });
});
