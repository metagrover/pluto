import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  appendCaptureJournalChunk,
  createCaptureJournal,
  readCaptureJournalManifest,
  sealCaptureJournal,
} from '../../electron/captureJournal';

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

  it('creates a versioned per-meeting manifest', async () => {
    const root = await makeRoot();

    const manifest = await createCaptureJournal(root, {
      meetingId: 'meeting-123',
      startedAtMs: 1_000,
    });

    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.meetingId).toBe('meeting-123');
    expect(manifest.lifecycleState).toBe('recording');
    expect(manifest.entries).toEqual([]);
    expect(manifest.artifactRootRelativePath).toBe(
      'meeting-123/capture-journal',
    );
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

    const sealed = await sealCaptureJournal(root, {
      meetingId: 'meeting-123',
      endedAtMs: 6_000,
    });

    expect(sealed.lifecycleState).toBe('sealed');
    expect(sealed.endedAtMs).toBe(6_000);

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
